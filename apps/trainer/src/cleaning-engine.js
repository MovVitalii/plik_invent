/* ==========================================================
   Excel Analytics Trainer
   src/cleaning-engine.js
========================================================== */

(function initializeCleaningEngine(global) {
    "use strict";

    const EAT = global.EAT || (global.EAT = {});

    if (
        !EAT.constants ||
        !EAT.state ||
        !EAT.utils ||
        !EAT.dom
    ) {
        throw new Error(
            "EAT core modules must be loaded before src/cleaning-engine.js."
        );
    }

    const {
        STATUS,
        SECTIONS,
        EVENTS,
        CLEANING_OPERATIONS,
        LEARNING_CONTENT
    } = EAT.constants;

    const {
        isBlank,
        cloneRows,
        stableRowKey,
        properCase,
        cleanControlCharacters,
        formatInteger,
        yieldToBrowser,
        normalizeError
    } = EAT.utils;

    const state = EAT.state;
    const dom = EAT.dom;
    const elements = dom.elements;

    const handlers = [];

    let initialized = false;
    let operationToken = 0;

    function initialize() {
        if (initialized) {
            return api;
        }

        renderOperationOptions();
        renderColumnOptions();

        bind(
            elements.cleaningOperationSelector,
            "change",
            handleOperationChange
        );

        bind(
            elements.cleaningColumnSelector,
            "change",
            clearPreview
        );

        bind(
            elements.replaceFromInput,
            "input",
            clearPreview
        );

        bind(
            elements.replaceToInput,
            "input",
            clearPreview
        );

        bind(
            elements.previewCleaningButton,
            "click",
            handlePreview
        );

        bind(
            elements.applyCleaningButton,
            "click",
            handleApply
        );

        bind(
            elements.undoCleaningButton,
            "click",
            handleUndo
        );

        bind(
            global,
            EVENTS.DATA_READY,
            handleDataReady
        );

        bind(
            global,
            EVENTS.WORKSPACE_RESET,
            reset
        );

        renderHistory();

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
        operationToken += 1;
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

    function handleOperationChange() {
        syncReplaceControls();
        clearPreview();
    }

    function handleDataReady() {
        renderColumnOptions();
        clearPreview();
        renderHistory();
    }

    async function handlePreview() {
        await previewCleaning();
    }

    async function handleApply() {
        await applyCleaning();
    }

    function handleUndo() {
        undoLastCleaning();
    }

    function renderOperationOptions() {
        const current =
            elements
                .cleaningOperationSelector
                .value ||
            "trim";

        dom.renderSelectOptions(
            elements
                .cleaningOperationSelector,

            CLEANING_OPERATIONS.map(
                (operation) => ({
                    value:
                        operation.id,

                    label:
                        operation.label
                })
            ),

            {
                value:
                    CLEANING_OPERATIONS.some(
                        (operation) =>
                            operation.id ===
                            current
                    )
                        ? current
                        : "trim"
            }
        );

        syncReplaceControls();
    }

    function renderColumnOptions() {
        const headers =
            state.get(
                "import.headers",
                []
            );

        const current =
            elements
                .cleaningColumnSelector
                .value;

        dom.renderSelectOptions(
            elements
                .cleaningColumnSelector,

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
                    headers.length
                        ? "Wybierz kolumnę"
                        : "Brak kolumn",

                value:
                    headers.includes(
                        current
                    )
                        ? current
                        : ""
            }
        );
    }

    function syncReplaceControls() {
        dom.setHidden(
            elements.replaceControls,

            elements
                .cleaningOperationSelector
                .value !==
                "replace"
        );
    }

    function getConfiguration() {
        return {
            column:
                elements
                    .cleaningColumnSelector
                    .value,

            operationId:
                elements
                    .cleaningOperationSelector
                    .value,

            parameters: {
                from:
                    elements
                        .replaceFromInput
                        .value,

                to:
                    elements
                        .replaceToInput
                        .value
            }
        };
    }

    function validateConfiguration(
        configuration
    ) {
        const errors = [];

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

        const operation =
            CLEANING_OPERATIONS.find(
                (item) =>
                    item.id ===
                    configuration
                        .operationId
            );

        if (!rows.length) {
            errors.push(
                "Brak danych do czyszczenia."
            );
        }

        if (!operation) {
            errors.push(
                "Wybierz poprawną operację."
            );
        }

        if (
            configuration
                .operationId !==
                "remove-duplicates"
        ) {
            if (
                !configuration.column
            ) {
                errors.push(
                    "Wybierz kolumnę."
                );
            } else if (
                !headers.includes(
                    configuration.column
                )
            ) {
                errors.push(
                    "Wybrana kolumna nie istnieje."
                );
            }
        }

        if (
            configuration
                .operationId ===
                "replace" &&
            configuration
                .parameters.from ===
                ""
        ) {
            errors.push(
                "Wpisz tekst, który ma zostać zamieniony."
            );
        }

        return {
            valid:
                errors.length === 0,

            errors,
            operation
        };
    }

    async function previewCleaning() {
        const token =
            ++operationToken;

        const configuration =
            getConfiguration();

        const validation =
            validateConfiguration(
                configuration
            );

        if (!validation.valid) {
            dom.showWarning(
                validation.errors.join(" "),
                "Czyszczenie"
            );

            return null;
        }

        try {
            state.setBusy({
                title:
                    "Podgląd czyszczenia",

                message:
                    "Porównywanie wartości...",

                progress: 20
            });

            await yieldToBrowser();

            const rows =
                state.get(
                    "table.workingRows",
                    []
                );

            const result =
                applyOperation(
                    rows,
                    configuration
                );

            if (
                token !==
                operationToken
            ) {
                return null;
            }

            const preview = {
                ...result.summary,

                operationId:
                    configuration
                        .operationId,

                column:
                    configuration.column,

                description:
                    validation
                        .operation.label
            };

            state.set(
                "cleaning.preview",
                preview
            );

            dom.renderCleaningPreview(
                preview
            );

            state.clearBusy(
                STATUS.READY
            );

            return preview;
        } catch (error) {
            return handleCleaningError(
                error
            );
        }
    }

    async function applyCleaning() {
        const token =
            ++operationToken;

        const configuration =
            getConfiguration();

        const validation =
            validateConfiguration(
                configuration
            );

        if (!validation.valid) {
            dom.showWarning(
                validation.errors.join(" "),
                "Czyszczenie"
            );

            return null;
        }

        try {
            state.setBusy({
                title:
                    "Czyszczenie danych",

                message:
                    "Stosowanie operacji...",

                progress: 20
            });

            await yieldToBrowser();

            const rowsBefore =
                cloneRows(
                    state.get(
                        "table.workingRows",
                        []
                    )
                );

            const result =
                applyOperation(
                    rowsBefore,
                    configuration
                );

            if (
                token !==
                operationToken
            ) {
                return null;
            }

            const history =
                state.get(
                    "cleaning.history",
                    []
                );

            const operationRecord = {
                id:
                    `cleaning-${Date.now()}`,

                operationId:
                    configuration
                        .operationId,

                label:
                    validation
                        .operation.label,

                column:
                    configuration.column,

                parameters: {
                    ...configuration
                        .parameters
                },

                changedRows:
                    result.summary
                        .changedRows,

                removedRows:
                    result.summary
                        .removedRows,

                appliedAt:
                    new Date()
                        .toISOString(),

                /*
                 * Snapshot jest używany wyłącznie
                 * do jednego kroku Undo.
                 */
                rowsBefore
            };

            state.set(
                "table.workingRows",
                result.rows,
                {
                    notify: false
                }
            );

            state.set(
                "cleaning.history",
                [
                    ...history,
                    operationRecord
                ],
                {
                    notify: false
                }
            );

            state.set(
                "cleaning.preview",
                null,
                {
                    notify: false
                }
            );

            state.invalidateAnalysis();

            state.emit(
                EVENTS.CLEANING_APPLIED,
                {
                    operation: {
                        ...operationRecord,
                        rowsBefore:
                            undefined
                    },

                    rowCount:
                        result.rows.length
                }
            );

            state.completeSection(
                SECTIONS.CLEANING
            );

            const learning =
                LEARNING_CONTENT.cleaning;

            state.setLearningContext(
                "cleaning",
                {
                    context:
                        learning.explanation,

                    excelEquivalent:
                        getExcelEquivalent(
                            configuration
                                .operationId
                        ),

                    verificationTip:
                        learning
                            .verificationTip
                }
            );

            dom.renderCleaningPreview(
                null
            );

            renderHistory();

            dom.setStatusBadge(
                elements.cleaningStatus,

                `${formatInteger(
                    result.summary
                        .changedRows
                )} zmian`,

                STATUS.SUCCESS
            );

            state.clearBusy(
                STATUS.READY
            );

            dom.showSuccess(
                `Zmieniono ${formatInteger(
                    result.summary
                        .changedRows
                )} wierszy. Usunięto ${formatInteger(
                    result.summary
                        .removedRows
                )}.`,

                "Czyszczenie"
            );

            return result;
        } catch (error) {
            return handleCleaningError(
                error
            );
        }
    }

    function applyOperation(
        sourceRows,
        configuration
    ) {
        const headers =
            state.get(
                "import.headers",
                []
            );

        const rows =
            cloneRows(sourceRows);

        const samples = [];

        let changedRows = 0;
        let removedRows = 0;

        if (
            configuration
                .operationId ===
                "remove-duplicates"
        ) {
            const seen =
                new Set();

            const resultRows = [];

            rows.forEach((row) => {
                const key =
                    stableRowKey(
                        row,
                        headers
                    );

                if (seen.has(key)) {
                    removedRows += 1;
                    changedRows += 1;
                    return;
                }

                seen.add(key);
                resultRows.push(row);
            });

            return {
                rows:
                    resultRows,

                summary: {
                    changedRows,
                    removedRows,
                    samples,
                    description:
                        "Usuń pełne duplikaty"
                }
            };
        }

        if (
            configuration
                .operationId ===
                "remove-empty"
        ) {
            const resultRows =
                rows.filter((row) => {
                    const remove =
                        isBlank(
                            row?.[
                                configuration
                                    .column
                            ]
                        );

                    if (remove) {
                        removedRows += 1;
                        changedRows += 1;
                    }

                    return !remove;
                });

            return {
                rows:
                    resultRows,

                summary: {
                    changedRows,
                    removedRows,
                    samples,
                    description:
                        "Usuń puste wiersze"
                }
            };
        }

        rows.forEach((row) => {
            const before =
                row?.[
                    configuration.column
                ];

            const after =
                transformValue(
                    before,
                    configuration
                );

            if (
                !valuesEqual(
                    before,
                    after
                )
            ) {
                row[
                    configuration.column
                ] =
                    after;

                changedRows += 1;

                if (
                    samples.length < 8
                ) {
                    samples.push({
                        before,
                        after
                    });
                }
            }
        });

        return {
            rows,

            summary: {
                changedRows,
                removedRows,
                samples,
                description:
                    configuration
                        .operationId
            }
        };
    }

    function transformValue(
        value,
        configuration
    ) {
        if (
            value === null ||
            value === undefined
        ) {
            return value;
        }

        const text =
            String(value);

        switch (
            configuration.operationId
        ) {
            case "trim":
                return text.trim();

            case "clean":
                return cleanControlCharacters(
                    text
                );

            case "upper":
                return text
                    .toLocaleUpperCase(
                        "pl-PL"
                    );

            case "lower":
                return text
                    .toLocaleLowerCase(
                        "pl-PL"
                    );

            case "proper":
                return properCase(text);

            case "replace":
                return text
                    .split(
                        configuration
                            .parameters.from
                    )
                    .join(
                        configuration
                            .parameters.to
                    );

            default:
                return value;
        }
    }

    function valuesEqual(
        left,
        right
    ) {
        if (
            left instanceof Date &&
            right instanceof Date
        ) {
            return (
                left.getTime() ===
                right.getTime()
            );
        }

        return (
            left === right
        );
    }

    function undoLastCleaning() {
        const history =
            state.get(
                "cleaning.history",
                []
            );

        const last =
            history.at(-1);

        if (!last) {
            dom.showInfo(
                "Brak operacji do cofnięcia.",
                "Cofnij"
            );

            return false;
        }

        state.set(
            "table.workingRows",
            cloneRows(
                last.rowsBefore
            ),
            {
                notify: false
            }
        );

        state.set(
            "cleaning.history",
            history.slice(0, -1),
            {
                notify: false
            }
        );

        state.set(
            "cleaning.preview",
            null,
            {
                notify: false
            }
        );

        state.invalidateAnalysis();

        state.emit(
            EVENTS.CLEANING_UNDONE,
            {
                operationId:
                    last.operationId
            }
        );

        dom.renderCleaningPreview(
            null
        );

        renderHistory();

        dom.setStatusBadge(
            elements.cleaningStatus,

            history.length - 1
                ? `${formatInteger(
                    history.length - 1
                )} operacji`
                : "Brak zmian",

            history.length - 1
                ? STATUS.SUCCESS
                : STATUS.IDLE
        );

        dom.showSuccess(
            "Cofnięto ostatnią operację.",
            "Cofnij"
        );

        return true;
    }

    function clearPreview() {
        operationToken += 1;

        state.set(
            "cleaning.preview",
            null,
            {
                notify: false
            }
        );

        dom.renderCleaningPreview(
            null
        );
    }

    function renderHistory() {
        const history =
            state.get(
                "cleaning.history",
                []
            );

        dom.renderCleaningHistory(
            history
        );

        dom.setDisabled(
            elements.undoCleaningButton,
            !history.length
        );
    }

    function getExcelEquivalent(
        operationId
    ) {
        const equivalents = {
            trim: "TRIM",
            clean: "CLEAN",
            upper: "UPPER",
            lower: "LOWER",
            proper: "PROPER",
            replace: "SUBSTITUTE",
            "remove-empty":
                "Filtr → Puste → Usuń wiersze",
            "remove-duplicates":
                "Dane → Usuń duplikaty"
        };

        return (
            equivalents[
                operationId
            ] ||
            "Power Query"
        );
    }

    function reset() {
        operationToken += 1;

        elements
            .replaceFromInput
            .value = "";

        elements
            .replaceToInput
            .value = "";

        if (
            CLEANING_OPERATIONS.some(
                (item) =>
                    item.id === "trim"
            )
        ) {
            elements
                .cleaningOperationSelector
                .value = "trim";
        }

        syncReplaceControls();
        renderColumnOptions();
        clearPreview();
        renderHistory();

        dom.setStatusBadge(
            elements.cleaningStatus,
            "Brak zmian",
            STATUS.IDLE
        );
    }

    function handleCleaningError(error) {
        const normalized =
            normalizeError(
                error,
                "Czyszczenie"
            );

        state.setError(
            error,
            "Czyszczenie"
        );

        state.clearBusy(
            STATUS.ERROR
        );

        dom.setStatusBadge(
            elements.cleaningStatus,
            "Błąd",
            STATUS.ERROR
        );

        dom.showError(
            normalized.message,
            "Czyszczenie"
        );

        return null;
    }

    const api = Object.freeze({
        initialize,
        destroy,

        renderOperationOptions,
        renderColumnOptions,

        getConfiguration,
        validateConfiguration,

        previewCleaning,
        applyCleaning,
        applyOperation,
        transformValue,
        undoLastCleaning,

        clearPreview,
        reset,

        get initialized() {
            return initialized;
        }
    });

    Object.defineProperty(
        EAT,
        "cleaningEngine",
        {
            value: api,
            writable: false,
            enumerable: true,
            configurable: false
        }
    );
})(window);
