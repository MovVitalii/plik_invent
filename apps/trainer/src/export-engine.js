/* ==========================================================
   Excel Analytics Trainer
   src/export-engine.js
========================================================== */

(function initializeExportEngine(global) {
    "use strict";

    const EAT = global.EAT || (global.EAT = {});

    if (
        !EAT.constants ||
        !EAT.state ||
        !EAT.utils ||
        !EAT.dom
    ) {
        throw new Error(
            "EAT core modules must be loaded before src/export-engine.js."
        );
    }

    const {
        APP,
        STATUS,
        EVENTS,
        SECTIONS
    } = EAT.constants;

    const {
        isBlank,
        cleanText,
        formatInteger,
        formatDateTime,
        downloadBlob,
        yieldToBrowser,
        normalizeError
    } = EAT.utils;

    const state = EAT.state;
    const dom = EAT.dom;
    const elements = dom.elements;

    const handlers = [];

    const MAX_WIDTH_SAMPLE_ROWS = 500;
    const MIN_COLUMN_WIDTH = 10;
    const MAX_COLUMN_WIDTH = 42;

    let initialized = false;
    let exportToken = 0;

    function initialize() {
        if (initialized) {
            return api;
        }

        assertSheetJs();

        bind(
            elements.exportButton,
            "click",
            handleMainExport
        );

        bind(
            elements.exportCleanDataButton,
            "click",
            () =>
                exportCleanDataWorkbook()
        );

        bind(
            elements.exportAnalysisButton,
            "click",
            () =>
                exportAnalysisWorkbook()
        );

        [
            EVENTS.DATA_READY,
            EVENTS.CLEANING_APPLIED,
            EVENTS.CLEANING_UNDONE,
            EVENTS.QUALITY_COMPLETED,
            EVENTS.CALCULATION_COMPLETED,
            EVENTS.PIVOT_BUILT,
            EVENTS.WORKSPACE_RESET
        ].forEach((eventName) => {
            bind(
                global,
                eventName,
                syncAvailability
            );
        });

        syncAvailability();

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
        exportToken += 1;
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

    async function handleMainExport() {
        if (
            validateAnalysisExport()
                .valid
        ) {
            await exportAnalysisWorkbook();
        } else {
            await exportCleanDataWorkbook();
        }
    }

    async function exportCleanDataWorkbook(
        options = {}
    ) {
        const token =
            ++exportToken;

        const validation =
            validateCleanDataExport();

        if (!validation.valid) {
            dom.showWarning(
                validation.errors.join(" "),
                "Eksport danych"
            );

            return null;
        }

        try {
            assertSheetJs();

            state.setBusy({
                title:
                    "Eksport danych",

                message:
                    "Tworzenie skoroszytu...",

                progress: 20
            });

            await yieldToBrowser();

            const headers =
                state.get(
                    "import.headers",
                    []
                );

            const rows =
                state.get(
                    "table.workingRows",
                    []
                );

            const workbook =
                createWorkbook();

            appendWorksheet(
                workbook,
                createDataWorksheet(
                    headers,
                    rows
                ),
                "Czyste dane"
            );

            appendMetadataWorksheet(
                workbook,
                {
                    exportType:
                        "Czyste dane",
                    sourceRowCount:
                        rows.length,
                    exportedSheetCount: 2
                }
            );

            if (
                token !== exportToken
            ) {
                return null;
            }

            const fileName =
                options.fileName ||
                buildExportFileName(
                    "czyste-dane",
                    ".xlsx"
                );

            global.XLSX.writeFile(
                workbook,
                fileName,
                {
                    compression: true,
                    cellDates: true
                }
            );

            state.setExportRecord(
                "clean-data-xlsx",
                fileName
            );

            state.completeSection(
                SECTIONS.REPORT
            );

            updateLearningContext(
                fileName
            );

            state.clearBusy(
                STATUS.READY
            );

            dom.showSuccess(
                `Wyeksportowano ${formatInteger(
                    rows.length
                )} wierszy do pliku „${fileName}”.`,

                "Eksport zakończony"
            );

            return {
                type:
                    "clean-data-xlsx",
                fileName,
                rowCount:
                    rows.length,
                sheetNames: [
                    ...workbook.SheetNames
                ]
            };
        } catch (error) {
            return handleExportError(
                error,
                "Eksport czystych danych"
            );
        }
    }

    async function exportCleanDataCsv(
        options = {}
    ) {
        const validation =
            validateCleanDataExport();

        if (!validation.valid) {
            dom.showWarning(
                validation.errors.join(" "),
                "Eksport CSV"
            );

            return null;
        }

        try {
            const headers =
                state.get(
                    "import.headers",
                    []
                );

            const rows =
                state.get(
                    "table.workingRows",
                    []
                );

            const delimiter =
                options.delimiter || ";";

            const csv =
                createCsvContent(
                    headers,
                    rows,
                    delimiter
                );

            const fileName =
                options.fileName ||
                buildExportFileName(
                    "czyste-dane",
                    ".csv"
                );

            downloadBlob(
                new Blob(
                    [
                        "\uFEFF",
                        csv
                    ],
                    {
                        type:
                            "text/csv;charset=utf-8"
                    }
                ),
                fileName
            );

            state.setExportRecord(
                "clean-data-csv",
                fileName
            );

            updateLearningContext(
                fileName
            );

            return {
                type:
                    "clean-data-csv",
                fileName,
                rowCount:
                    rows.length
            };
        } catch (error) {
            return handleExportError(
                error,
                "Eksport CSV"
            );
        }
    }

    async function exportAnalysisWorkbook(
        options = {}
    ) {
        const token =
            ++exportToken;

        const validation =
            validateAnalysisExport();

        if (!validation.valid) {
            dom.showWarning(
                validation.errors.join(" "),
                "Eksport analizy"
            );

            return null;
        }

        try {
            assertSheetJs();

            state.setBusy({
                title:
                    "Eksport analizy",

                message:
                    "Tworzenie skoroszytu raportowego...",

                progress: 10
            });

            await yieldToBrowser();

            const headers =
                state.get(
                    "import.headers",
                    []
                );

            const rows =
                state.get(
                    "table.workingRows",
                    []
                );

            const workbook =
                createWorkbook();

            appendWorksheet(
                workbook,
                createDataWorksheet(
                    headers,
                    rows
                ),
                "Czyste dane"
            );

            const quality =
                state.get(
                    "quality",
                    null
                );

            if (quality?.completed) {
                appendWorksheet(
                    workbook,
                    createQualityWorksheet(
                        quality
                    ),
                    "Jakość danych"
                );
            }

            const calculation =
                state.get(
                    "calculation",
                    null
                );

            if (
                hasCalculationResult(
                    calculation
                )
            ) {
                appendWorksheet(
                    workbook,
                    createCalculationWorksheet(
                        calculation
                    ),
                    "Obliczenie"
                );
            }

            const pivot =
                state.get(
                    "pivot.result",
                    null
                );

            if (pivot) {
                appendWorksheet(
                    workbook,
                    createPivotWorksheet(
                        pivot
                    ),
                    "Tabela przestawna"
                );

                const chartSheet =
                    createChartDataWorksheet(
                        pivot
                    );

                if (chartSheet) {
                    appendWorksheet(
                        workbook,
                        chartSheet,
                        "Dane wykresu"
                    );
                }
            }

            const history =
                state.get(
                    "cleaning.history",
                    []
                );

            if (history.length) {
                appendWorksheet(
                    workbook,
                    createCleaningHistoryWorksheet(
                        history
                    ),
                    "Historia zmian"
                );
            }

            appendMetadataWorksheet(
                workbook,
                {
                    exportType:
                        "Pełna analiza",
                    sourceRowCount:
                        rows.length,
                    exportedSheetCount:
                        workbook
                            .SheetNames
                            .length + 1
                }
            );

            if (
                token !== exportToken
            ) {
                return null;
            }

            const fileName =
                options.fileName ||
                buildExportFileName(
                    "analiza",
                    ".xlsx"
                );

            global.XLSX.writeFile(
                workbook,
                fileName,
                {
                    compression: true,
                    cellDates: true
                }
            );

            state.setExportRecord(
                "analysis-xlsx",
                fileName
            );

            state.completeSection(
                SECTIONS.REPORT
            );

            updateLearningContext(
                fileName
            );

            state.clearBusy(
                STATUS.READY
            );

            dom.showSuccess(
                `Utworzono raport „${fileName}” zawierający ${formatInteger(
                    workbook.SheetNames.length
                )} arkuszy.`,

                "Eksport analizy"
            );

            return {
                type:
                    "analysis-xlsx",
                fileName,
                rowCount:
                    rows.length,
                sheetNames: [
                    ...workbook.SheetNames
                ]
            };
        } catch (error) {
            return handleExportError(
                error,
                "Eksport analizy"
            );
        }
    }

    function createWorkbook() {
        assertSheetJs();

        const workbook =
            global.XLSX.utils
                .book_new();

        workbook.Props = {
            Title:
                `${APP.name} — raport`,
            Subject:
                "Analiza danych Excel",
            Author:
                APP.name,
            Company:
                APP.name,
            Category:
                "Data analysis",
            Keywords:
                "Excel, analiza, pivot, jakość danych",
            Comments:
                "Plik utworzony lokalnie w przeglądarce.",
            CreatedDate:
                new Date()
        };

        return workbook;
    }

    function appendWorksheet(
        workbook,
        worksheet,
        requestedName
    ) {
        const safeName =
            createUniqueSheetName(
                workbook,
                requestedName
            );

        global.XLSX.utils
            .book_append_sheet(
                workbook,
                worksheet,
                safeName
            );

        return safeName;
    }

    function createDataWorksheet(
        headers,
        rows
    ) {
        const orderedRows =
            rows.map((row) => {
                const result = {};

                headers.forEach((header) => {
                    result[header] =
                        normalizeExportValue(
                            row?.[header]
                        );
                });

                return result;
            });

        const sheet =
            global.XLSX.utils
                .json_to_sheet(
                    orderedRows,
                    {
                        header:
                            headers,
                        cellDates: true
                    }
                );

        applyObjectLayout(
            sheet,
            headers,
            orderedRows
        );

        return sheet;
    }

    function createQualityWorksheet(
        report
    ) {
        const summaryRows = [
            {
                Wskaźnik:
                    "Liczba wierszy",
                Wartość:
                    report.rowCount || 0
            },
            {
                Wskaźnik:
                    "Liczba kolumn",
                Wartość:
                    report.columnCount || 0
            },
            {
                Wskaźnik:
                    "Puste komórki",
                Wartość:
                    report.emptyCellCount || 0
            },
            {
                Wskaźnik:
                    "Pełne duplikaty",
                Wartość:
                    report.duplicateRowCount || 0
            },
            {
                Wskaźnik:
                    "Błędy typów",
                Wartość:
                    report.typeErrorCount || 0
            }
        ];

        const sheet =
            global.XLSX.utils
                .json_to_sheet(
                    summaryRows
                );

        const columnRows =
            (
                report.columns || []
            ).map((column) => ({
                Kolumna:
                    column.name || "",
                Typ:
                    column.type || "",
                "Typ dominujący":
                    column.dominantType || "",
                Wiersze:
                    column.rowCount || 0,
                Niepuste:
                    column.populatedCount || 0,
                Puste:
                    column.emptyCount || 0,
                Unikalne:
                    column.uniqueCount || 0,
                "Błędy typu":
                    column.typeErrorCount || 0,
                Minimum:
                    normalizeExportValue(
                        column.minimum
                    ),
                Maksimum:
                    normalizeExportValue(
                        column.maximum
                    ),
                Średnia:
                    column.average ?? "",
                Suma:
                    column.sum ?? "",
                Problemy:
                    Array.isArray(
                        column.problems
                    )
                        ? column.problems
                            .join("; ")
                        : ""
            }));

        if (columnRows.length) {
            global.XLSX.utils
                .sheet_add_json(
                    sheet,
                    columnRows,
                    {
                        origin: "A8"
                    }
                );
        }

        sheet["!cols"] =
            Array.from(
                {
                    length: 13
                },
                (
                    _,
                    index
                ) => ({
                    wch:
                        index === 12
                            ? 40
                            : 18
                })
            );

        applyFormats(sheet);

        return sheet;
    }

    function createCalculationWorksheet(
        calculation
    ) {
        const rows = [
            {
                Parametr: "Funkcja",
                Wartość:
                    calculation.functionId || ""
            },
            {
                Parametr:
                    "Kolumna wartości",
                Wartość:
                    calculation.valueColumn || ""
            },
            {
                Parametr: "Wynik",
                Wartość:
                    calculation.result ?? ""
            },
            {
                Parametr:
                    "Pasujące wiersze",
                Wartość:
                    calculation.matchedRows || 0
            },
            {
                Parametr:
                    "Formuła Excel",
                Wartość:
                    calculation.formula || ""
            },
            {
                Parametr:
                    "Wyjaśnienie",
                Wartość:
                    calculation.explanation || ""
            },
            {
                Parametr:
                    "Data wykonania",
                Wartość:
                    calculation.completedAt
                        ? new Date(
                            calculation
                                .completedAt
                        )
                        : ""
            }
        ];

        const sheet =
            global.XLSX.utils
                .json_to_sheet(
                    rows,
                    {
                        cellDates: true
                    }
                );

        const criteriaRows =
            (
                calculation.criteria || []
            ).map(
                (
                    criterion,
                    index
                ) => ({
                    Nr: index + 1,
                    Kolumna:
                        criterion.column || "",
                    Operator:
                        criterion.operator || "",
                    Wartość:
                        criterion.value ?? ""
                })
            );

        if (criteriaRows.length) {
            global.XLSX.utils
                .sheet_add_json(
                    sheet,
                    criteriaRows,
                    {
                        origin: "A10"
                    }
                );
        }

        sheet["!cols"] = [
            { wch: 24 },
            { wch: 60 },
            { wch: 20 },
            { wch: 25 }
        ];

        applyFormats(sheet);

        return sheet;
    }

    function createPivotWorksheet(
        pivot
    ) {
        const columns =
            pivot.columns || [];

        const matrix = [
            columns.map(
                (column) =>
                    column.label ||
                    column.key
            )
        ];

        (
            pivot.rows || []
        ).forEach((row) => {
            matrix.push(
                columns.map(
                    (column) =>
                        normalizeExportValue(
                            row?.[
                                column.key
                            ]
                        )
                )
            );
        });

        if (pivot.footer) {
            matrix.push(
                columns.map(
                    (column) =>
                        normalizeExportValue(
                            pivot.footer[
                                column.key
                            ]
                        )
                )
            );
        }

        const sheet =
            global.XLSX.utils
                .aoa_to_sheet(
                    matrix,
                    {
                        cellDates: true
                    }
                );

        applyMatrixLayout(
            sheet,
            matrix
        );

        return sheet;
    }

    function createChartDataWorksheet(
        pivot
    ) {
        const chart =
            pivot?.chart;

        if (
            !chart ||
            !Array.isArray(
                chart.labels
            ) ||
            !Array.isArray(
                chart.datasets
            ) ||
            !chart.labels.length
        ) {
            return null;
        }

        const matrix = [
            [
                "Kategoria",
                ...chart.datasets
                    .map(
                        (dataset) =>
                            dataset.label ||
                            "Wartość"
                    )
            ]
        ];

        chart.labels
            .forEach(
                (
                    label,
                    index
                ) => {
                    matrix.push([
                        label,
                        ...chart.datasets
                            .map(
                                (dataset) =>
                                    dataset
                                        .data?.[
                                        index
                                    ] ?? 0
                            )
                    ]);
                }
            );

        const sheet =
            global.XLSX.utils
                .aoa_to_sheet(matrix);

        applyMatrixLayout(
            sheet,
            matrix
        );

        return sheet;
    }

    function createCleaningHistoryWorksheet(
        history
    ) {
        const rows =
            history.map(
                (
                    operation,
                    index
                ) => ({
                    Nr: index + 1,
                    Operacja:
                        operation.label ||
                        operation.operationId ||
                        "",
                    Kolumna:
                        operation.column || "",
                    "Zmienione wiersze":
                        operation.changedRows || 0,
                    "Usunięte wiersze":
                        operation.removedRows || 0,
                    Parametry:
                        formatParameters(
                            operation.parameters
                        ),
                    "Data wykonania":
                        operation.appliedAt
                            ? new Date(
                                operation
                                    .appliedAt
                            )
                            : ""
                })
            );

        const headers = [
            "Nr",
            "Operacja",
            "Kolumna",
            "Zmienione wiersze",
            "Usunięte wiersze",
            "Parametry",
            "Data wykonania"
        ];

        const sheet =
            global.XLSX.utils
                .json_to_sheet(
                    rows,
                    {
                        header:
                            headers,
                        cellDates: true
                    }
                );

        applyObjectLayout(
            sheet,
            headers,
            rows
        );

        return sheet;
    }

    function appendMetadataWorksheet(
        workbook,
        details = {}
    ) {
        const fileMeta =
            state.get(
                "import.fileMeta",
                {}
            );

        const quality =
            state.get(
                "quality",
                {}
            );

        const history =
            state.get(
                "cleaning.history",
                []
            );

        const rows = [
            {
                Parametr: "Aplikacja",
                Wartość: APP.name
            },
            {
                Parametr: "Wersja",
                Wartość: APP.version
            },
            {
                Parametr:
                    "Typ eksportu",
                Wartość:
                    details.exportType || ""
            },
            {
                Parametr:
                    "Data eksportu",
                Wartość:
                    new Date()
            },
            {
                Parametr:
                    "Plik źródłowy",
                Wartość:
                    fileMeta.name || ""
            },
            {
                Parametr:
                    "Arkusz źródłowy",
                Wartość:
                    state.get(
                        "import.selectedSheet",
                        ""
                    )
            },
            {
                Parametr:
                    "Wiersze robocze",
                Wartość:
                    details.sourceRowCount || 0
            },
            {
                Parametr:
                    "Operacje czyszczenia",
                Wartość:
                    history.length
            },
            {
                Parametr:
                    "Kontrola jakości",
                Wartość:
                    quality.completed
                        ? "TAK"
                        : "NIE"
            },
            {
                Parametr:
                    "Liczba arkuszy",
                Wartość:
                    details
                        .exportedSheetCount ||
                    workbook
                        .SheetNames
                        .length + 1
            },
            {
                Parametr:
                    "Przetwarzanie",
                Wartość:
                    "Lokalnie w przeglądarce"
            }
        ];

        const sheet =
            global.XLSX.utils
                .json_to_sheet(
                    rows,
                    {
                        cellDates: true
                    }
                );

        sheet["!cols"] = [
            { wch: 32 },
            { wch: 50 }
        ];

        applyFormats(sheet);

        appendWorksheet(
            workbook,
            sheet,
            "Informacje"
        );
    }

    function createCsvContent(
        headers,
        rows,
        delimiter = ";"
    ) {
        const lines = [
            headers
                .map(
                    (header) =>
                        encodeCsvCell(
                            header,
                            delimiter
                        )
                )
                .join(delimiter)
        ];

        rows.forEach((row) => {
            lines.push(
                headers
                    .map(
                        (header) =>
                            encodeCsvCell(
                                row?.[header],
                                delimiter
                            )
                    )
                    .join(delimiter)
            );
        });

        return lines.join("\r\n");
    }

    function encodeCsvCell(
        value,
        delimiter
    ) {
        const text =
            value instanceof Date &&
            !Number.isNaN(
                value.getTime()
            )
                ? value.toISOString()
                : String(value ?? "");

        return (
            text.includes(delimiter) ||
            text.includes('"') ||
            text.includes("\n") ||
            text.includes("\r")
        )
            ? (
                '"' +
                text.replace(
                    /"/g,
                    '""'
                ) +
                '"'
            )
            : text;
    }

    function applyObjectLayout(
        sheet,
        headers,
        rows
    ) {
        if (!sheet["!ref"]) {
            return;
        }

        const lastColumn =
            global.XLSX.utils
                .encode_col(
                    Math.max(
                        0,
                        headers.length - 1
                    )
                );

        sheet["!autofilter"] = {
            ref:
                `A1:${lastColumn}${Math.max(
                    1,
                    rows.length + 1
                )}`
        };

        sheet["!cols"] =
            headers.map((header) => {
                let length =
                    String(header)
                        .length;

                rows
                    .slice(
                        0,
                        MAX_WIDTH_SAMPLE_ROWS
                    )
                    .forEach((row) => {
                        length =
                            Math.max(
                                length,
                                valueToWidthText(
                                    row?.[header]
                                ).length
                            );
                    });

                return {
                    wch:
                        constrainWidth(
                            length
                        )
                };
            });

        applyFormats(sheet);
    }

    function applyMatrixLayout(
        sheet,
        matrix
    ) {
        if (
            !sheet["!ref"] ||
            !matrix.length
        ) {
            return;
        }

        let columnCount = 1;

        matrix.forEach((row) => {
            if (
                Array.isArray(row) &&
                row.length >
                columnCount
            ) {
                columnCount =
                    row.length;
            }
        });

        const lastColumn =
            global.XLSX.utils
                .encode_col(
                    columnCount - 1
                );

        sheet["!autofilter"] = {
            ref:
                `A1:${lastColumn}${matrix.length}`
        };

        sheet["!cols"] =
            Array.from(
                {
                    length:
                        columnCount
                },
                (
                    _,
                    columnIndex
                ) => {
                    let length = 0;

                    matrix
                        .slice(
                            0,
                            MAX_WIDTH_SAMPLE_ROWS +
                            1
                        )
                        .forEach((row) => {
                            length =
                                Math.max(
                                    length,
                                    valueToWidthText(
                                        row?.[
                                            columnIndex
                                        ]
                                    ).length
                                );
                        });

                    return {
                        wch:
                            constrainWidth(
                                length
                            )
                    };
                }
            );

        applyFormats(sheet);
    }

    function constrainWidth(length) {
        return Math.min(
            MAX_COLUMN_WIDTH,
            Math.max(
                MIN_COLUMN_WIDTH,
                length + 2
            )
        );
    }

    function valueToWidthText(value) {
        return value instanceof Date
            ? formatDateTime(value)
            : String(value ?? "");
    }

    function applyFormats(sheet) {
        if (!sheet["!ref"]) {
            return;
        }

        const range =
            global.XLSX.utils
                .decode_range(
                    sheet["!ref"]
                );

        for (
            let row = range.s.r;
            row <= range.e.r;
            row += 1
        ) {
            for (
                let column =
                    range.s.c;
                column <= range.e.c;
                column += 1
            ) {
                const address =
                    global.XLSX.utils
                        .encode_cell({
                            r: row,
                            c: column
                        });

                const cell =
                    sheet[address];

                if (!cell) {
                    continue;
                }

                if (
                    cell.t === "d" ||
                    cell.v instanceof Date
                ) {
                    cell.z =
                        "yyyy-mm-dd hh:mm";
                } else if (
                    cell.t === "n"
                ) {
                    cell.z =
                        "#,##0.00";
                }
            }
        }
    }

    function validateCleanDataExport() {
        const errors = [];

        if (
            !state.get(
                "import.headers",
                []
            ).length
        ) {
            errors.push(
                "Brak nagłówków do eksportu."
            );
        }

        if (
            !state.get(
                "table.workingRows",
                []
            ).length
        ) {
            errors.push(
                "Brak danych do eksportu."
            );
        }

        return {
            valid:
                errors.length === 0,
            errors
        };
    }

    function validateAnalysisExport() {
        const base =
            validateCleanDataExport();

        const errors = [
            ...base.errors
        ];

        const hasAnalysis =
            Boolean(
                state.get(
                    "quality.completed",
                    false
                ) ||
                hasCalculationResult(
                    state.get(
                        "calculation",
                        null
                    )
                ) ||
                state.get(
                    "pivot.result",
                    null
                )
            );

        if (!hasAnalysis) {
            errors.push(
                "Wykonaj kontrolę jakości, obliczenie lub tabelę przestawną."
            );
        }

        return {
            valid:
                errors.length === 0,
            errors
        };
    }

    function hasCalculationResult(
        calculation
    ) {
        return Boolean(
            calculation &&
            (
                calculation.completedAt !=
                    null ||
                calculation.result !=
                    null
            )
        );
    }

    function buildExportFileName(
        suffix,
        extension
    ) {
        const sourceName =
            state.get(
                "import.fileMeta.name",
                "dane"
            );

        return sanitizeFileName(
            `${removeFileExtension(
                sourceName
            )}-${suffix}-${createTimestamp()}${extension}`
        );
    }

    function removeFileExtension(
        fileName
    ) {
        const name =
            cleanText(fileName) ||
            "dane";

        const index =
            name.lastIndexOf(".");

        return index > 0
            ? name.slice(0, index)
            : name;
    }

    function sanitizeFileName(
        fileName
    ) {
        return (
            String(fileName || "")
                .replace(
                    /[<>:"\/\\|?*\u0000-\u001F]/g,
                    "-"
                )
                .replace(/\s+/g, "-")
                .replace(/-+/g, "-")
                .replace(
                    /^[-.\s]+|[-.\s]+$/g,
                    ""
                ) ||
            `eksport-${createTimestamp()}.xlsx`
        );
    }

    function sanitizeSheetName(
        sheetName
    ) {
        return (
            cleanText(sheetName)
                .replace(
                    /[:\\\/?*\[\]]/g,
                    " "
                )
                .replace(/\s+/g, " ")
                .slice(0, 31) ||
            "Arkusz"
        );
    }

    function createUniqueSheetName(
        workbook,
        requestedName
    ) {
        const base =
            sanitizeSheetName(
                requestedName
            );

        const existing =
            new Set(
                workbook.SheetNames
                    .map(
                        (name) =>
                            name
                                .toLocaleLowerCase(
                                    "pl-PL"
                                )
                    )
            );

        if (
            !existing.has(
                base
                    .toLocaleLowerCase(
                        "pl-PL"
                    )
            )
        ) {
            return base;
        }

        let index = 2;

        while (index < 1000) {
            const suffix =
                ` (${index})`;

            const candidate =
                base.slice(
                    0,
                    31 -
                    suffix.length
                ) +
                suffix;

            if (
                !existing.has(
                    candidate
                        .toLocaleLowerCase(
                            "pl-PL"
                        )
                )
            ) {
                return candidate;
            }

            index += 1;
        }

        return (
            "Arkusz " +
            Date.now()
                .toString()
                .slice(-6)
        );
    }

    function createTimestamp() {
        const date =
            new Date();

        const part = (value) =>
            String(value)
                .padStart(2, "0");

        return (
            `${date.getFullYear()}` +
            `${part(date.getMonth() + 1)}` +
            `${part(date.getDate())}-` +
            `${part(date.getHours())}` +
            `${part(date.getMinutes())}`
        );
    }

    function normalizeExportValue(
        value
    ) {
        if (
            value === null ||
            value === undefined
        ) {
            return "";
        }

        if (
            value instanceof Date
        ) {
            return Number.isNaN(
                value.getTime()
            )
                ? ""
                : new Date(
                    value.getTime()
                );
        }

        if (
            typeof value ===
            "number"
        ) {
            return Number.isFinite(
                value
            )
                ? value
                : "";
        }

        return value;
    }

    function formatParameters(
        parameters
    ) {
        if (
            !parameters ||
            typeof parameters !==
                "object"
        ) {
            return "";
        }

        return Object.entries(
            parameters
        )
            .filter(
                (
                    [, value]
                ) =>
                    !isBlank(value)
            )
            .map(
                ([key, value]) =>
                    `${key}: ${value}`
            )
            .join("; ");
    }

    function syncAvailability() {
        const hasData =
            state.get(
                "table.workingRows",
                []
            ).length > 0;

        const hasAnalysis =
            Boolean(
                state.get(
                    "quality.completed",
                    false
                ) ||
                hasCalculationResult(
                    state.get(
                        "calculation",
                        null
                    )
                ) ||
                state.get(
                    "pivot.result",
                    null
                )
            );

        dom.setDisabled(
            elements.exportButton,
            !hasData
        );

        dom.setDisabled(
            elements.exportCleanDataButton,
            !hasData
        );

        dom.setDisabled(
            elements.exportAnalysisButton,
            !hasData ||
            !hasAnalysis
        );
    }

    function updateLearningContext(
        fileName
    ) {
        state.setLearningContext(
            "report",
            {
                context:
                    `Wyeksportowano dane do pliku „${fileName}”.`,
                excelEquivalent:
                    "Plik → Zapisz jako / Eksportuj",
                verificationTip:
                    "Otwórz plik i sprawdź arkusze, liczbę wierszy oraz sumy kontrolne."
            }
        );
    }

    function assertSheetJs() {
        if (
            !global.XLSX ||
            !global.XLSX.utils ||
            typeof global.XLSX
                .writeFile !==
                "function"
        ) {
            throw new Error(
                "Biblioteka SheetJS nie została załadowana."
            );
        }
    }

    function handleExportError(
        error,
        context
    ) {
        const normalized =
            normalizeError(
                error,
                context
            );

        state.setError(
            error,
            context
        );

        state.clearBusy(
            STATUS.ERROR
        );

        dom.showError(
            normalized.message,
            "Eksport"
        );

        return null;
    }

    const api = Object.freeze({
        initialize,
        destroy,

        exportCleanDataWorkbook,
        exportCleanDataCsv,
        exportAnalysisWorkbook,

        createWorkbook,
        createDataWorksheet,
        createQualityWorksheet,
        createCalculationWorksheet,
        createPivotWorksheet,
        createChartDataWorksheet,
        createCleaningHistoryWorksheet,

        createCsvContent,

        validateCleanDataExport,
        validateAnalysisExport,
        hasCalculationResult,

        buildExportFileName,
        sanitizeFileName,
        sanitizeSheetName,
        createUniqueSheetName,

        syncAvailability,

        get initialized() {
            return initialized;
        }
    });

    Object.defineProperty(
        EAT,
        "exportEngine",
        {
            value: api,
            writable: false,
            enumerable: true,
            configurable: false
        }
    );
})(window);
