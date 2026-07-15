/* ==========================================================
   Excel Analytics Trainer
   src/calculation-engine.js
========================================================== */

(function initializeCalculationEngine(global) {
    "use strict";

    const EAT = global.EAT || (global.EAT = {});

    if (
        !EAT.constants ||
        !EAT.state ||
        !EAT.utils ||
        !EAT.dom
    ) {
        throw new Error(
            "EAT core modules must be loaded before src/calculation-engine.js."
        );
    }

    const {
        STATUS,
        SECTIONS,
        EVENTS,
        DATA_TYPES,
        CALCULATION_FUNCTIONS,
        CRITERIA_OPERATORS,
        LEARNING_CONTENT
    } = EAT.constants;

    const {
        isBlank,
        parseNumber,
        rowMatchesCriteria,
        buildExcelCriterion,
        formatNumber,
        formatInteger,
        createId,
        yieldToBrowser,
        normalizeError
    } = EAT.utils;

    const state = EAT.state;
    const dom = EAT.dom;
    const elements = dom.elements;

    const handlers = [];
    const MAX_CRITERIA = 5;
    const TABLE_NAME = "Tabela1";

    const CRITERIA_FUNCTIONS =
        new Set([
            "sumifs",
            "countifs",
            "averageifs",
            "minifs",
            "maxifs"
        ]);

    const NUMERIC_FUNCTIONS =
        new Set([
            "sum",
            "average",
            "min",
            "max",
            "count",
            "sumifs",
            "averageifs",
            "minifs",
            "maxifs"
        ]);

    const NO_VALUE_COLUMN_FUNCTIONS =
        new Set([
            "countifs"
        ]);

    const VALUELESS_OPERATORS =
        new Set([
            "is-empty",
            "is-not-empty"
        ]);

    let initialized = false;
    let calculationToken = 0;

    function initialize() {
        if (initialized) {
            return api;
        }

        renderFunctionOptions();
        renderColumnOptions();

        bind(
            elements.calculationFunctionSelector,
            "change",
            handleFunctionChange
        );

        bind(
            elements.calculationValueColumnSelector,
            "change",
            clearResult
        );

        bind(
            elements.addCriterionButton,
            "click",
            handleAddCriterion
        );

        bind(
            elements.criteriaRows,
            "click",
            handleCriteriaClick
        );

        bind(
            elements.criteriaRows,
            "change",
            handleCriteriaChange
        );

        bind(
            elements.criteriaRows,
            "input",
            handleCriteriaChange
        );

        bind(
            elements.runCalculationButton,
            "click",
            handleRunCalculation
        );

        bind(
            global,
            EVENTS.DATA_READY,
            handleDataReady
        );

        bind(
            global,
            EVENTS.CLEANING_APPLIED,
            clearResult
        );

        bind(
            global,
            EVENTS.CLEANING_UNDONE,
            clearResult
        );

        bind(
            global,
            EVENTS.WORKSPACE_RESET,
            reset
        );

        updateFunctionControls();

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
        calculationToken += 1;
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

    function handleFunctionChange() {
        updateFunctionControls();
        clearResult();
    }

    function handleDataReady() {
        renderColumnOptions();
        updateFunctionControls();
        clearResult();
    }

    function handleAddCriterion() {
        addCriterionRow();
        clearResult();
    }

    function handleCriteriaClick(event) {
        const button =
            event.target.closest(
                '[data-action="remove-criterion"]'
            );

        if (!button) {
            return;
        }

        button.closest(
            ".criterion-row"
        )?.remove();

        if (
            supportsCriteria(
                getSelectedFunction()
            ) &&
            !getCriterionRows().length
        ) {
            addCriterionRow();
        }

        updateCriterionButtons();
        clearResult();
    }

    function handleCriteriaChange(event) {
        const row =
            event.target.closest(
                ".criterion-row"
            );

        if (row) {
            updateCriterionValueControl(
                row
            );
        }

        clearResult();
    }

    async function handleRunCalculation() {
        await runCalculation();
    }

    function renderFunctionOptions() {
        const current =
            elements
                .calculationFunctionSelector
                .value ||
            state.get(
                "calculation.functionId",
                "sum"
            );

        dom.renderSelectOptions(
            elements
                .calculationFunctionSelector,

            CALCULATION_FUNCTIONS.map(
                (item) => ({
                    value:
                        item.id,

                    label:
                        `${item.excelName} — ${item.label}`
                })
            ),

            {
                value:
                    CALCULATION_FUNCTIONS.some(
                        (item) =>
                            item.id ===
                            current
                    )
                        ? current
                        : "sum"
            }
        );
    }

    function getSelectedFunction() {
        return (
            CALCULATION_FUNCTIONS.find(
                (item) =>
                    item.id ===
                    elements
                        .calculationFunctionSelector
                        .value
            ) || null
        );
    }

    function supportsCriteria(
        selectedFunction
    ) {
        return Boolean(
            selectedFunction &&
            (
                selectedFunction
                    .supportsCriteria ||
                CRITERIA_FUNCTIONS.has(
                    selectedFunction.id
                )
            )
        );
    }

    function requiresValueColumn(
        selectedFunction
    ) {
        return Boolean(
            selectedFunction &&
            !NO_VALUE_COLUMN_FUNCTIONS.has(
                selectedFunction.id
            )
        );
    }

    function requiresNumericColumn(
        selectedFunction
    ) {
        return Boolean(
            selectedFunction &&
            NUMERIC_FUNCTIONS.has(
                selectedFunction.id
            )
        );
    }

    function getDetectedColumnType(
        columnName
    ) {
        const detectedTypes =
            state.get(
                "import.detectedTypes",
                {}
            );

        return (
            detectedTypes[
                columnName
            ] ||
            DATA_TYPES.TEXT
        );
    }

    function renderColumnOptions(
        selectedFunction =
            getSelectedFunction()
    ) {
        const headers =
            state.get(
                "import.headers",
                []
            );

        const current =
            elements
                .calculationValueColumnSelector
                .value;

        const available =
            requiresNumericColumn(
                selectedFunction
            )
                ? headers.filter(
                    (header) => {
                        const type =
                            getDetectedColumnType(
                                header
                            );

                        return (
                            type ===
                                DATA_TYPES.NUMBER ||
                            type ===
                                DATA_TYPES.MIXED
                        );
                    }
                )
                : headers;

        dom.renderSelectOptions(
            elements
                .calculationValueColumnSelector,

            available.map(
                (header) => ({
                    value:
                        header,

                    label:
                        header
                })
            ),

            {
                placeholder:
                    available.length
                        ? "Wybierz kolumnę"
                        : "Brak odpowiednich kolumn",

                value:
                    available.includes(
                        current
                    )
                        ? current
                        : ""
            }
        );

        getCriterionRows()
            .forEach((row) => {
                const select =
                    row.querySelector(
                        ".criterion-column"
                    );

                const value =
                    select?.value || "";

                renderCriterionColumnOptions(
                    select,
                    headers,
                    value
                );

                updateCriterionValueControl(
                    row
                );
            });
    }

    function renderCriterionColumnOptions(
        select,
        headers,
        selectedValue = ""
    ) {
        if (!select) {
            return;
        }

        dom.renderSelectOptions(
            select,

            headers.map(
                (header) => ({
                    value:
                        header,

                    label:
                        header
                })
            ),

            {
                placeholder:
                    "Wybierz kolumnę",

                value:
                    headers.includes(
                        selectedValue
                    )
                        ? selectedValue
                        : ""
            }
        );
    }

    function updateFunctionControls() {
        const selectedFunction =
            getSelectedFunction();

        if (!selectedFunction) {
            return;
        }

        const criteriaSupported =
            supportsCriteria(
                selectedFunction
            );

        const valueRequired =
            requiresValueColumn(
                selectedFunction
            );

        dom.setHidden(
            elements.criteriaBuilder,
            !criteriaSupported
        );

        dom.setHidden(
            elements
                .calculationValueColumnField,
            !valueRequired
        );

        dom.setDisabled(
            elements
                .calculationValueColumnSelector,
            !valueRequired
        );

        renderColumnOptions(
            selectedFunction
        );

        if (
            criteriaSupported &&
            !getCriterionRows().length
        ) {
            addCriterionRow();
        }

        updateCriterionButtons();
        updateLearningContext(
            selectedFunction
        );
    }

    function addCriterionRow(
        initial = {}
    ) {
        if (
            getCriterionRows().length >=
            MAX_CRITERIA
        ) {
            dom.showInfo(
                `Można dodać maksymalnie ${MAX_CRITERIA} warunków.`,
                "Warunki"
            );

            return null;
        }

        const headers =
            state.get(
                "import.headers",
                []
            );

        const columnSelect =
            dom.createElement(
                "select",
                {
                    className:
                        "criterion-column",

                    attributes: {
                        "aria-label":
                            "Kolumna warunku"
                    }
                }
            );

        renderCriterionColumnOptions(
            columnSelect,
            headers,
            initial.column || ""
        );

        const operatorSelect =
            dom.createElement(
                "select",
                {
                    className:
                        "criterion-operator",

                    attributes: {
                        "aria-label":
                            "Operator warunku"
                    }
                }
            );

        dom.renderSelectOptions(
            operatorSelect,

            CRITERIA_OPERATORS.map(
                (operator) => ({
                    value:
                        operator.id,

                    label:
                        operator.symbol
                            ? `${operator.label} (${operator.symbol})`
                            : operator.label
                })
            ),

            {
                value:
                    CRITERIA_OPERATORS.some(
                        (operator) =>
                            operator.id ===
                            initial.operator
                    )
                        ? initial.operator
                        : "equals"
            }
        );

        const valueInput =
            dom.createElement(
                "input",
                {
                    className:
                        "criterion-value",

                    attributes: {
                        type: "text",
                        placeholder:
                            "Wartość warunku",
                        "aria-label":
                            "Wartość warunku",
                        autocomplete: "off"
                    },

                    properties: {
                        value:
                            initial.value ?? ""
                    }
                }
            );

        const removeButton =
            dom.createElement(
                "button",
                {
                    text: "Usuń",
                    className:
                        "criterion-remove",

                    attributes: {
                        type: "button"
                    },

                    dataset: {
                        action:
                            "remove-criterion"
                    }
                }
            );

        const row =
            dom.createElement(
                "div",
                {
                    className:
                        "criterion-row",

                    dataset: {
                        criterionId:
                            createId(
                                "criterion"
                            )
                    },

                    children: [
                        columnSelect,
                        operatorSelect,
                        valueInput,
                        removeButton
                    ]
                }
            );

        elements.criteriaRows
            .appendChild(row);

        updateCriterionValueControl(
            row
        );

        updateCriterionButtons();

        return row;
    }

    function getCriterionRows() {
        return [
            ...elements.criteriaRows
                .querySelectorAll(
                    ".criterion-row"
                )
        ];
    }

    function readCriteriaFromUI() {
        return getCriterionRows()
            .map((row) => ({
                column:
                    row.querySelector(
                        ".criterion-column"
                    )?.value || "",

                operator:
                    row.querySelector(
                        ".criterion-operator"
                    )?.value ||
                    "equals",

                value:
                    row.querySelector(
                        ".criterion-value"
                    )?.value ?? ""
            }));
    }

    function updateCriterionValueControl(
        row
    ) {
        const operator =
            row.querySelector(
                ".criterion-operator"
            )?.value ||
            "equals";

        const column =
            row.querySelector(
                ".criterion-column"
            )?.value || "";

        const input =
            row.querySelector(
                ".criterion-value"
            );

        if (!input) {
            return;
        }

        const valueNotRequired =
            VALUELESS_OPERATORS.has(
                operator
            );

        input.disabled =
            valueNotRequired;

        input.hidden =
            valueNotRequired;

        if (valueNotRequired) {
            input.value = "";
            return;
        }

        const type =
            getDetectedColumnType(
                column
            );

        if (
            type ===
            DATA_TYPES.NUMBER
        ) {
            input.type = "number";
            input.step = "any";
            input.placeholder =
                "Wartość liczbowa";
        } else if (
            type === DATA_TYPES.DATE
        ) {
            input.type = "date";
            input.removeAttribute(
                "step"
            );
        } else {
            input.type = "text";
            input.removeAttribute(
                "step"
            );
            input.placeholder =
                "Wartość warunku";
        }
    }

    function updateCriterionButtons() {
        const rows =
            getCriterionRows();

        elements.addCriterionButton
            .disabled =
            rows.length >=
            MAX_CRITERIA;

        rows.forEach((row) => {
            const button =
                row.querySelector(
                    '[data-action="remove-criterion"]'
                );

            if (button) {
                button.disabled =
                    rows.length <= 1;
            }
        });
    }

    function getConfiguration() {
        const selectedFunction =
            getSelectedFunction();

        return {
            functionId:
                selectedFunction?.id ||
                "",

            valueColumn:
                requiresValueColumn(
                    selectedFunction
                )
                    ? elements
                        .calculationValueColumnSelector
                        .value
                    : "",

            criteria:
                supportsCriteria(
                    selectedFunction
                )
                    ? readCriteriaFromUI()
                    : []
        };
    }

    function validateConfiguration(
        configuration
    ) {
        const errors = [];

        const selectedFunction =
            CALCULATION_FUNCTIONS.find(
                (item) =>
                    item.id ===
                    configuration.functionId
            ) || null;

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

        if (!selectedFunction) {
            errors.push(
                "Nie wybrano poprawnej funkcji."
            );
        }

        if (!rows.length) {
            errors.push(
                "Brak danych do obliczenia."
            );
        }

        if (
            selectedFunction &&
            requiresValueColumn(
                selectedFunction
            )
        ) {
            if (
                !configuration.valueColumn
            ) {
                errors.push(
                    "Wybierz kolumnę wartości."
                );
            } else if (
                !headers.includes(
                    configuration.valueColumn
                )
            ) {
                errors.push(
                    "Wybrana kolumna wartości nie istnieje."
                );
            }
        }

        if (
            selectedFunction &&
            supportsCriteria(
                selectedFunction
            )
        ) {
            if (
                !configuration.criteria.length
            ) {
                errors.push(
                    "Dodaj co najmniej jeden warunek."
                );
            }

            configuration.criteria
                .forEach(
                    (
                        criterion,
                        index
                    ) => {
                        const number =
                            index + 1;

                        if (
                            !criterion.column
                        ) {
                            errors.push(
                                `Warunek ${number}: wybierz kolumnę.`
                            );
                        } else if (
                            !headers.includes(
                                criterion.column
                            )
                        ) {
                            errors.push(
                                `Warunek ${number}: kolumna nie istnieje.`
                            );
                        }

                        if (
                            !CRITERIA_OPERATORS.some(
                                (operator) =>
                                    operator.id ===
                                    criterion.operator
                            )
                        ) {
                            errors.push(
                                `Warunek ${number}: wybierz operator.`
                            );
                        }

                        if (
                            !VALUELESS_OPERATORS.has(
                                criterion.operator
                            ) &&
                            isBlank(
                                criterion.value
                            )
                        ) {
                            errors.push(
                                `Warunek ${number}: wpisz wartość.`
                            );
                        }
                    }
                );
        }

        return {
            valid:
                errors.length === 0,

            errors,
            selectedFunction
        };
    }

    async function runCalculation(
        customConfiguration = null
    ) {
        const token =
            ++calculationToken;

        const configuration =
            normalizeConfiguration(
                customConfiguration ||
                getConfiguration()
            );

        const validation =
            validateConfiguration(
                configuration
            );

        if (!validation.valid) {
            dom.showWarning(
                validation.errors.join(" "),
                "Obliczenia"
            );

            return null;
        }

        try {
            state.clearError();

            state.setBusy({
                title:
                    "Wykonywanie obliczenia",

                message:
                    supportsCriteria(
                        validation
                            .selectedFunction
                    )
                        ? "Sprawdzanie warunków..."
                        : "Przygotowywanie wartości...",

                progress: 20
            });

            await yieldToBrowser();

            const rows =
                state.get(
                    "table.workingRows",
                    []
                );

            const result =
                executeCalculation(
                    rows,
                    configuration
                );

            if (
                token !==
                calculationToken
            ) {
                return null;
            }

            const formula =
                buildExcelFormula(
                    configuration
                );

            const explanation =
                buildExplanation(
                    validation
                        .selectedFunction,

                    configuration,
                    result
                );

            const stateResult = {
                functionId:
                    configuration.functionId,

                valueColumn:
                    configuration.valueColumn,

                criteria:
                    configuration.criteria,

                result:
                    result.value,

                formula,
                explanation,

                matchedRows:
                    result.matchedRows
            };

            state.setCalculationConfiguration(
                configuration
            );

            state.setCalculationResult(
                stateResult
            );

            state.completeSection(
                SECTIONS.CALCULATION
            );

            dom.renderCalculationResult(
                stateResult
            );

            dom.setStatusBadge(
                elements.calculationStatus,

                result.value === null
                    ? "Brak wyniku"
                    : "Obliczono",

                result.value === null
                    ? STATUS.WARNING
                    : STATUS.SUCCESS
            );

            updateLearningContext(
                validation.selectedFunction
            );

            state.clearBusy(
                STATUS.READY
            );

            if (
                result.value === null
            ) {
                dom.showWarning(
                    "Nie znaleziono wartości liczbowych spełniających warunki.",
                    "Brak wyniku"
                );
            } else {
                dom.showSuccess(
                    `Wynik: ${formatResultValue(
                        result.value
                    )}. Pasujące wiersze: ${formatInteger(
                        result.matchedRows
                    )}.`,

                    validation
                        .selectedFunction
                        .excelName
                );
            }

            EAT.exportEngine
                ?.syncAvailability?.();

            return stateResult;
        } catch (error) {
            return handleCalculationError(
                error
            );
        }
    }

    function normalizeConfiguration(
        configuration = {}
    ) {
        return {
            functionId:
                String(
                    configuration.functionId ||
                    ""
                ),

            valueColumn:
                String(
                    configuration.valueColumn ||
                    ""
                ),

            criteria:
                Array.isArray(
                    configuration.criteria
                )
                    ? configuration.criteria
                        .map(
                            (criterion) => ({
                                column:
                                    String(
                                        criterion?.column ||
                                        ""
                                    ),

                                operator:
                                    String(
                                        criterion?.operator ||
                                        "equals"
                                    ),

                                value:
                                    criterion?.value ?? ""
                            })
                        )
                    : []
        };
    }

    function executeCalculation(
        rows,
        configuration
    ) {
        const sourceRows =
            Array.isArray(rows)
                ? rows
                : [];

        const matchedRows =
            configuration.criteria.length
                ? sourceRows.filter(
                    (row) =>
                        rowMatchesCriteria(
                            row,
                            configuration.criteria
                        )
                )
                : [...sourceRows];

        if (
            configuration.functionId ===
            "countifs"
        ) {
            return {
                value:
                    matchedRows.length,

                matchedRows:
                    matchedRows.length,

                numericValues: []
            };
        }

        const rawValues =
            matchedRows.map(
                (row) =>
                    row?.[
                        configuration
                            .valueColumn
                    ]
            );

        if (
            configuration.functionId ===
            "counta"
        ) {
            return {
                value:
                    rawValues.reduce(
                        (
                            total,
                            value
                        ) =>
                            total +
                            (
                                isCountaValue(
                                    value
                                )
                                    ? 1
                                    : 0
                            ),
                        0
                    ),

                matchedRows:
                    matchedRows.length,

                numericValues: []
            };
        }

        const numericValues =
            rawValues
                .map(parseNumber)
                .filter(
                    (value) =>
                        value !== null &&
                        Number.isFinite(
                            value
                        )
                );

        switch (
            configuration.functionId
        ) {
            case "count":
                return {
                    value:
                        numericValues.length,

                    matchedRows:
                        matchedRows.length,

                    numericValues
                };

            case "sum":
            case "sumifs":
                return {
                    value:
                        sumValues(
                            numericValues
                        ),

                    matchedRows:
                        matchedRows.length,

                    numericValues
                };

            case "average":
            case "averageifs":
                return {
                    value:
                        numericValues.length
                            ? (
                                sumValues(
                                    numericValues
                                ) /
                                numericValues.length
                            )
                            : null,

                    matchedRows:
                        matchedRows.length,

                    numericValues
                };

            case "min":
            case "minifs":
                return {
                    value:
                        numericValues.length
                            ? findMinimum(
                                numericValues
                            )
                            : null,

                    matchedRows:
                        matchedRows.length,

                    numericValues
                };

            case "max":
            case "maxifs":
                return {
                    value:
                        numericValues.length
                            ? findMaximum(
                                numericValues
                            )
                            : null,

                    matchedRows:
                        matchedRows.length,

                    numericValues
                };

            default:
                throw new Error(
                    "Nieobsługiwana funkcja obliczeniowa."
                );
        }
    }

    function isCountaValue(value) {
        return !(
            value === null ||
            value === undefined ||
            value === ""
        );
    }

    function sumValues(values) {
        return values.reduce(
            (
                total,
                value
            ) =>
                total + value,
            0
        );
    }

    function findMinimum(values) {
        return values.reduce(
            (
                minimum,
                value
            ) =>
                value < minimum
                    ? value
                    : minimum,
            Infinity
        );
    }

    function findMaximum(values) {
        return values.reduce(
            (
                maximum,
                value
            ) =>
                value > maximum
                    ? value
                    : maximum,
            -Infinity
        );
    }

    function buildExcelFormula(
        configuration
    ) {
        const selectedFunction =
            CALCULATION_FUNCTIONS.find(
                (item) =>
                    item.id ===
                    configuration.functionId
            );

        if (!selectedFunction) {
            return "";
        }

        const valueReference =
            configuration.valueColumn
                ? buildStructuredReference(
                    configuration.valueColumn
                )
                : "";

        if (
            !supportsCriteria(
                selectedFunction
            )
        ) {
            return (
                `=${selectedFunction.excelName}` +
                `(${valueReference})`
            );
        }

        const criteriaParts = [];

        configuration.criteria
            .forEach((criterion) => {
                criteriaParts.push(
                    buildStructuredReference(
                        criterion.column
                    )
                );

                criteriaParts.push(
                    buildExcelCriterion(
                        criterion.operator,
                        criterion.value
                    )
                );
            });

        if (
            configuration.functionId ===
            "countifs"
        ) {
            return (
                `=${selectedFunction.excelName}(` +
                criteriaParts.join(";") +
                ")"
            );
        }

        return (
            `=${selectedFunction.excelName}(` +
            [
                valueReference,
                ...criteriaParts
            ].join(";") +
            ")"
        );
    }

    function buildStructuredReference(
        columnName
    ) {
        const safeColumn =
            String(
                columnName ?? ""
            ).replace(
                /]/g,
                "]]"
            );

        return (
            `${TABLE_NAME}[${safeColumn}]`
        );
    }

    function buildExplanation(
        selectedFunction,
        configuration,
        result
    ) {
        return (
            `${selectedFunction.description} ` +
            (
                configuration.valueColumn
                    ? `Kolumna: „${configuration.valueColumn}”. `
                    : ""
            ) +
            `Pasujące wiersze: ${formatInteger(
                result.matchedRows
            )}.`
        );
    }

    function updateLearningContext(
        selectedFunction
    ) {
        const learning =
            LEARNING_CONTENT.calculation;

        state.setLearningContext(
            "calculation",
            {
                context:
                    selectedFunction
                        ?.description ||
                    learning.explanation,

                excelEquivalent:
                    selectedFunction
                        ?.excelName ||
                    learning.excelEquivalent,

                verificationTip:
                    learning.verificationTip
            }
        );
    }

    function formatResultValue(value) {
        return typeof value ===
            "number"
            ? formatNumber(value)
            : String(value ?? "");
    }

    function clearResult() {
        calculationToken += 1;

        state.set(
            "calculation",
            {
                ...state.get(
                    "calculation",
                    {}
                ),

                functionId:
                    elements
                        .calculationFunctionSelector
                        .value ||
                    "sum",

                valueColumn:
                    elements
                        .calculationValueColumnSelector
                        .value ||
                    "",

                criteria:
                    supportsCriteria(
                        getSelectedFunction()
                    )
                        ? readCriteriaFromUI()
                        : [],

                result: null,
                formula: "",
                explanation: "",
                matchedRows: 0,
                completedAt: null
            }
        );

        dom.renderCalculationResult(
            {}
        );

        dom.setStatusBadge(
            elements.calculationStatus,
            "Brak obliczenia",
            STATUS.IDLE
        );

        EAT.exportEngine
            ?.syncAvailability?.();
    }

    function reset() {
        calculationToken += 1;

        dom.clearElement(
            elements.criteriaRows
        );

        elements
            .calculationFunctionSelector
            .value =
            CALCULATION_FUNCTIONS.some(
                (item) =>
                    item.id === "sum"
            )
                ? "sum"
                : (
                    CALCULATION_FUNCTIONS[0]
                        ?.id || ""
                );

        renderColumnOptions();
        updateFunctionControls();
        clearResult();
    }

    function handleCalculationError(error) {
        const normalized =
            normalizeError(
                error,
                "Obliczenia"
            );

        state.setError(
            error,
            "Obliczenia"
        );

        state.clearBusy(
            STATUS.ERROR
        );

        dom.setStatusBadge(
            elements.calculationStatus,
            "Błąd",
            STATUS.ERROR
        );

        dom.showError(
            normalized.message,
            "Obliczenia"
        );

        return null;
    }

    const api = Object.freeze({
        initialize,
        destroy,

        runCalculation,
        executeCalculation,
        buildExcelFormula,

        addCriterionRow,
        readCriteriaFromUI,

        getConfiguration,
        normalizeConfiguration,
        validateConfiguration,

        renderFunctionOptions,
        renderColumnOptions,
        updateFunctionControls,

        supportsCriteria,
        requiresValueColumn,
        requiresNumericColumn,

        isCountaValue,
        sumValues,
        findMinimum,
        findMaximum,

        clearResult,
        reset,

        get initialized() {
            return initialized;
        }
    });

    Object.defineProperty(
        EAT,
        "calculationEngine",
        {
            value: api,
            writable: false,
            enumerable: true,
            configurable: false
        }
    );
})(window);
