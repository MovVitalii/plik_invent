/* ==========================================================
   Excel Analytics Trainer
   src/dom.js
========================================================== */

(function initializeDomModule(global) {
    "use strict";

    const EAT = global.EAT || (global.EAT = {});

    if (
        !EAT.constants ||
        !EAT.state ||
        !EAT.utils
    ) {
        throw new Error(
            "EAT.constants, EAT.state and EAT.utils must be loaded before src/dom.js."
        );
    }

    const {
        APP,
        STATUS,
        SECTIONS,
        DATA_TYPES,
        EVENTS
    } = EAT.constants;

    const {
        cleanText,
        parseNumber,
        parseDate,
        formatNumber,
        formatInteger,
        formatDate,
        formatFileSize,
        truncate,
        createId,
        normalizeError
    } = EAT.utils;

    const state = EAT.state;

    const REQUIRED_IDS = Object.freeze([
        "fileInput",
        "exportButton",
        "resetButton",

        "importSection",
        "importStatus",
        "dropZone",
        "fileSummary",
        "fileName",
        "fileSize",
        "sheetCount",
        "sourceRowCount",
        "sheetControls",
        "sheetSelector",
        "analyzeSheetButton",

        "previewSection",
        "previewStatus",
        "globalSearchInput",
        "pageSizeSelector",
        "clearTableFiltersButton",
        "dataTable",
        "dataTableHead",
        "dataTableBody",
        "previousPageButton",
        "paginationStatus",
        "nextPageButton",

        "qualitySection",
        "runQualityCheckButton",
        "qualityRows",
        "qualityColumns",
        "qualityEmptyCells",
        "qualityDuplicates",
        "qualityTypeErrors",
        "qualityUniqueValues",
        "qualityTable",
        "qualityTableBody",

        "cleaningSection",
        "cleaningStatus",
        "cleaningColumnSelector",
        "cleaningOperationSelector",
        "replaceControls",
        "replaceFromInput",
        "replaceToInput",
        "previewCleaningButton",
        "applyCleaningButton",
        "cleaningPreview",
        "cleaningHistory",
        "undoCleaningButton",

        "calculationSection",
        "calculationStatus",
        "calculationFunctionSelector",
        "calculationValueColumnField",
        "calculationValueColumnSelector",
        "criteriaBuilder",
        "criteriaRows",
        "addCriterionButton",
        "runCalculationButton",
        "calculationResult",
        "excelFormulaPreview",
        "calculationExplanation",

        "pivotSection",
        "buildPivotButton",
        "pivotFieldSearchInput",
        "pivotFieldsList",
        "pivotRowsZone",
        "pivotColumnsZone",
        "pivotValuesZone",
        "pivotFiltersZone",
        "pivotAggregationSelector",
        "pivotSourceRows",
        "pivotGroups",
        "pivotTotal",
        "pivotAverage",
        "pivotMinimum",
        "pivotMaximum",
        "pivotTableHead",
        "pivotTableBody",
        "pivotTableFoot",

        "reportSection",
        "exportCleanDataButton",
        "exportAnalysisButton",
        "chartTypeSelector",
        "renderChartButton",
        "analysisChart",
        "chartDescription",

        "learningPanel",
        "learningPanelToggle",
        "learningPanelContent",
        "learningContext",
        "excelEquivalent",
        "verificationTip",

        "appVersion",
        "loadingOverlay",
        "loadingTitle",
        "loadingMessage",
        "loadingProgress",
        "toastContainer"
    ]);

    const elements = {};
    const toastTimers = new WeakMap();

    let initialized = false;
    let elementsCached = false;
    let unsubscribeState = null;

    function initialize() {
        if (initialized) {
            return api;
        }

        cacheElements();

        document.documentElement
            .classList.remove("no-js");

        elements.appVersion.textContent =
            APP.version;

        unsubscribeState =
            state.subscribe(
                handleStateNotification
            );

        syncFromState();

        initialized = true;

        return api;
    }

    function destroy() {
        unsubscribeState?.();
        unsubscribeState = null;
        clearToasts();
        initialized = false;
    }

    function cacheElements() {
        if (elementsCached) {
            return elements;
        }

        const missingIds = [];

        REQUIRED_IDS.forEach((id) => {
            const element =
                document.getElementById(id);

            if (!element) {
                missingIds.push(id);
                return;
            }

            elements[id] = element;
        });

        if (missingIds.length) {
            throw new Error(
                "Brakuje wymaganych elementów HTML: " +
                missingIds
                    .map((id) => `#${id}`)
                    .join(", ") +
                "."
            );
        }

        elements.workflowSteps = [
            ...document.querySelectorAll(
                ".workflow-step[data-section]"
            )
        ];

        elements.sections = [
            elements.importSection,
            elements.previewSection,
            elements.qualitySection,
            elements.cleaningSection,
            elements.calculationSection,
            elements.pivotSection,
            elements.reportSection
        ];

        elementsCached = true;

        return elements;
    }

    function createElement(
        tagName,
        options = {}
    ) {
        const element =
            document.createElement(
                tagName
            );

        if (options.id) {
            element.id =
                String(options.id);
        }

        if (options.className) {
            element.className =
                String(
                    options.className
                );
        }

        if (
            Array.isArray(
                options.classes
            )
        ) {
            element.classList.add(
                ...options.classes
                    .filter(Boolean)
                    .map(String)
            );
        }

        if (
            options.text !==
            undefined
        ) {
            element.textContent =
                String(
                    options.text ?? ""
                );
        }

        Object.entries(
            options.attributes || {}
        ).forEach(
            ([name, value]) => {
                if (
                    value === null ||
                    value === undefined ||
                    value === false
                ) {
                    return;
                }

                element.setAttribute(
                    name,
                    value === true
                        ? ""
                        : String(value)
                );
            }
        );

        Object.entries(
            options.dataset || {}
        ).forEach(
            ([name, value]) => {
                if (
                    value !== null &&
                    value !== undefined
                ) {
                    element.dataset[name] =
                        String(value);
                }
            }
        );

        Object.entries(
            options.properties || {}
        ).forEach(
            ([name, value]) => {
                if (name === "style") {
                    Object.assign(
                        element.style,
                        value || {}
                    );
                } else {
                    element[name] =
                        value;
                }
            }
        );

        (options.children || [])
            .forEach((child) => {
                if (
                    child instanceof Node
                ) {
                    element.appendChild(
                        child
                    );
                } else if (
                    child !== null &&
                    child !== undefined
                ) {
                    element.appendChild(
                        document.createTextNode(
                            String(child)
                        )
                    );
                }
            });

        return element;
    }

    function clearElement(element) {
        element?.replaceChildren();
    }

    function setText(
        element,
        value,
        fallback = "—"
    ) {
        if (!element) {
            return;
        }

        element.textContent =
            value === null ||
            value === undefined ||
            value === ""
                ? fallback
                : String(value);
    }

    function setValue(
        element,
        value = ""
    ) {
        if (element) {
            element.value =
                value === null ||
                value === undefined
                    ? ""
                    : String(value);
        }
    }

    function setHidden(
        element,
        hidden = true
    ) {
        if (element) {
            element.hidden =
                Boolean(hidden);
        }
    }

    function setDisabled(
        element,
        disabled = true
    ) {
        if (element) {
            element.disabled =
                Boolean(disabled);
        }
    }

    function setAriaExpanded(
        element,
        expanded
    ) {
        element?.setAttribute(
            "aria-expanded",
            String(Boolean(expanded))
        );
    }

    function setStatusBadge(
        element,
        text,
        status = STATUS.IDLE
    ) {
        if (!element) {
            return;
        }

        element.textContent =
            cleanText(text) || "—";

        element.classList.remove(
            "status-success",
            "status-warning",
            "status-danger",
            "status-loading"
        );

        if (
            status === STATUS.SUCCESS ||
            status === STATUS.READY
        ) {
            element.classList.add(
                "status-success"
            );
        } else if (
            status === STATUS.WARNING
        ) {
            element.classList.add(
                "status-warning"
            );
        } else if (
            status === STATUS.ERROR
        ) {
            element.classList.add(
                "status-danger"
            );
        } else if (
            status === STATUS.LOADING ||
            status === STATUS.PROCESSING
        ) {
            element.classList.add(
                "status-loading"
            );
        }
    }

    function activateSection(
        sectionId,
        options = {}
    ) {
        const target =
            document.getElementById(
                sectionId
            );

        if (
            !target ||
            !elements.sections.includes(
                target
            )
        ) {
            throw new Error(
                `Unknown application section: ${sectionId}`
            );
        }

        elements.sections.forEach(
            (section) => {
                const active =
                    section === target;

                section.hidden =
                    !active;

                section.classList.toggle(
                    "is-active",
                    active
                );
            }
        );

        elements.workflowSteps.forEach(
            (button) => {
                const active =
                    button.dataset.section ===
                    sectionId;

                button.classList.toggle(
                    "is-active",
                    active
                );

                if (active) {
                    button.setAttribute(
                        "aria-current",
                        "step"
                    );
                } else {
                    button.removeAttribute(
                        "aria-current"
                    );
                }
            }
        );

        if (
            options.scroll !== false
        ) {
            target.scrollIntoView({
                behavior:
                    options.behavior ||
                    "smooth",

                block: "start"
            });
        }

        return target;
    }

    function setWorkflowState(
        workflow = {}
    ) {
        if (!elementsCached) {
            return;
        }

        const unlocked =
            new Set(
                workflow.unlockedSections ||
                [SECTIONS.IMPORT]
            );

        const completed =
            new Set(
                workflow.completedSections ||
                []
            );

        elements.workflowSteps.forEach(
            (button) => {
                const sectionId =
                    button.dataset.section;

                button.disabled =
                    !unlocked.has(
                        sectionId
                    );

                button.classList.toggle(
                    "is-completed",
                    completed.has(
                        sectionId
                    )
                );
            }
        );
    }

    function renderSelectOptions(
        select,
        options = [],
        config = {}
    ) {
        if (!select) {
            return;
        }

        clearElement(select);

        if (
            config.placeholder !==
            undefined
        ) {
            select.appendChild(
                createElement(
                    "option",
                    {
                        text:
                            config.placeholder,

                        attributes: {
                            value: ""
                        }
                    }
                )
            );
        }

        options.forEach((item) => {
            const option =
                typeof item ===
                "object"
                    ? item
                    : {
                        value: item,
                        label: item
                    };

            select.appendChild(
                createElement(
                    "option",
                    {
                        text:
                            option.label ??
                            option.value ??
                            "",

                        attributes: {
                            value:
                                option.value ??
                                ""
                        },

                        properties: {
                            disabled:
                                Boolean(
                                    option.disabled
                                )
                        }
                    }
                )
            );
        });

        if (
            config.value !==
            undefined
        ) {
            select.value =
                String(
                    config.value ?? ""
                );
        }
    }

    function renderColumnSelectors(
        headers = [],
        detectedTypes = {}
    ) {
        const allOptions =
            headers.map((header) => ({
                value: header,
                label: header
            }));

        const numericOptions =
            headers
                .filter((header) => {
                    const type =
                        detectedTypes[header];

                    return (
                        type ===
                            DATA_TYPES.NUMBER ||
                        type ===
                            DATA_TYPES.MIXED
                    );
                })
                .map((header) => ({
                    value: header,
                    label: header
                }));

        renderSelectOptions(
            elements.cleaningColumnSelector,
            allOptions,
            {
                placeholder:
                    "Wybierz kolumnę"
            }
        );

        renderSelectOptions(
            elements.calculationValueColumnSelector,
            numericOptions.length
                ? numericOptions
                : allOptions,
            {
                placeholder:
                    "Wybierz kolumnę"
            }
        );
    }

    function renderFileSummary(
        fileMeta = {},
        workbookInfo = {}
    ) {
        const sheetNames =
            Array.isArray(
                workbookInfo.sheetNames
            )
                ? workbookInfo.sheetNames
                : [];

        setText(
            elements.fileName,
            fileMeta.name
        );

        setText(
            elements.fileSize,
            formatFileSize(
                Number(
                    fileMeta.size
                ) || 0
            ),
            "0 B"
        );

        setText(
            elements.sheetCount,
            formatInteger(
                sheetNames.length
            ),
            "0"
        );

        setText(
            elements.sourceRowCount,
            formatInteger(
                workbookInfo.rowCount ||
                0
            ),
            "0"
        );

        setHidden(
            elements.fileSummary,
            !fileMeta.name
        );

        setHidden(
            elements.sheetControls,
            sheetNames.length === 0
        );

        renderSelectOptions(
            elements.sheetSelector,
            sheetNames.map((name) => ({
                value: name,
                label: name
            })),
            {
                value:
                    workbookInfo
                        .selectedSheet ||
                    sheetNames[0] ||
                    ""
            }
        );
    }

    function resetImportUI() {
        if (!elementsCached) {
            return;
        }

        elements.fileInput.value = "";

        setStatusBadge(
            elements.importStatus,
            "Brak pliku",
            STATUS.IDLE
        );

        setHidden(
            elements.fileSummary,
            true
        );

        setHidden(
            elements.sheetControls,
            true
        );

        clearElement(
            elements.sheetSelector
        );
    }

    function renderDataTable(
        headers = [],
        rows = [],
        options = {}
    ) {
        clearElement(
            elements.dataTableHead
        );

        clearElement(
            elements.dataTableBody
        );

        if (!headers.length) {
            renderEmptyTable(
                elements.dataTableBody,
                1,
                "Brak danych do wyświetlenia."
            );

            return;
        }

        const headerRow =
            createElement("tr");

        headers.forEach((header) => {
            const sortButton =
                createElement(
                    "button",
                    {
                        text: header,
                        className:
                            "table-sort-button",

                        attributes: {
                            type: "button",
                            title:
                                `Sortuj według kolumny ${header}`
                        },

                        dataset: {
                            column: header
                        }
                    }
                );

            if (
                options.sort?.column ===
                header
            ) {
                const direction =
                    options.sort
                        .direction ===
                    "desc"
                        ? "desc"
                        : "asc";

                sortButton.appendChild(
                    document.createTextNode(
                        direction === "desc"
                            ? " ↓"
                            : " ↑"
                    )
                );
            }

            headerRow.appendChild(
                createElement(
                    "th",
                    {
                        attributes: {
                            scope: "col"
                        },

                        children: [
                            sortButton
                        ]
                    }
                )
            );
        });

        elements.dataTableHead
            .appendChild(
                headerRow
            );

        if (!rows.length) {
            renderEmptyTable(
                elements.dataTableBody,
                headers.length,
                options.emptyMessage ||
                "Brak wyników."
            );

            return;
        }

        const fragment =
            document
                .createDocumentFragment();

        rows.forEach((row, rowIndex) => {
            const tr =
                createElement(
                    "tr",
                    {
                        dataset: {
                            rowIndex:
                                (
                                    options
                                        .startIndex ||
                                    0
                                ) +
                                rowIndex
                        }
                    }
                );

            headers.forEach((header) => {
                const rawValue =
                    row?.[header];

                const type =
                    options
                        .detectedTypes?.[
                        header
                    ];

                const displayedValue =
                    formatCellValue(
                        rawValue,
                        type
                    );

                const isRawText =
                    typeof rawValue ===
                    "string" &&
                    (
                        type ===
                            DATA_TYPES.TEXT ||
                        type ===
                            DATA_TYPES.MIXED ||
                        !type
                    );

                tr.appendChild(
                    createElement(
                        "td",
                        {
                            text:
                                displayedValue,

                            className:
                                isRawText
                                    ? "raw-text-cell"
                                    : "",

                            attributes: {
                                title:
                                    isRawText
                                        ? (
                                            "Wartość surowa: " +
                                            JSON.stringify(
                                                rawValue
                                            )
                                        )
                                        : truncate(
                                            displayedValue,
                                            300
                                        )
                            }
                        }
                    )
                );
            });

            fragment.appendChild(tr);
        });

        elements.dataTableBody
            .appendChild(fragment);
    }

    function updatePagination(
        model = {}
    ) {
        const page =
            Math.max(
                1,
                Number(model.page) || 1
            );

        const totalPages =
            Math.max(
                1,
                Number(
                    model.totalPages
                ) || 1
            );

        const totalRows =
            Math.max(
                0,
                Number(
                    model.totalRows
                ) || 0
            );

        elements.paginationStatus
            .textContent =
            `Strona ${formatInteger(page)} ` +
            `z ${formatInteger(totalPages)} · ` +
            `${formatInteger(totalRows)} wierszy`;

        elements.previousPageButton
            .disabled =
            page <= 1;

        elements.nextPageButton
            .disabled =
            page >= totalPages;
    }

    function renderQualitySummary(
        report = {}
    ) {
        setText(
            elements.qualityRows,
            formatInteger(
                report.rowCount || 0
            ),
            "0"
        );

        setText(
            elements.qualityColumns,
            formatInteger(
                report.columnCount || 0
            ),
            "0"
        );

        setText(
            elements.qualityEmptyCells,
            formatInteger(
                report.emptyCellCount || 0
            ),
            "0"
        );

        setText(
            elements.qualityDuplicates,
            formatInteger(
                report.duplicateRowCount || 0
            ),
            "0"
        );

        setText(
            elements.qualityTypeErrors,
            formatInteger(
                report.typeErrorCount || 0
            ),
            "0"
        );

        setText(
            elements.qualityUniqueValues,
            formatInteger(
                report.uniqueValueCount || 0
            ),
            "0"
        );
    }

    function renderQualityTable(
        columns = []
    ) {
        clearElement(
            elements.qualityTableBody
        );

        if (!columns.length) {
            renderEmptyTable(
                elements.qualityTableBody,
                10,
                "Uruchom kontrolę jakości danych."
            );

            return;
        }

        const fragment =
            document
                .createDocumentFragment();

        columns.forEach((column) => {
            const problems =
                Array.isArray(
                    column.problems
                )
                    ? column.problems
                        .join("; ")
                    : cleanText(
                        column.problems
                    );

            const tr =
                createElement("tr");

            [
                column.name || "—",
                formatDataType(
                    column.type
                ),
                formatDataType(
                    column.dominantType
                ),
                formatInteger(
                    column.emptyCount || 0
                ),
                formatInteger(
                    column.uniqueCount || 0
                ),
                formatInteger(
                    column.typeErrorCount || 0
                ),
                formatMetricValue(
                    column.minimum,
                    column.dominantType
                ),
                formatMetricValue(
                    column.maximum,
                    column.dominantType
                ),
                formatMetricValue(
                    column.average,
                    DATA_TYPES.NUMBER
                ),
                problems || "Brak"
            ].forEach(
                (value, index) => {
                    tr.appendChild(
                        createElement(
                            "td",
                            {
                                text: value,
                                className:
                                    index === 9
                                        ? (
                                            problems
                                                ? "quality-problem"
                                                : "quality-ok"
                                        )
                                        : ""
                            }
                        )
                    );
                }
            );

            fragment.appendChild(tr);
        });

        elements.qualityTableBody
            .appendChild(fragment);
    }

    function renderCleaningPreview(
        preview = null
    ) {
        clearElement(
            elements.cleaningPreview
        );

        if (!preview) {
            elements.cleaningPreview
                .textContent =
                "Wybierz operację, aby zobaczyć efekt.";

            return;
        }

        elements.cleaningPreview
            .appendChild(
                createElement(
                    "strong",
                    {
                        text:
                            preview.description ||
                            "Podgląd operacji"
                    }
                )
            );

        elements.cleaningPreview
            .appendChild(
                createElement(
                    "p",
                    {
                        text:
                            `Zmienione wiersze: ${formatInteger(
                                preview.changedRows || 0
                            )}. Usunięte wiersze: ${formatInteger(
                                preview.removedRows || 0
                            )}.`
                    }
                )
            );

        if (
            Array.isArray(
                preview.samples
            ) &&
            preview.samples.length
        ) {
            const samples =
                createElement(
                    "div",
                    {
                        className:
                            "cleaning-samples"
                    }
                );

            preview.samples.forEach(
                (sample) => {
                    samples.appendChild(
                        createElement(
                            "div",
                            {
                                className:
                                    "cleaning-sample",

                                children: [
                                    createElement(
                                        "span",
                                        {
                                            text:
                                                JSON.stringify(
                                                    sample.before
                                                )
                                        }
                                    ),
                                    createElement(
                                        "span",
                                        {
                                            text: "→"
                                        }
                                    ),
                                    createElement(
                                        "span",
                                        {
                                            text:
                                                JSON.stringify(
                                                    sample.after
                                                )
                                        }
                                    )
                                ]
                            }
                        )
                    );
                }
            );

            elements.cleaningPreview
                .appendChild(samples);
        }
    }

    function renderCleaningHistory(
        history = []
    ) {
        clearElement(
            elements.cleaningHistory
        );

        if (!history.length) {
            elements.cleaningHistory
                .appendChild(
                    createElement(
                        "li",
                        {
                            text:
                                "Brak wykonanych operacji."
                        }
                    )
                );

            return;
        }

        [...history]
            .reverse()
            .forEach((operation) => {
                elements.cleaningHistory
                    .appendChild(
                        createElement(
                            "li",
                            {
                                text: [
                                    operation.label ||
                                    operation.operationId ||
                                    "Operacja",

                                    operation.column
                                        ? (
                                            `kolumna: ${operation.column}`
                                        )
                                        : "",

                                    `zmienione: ${formatInteger(
                                        operation.changedRows || 0
                                    )}`,

                                    operation.removedRows
                                        ? (
                                            `usunięte: ${formatInteger(
                                                operation.removedRows
                                            )}`
                                        )
                                        : ""
                                ]
                                    .filter(Boolean)
                                    .join(" · ")
                            }
                        )
                    );
            });
    }

    function renderCalculationResult(
        result = {}
    ) {
        const value =
            result.result;

        setText(
            elements.calculationResult,
            typeof value ===
            "number"
                ? formatNumber(value)
                : value,
            "—"
        );

        setText(
            elements.excelFormulaPreview,
            result.formula,
            "—"
        );

        setText(
            elements.calculationExplanation,
            result.explanation ||
            "Wybierz funkcję i kolumnę.",
            "Wybierz funkcję i kolumnę."
        );
    }

    function renderPivotFields(
        fields = []
    ) {
        clearElement(
            elements.pivotFieldsList
        );

        if (!fields.length) {
            elements.pivotFieldsList
                .appendChild(
                    createElement(
                        "p",
                        {
                            text:
                                "Brak dostępnych pól."
                        }
                    )
                );

            return;
        }

        fields.forEach((field) => {
            elements.pivotFieldsList
                .appendChild(
                    createElement(
                        "button",
                        {
                            className:
                                "field-chip",

                            attributes: {
                                type: "button",
                                draggable: "true"
                            },

                            dataset: {
                                field:
                                    field.id ||
                                    field.name,

                                type:
                                    field.type ||
                                    DATA_TYPES.TEXT
                            },

                            children: [
                                createElement(
                                    "span",
                                    {
                                        text:
                                            field.label ||
                                            field.name ||
                                            field.id
                                    }
                                ),
                                createElement(
                                    "small",
                                    {
                                        text:
                                            formatDataType(
                                                field.type
                                            )
                                    }
                                )
                            ]
                        }
                    )
                );
        });
    }

    function renderPivotZone(
        zoneElement,
        fields = [],
        placeholder =
            "Przeciągnij pole"
    ) {
        clearElement(zoneElement);

        if (!fields.length) {
            zoneElement.appendChild(
                createElement(
                    "span",
                    {
                        text: placeholder,
                        className:
                            "drop-target-placeholder"
                    }
                )
            );

            return;
        }

        fields.forEach((field) => {
            const fieldId =
                typeof field ===
                    "object"
                    ? (
                        field.id ||
                        field.name ||
                        field.label
                    )
                    : field;

            const label =
                typeof field ===
                    "object"
                    ? (
                        field.label ||
                        field.name ||
                        field.id
                    )
                    : field;

            zoneElement.appendChild(
                createElement(
                    "button",
                    {
                        text:
                            `${label} ×`,

                        className:
                            "field-chip",

                        attributes: {
                            type: "button"
                        },

                        dataset: {
                            field: fieldId,
                            action:
                                "remove-pivot-field"
                        }
                    }
                )
            );
        });
    }

    function renderPivotTable(
        model = {}
    ) {
        clearElement(
            elements.pivotTableHead
        );

        clearElement(
            elements.pivotTableBody
        );

        clearElement(
            elements.pivotTableFoot
        );

        const columns =
            Array.isArray(
                model.columns
            )
                ? model.columns
                : [];

        const rows =
            Array.isArray(
                model.rows
            )
                ? model.rows
                : [];

        if (!columns.length) {
            renderEmptyTable(
                elements.pivotTableBody,
                1,
                "Zbuduj tabelę przestawną."
            );

            return;
        }

        const headerRow =
            createElement("tr");

        columns.forEach((column) => {
            headerRow.appendChild(
                createElement(
                    "th",
                    {
                        text:
                            column.label ||
                            column.key ||
                            column,

                        attributes: {
                            scope: "col"
                        }
                    }
                )
            );
        });

        elements.pivotTableHead
            .appendChild(headerRow);

        if (!rows.length) {
            renderEmptyTable(
                elements.pivotTableBody,
                columns.length,
                "Brak danych dla tej konfiguracji."
            );
        } else {
            const fragment =
                document
                    .createDocumentFragment();

            rows.forEach((row) => {
                const tr =
                    createElement("tr");

                columns.forEach((column) => {
                    const key =
                        column.key || column;

                    tr.appendChild(
                        createElement(
                            "td",
                            {
                                text:
                                    formatCellValue(
                                        row?.[key],
                                        column.type
                                    )
                            }
                        )
                    );
                });

                fragment.appendChild(tr);
            });

            elements.pivotTableBody
                .appendChild(fragment);
        }

        if (model.footer) {
            const footerRow =
                createElement("tr");

            columns.forEach((column) => {
                const key =
                    column.key || column;

                footerRow.appendChild(
                    createElement(
                        "td",
                        {
                            text:
                                formatCellValue(
                                    model.footer[key],
                                    column.type
                                )
                        }
                    )
                );
            });

            elements.pivotTableFoot
                .appendChild(footerRow);
        }
    }

    function renderPivotStatistics(
        statistics = {}
    ) {
        setText(
            elements.pivotSourceRows,
            formatInteger(
                statistics.sourceRows || 0
            ),
            "0"
        );

        setText(
            elements.pivotGroups,
            formatInteger(
                statistics.groupCount || 0
            ),
            "0"
        );

        setText(
            elements.pivotTotal,
            formatMetricValue(
                statistics.total,
                DATA_TYPES.NUMBER
            ),
            "0"
        );

        setText(
            elements.pivotAverage,
            formatMetricValue(
                statistics.average,
                DATA_TYPES.NUMBER
            ),
            "0"
        );

        setText(
            elements.pivotMinimum,
            formatMetricValue(
                statistics.minimum,
                DATA_TYPES.NUMBER
            ),
            "—"
        );

        setText(
            elements.pivotMaximum,
            formatMetricValue(
                statistics.maximum,
                DATA_TYPES.NUMBER
            ),
            "—"
        );
    }

    function renderLearningContext(
        learning = {}
    ) {
        setText(
            elements.learningContext,
            learning.context,
            "—"
        );

        setText(
            elements.excelEquivalent,
            learning.excelEquivalent,
            "—"
        );

        setText(
            elements.verificationTip,
            learning.verificationTip,
            "—"
        );

        const expanded =
            learning.panelExpanded !==
            false;

        setHidden(
            elements.learningPanelContent,
            !expanded
        );

        setAriaExpanded(
            elements.learningPanelToggle,
            expanded
        );
    }

    function showLoading(
        options = {}
    ) {
        setText(
            elements.loadingTitle,
            options.title ||
            "Przetwarzanie danych"
        );

        setText(
            elements.loadingMessage,
            options.message ||
            "Proszę czekać..."
        );

        const progress =
            Math.min(
                100,
                Math.max(
                    0,
                    Number(
                        options.progress
                    ) || 0
                )
            );

        elements.loadingProgress.value =
            progress;

        elements.loadingProgress
            .textContent =
            `${progress}%`;

        setHidden(
            elements.loadingOverlay,
            false
        );

        document.body.setAttribute(
            "aria-busy",
            "true"
        );
    }

    function hideLoading() {
        if (!elementsCached) {
            return;
        }

        setHidden(
            elements.loadingOverlay,
            true
        );

        document.body.removeAttribute(
            "aria-busy"
        );
    }

    function showToast(
        message,
        options = {}
    ) {
        const text =
            cleanText(message);

        if (
            !text ||
            !elementsCached
        ) {
            return null;
        }

        const type =
            [
                "success",
                "warning",
                "error",
                "info"
            ].includes(
                options.type
            )
                ? options.type
                : "info";

        const toast =
            createElement(
                "article",
                {
                    id:
                        createId("toast"),

                    classes: [
                        "toast",
                        type
                    ],

                    attributes: {
                        role:
                            type === "error"
                                ? "alert"
                                : "status"
                    }
                }
            );

        const content =
            createElement("div");

        if (options.title) {
            content.appendChild(
                createElement(
                    "strong",
                    {
                        text:
                            options.title
                    }
                )
            );
        }

        content.appendChild(
            createElement(
                "p",
                {
                    text
                }
            )
        );

        const closeButton =
            createElement(
                "button",
                {
                    text: "×",
                    className:
                        "toast-close",

                    attributes: {
                        type: "button",
                        "aria-label":
                            "Zamknij komunikat"
                    }
                }
            );

        closeButton.addEventListener(
            "click",
            () => removeToast(toast)
        );

        toast.append(
            content,
            closeButton
        );

        elements.toastContainer
            .appendChild(toast);

        const duration =
            Number(
                options.duration ??
                (
                    type === "error"
                        ? 0
                        : 4500
                )
            );

        if (duration > 0) {
            const timer =
                global.setTimeout(
                    () => removeToast(toast),
                    duration
                );

            toastTimers.set(
                toast,
                timer
            );
        }

        return toast;
    }

    function removeToast(toast) {
        if (!toast) {
            return;
        }

        const timer =
            toastTimers.get(toast);

        if (timer) {
            global.clearTimeout(timer);
        }

        toastTimers.delete(toast);
        toast.remove();
    }

    function clearToasts() {
        if (!elementsCached) {
            return;
        }

        [
            ...elements.toastContainer
                .querySelectorAll(
                    ".toast"
                )
        ].forEach(removeToast);

        clearElement(
            elements.toastContainer
        );
    }

    function showSuccess(
        message,
        title = "Gotowe"
    ) {
        return showToast(
            message,
            {
                type: "success",
                title
            }
        );
    }

    function showInfo(
        message,
        title = "Informacja"
    ) {
        return showToast(
            message,
            {
                type: "info",
                title
            }
        );
    }

    function showWarning(
        message,
        title = "Uwaga"
    ) {
        return showToast(
            message,
            {
                type: "warning",
                title
            }
        );
    }

    function showError(
        error,
        title = "Błąd"
    ) {
        const normalized =
            normalizeError(error);

        return showToast(
            normalized.message,
            {
                type: "error",
                title,
                duration: 0
            }
        );
    }

    function formatCellValue(
        value,
        type = null
    ) {
        if (
            value === null ||
            value === undefined
        ) {
            return "";
        }

        if (
            type === DATA_TYPES.NUMBER ||
            typeof value === "number"
        ) {
            const number =
                parseNumber(value);

            return (
                number !== null &&
                Number.isFinite(number)
            )
                ? formatNumber(number)
                : String(value);
        }

        if (
            type === DATA_TYPES.DATE ||
            value instanceof Date
        ) {
            const date =
                parseDate(value);

            return date
                ? formatDate(date)
                : String(value);
        }

        if (
            type === DATA_TYPES.BOOLEAN ||
            typeof value === "boolean"
        ) {
            const normalized =
                String(value)
                    .trim()
                    .toLocaleLowerCase(
                        "pl-PL"
                    );

            if (
                value === true ||
                ["true", "tak", "yes"]
                    .includes(normalized)
            ) {
                return "TAK";
            }

            if (
                value === false ||
                ["false", "nie", "no"]
                    .includes(normalized)
            ) {
                return "NIE";
            }
        }

        return String(value);
    }

    function formatMetricValue(
        value,
        type =
            DATA_TYPES.NUMBER
    ) {
        if (
            value === null ||
            value === undefined ||
            value === ""
        ) {
            return "—";
        }

        if (
            type === DATA_TYPES.DATE
        ) {
            return formatDate(value);
        }

        if (
            type === DATA_TYPES.NUMBER
        ) {
            return formatNumber(value);
        }

        return cleanText(value) || "—";
    }

    function formatDataType(type) {
        const labels = {
            [DATA_TYPES.TEXT]: "Tekst",
            [DATA_TYPES.NUMBER]: "Liczba",
            [DATA_TYPES.DATE]: "Data",
            [DATA_TYPES.BOOLEAN]: "Logiczny",
            [DATA_TYPES.EMPTY]: "Pusty",
            [DATA_TYPES.MIXED]: "Mieszany"
        };

        return labels[type] || "Nieznany";
    }

    function renderEmptyTable(
        tbody,
        columnCount,
        message
    ) {
        clearElement(tbody);

        tbody.appendChild(
            createElement(
                "tr",
                {
                    children: [
                        createElement(
                            "td",
                            {
                                text: message,
                                className:
                                    "empty-table-message",

                                attributes: {
                                    colspan:
                                        Math.max(
                                            1,
                                            Number(
                                                columnCount
                                            ) || 1
                                        )
                                }
                            }
                        )
                    ]
                }
            )
        );
    }

    function resetUI() {
        if (!elementsCached) {
            return;
        }

        resetImportUI();
        setValue(
            elements.globalSearchInput,
            ""
        );
        setValue(
            elements.pageSizeSelector,
            "25"
        );
        clearElement(
            elements.dataTableHead
        );
        renderEmptyTable(
            elements.dataTableBody,
            1,
            "Brak danych do wyświetlenia."
        );
        updatePagination({
            page: 1,
            totalPages: 1,
            totalRows: 0
        });
        renderQualitySummary({});
        renderQualityTable([]);
        renderCleaningPreview(null);
        renderCleaningHistory([]);
        renderCalculationResult({});
        renderPivotTable({});
        renderPivotStatistics({});
        setText(
            elements.chartDescription,
            "Brak wykresu."
        );
        hideLoading();
    }

    function syncFromState() {
        if (!elementsCached) {
            return;
        }

        const application =
            state.get(
                "application",
                {}
            );

        const workflow =
            state.get(
                "workflow",
                {}
            );

        const learning =
            state.get(
                "learning",
                {}
            );

        setWorkflowState(workflow);
        renderLearningContext(learning);

        if (application.busy) {
            showLoading({
                title:
                    application.busyTitle,

                message:
                    application.busyMessage,

                progress:
                    application.progress
            });
        } else {
            hideLoading();
        }
    }

    function handleStateNotification(
        payload
    ) {
        syncFromState();

        if (
            payload?.eventName ===
            EVENTS.WORKSPACE_RESET
        ) {
            resetUI();
        }
    }

    const api = Object.freeze({
        initialize,
        destroy,
        elements,

        cacheElements,
        createElement,
        clearElement,
        setText,
        setValue,
        setHidden,
        setDisabled,
        setAriaExpanded,
        setStatusBadge,

        activateSection,
        setWorkflowState,

        renderSelectOptions,
        renderColumnSelectors,
        renderFileSummary,
        resetImportUI,

        renderDataTable,
        updatePagination,

        renderQualitySummary,
        renderQualityTable,

        renderCleaningPreview,
        renderCleaningHistory,

        renderCalculationResult,

        renderPivotFields,
        renderPivotZone,
        renderPivotTable,
        renderPivotStatistics,

        renderLearningContext,

        showLoading,
        hideLoading,

        showToast,
        showSuccess,
        showInfo,
        showWarning,
        showError,
        clearToasts,

        formatCellValue,
        formatMetricValue,
        formatDataType,

        resetUI,
        syncFromState,

        get initialized() {
            return initialized;
        }
    });

    Object.defineProperty(
        EAT,
        "dom",
        {
            value: api,
            writable: false,
            enumerable: true,
            configurable: false
        }
    );
})(window);
