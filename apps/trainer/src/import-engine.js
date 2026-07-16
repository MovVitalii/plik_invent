/* ==========================================================
   Excel Analytics Trainer
   src/import-engine.js
========================================================== */

(function initializeImportEngine(global) {
    "use strict";

    const EAT = global.EAT || (global.EAT = {});

    if (
        !EAT.constants ||
        !EAT.state ||
        !EAT.utils ||
        !EAT.dom
    ) {
        throw new Error(
            "EAT core modules must be loaded before src/import-engine.js."
        );
    }

    const {
        STATUS,
        EVENTS,
        FILE_LIMITS
    } = EAT.constants;

    const {
        cleanText,
        rowHasValues,
        createUniqueHeaders,
        detectColumnTypes,
        formatInteger,
        yieldToBrowser,
        normalizeError
    } = EAT.utils;

    const state = EAT.state;
    const dom = EAT.dom;
    const elements = dom.elements;

    const handlers = [];

    let initialized = false;
    let importToken = 0;
    let workbook = null;
    let currentFileMeta = null;

    function initialize() {
        if (initialized) {
            return api;
        }

        assertSheetJs();

        bind(
            elements.fileInput,
            "change",
            handleFileInputChange
        );

        bind(
            elements.dropZone,
            "dragover",
            handleDragOver
        );

        bind(
            elements.dropZone,
            "dragleave",
            handleDragLeave
        );

        bind(
            elements.dropZone,
            "drop",
            handleDrop
        );

        bind(
            elements.sheetSelector,
            "change",
            handleSheetChange
        );

        bind(
            elements.analyzeSheetButton,
            "click",
            handleAnalyzeSheet
        );

        bind(
            global,
            EVENTS.WORKSPACE_RESET,
            handleWorkspaceReset
        );

        initialized = true;

        return api;
    }

    function destroy() {
        handlers.forEach(
            ({
                element,
                eventName,
                handler
            }) => {
                element.removeEventListener(
                    eventName,
                    handler
                );
            }
        );

        handlers.length = 0;

        importToken += 1;
        workbook = null;
        currentFileMeta = null;
        initialized = false;
    }

    function bind(
        element,
        eventName,
        handler
    ) {
        if (
            !element ||
            typeof element.addEventListener !==
                "function" ||
            !eventName ||
            typeof handler !== "function"
        ) {
            return;
        }

        element.addEventListener(
            eventName,
            handler
        );

        handlers.push({
            element,
            eventName,
            handler
        });
    }

    function handleFileInputChange(
        event
    ) {
        const file =
            event.target.files?.[0];

        event.target.value = "";

        if (file) {
            importFile(file);
        }
    }

    function handleDragOver(event) {
        event.preventDefault();

        elements.dropZone
            .classList.add(
                "is-over"
            );

        if (event.dataTransfer) {
            event.dataTransfer.dropEffect =
                "copy";
        }
    }

    function handleDragLeave(event) {
        if (
            !event.currentTarget.contains(
                event.relatedTarget
            )
        ) {
            elements.dropZone
                .classList.remove(
                    "is-over"
                );
        }
    }

    function handleDrop(event) {
        event.preventDefault();

        elements.dropZone
            .classList.remove(
                "is-over"
            );

        const file =
            event.dataTransfer
                ?.files?.[0];

        if (file) {
            importFile(file);
        }
    }

    function handleSheetChange(event) {
        const selectedSheet =
            event.target.value;

        state.set(
            "import.selectedSheet",
            selectedSheet
        );

        dom.renderFileSummary(
            currentFileMeta || {},
            {
                sheetNames:
                    workbook?.SheetNames ||
                    [],

                selectedSheet,

                rowCount:
                    estimateSheetRowCount(
                        selectedSheet
                    )
            }
        );
    }

    async function handleAnalyzeSheet() {
        await analyzeSelectedSheet();
    }

    function handleWorkspaceReset() {
        reset();
    }

    async function importFile(file) {
        const token =
            ++importToken;

        const validation =
            validateFile(file);

        if (!validation.valid) {
            dom.showError(
                validation.errors.join(" "),
                "Walidacja pliku"
            );

            return null;
        }

        try {
            assertSheetJs();
            state.clearError();

            state.setBusy({
                title:
                    "Wczytywanie pliku",

                message:
                    "Odczytywanie zawartości...",

                progress: 10
            });

            dom.setStatusBadge(
                elements.importStatus,
                "Wczytywanie...",
                STATUS.LOADING
            );

            const buffer =
                await file.arrayBuffer();

            if (token !== importToken) {
                return null;
            }

            state.updateBusy({
                message:
                    "Analizowanie skoroszytu...",

                progress: 45
            });

            await yieldToBrowser();

            workbook =
                global.XLSX.read(
                    buffer,
                    {
                        type: "array",
                        cellDates: true,
                        raw: true,
                        dense: false,
                        WTF: false
                    }
                );

            if (token !== importToken) {
                return null;
            }

            if (
                !workbook ||
                !Array.isArray(
                    workbook.SheetNames
                ) ||
                !workbook.SheetNames.length
            ) {
                throw new Error(
                    "Plik nie zawiera arkuszy możliwych do odczytania."
                );
            }

            currentFileMeta = {
                name:
                    file.name,

                size:
                    file.size,

                type:
                    file.type,

                lastModified:
                    file.lastModified
            };

            const selectedSheet =
                workbook.SheetNames[0];

            state.set(
                "import.fileMeta",
                {
                    ...currentFileMeta
                },
                {
                    notify: false
                }
            );

            state.set(
                "import.sheetNames",
                [
                    ...workbook.SheetNames
                ],
                {
                    notify: false
                }
            );

            state.set(
                "import.selectedSheet",
                selectedSheet
            );

            dom.renderFileSummary(
                currentFileMeta,
                {
                    sheetNames:
                        workbook.SheetNames,

                    selectedSheet,

                    rowCount:
                        estimateSheetRowCount(
                            selectedSheet
                        )
                }
            );

            dom.setStatusBadge(
                elements.importStatus,
                "Plik gotowy",
                STATUS.SUCCESS
            );

            state.clearBusy(
                STATUS.READY
            );

            dom.showSuccess(
                `Wczytano plik „${file.name}” z ${formatInteger(
                    workbook.SheetNames.length
                )} arkuszami.`,

                "Import"
            );

            return {
                fileMeta:
                    currentFileMeta,

                sheetNames: [
                    ...workbook.SheetNames
                ]
            };
        } catch (error) {
            return handleImportError(
                error
            );
        }
    }

    async function analyzeSelectedSheet(
        requestedSheetName = null
    ) {
        const token =
            ++importToken;

        if (!workbook) {
            dom.showWarning(
                "Najpierw wczytaj plik.",
                "Import"
            );

            return null;
        }

        const selectedSheet =
            requestedSheetName ||
            elements.sheetSelector.value ||
            state.get(
                "import.selectedSheet",
                ""
            );

        if (
            !selectedSheet ||
            !workbook.Sheets[
                selectedSheet
            ]
        ) {
            dom.showWarning(
                "Wybierz poprawny arkusz.",
                "Import"
            );

            return null;
        }

        try {
            state.clearError();

            state.setBusy({
                title:
                    "Analiza arkusza",

                message:
                    "Wyszukiwanie nagłówków...",

                progress: 10
            });

            dom.setStatusBadge(
                elements.importStatus,
                "Analiza...",
                STATUS.PROCESSING
            );

            await yieldToBrowser();

            const matrix =
                global.XLSX.utils
                    .sheet_to_json(
                        workbook.Sheets[
                            selectedSheet
                        ],
                        {
                            header: 1,
                            defval: "",
                            raw: true,
                            blankrows: false
                        }
                    );

            if (token !== importToken) {
                return null;
            }

            const headerRowIndex =
                findHeaderRowIndex(
                    matrix
                );

            if (headerRowIndex < 0) {
                throw new Error(
                    "Nie znaleziono wiersza nagłówków."
                );
            }

            const sourceHeaders =
                matrix[
                    headerRowIndex
                ] || [];

            const headers =
                createUniqueHeaders(
                    sourceHeaders
                );

            if (!headers.length) {
                throw new Error(
                    "Wiersz nagłówków jest pusty."
                );
            }

            state.updateBusy({
                message:
                    "Tworzenie tabeli danych...",

                progress: 45
            });

            const rows = [];

            for (
                let rowIndex =
                    headerRowIndex + 1;
                rowIndex <
                    matrix.length;
                rowIndex += 1
            ) {
                const sourceRow =
                    matrix[rowIndex] || [];

                if (
                    !rowHasValues(
                        sourceRow
                    )
                ) {
                    continue;
                }

                const row = {};

                headers.forEach(
                    (
                        header,
                        columnIndex
                    ) => {
                        row[header] =
                            sourceRow[
                                columnIndex
                            ] ?? "";
                    }
                );

                rows.push(row);

                if (
                    rows.length >=
                    FILE_LIMITS
                        .maximumPreviewRows
                ) {
                    break;
                }
            }

            if (!rows.length) {
                throw new Error(
                    "Arkusz nie zawiera wierszy danych pod nagłówkami."
                );
            }

            await yieldToBrowser();

            if (token !== importToken) {
                return null;
            }

            const detectedTypes =
                detectColumnTypes(
                    headers,
                    rows
                );

            state.setImportedData({
                fileMeta:
                    currentFileMeta ||
                    state.get(
                        "import.fileMeta",
                        {}
                    ),

                sheetNames:
                    workbook.SheetNames,

                selectedSheet,
                headers,
                rows,
                detectedTypes
            });

            dom.renderFileSummary(
                currentFileMeta || {},
                {
                    sheetNames:
                        workbook.SheetNames,

                    selectedSheet,

                    rowCount:
                        rows.length
                }
            );

            dom.setStatusBadge(
                elements.importStatus,
                `${formatInteger(
                    rows.length
                )} wierszy`,
                STATUS.SUCCESS
            );

            dom.setStatusBadge(
                elements.previewStatus,
                `${formatInteger(
                    rows.length
                )} wierszy`,
                STATUS.SUCCESS
            );

            state.clearBusy(
                STATUS.READY
            );

            dom.showSuccess(
                `Przygotowano ${formatInteger(
                    rows.length
                )} wierszy i ${formatInteger(
                    headers.length
                )} kolumn.`,

                "Arkusz gotowy"
            );

            return {
                selectedSheet,
                headers,
                rows,
                detectedTypes
            };
        } catch (error) {
            return handleImportError(
                error
            );
        }
    }

    function findHeaderRowIndex(
        matrix
    ) {
        const maximumRows =
            Math.min(
                25,
                matrix.length
            );

        let bestIndex = -1;
        let bestScore = -1;

        for (
            let index = 0;
            index < maximumRows;
            index += 1
        ) {
            const row =
                matrix[index] || [];

            const nonEmpty =
                row.filter(
                    (value) =>
                        cleanText(value)
                ).length;

            const textValues =
                row.filter(
                    (value) =>
                        typeof value ===
                            "string" &&
                        cleanText(value)
                ).length;

            const score =
                nonEmpty * 2 +
                textValues;

            if (
                nonEmpty >= 1 &&
                score > bestScore
            ) {
                bestScore = score;
                bestIndex = index;
            }
        }

        return bestIndex;
    }

    function estimateSheetRowCount(
        sheetName
    ) {
        const sheet =
            workbook?.Sheets?.[
                sheetName
            ];

        if (
            !sheet ||
            !sheet["!ref"]
        ) {
            return 0;
        }

        try {
            const range =
                global.XLSX.utils
                    .decode_range(
                        sheet["!ref"]
                    );

            return Math.max(
                0,
                range.e.r -
                range.s.r
            );
        } catch {
            return 0;
        }
    }

    function validateFile(file) {
        const errors = [];

        if (
            !(file instanceof File)
        ) {
            errors.push(
                "Nie wybrano poprawnego pliku."
            );

            return {
                valid: false,
                errors
            };
        }

        if (
            file.size >
            FILE_LIMITS.maximumBytes
        ) {
            errors.push(
                "Plik przekracza limit 50 MB."
            );
        }

        const extension =
            file.name
                .split(".")
                .pop()
                ?.toLocaleLowerCase(
                    "pl-PL"
                );

        if (
            ![
                "xlsx",
                "xls",
                "xlsm",
                "xlsb",
                "csv",
                "tsv",
                "ods"
            ].includes(extension)
        ) {
            errors.push(
                "Obsługiwane są pliki Excel, CSV, TSV i ODS."
            );
        }

        return {
            valid:
                errors.length === 0,

            errors
        };
    }

    function reset() {
        importToken += 1;
        workbook = null;
        currentFileMeta = null;
        dom.resetImportUI();
    }

    function assertSheetJs() {
        if (
            !global.XLSX ||
            typeof global.XLSX.read !==
                "function" ||
            !global.XLSX.utils
        ) {
            throw new Error(
                "Biblioteka SheetJS nie została załadowana."
            );
        }
    }

    function handleImportError(error) {
        const normalized =
            normalizeError(
                error,
                "Import"
            );

        state.setError(
            error,
            "Import"
        );

        state.clearBusy(
            STATUS.ERROR
        );

        dom.setStatusBadge(
            elements.importStatus,
            "Błąd",
            STATUS.ERROR
        );

        dom.showError(
            normalized.message,
            "Import"
        );

        return null;
    }

    const api = Object.freeze({
        initialize,
        destroy,

        importFile,
        analyzeSelectedSheet,
        validateFile,
        findHeaderRowIndex,
        estimateSheetRowCount,
        reset,

        get workbook() {
            return workbook;
        },

        get initialized() {
            return initialized;
        }
    });

    Object.defineProperty(
        EAT,
        "importEngine",
        {
            value: api,
            writable: false,
            enumerable: true,
            configurable: false
        }
    );
})(window);
