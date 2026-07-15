/* ==========================================================
   Excel Analytics Trainer
   src/state.js
========================================================== */

(function initializeState(global) {
    "use strict";

    const EAT = global.EAT || (global.EAT = {});

    if (!EAT.constants) {
        throw new Error("EAT.constants must be loaded before src/state.js.");
    }

    const {
        STATUS,
        SECTIONS,
        SECTION_ORDER,
        EVENTS,
        FILE_LIMITS,
        LEARNING_CONTENT
    } = EAT.constants;

    const subscribers = new Set();

    let initialized = false;
    let revision = 0;
    let model = createInitialState();

    function createInitialState() {
        return {
            application: {
                status: STATUS.IDLE,
                busy: false,
                busyTitle: "",
                busyMessage: "",
                progress: 0,
                error: null
            },

            workflow: {
                activeSection: SECTIONS.IMPORT,
                unlockedSections: [SECTIONS.IMPORT],
                completedSections: []
            },

            import: {
                fileMeta: {
                    name: "",
                    size: 0,
                    type: "",
                    lastModified: 0
                },
                sheetNames: [],
                selectedSheet: "",
                headers: [],
                dataRows: [],
                detectedTypes: {}
            },

            table: {
                originalRows: [],
                workingRows: [],
                filteredRows: [],
                searchText: "",
                columnFilters: {},
                sort: {
                    column: "",
                    direction: "asc"
                },
                page: 1,
                pageSize: FILE_LIMITS.defaultPageSize,
                totalPages: 1
            },

            quality: createEmptyQuality(),

            cleaning: {
                preview: null,
                history: []
            },

            calculation: createEmptyCalculation(),

            pivot: {
                rows: [],
                columns: [],
                values: [],
                filters: [],
                aggregation: "sum",
                filterValues: {},
                result: null,
                statistics: createEmptyPivotStatistics(),
                completedAt: null
            },

            chart: {
                type: "bar",
                title: "",
                description: "",
                rendered: false,
                config: null,
                renderedAt: null
            },

            export: {
                lastType: "",
                lastFileName: "",
                exportedAt: null
            },

            learning: {
                activeTopic: "import",
                context: LEARNING_CONTENT.import.explanation,
                excelEquivalent: LEARNING_CONTENT.import.excelEquivalent,
                verificationTip: LEARNING_CONTENT.import.verificationTip,
                panelExpanded: true
            },

            preferences: {
                confirmDestructiveActions: true
            }
        };
    }

    function createEmptyQuality() {
        return {
            completed: false,
            rowCount: 0,
            columnCount: 0,
            emptyCellCount: 0,
            duplicateRowCount: 0,
            typeErrorCount: 0,
            uniqueValueCount: 0,
            columns: [],
            checkedAt: null,
            completedAt: null
        };
    }

    function createEmptyCalculation() {
        return {
            functionId: "sum",
            valueColumn: "",
            criteria: [],
            result: null,
            formula: "",
            explanation: "",
            matchedRows: 0,
            completedAt: null
        };
    }

    function createEmptyPivotStatistics() {
        return {
            sourceRows: 0,
            groupCount: 0,
            total: 0,
            average: 0,
            minimum: null,
            maximum: null
        };
    }

    function initialize() {
        initialized = true;
        return api;
    }

    function destroy() {
        subscribers.clear();
        initialized = false;
    }

    function pathParts(path) {
        if (Array.isArray(path)) {
            return path;
        }

        return String(path || "")
            .split(".")
            .filter(Boolean);
    }

    function get(path, fallback = undefined) {
        if (!path) {
            return model;
        }

        const parts = pathParts(path);
        let current = model;

        for (const part of parts) {
            if (
                current === null ||
                current === undefined ||
                !Object.prototype.hasOwnProperty.call(current, part)
            ) {
                return fallback;
            }

            current = current[part];
        }

        return current === undefined
            ? fallback
            : current;
    }

    function set(path, value, options = {}) {
        const parts = pathParts(path);

        if (!parts.length) {
            throw new Error("State path cannot be empty.");
        }

        let current = model;

        for (let index = 0; index < parts.length - 1; index += 1) {
            const part = parts[index];

            if (
                !current[part] ||
                typeof current[part] !== "object" ||
                Array.isArray(current[part])
            ) {
                current[part] = {};
            }

            current = current[part];
        }

        current[parts.at(-1)] = value;

        if (options.notify !== false) {
            emit(
                options.eventName || EVENTS.STATE_CHANGED,
                options.detail || {
                    path,
                    value
                }
            );
        }

        return value;
    }

    function merge(path, partial, options = {}) {
        const current = get(path, {});

        return set(
            path,
            {
                ...(current && typeof current === "object" ? current : {}),
                ...(partial || {})
            },
            options
        );
    }

    function emit(eventName = EVENTS.STATE_CHANGED, detail = {}) {
        revision += 1;

        const payload = {
            eventName,
            detail,
            revision
        };

        subscribers.forEach((subscriber) => {
            try {
                subscriber(payload);
            } catch (error) {
                global.console?.error?.("State subscriber failed:", error);
            }
        });

        try {
            global.dispatchEvent(
                new CustomEvent(eventName, {
                    detail: payload
                })
            );
        } catch (error) {
            global.console?.error?.("State event dispatch failed:", error);
        }

        return payload;
    }

    function subscribe(callback) {
        if (typeof callback !== "function") {
            throw new TypeError("State subscriber must be a function.");
        }

        subscribers.add(callback);

        return () => {
            subscribers.delete(callback);
        };
    }

    function setApplicationStatus(status) {
        set("application.status", status);
    }

    function setBusy(options = {}) {
        model.application.busy = true;
        model.application.status = STATUS.PROCESSING;
        model.application.busyTitle = options.title || "Przetwarzanie danych";
        model.application.busyMessage = options.message || "Proszę czekać...";
        model.application.progress = normalizeProgress(options.progress);
        emit(EVENTS.STATE_CHANGED, {
            source: "busy",
            busy: true
        });
    }

    function updateBusy(options = {}) {
        if (options.title !== undefined) {
            model.application.busyTitle = String(options.title);
        }

        if (options.message !== undefined) {
            model.application.busyMessage = String(options.message);
        }

        if (options.progress !== undefined) {
            model.application.progress = normalizeProgress(options.progress);
        }

        emit(EVENTS.STATE_CHANGED, {
            source: "busy-update"
        });
    }

    function clearBusy(status = STATUS.READY) {
        model.application.busy = false;
        model.application.status = status;
        model.application.busyTitle = "";
        model.application.busyMessage = "";
        model.application.progress = 0;
        emit(EVENTS.STATE_CHANGED, {
            source: "busy",
            busy: false
        });
    }

    function normalizeProgress(value) {
        return Math.min(
            100,
            Math.max(
                0,
                Number(value) || 0
            )
        );
    }

    function setError(error, context = "") {
        model.application.error = {
            message:
                error instanceof Error
                    ? error.message
                    : String(error || "Nieznany błąd."),
            context,
            at: new Date().toISOString()
        };
        model.application.status = STATUS.ERROR;
        emit(EVENTS.STATE_CHANGED, {
            source: "error",
            error: model.application.error
        });
    }

    function clearError() {
        model.application.error = null;
    }

    function setImportedData(payload = {}) {
        model.import.fileMeta = {
            ...model.import.fileMeta,
            ...(payload.fileMeta || {})
        };
        model.import.sheetNames = [...(payload.sheetNames || [])];
        model.import.selectedSheet = payload.selectedSheet || "";
        model.import.headers = [...(payload.headers || [])];
        model.import.dataRows = cloneRows(payload.rows || []);
        model.import.detectedTypes = {
            ...(payload.detectedTypes || {})
        };

        model.table.originalRows = cloneRows(payload.rows || []);
        model.table.workingRows = cloneRows(payload.rows || []);
        model.table.filteredRows = cloneRows(payload.rows || []);
        model.table.searchText = "";
        model.table.columnFilters = {};
        model.table.sort = {
            column: "",
            direction: "asc"
        };
        model.table.page = 1;
        model.table.totalPages = 1;

        model.quality = createEmptyQuality();
        model.cleaning = {
            preview: null,
            history: []
        };
        model.calculation = createEmptyCalculation();
        model.pivot = {
            rows: [],
            columns: [],
            values: [],
            filters: [],
            aggregation: "sum",
            filterValues: {},
            result: null,
            statistics: createEmptyPivotStatistics(),
            completedAt: null
        };
        model.chart = {
            type: "bar",
            title: "",
            description: "",
            rendered: false,
            config: null,
            renderedAt: null
        };
        model.export = {
            lastType: "",
            lastFileName: "",
            exportedAt: null
        };

        model.workflow.unlockedSections = [...SECTION_ORDER];
        model.workflow.completedSections = [
            SECTIONS.IMPORT,
            SECTIONS.PREVIEW
        ];
        model.workflow.activeSection = SECTIONS.PREVIEW;

        emit(EVENTS.DATA_READY, {
            rowCount: model.table.workingRows.length,
            columnCount: model.import.headers.length
        });
    }

    function invalidateAnalysis(options = {}) {
        const preserveQuality = options.preserveQuality === true;

        if (!preserveQuality) {
            model.quality = createEmptyQuality();
        }

        model.calculation = {
            ...createEmptyCalculation(),
            functionId: model.calculation.functionId || "sum"
        };

        model.pivot.result = null;
        model.pivot.statistics = createEmptyPivotStatistics();
        model.pivot.completedAt = null;

        model.chart = {
            type: model.chart.type || "bar",
            title: "",
            description: "",
            rendered: false,
            config: null,
            renderedAt: null
        };

        emit(EVENTS.STATE_CHANGED, {
            source: "analysis-invalidated"
        });
    }

    function setSearchText(value) {
        model.table.searchText = String(value || "");
        model.table.page = 1;
        emit(EVENTS.STATE_CHANGED, {
            source: "table-search"
        });
    }

    function setPageSize(value) {
        const size = Math.max(
            1,
            Math.trunc(Number(value) || FILE_LIMITS.defaultPageSize)
        );

        model.table.pageSize = size;
        model.table.page = 1;

        emit(EVENTS.STATE_CHANGED, {
            source: "page-size"
        });

        return size;
    }

    function setPage(value) {
        const totalPages = Math.max(
            1,
            Number(model.table.totalPages) || 1
        );

        model.table.page = Math.min(
            totalPages,
            Math.max(
                1,
                Math.trunc(Number(value) || 1)
            )
        );

        emit(EVENTS.STATE_CHANGED, {
            source: "page"
        });

        return model.table.page;
    }

    function setSort(column, direction = "asc") {
        model.table.sort = {
            column: String(column || ""),
            direction: direction === "desc" ? "desc" : "asc"
        };
        model.table.page = 1;
        emit(EVENTS.STATE_CHANGED, {
            source: "sort"
        });
    }

    function clearTableFilters() {
        model.table.searchText = "";
        model.table.columnFilters = {};
        model.table.sort = {
            column: "",
            direction: "asc"
        };
        model.table.page = 1;
        emit(EVENTS.STATE_CHANGED, {
            source: "clear-table-filters"
        });
    }

    function completeSection(sectionId) {
        if (!SECTION_ORDER.includes(sectionId)) {
            return false;
        }

        if (!model.workflow.completedSections.includes(sectionId)) {
            model.workflow.completedSections.push(sectionId);
        }

        const index = SECTION_ORDER.indexOf(sectionId);
        const nextSection = SECTION_ORDER[index + 1];

        if (
            nextSection &&
            !model.workflow.unlockedSections.includes(nextSection)
        ) {
            model.workflow.unlockedSections.push(nextSection);
        }

        emit(EVENTS.STATE_CHANGED, {
            source: "workflow-complete",
            sectionId
        });

        return true;
    }

    function unlockSections(sectionIds = []) {
        sectionIds.forEach((sectionId) => {
            if (
                SECTION_ORDER.includes(sectionId) &&
                !model.workflow.unlockedSections.includes(sectionId)
            ) {
                model.workflow.unlockedSections.push(sectionId);
            }
        });

        emit(EVENTS.STATE_CHANGED, {
            source: "workflow-unlock",
            sectionIds
        });
    }

    function activateSection(sectionId) {
        if (
            !model.workflow.unlockedSections.includes(sectionId)
        ) {
            return false;
        }

        model.workflow.activeSection = sectionId;
        emit(EVENTS.STATE_CHANGED, {
            source: "workflow-activate",
            sectionId
        });

        return true;
    }

    function setQualityReport(report) {
        model.quality = {
            ...createEmptyQuality(),
            ...(report || {})
        };

        emit(EVENTS.QUALITY_COMPLETED, {
            report: model.quality
        });
    }

    function setCalculationConfiguration(configuration = {}) {
        model.calculation = {
            ...model.calculation,
            functionId: configuration.functionId || model.calculation.functionId,
            valueColumn: configuration.valueColumn || "",
            criteria: Array.isArray(configuration.criteria)
                ? configuration.criteria.map((criterion) => ({ ...criterion }))
                : []
        };

        emit(EVENTS.STATE_CHANGED, {
            source: "calculation-configuration"
        });
    }

    function setCalculationResult(result = {}) {
        model.calculation = {
            ...model.calculation,
            ...result,
            completedAt: result.completedAt || new Date().toISOString()
        };

        emit(EVENTS.CALCULATION_COMPLETED, {
            result: model.calculation
        });
    }

    function setPivotConfiguration(configuration = {}) {
        model.pivot.rows = [...(configuration.rows || [])];
        model.pivot.columns = [...(configuration.columns || [])];
        model.pivot.values = [...(configuration.values || [])];
        model.pivot.filters = [...(configuration.filters || [])];
        model.pivot.aggregation = configuration.aggregation || "sum";
        model.pivot.filterValues = {
            ...(configuration.filterValues || {})
        };

        emit(EVENTS.STATE_CHANGED, {
            source: "pivot-configuration"
        });
    }

    function setPivotResult(result, statistics = createEmptyPivotStatistics()) {
        model.pivot.result = result;
        model.pivot.statistics = {
            ...createEmptyPivotStatistics(),
            ...(statistics || {})
        };
        model.pivot.completedAt = result
            ? new Date().toISOString()
            : null;

        emit(EVENTS.PIVOT_BUILT, {
            result,
            statistics: model.pivot.statistics
        });
    }

    function setChartState(partial = {}) {
        model.chart = {
            ...model.chart,
            ...partial,
            renderedAt:
                partial.rendered === true
                    ? new Date().toISOString()
                    : partial.renderedAt ?? null
        };

        emit(EVENTS.STATE_CHANGED, {
            source: "chart"
        });
    }

    function setExportRecord(type, fileName) {
        model.export = {
            lastType: type || "",
            lastFileName: fileName || "",
            exportedAt: new Date().toISOString()
        };

        emit(EVENTS.STATE_CHANGED, {
            source: "export"
        });
    }

    function setLearningContext(topic, content = {}) {
        model.learning = {
            ...model.learning,
            activeTopic: topic || model.learning.activeTopic,
            context: content.context ?? model.learning.context,
            excelEquivalent:
                content.excelEquivalent ?? model.learning.excelEquivalent,
            verificationTip:
                content.verificationTip ?? model.learning.verificationTip
        };

        emit(EVENTS.STATE_CHANGED, {
            source: "learning"
        });
    }

    function setLearningPanelExpanded(expanded) {
        model.learning.panelExpanded = Boolean(expanded);
        emit(EVENTS.STATE_CHANGED, {
            source: "learning-panel"
        });
    }

    function getPreference(name, fallback = undefined) {
        return Object.prototype.hasOwnProperty.call(model.preferences, name)
            ? model.preferences[name]
            : fallback;
    }

    function resetWorkspace() {
        const preferences = {
            ...model.preferences
        };

        const panelExpanded =
            model.learning?.panelExpanded !== false;

        model = createInitialState();
        model.preferences = preferences;
        model.learning.panelExpanded = panelExpanded;

        emit(EVENTS.WORKSPACE_RESET, {});
    }

    function cloneRows(rows) {
        return Array.isArray(rows)
            ? rows.map((row) => ({ ...(row || {}) }))
            : [];
    }

    const api = Object.freeze({
        initialize,
        destroy,
        get,
        set,
        merge,
        emit,
        subscribe,

        setApplicationStatus,
        setBusy,
        updateBusy,
        clearBusy,
        setError,
        clearError,

        setImportedData,
        invalidateAnalysis,

        setSearchText,
        setPageSize,
        setPage,
        setSort,
        clearTableFilters,

        completeSection,
        unlockSections,
        activateSection,

        setQualityReport,
        setCalculationConfiguration,
        setCalculationResult,
        setPivotConfiguration,
        setPivotResult,
        setChartState,
        setExportRecord,
        setLearningContext,
        setLearningPanelExpanded,
        getPreference,

        resetWorkspace,

        get revision() {
            return revision;
        },

        get initialized() {
            return initialized;
        }
    });

    Object.defineProperty(EAT, "state", {
        value: api,
        writable: false,
        enumerable: true,
        configurable: false
    });
})(window);
