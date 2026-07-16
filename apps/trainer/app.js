/* ==========================================================
   Excel Analytics Trainer
   app.js
========================================================== */

(function initializeApplication(global) {
    "use strict";

    const EAT = global.EAT || (global.EAT = {});

    const MODULE_INITIALIZATION_ORDER = Object.freeze([
        "importEngine",
        "dataQualityEngine",
        "cleaningEngine",
        "calculationEngine",
        "pivotEngine",
        "chartEngine",
        "exportEngine",
        "learningEngine"
    ]);

    const handlers = [];
    const cleanupCallbacks = [];

    let initialized = false;
    let booting = false;
    let lastRenderedSection = "";
    let tableRenderToken = 0;

    let constants;
    let state;
    let utils;
    let dom;
    let elements;

    async function bootstrap() {
        if (initialized || booting) {
            return api;
        }

        booting = true;

        try {
            assertCoreModules();

            constants = EAT.constants;
            state = EAT.state;
            utils = EAT.utils;
            dom = EAT.dom;

            state.initialize();
            dom.initialize();

            elements = dom.elements;

            assertExternalLibraries();
            initializeFeatureModules();
            bindApplicationEvents();
            subscribeToState();
            installGlobalErrorHandlers();
            configureInitialInterface();

            state.setApplicationStatus(
                constants.STATUS.READY
            );

            initialized = true;
            booting = false;

            global.__EAT_READY__ = true;

            return api;
        } catch (error) {
            booting = false;
            global.__EAT_READY__ = false;
            showFatalError(error);
            return null;
        }
    }

    function assertCoreModules() {
        if (!EAT.constants) {
            throw new Error(
                "Nie załadowano modułu constants."
            );
        }

        const missing =
            EAT.constants
                .REQUIRED_MODULES
                .filter(
                    (moduleName) =>
                        !EAT[moduleName]
                );

        if (missing.length) {
            throw new Error(
                "Nie załadowano modułów: " +
                missing.join(", ") +
                "."
            );
        }
    }

    function assertExternalLibraries() {
        if (
            !global.XLSX ||
            typeof global.XLSX.read !==
                "function"
        ) {
            throw new Error(
                "Nie załadowano biblioteki SheetJS."
            );
        }

        if (
            typeof global.Chart !==
            "function"
        ) {
            throw new Error(
                "Nie załadowano biblioteki Chart.js."
            );
        }
    }

    function initializeFeatureModules() {
        MODULE_INITIALIZATION_ORDER
            .forEach((moduleName) => {
                const module =
                    EAT[moduleName];

                if (
                    typeof module
                        .initialize !==
                    "function"
                ) {
                    throw new Error(
                        `Moduł ${moduleName} nie posiada initialize().`
                    );
                }

                module.initialize();
            });
    }

    function bindApplicationEvents() {
        bind(
            elements.resetButton,
            "click",
            handleReset
        );

        bind(
            elements.globalSearchInput,
            "input",
            utils.debounce(
                handleGlobalSearch,
                180
            )
        );

        bind(
            elements.pageSizeSelector,
            "change",
            handlePageSizeChange
        );

        bind(
            elements.clearTableFiltersButton,
            "click",
            handleClearTableFilters
        );

        bind(
            elements.previousPageButton,
            "click",
            handlePreviousPage
        );

        bind(
            elements.nextPageButton,
            "click",
            handleNextPage
        );

        bind(
            elements.dataTableHead,
            "click",
            handleTableHeaderClick
        );

        elements.workflowSteps
            .forEach((button) => {
                bind(
                    button,
                    "click",
                    handleWorkflowClick
                );
            });
    }

    function bind(
        element,
        eventName,
        handler
    ) {
        if (
            !element ||
            typeof element
                .addEventListener !==
                "function"
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

    function subscribeToState() {
        cleanupCallbacks.push(
            state.subscribe(
                handleStateNotification
            )
        );
    }

    function configureInitialInterface() {
        elements.pageSizeSelector.value =
            String(
                state.get(
                    "table.pageSize",
                    constants
                        .FILE_LIMITS
                        .defaultPageSize
                )
            );

        lastRenderedSection =
            state.get(
                "workflow.activeSection",
                constants.SECTIONS.IMPORT
            );

        dom.activateSection(
            lastRenderedSection,
            {
                scroll: false
            }
        );

        dom.setStatusBadge(
            elements.importStatus,
            "Brak pliku",
            constants.STATUS.IDLE
        );

        dom.setStatusBadge(
            elements.previewStatus,
            "Oczekuje",
            constants.STATUS.IDLE
        );

        dom.setStatusBadge(
            elements.cleaningStatus,
            "Brak zmian",
            constants.STATUS.IDLE
        );

        dom.setStatusBadge(
            elements.calculationStatus,
            "Brak obliczenia",
            constants.STATUS.IDLE
        );

        renderTableView({
            resetPage: true
        });
    }

    function handleWorkflowClick(event) {
        openSection(
            event.currentTarget
                .dataset.section
        );
    }

    function openSection(
        sectionId,
        options = {}
    ) {
        if (!sectionId) {
            return false;
        }

        const activated =
            state.activateSection(
                sectionId
            );

        if (!activated) {
            dom.showWarning(
                "Ten etap nie jest jeszcze dostępny.",
                "Etap zablokowany"
            );

            return false;
        }

        dom.activateSection(
            sectionId,
            {
                scroll:
                    options.scroll !==
                    false,

                behavior:
                    options.behavior ||
                    "smooth"
            }
        );

        lastRenderedSection =
            sectionId;

        return true;
    }

    function synchronizeActiveSection() {
        const activeSection =
            state.get(
                "workflow.activeSection",
                constants.SECTIONS.IMPORT
            );

        if (
            !activeSection ||
            activeSection ===
                lastRenderedSection
        ) {
            return;
        }

        dom.activateSection(
            activeSection,
            {
                scroll: false
            }
        );

        lastRenderedSection =
            activeSection;
    }

    function handleGlobalSearch(event) {
        state.setSearchText(
            event.target.value
        );

        renderTableView({
            resetPage: true
        });
    }

    function handlePageSizeChange(event) {
        state.setPageSize(
            event.target.value
        );

        renderTableView({
            resetPage: true
        });
    }

    function handleClearTableFilters() {
        elements.globalSearchInput.value =
            "";

        state.clearTableFilters();

        renderTableView({
            resetPage: true
        });
    }

    function handlePreviousPage() {
        state.setPage(
            state.get(
                "table.page",
                1
            ) - 1
        );

        renderTableView();
    }

    function handleNextPage() {
        state.setPage(
            state.get(
                "table.page",
                1
            ) + 1
        );

        renderTableView();
    }

    function handleTableHeaderClick(event) {
        const button =
            event.target.closest(
                ".table-sort-button[data-column]"
            );

        if (!button) {
            return;
        }

        const column =
            button.dataset.column;

        const sort =
            state.get(
                "table.sort",
                {}
            );

        state.setSort(
            column,
            (
                sort.column === column &&
                sort.direction === "asc"
            )
                ? "desc"
                : "asc"
        );

        renderTableView({
            resetPage: true
        });
    }

    function renderTableView(
        options = {}
    ) {
        const token =
            ++tableRenderToken;

        const headers =
            state.get(
                "import.headers",
                []
            );

        const sourceRows =
            state.get(
                "table.workingRows",
                []
            );

        const detectedTypes =
            state.get(
                "import.detectedTypes",
                {}
            );

        const searchText =
            state.get(
                "table.searchText",
                ""
            );

        const columnFilters =
            state.get(
                "table.columnFilters",
                {}
            );

        const sort =
            state.get(
                "table.sort",
                {
                    column: "",
                    direction: "asc"
                }
            );

        let filteredRows =
            utils.filterRows(
                sourceRows,
                {
                    searchText,
                    columnFilters
                }
            );

        if (
            sort.column &&
            headers.includes(
                sort.column
            )
        ) {
            filteredRows =
                utils.sortRows(
                    filteredRows,
                    sort.column,
                    sort.direction
                );
        }

        const pagination =
            utils.paginateRows(
                filteredRows,
                options.resetPage
                    ? 1
                    : state.get(
                        "table.page",
                        1
                    ),
                state.get(
                    "table.pageSize",
                    constants
                        .FILE_LIMITS
                        .defaultPageSize
                )
            );

        if (
            token !== tableRenderToken
        ) {
            return;
        }

        state.set(
            "table.filteredRows",
            utils.cloneRows(
                filteredRows
            ),
            {
                notify: false
            }
        );

        state.set(
            "table.page",
            pagination.page,
            {
                notify: false
            }
        );

        state.set(
            "table.totalPages",
            pagination.totalPages,
            {
                notify: false
            }
        );

        dom.renderDataTable(
            headers,
            pagination.rows,
            {
                detectedTypes,
                startIndex:
                    (
                        pagination.page -
                        1
                    ) *
                    pagination.pageSize,
                sort,
                emptyMessage:
                    sourceRows.length
                        ? "Brak wyników spełniających warunki."
                        : "Brak danych do wyświetlenia."
            }
        );

        dom.updatePagination(
            pagination
        );

        updatePreviewStatus(
            sourceRows.length,
            filteredRows.length
        );
    }

    function updatePreviewStatus(
        sourceRowCount,
        filteredRowCount
    ) {
        if (!sourceRowCount) {
            dom.setStatusBadge(
                elements.previewStatus,
                "Oczekuje",
                constants.STATUS.IDLE
            );

            return;
        }

        dom.setStatusBadge(
            elements.previewStatus,

            filteredRowCount !==
                sourceRowCount
                ? `${utils.formatInteger(
                    filteredRowCount
                )} z ${utils.formatInteger(
                    sourceRowCount
                )}`
                : `${utils.formatInteger(
                    sourceRowCount
                )} wierszy`,

            filteredRowCount
                ? constants.STATUS.SUCCESS
                : constants.STATUS.WARNING
        );
    }

    function refreshDataDependentControls() {
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

        if (!headers.length) {
            return;
        }

        const detectedTypes =
            utils.detectColumnTypes(
                headers,
                rows
            );

        state.set(
            "import.detectedTypes",
            detectedTypes,
            {
                notify: false
            }
        );

        dom.renderColumnSelectors(
            headers,
            detectedTypes
        );

        EAT.cleaningEngine
            ?.renderColumnOptions?.();

        EAT.calculationEngine
            ?.renderColumnOptions?.();

        EAT.pivotEngine
            ?.renderAvailableFields?.(
                elements
                    .pivotFieldSearchInput
                    .value || ""
            );

        renderTableView({
            resetPage: true
        });
    }

    function handleDataReady() {
        elements.globalSearchInput.value =
            "";

        refreshDataDependentControls();

        EAT.chartEngine
            ?.syncAvailability?.();

        EAT.exportEngine
            ?.syncAvailability?.();
    }

    function handleCleaningChange() {
        refreshDataDependentControls();

        EAT.chartEngine
            ?.syncAvailability?.();

        EAT.exportEngine
            ?.syncAvailability?.();
    }

    function handleStateNotification(
        payload
    ) {
        synchronizeActiveSection();

        switch (payload?.eventName) {
            case constants.EVENTS.DATA_READY:
                handleDataReady();
                break;

            case constants.EVENTS.CLEANING_APPLIED:
            case constants.EVENTS.CLEANING_UNDONE:
                handleCleaningChange();
                break;

            case constants.EVENTS.QUALITY_COMPLETED:
            case constants.EVENTS.CALCULATION_COMPLETED:
            case constants.EVENTS.PIVOT_BUILT:
                EAT.chartEngine
                    ?.syncAvailability?.();

                EAT.exportEngine
                    ?.syncAvailability?.();
                break;

            case constants.EVENTS.WORKSPACE_RESET:
                handleWorkspaceReset();
                break;

            default:
                break;
        }
    }

    function handleReset() {
        const rowCount =
            state.get(
                "table.workingRows",
                []
            ).length;

        if (
            rowCount > 0 &&
            state.getPreference(
                "confirmDestructiveActions",
                true
            ) &&
            !global.confirm(
                "Wyczyścić bieżący plik i wszystkie wyniki analizy?"
            )
        ) {
            return;
        }

        state.resetWorkspace();

        global.setTimeout(
            () =>
                dom.showSuccess(
                    "Usunięto bieżące dane i wyniki analizy.",
                    "Aplikacja wyczyszczona"
                ),
            0
        );
    }

    function handleWorkspaceReset() {
        tableRenderToken += 1;

        elements.globalSearchInput.value =
            "";

        elements.pageSizeSelector.value =
            String(
                constants
                    .FILE_LIMITS
                    .defaultPageSize
            );

        lastRenderedSection =
            constants.SECTIONS.IMPORT;

        dom.activateSection(
            constants.SECTIONS.IMPORT,
            {
                scroll: false
            }
        );

        renderTableView({
            resetPage: true
        });

        EAT.exportEngine
            ?.syncAvailability?.();

        EAT.chartEngine
            ?.syncAvailability?.();
    }

    function installGlobalErrorHandlers() {
        const errorHandler =
            (event) => {
                handleUnexpectedError(
                    event.error ||
                    new Error(
                        event.message ||
                        "Nieznany błąd JavaScript."
                    ),
                    "Błąd aplikacji"
                );
            };

        const rejectionHandler =
            (event) => {
                handleUnexpectedError(
                    event.reason instanceof
                        Error
                        ? event.reason
                        : new Error(
                            String(
                                event.reason ||
                                "Nieobsłużony błąd asynchroniczny."
                            )
                        ),
                    "Błąd asynchroniczny"
                );
            };

        global.addEventListener(
            "error",
            errorHandler
        );

        global.addEventListener(
            "unhandledrejection",
            rejectionHandler
        );

        cleanupCallbacks.push(
            () => {
                global.removeEventListener(
                    "error",
                    errorHandler
                );

                global.removeEventListener(
                    "unhandledrejection",
                    rejectionHandler
                );
            }
        );
    }

    function handleUnexpectedError(
        error,
        context
    ) {
        global.console?.error?.(
            context,
            error
        );

        const normalized =
            utils.normalizeError(
                error,
                context
            );

        state?.setError?.(
            error,
            context
        );

        state?.clearBusy?.(
            constants.STATUS.ERROR
        );

        dom?.showError?.(
            normalized.message,
            context
        );
    }

    function showFatalError(error) {
        global.console?.error?.(
            "Application startup failed:",
            error
        );

        const existing =
            document.getElementById(
                "fatalApplicationError"
            );

        existing?.remove();

        const panel =
            document.createElement(
                "section"
            );

        panel.id =
            "fatalApplicationError";

        panel.className =
            "startup-error";

        panel.setAttribute(
            "role",
            "alert"
        );

        const title =
            document.createElement(
                "h2"
            );

        title.textContent =
            "Nie można uruchomić aplikacji";

        const message =
            document.createElement(
                "p"
            );

        message.textContent =
            error instanceof Error
                ? error.message
                : String(error);

        panel.append(
            title,
            message
        );

        document.body.prepend(panel);
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

        cleanupCallbacks
            .forEach((callback) => {
                try {
                    callback();
                } catch {
                    // Ignore cleanup failure.
                }
            });

        cleanupCallbacks.length = 0;

        [
            ...MODULE_INITIALIZATION_ORDER
        ]
            .reverse()
            .forEach((moduleName) => {
                EAT[moduleName]
                    ?.destroy?.();
            });

        dom?.destroy?.();
        state?.destroy?.();

        initialized = false;
        booting = false;
        global.__EAT_READY__ = false;
    }

    const api = Object.freeze({
        bootstrap,
        destroy,
        openSection,
        renderTableView,
        refreshDataDependentControls,

        get initialized() {
            return initialized;
        }
    });

    Object.defineProperty(
        EAT,
        "app",
        {
            value: api,
            writable: false,
            enumerable: true,
            configurable: false
        }
    );

    if (
        document.readyState ===
        "loading"
    ) {
        document.addEventListener(
            "DOMContentLoaded",
            bootstrap,
            {
                once: true
            }
        );
    } else {
        bootstrap();
    }
})(window);
