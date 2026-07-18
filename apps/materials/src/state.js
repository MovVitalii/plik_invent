/* ==========================================================
   Pack Materials Analytics
   src/state.js
========================================================== */

(function initializeState(global) {
    "use strict";

    const PMA = global.PMA || (global.PMA = {});

    if (!PMA.constants) {
        throw new Error("PMA.constants must be loaded before src/state.js.");
    }

    const {
        APP,
        STORAGE_KEYS,
        STATUS,
        EVENTS,
        REQUIRED_FIELDS,
        SYSTEM_FIELDS,
        DEFAULT_ANALYSIS,
        AGGREGATION_IDS,
        CHART_TYPE_IDS,
        RESULT_VIEWS,
        PROCESSING_LIMITS
    } = PMA.constants;

    const subscribers = new Set();
    let revision = 0;
    let initialized = false;
    let transactionDepth = 0;
    let queuedNotification = null;

    const LEGACY_PERSISTENT_STORAGE_KEYS = Object.freeze({
        preferences: Object.freeze([
            "pma.preferences.v1",
            "pma.preferences"
        ]),
        mappingProfiles: Object.freeze([
            "pma.mappingProfiles.v1",
            "pma.mappingProfiles"
        ]),
        recentFiles: Object.freeze([
            "pma.recentFiles.v1",
            "pma.recentFiles"
        ]),
        normalizationRules: Object.freeze([
            "pma.normalizationRules"
        ])
    });

    const PMA_STORAGE_PREFIXES = Object.freeze(["pma.", "pma:"]);

    function cloneAnalysisDefaults() {
        return {
            rows: [...DEFAULT_ANALYSIS.rows],
            columns: [...DEFAULT_ANALYSIS.columns],
            values: [...DEFAULT_ANALYSIS.values],
            aggregation: DEFAULT_ANALYSIS.aggregation,
            chartType: DEFAULT_ANALYSIS.chartType,
            resultView: DEFAULT_ANALYSIS.resultView,
            activeTemplate: DEFAULT_ANALYSIS.activeTemplate,
            sort: { ...DEFAULT_ANALYSIS.sort }
        };
    }

    function createDefaultMapping() {
        return Object.fromEntries(SYSTEM_FIELDS.map((field) => [field.id, ""]));
    }

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

            import: {
                file: null,
                fileMeta: {
                    name: "",
                    size: 0,
                    type: "",
                    lastModified: 0
                },
                workbook: null,
                sheetNames: [],
                selectedSheet: "",
                rawRows: [],
                headerRowIndex: null,
                headers: [],
                sourceHeaders: [],
                dataRows: [],
                previewRows: [],
                detectedTypes: {},
                emptyRowCount: 0,
                sourceRowNumbers: [],
                rowProvenance: [],
                sheetProvenance: {}
            },

            mapping: {
                values: createDefaultMapping(),
                confidence: {},
                origins: {},
                profileId: null,
                isValid: false,
                missingRequiredFields: [...REQUIRED_FIELDS],
                duplicateSourceColumns: [],
                unavailableSourceColumns: []
            },

            validation: {
                completed: false,
                totalRows: 0,
                validRows: 0,
                invalidRows: 0,
                duplicateRows: 0,
                warningRows: 0,
                errorsByCode: {},
                warningsByCode: {},
                messages: [],
                invalidRecords: [],
                duplicateRecords: [],
                completedAt: null
            },

            dataset: {
                normalizedRows: [],
                filteredRows: [],
                invalidRows: [],
                duplicateRows: [],
                stockRows: [],
                stockFields: [],
                calculatedColumns: [],
                transformationSteps: [],
                fields: [],
                statistics: {
                    totalSourceRows: 0,
                    normalizedRows: 0,
                    filteredRows: 0,
                    invalidRows: 0,
                    duplicateRows: 0,
                    totalQuantity: 0,
                    averageQuantity: 0,
                    minimumQuantity: null,
                    maximumQuantity: null,
                    minimumDate: null,
                    maximumDate: null
                }
            },

            filters: {
                dateFrom: "",
                dateTo: "",
                values: {}
            },

            analysis: cloneAnalysisDefaults(),

            pivot: {
                ready: false,
                result: null,
                rowFields: [],
                columnFields: [],
                valueFields: [],
                columnKeys: [],
                rows: [],
                totals: null,
                statistics: {
                    sourceRows: 0,
                    groupCount: 0,
                    total: 0,
                    average: 0,
                    minimum: 0,
                    maximum: 0
                },
                generatedAt: null
            },

            chart: {
                instance: null
            },

            ui: {
                activeSection: "importSection",
                exportMenuOpen: false,
                fieldSearch: "",
                normalizationField: "material"
            },

            preferences: {
                autoMapColumns: true,
                rememberMapping: true
            },

            mappingProfiles: [],
            normalizationRules: [],
            recentFiles: []
        };
    }

    let store = createInitialState();

    function initialize() {
        if (initialized) {
            return api;
        }

        initializeStoragePolicy();

        store.preferences = {
            ...store.preferences,
            ...readStorage(STORAGE_KEYS.preferences, {})
        };

        const loadedMappingProfiles = readStorage(STORAGE_KEYS.mappingProfiles, []);
        store.mappingProfiles = normalizeMappingProfiles(loadedMappingProfiles);
        if (JSON.stringify(store.mappingProfiles) !== JSON.stringify(loadedMappingProfiles)) {
            writeStorage(STORAGE_KEYS.mappingProfiles, store.mappingProfiles);
        }

        store.normalizationRules = normalizeNormalizationRules(
            readStorage(STORAGE_KEYS.normalizationRules, [])
        );

        store.recentFiles = Array.isArray(readStorage(STORAGE_KEYS.recentFiles, []))
            ? readStorage(STORAGE_KEYS.recentFiles, []).slice(0, 20)
            : [];

        initialized = true;
        setApplicationStatus(STATUS.READY);
        return api;
    }

    function getState() {
        return store;
    }

    function get(path, fallback = undefined) {
        if (!path) {
            return store;
        }

        const parts = Array.isArray(path) ? path : String(path).split(".");
        let value = store;

        for (const part of parts) {
            if (value === null || value === undefined) {
                return fallback;
            }
            value = value[part];
        }

        return value === undefined ? fallback : value;
    }

    function subscribe(callback) {
        if (typeof callback !== "function") {
            throw new TypeError("State subscriber must be a function.");
        }

        subscribers.add(callback);
        return function unsubscribe() {
            subscribers.delete(callback);
        };
    }

    function transaction(callback) {
        if (typeof callback !== "function") {
            throw new TypeError("Transaction callback must be a function.");
        }

        transactionDepth += 1;
        try {
            return callback(store);
        } finally {
            transactionDepth -= 1;
            if (transactionDepth === 0 && queuedNotification) {
                const notification = queuedNotification;
                queuedNotification = null;
                notify(notification.eventName, notification.detail);
            }
        }
    }

    function notify(eventName, detail = null) {
        if (transactionDepth > 0) {
            queuedNotification = { eventName, detail };
            return;
        }

        revision += 1;
        const payload = {
            eventName,
            detail,
            revision,
            state: store
        };

        subscribers.forEach((subscriber) => {
            try {
                subscriber(payload);
            } catch (error) {
                console.error("PMA state subscriber failed:", error);
            }
        });

        if (typeof CustomEvent === "function" && typeof document !== "undefined") {
            document.dispatchEvent(new CustomEvent(eventName, { detail }));
        }
    }

    function setApplicationStatus(status) {
        store.application.status = status;
        notify(EVENTS.APPLICATION_STATUS_CHANGED, { status });
    }

    function setBusy(options = {}) {
        const normalized = typeof options === "string" ? { message: options } : options;
        store.application.busy = true;
        store.application.status = STATUS.PROCESSING;
        store.application.busyTitle = String(normalized.title || "");
        store.application.busyMessage = String(normalized.message || "");
        store.application.progress = clampProgress(normalized.progress);
        notify(EVENTS.APPLICATION_BUSY_CHANGED, {
            busy: true,
            title: store.application.busyTitle,
            message: store.application.busyMessage,
            progress: store.application.progress
        });
    }

    function updateBusy(options = {}) {
        if (options.title !== undefined) {
            store.application.busyTitle = String(options.title || "");
        }
        if (options.message !== undefined) {
            store.application.busyMessage = String(options.message || "");
        }
        if (options.progress !== undefined) {
            store.application.progress = clampProgress(options.progress);
        }
        store.application.busy = true;
        notify(EVENTS.APPLICATION_BUSY_CHANGED, {
            busy: true,
            title: store.application.busyTitle,
            message: store.application.busyMessage,
            progress: store.application.progress
        });
    }

    function clearBusy(status = STATUS.READY) {
        store.application.busy = false;
        store.application.status = status;
        store.application.busyTitle = "";
        store.application.busyMessage = "";
        store.application.progress = 0;
        notify(EVENTS.APPLICATION_BUSY_CHANGED, { busy: false, status });
    }

    function setError(error, context = "") {
        const normalized = normalizeError(error, context);
        store.application.error = normalized;
        store.application.status = STATUS.ERROR;
        store.application.busy = false;
        notify(EVENTS.APPLICATION_ERROR, normalized);
        return normalized;
    }

    function clearError() {
        store.application.error = null;
        if (store.application.status === STATUS.ERROR) {
            store.application.status = STATUS.READY;
        }
    }

    function resetWorkspace(options = {}) {
        destroyChart();

        const preservePreferences = options.preservePreferences !== false;
        const preserveMappingProfiles = options.preserveMappingProfiles !== false;
        const preserveRecentFiles = options.preserveRecentFiles !== false;
        const preserveNormalizationRules = options.preserveNormalizationRules !== false;

        const preferences = preservePreferences ? { ...store.preferences } : createInitialState().preferences;
        const mappingProfiles = preserveMappingProfiles ? [...store.mappingProfiles] : [];
        const normalizationRules = preserveNormalizationRules ? [...store.normalizationRules] : [];
        const recentFiles = preserveRecentFiles ? [...store.recentFiles] : [];

        store = createInitialState();
        store.preferences = preferences;
        store.mappingProfiles = mappingProfiles;
        store.normalizationRules = normalizationRules;
        store.recentFiles = recentFiles;
        store.application.status = STATUS.READY;

        notify(EVENTS.WORKSPACE_RESET, { resetAt: new Date().toISOString() });
    }

    function resetFromImport() {
        destroyChart();
        const next = createInitialState();
        next.preferences = { ...store.preferences };
        next.mappingProfiles = [...store.mappingProfiles];
        next.recentFiles = [...store.recentFiles];
        next.application.status = STATUS.READY;
        store = next;
        notify(EVENTS.WORKSPACE_RESET, { scope: "from-import" });
    }

    function resetAfterSheetSelection() {
        destroyChart();

        store.import.rawRows = [];
        store.import.headerRowIndex = null;
        store.import.headers = [];
        store.import.sourceHeaders = [];
        store.import.dataRows = [];
        store.import.previewRows = [];
        store.import.detectedTypes = {};
        store.import.emptyRowCount = 0;
        store.import.sourceRowNumbers = [];
        store.import.rowProvenance = [];
        store.mapping = createInitialState().mapping;
        store.validation = createInitialState().validation;
        store.dataset = createInitialState().dataset;
        store.filters = createInitialState().filters;
        store.analysis = cloneAnalysisDefaults();
        store.pivot = createInitialState().pivot;
        store.ui.fieldSearch = "";
    }

    function setSelectedFile(file) {
        if (!(file instanceof File)) {
            throw new TypeError("Selected file must be a File object.");
        }

        resetFromImport();
        store.import.file = file;
        store.import.fileMeta = {
            name: file.name,
            size: file.size,
            type: file.type,
            lastModified: file.lastModified
        };
        addRecentFile(store.import.fileMeta);
        notify(EVENTS.FILE_SELECTED, { ...store.import.fileMeta });
    }

    function setWorkbook(workbook, sheetNames = [], sheetProvenance = {}) {
        store.import.workbook = workbook;
        store.import.sheetNames = Array.isArray(sheetNames) ? [...sheetNames] : [];
        store.import.sheetProvenance = sheetProvenance && typeof sheetProvenance === "object" ? { ...sheetProvenance } : {};
        notify(EVENTS.WORKBOOK_LOADED, { sheetNames: [...store.import.sheetNames] });
    }

    function setSelectedSheet(sheetName) {
        resetAfterSheetSelection();
        store.import.selectedSheet = String(sheetName || "");
        notify(EVENTS.SHEET_SELECTED, { sheetName: store.import.selectedSheet });
    }

    function setSheetAnalysis(analysis = {}) {
        store.import.rawRows = Array.isArray(analysis.rawRows) ? analysis.rawRows : [];
        store.import.headerRowIndex = Number.isInteger(analysis.headerRowIndex)
            ? analysis.headerRowIndex
            : null;
        store.import.headers = Array.isArray(analysis.headers) ? [...analysis.headers] : [];
        store.import.sourceHeaders = Array.isArray(analysis.sourceHeaders)
            ? [...analysis.sourceHeaders]
            : [];
        store.import.dataRows = Array.isArray(analysis.dataRows) ? analysis.dataRows : [];
        store.import.previewRows = Array.isArray(analysis.previewRows) ? analysis.previewRows : [];
        store.import.detectedTypes = analysis.detectedTypes && typeof analysis.detectedTypes === "object"
            ? { ...analysis.detectedTypes }
            : {};
        store.import.emptyRowCount = Number(analysis.emptyRowCount) || 0;
        store.import.sourceRowNumbers = Array.isArray(analysis.sourceRowNumbers) ? [...analysis.sourceRowNumbers] : [];
        store.import.rowProvenance = Array.isArray(analysis.rowProvenance) ? analysis.rowProvenance.map((item) => ({ ...item })) : [];
        initializeMapping({});
        notify(EVENTS.SHEET_ANALYZED, {
            sheetName: store.import.selectedSheet,
            rowCount: store.import.dataRows.length,
            columnCount: store.import.headers.length,
            headerRowIndex: store.import.headerRowIndex
        });
    }

    function initializeMapping(initialValues = {}) {
        setMapping(initialValues, { silent: true });
        validateMapping();
    }

    function setMapping(values = {}, metadata = {}) {
        const nextValues = createDefaultMapping();
        SYSTEM_FIELDS.forEach((field) => {
            nextValues[field.id] = String(values[field.id] || "");
        });

        store.mapping.values = nextValues;
        store.mapping.confidence = metadata.confidence ? { ...metadata.confidence } : {};
        store.mapping.origins = metadata.origins ? { ...metadata.origins } : {};
        store.mapping.profileId = metadata.profileId || null;
        validateMapping({ silent: true });
        clearValidationResult({ silent: true });

        if (!metadata.silent) {
            notify(EVENTS.MAPPING_CHANGED, { values: { ...store.mapping.values } });
        }
    }

    function setMappingField(fieldId, sourceColumn, metadata = {}) {
        if (!Object.prototype.hasOwnProperty.call(store.mapping.values, fieldId)) {
            throw new Error(`Unknown mapping field: ${fieldId}`);
        }

        store.mapping.values[fieldId] = String(sourceColumn || "");

        if (metadata.confidence === null || metadata.confidence === undefined) {
            delete store.mapping.confidence[fieldId];
        } else {
            store.mapping.confidence[fieldId] = Number(metadata.confidence);
        }

        if (metadata.origin) {
            store.mapping.origins[fieldId] = metadata.origin;
        } else if (!sourceColumn) {
            delete store.mapping.origins[fieldId];
        }

        store.mapping.profileId = null;
        validateMapping({ silent: true });
        clearValidationResult({ silent: true });
        notify(EVENTS.MAPPING_CHANGED, { fieldId, sourceColumn: store.mapping.values[fieldId] });
    }

    function clearMappingField(fieldId) {
        setMappingField(fieldId, "", { origin: null, confidence: null });
    }

    function validateMapping(options = {}) {
        const headers = new Set(store.import.headers);
        const missingRequiredFields = REQUIRED_FIELDS.filter((fieldId) => !store.mapping.values[fieldId]);
        const unavailableSourceColumns = [];
        const usage = new Map();

        Object.entries(store.mapping.values).forEach(([fieldId, sourceColumn]) => {
            if (!sourceColumn) {
                return;
            }
            if (!headers.has(sourceColumn)) {
                unavailableSourceColumns.push(sourceColumn);
            }
            if (!usage.has(sourceColumn)) {
                usage.set(sourceColumn, []);
            }
            usage.get(sourceColumn).push(fieldId);
        });

        const duplicateSourceColumns = [...usage.entries()]
            .filter(([, fields]) => fields.length > 1)
            .map(([sourceColumn]) => sourceColumn);

        store.mapping.missingRequiredFields = [...new Set(missingRequiredFields)];
        store.mapping.unavailableSourceColumns = [...new Set(unavailableSourceColumns)];
        store.mapping.duplicateSourceColumns = [...new Set(duplicateSourceColumns)];
        store.mapping.isValid =
            store.mapping.missingRequiredFields.length === 0 &&
            store.mapping.unavailableSourceColumns.length === 0 &&
            store.mapping.duplicateSourceColumns.length === 0;

        const result = {
            isValid: store.mapping.isValid,
            missingRequiredFields: [...store.mapping.missingRequiredFields],
            unavailableSourceColumns: [...store.mapping.unavailableSourceColumns],
            duplicateSourceColumns: [...store.mapping.duplicateSourceColumns]
        };

        if (!options.silent) {
            notify(EVENTS.MAPPING_VALIDATED, result);
        }

        return result;
    }

    function setValidationResult(result = {}) {
        store.validation = {
            completed: Boolean(result.completed),
            totalRows: Number(result.totalRows) || 0,
            validRows: Number(result.validRows) || 0,
            invalidRows: Number(result.invalidRows) || 0,
            duplicateRows: Number(result.duplicateRows) || 0,
            warningRows: Number(result.warningRows) || 0,
            errorsByCode: { ...(result.errorsByCode || {}) },
            warningsByCode: { ...(result.warningsByCode || {}) },
            messages: Array.isArray(result.messages) ? result.messages : [],
            invalidRecords: Array.isArray(result.invalidRecords) ? result.invalidRecords : [],
            duplicateRecords: Array.isArray(result.duplicateRecords) ? result.duplicateRecords : [],
            completedAt: result.completedAt || null
        };
        notify(EVENTS.VALIDATION_COMPLETED, {
            totalRows: store.validation.totalRows,
            validRows: store.validation.validRows,
            invalidRows: store.validation.invalidRows,
            duplicateRows: store.validation.duplicateRows
        });
    }

    function clearValidationResult(options = {}) {
        store.validation = createInitialState().validation;
        if (!options.silent) {
            notify(EVENTS.VALIDATION_COMPLETED, { cleared: true });
        }
    }

    function clearProcessedData(options = {}) {
        destroyChart();
        store.dataset = createInitialState().dataset;
        store.filters = createInitialState().filters;
        store.analysis = cloneAnalysisDefaults();
        store.pivot = createInitialState().pivot;
        store.chart = createInitialState().chart;
        if (!options.silent) {
            notify(EVENTS.DATA_NORMALIZED, { ready: false, invalidated: true });
        }
    }

    function setNormalizedDataset(payload = {}) {
        store.dataset.normalizedRows = Array.isArray(payload.normalizedRows) ? payload.normalizedRows : [];
        store.dataset.filteredRows = [...store.dataset.normalizedRows];
        store.dataset.invalidRows = Array.isArray(payload.invalidRows) ? payload.invalidRows : [];
        store.dataset.duplicateRows = Array.isArray(payload.duplicateRows) ? payload.duplicateRows : [];
        store.dataset.fields = Array.isArray(payload.fields) ? payload.fields : [];
        store.dataset.statistics = {
            ...createInitialState().dataset.statistics,
            ...(payload.statistics || {}),
            normalizedRows: store.dataset.normalizedRows.length,
            filteredRows: store.dataset.filteredRows.length,
            invalidRows: store.dataset.invalidRows.length,
            duplicateRows: store.dataset.duplicateRows.length
        };
        notify(EVENTS.DATA_NORMALIZED, {
            normalizedRows: store.dataset.normalizedRows.length,
            invalidRows: store.dataset.invalidRows.length,
            duplicateRows: store.dataset.duplicateRows.length
        });
    }


    function setStockDataset(rows = [], fields = []) {
        store.dataset.stockRows = Array.isArray(rows) ? rows : [];
        store.dataset.stockFields = Array.isArray(fields) ? fields : [];
        notify(EVENTS.DATA_NORMALIZED, {
            normalizedRows: store.dataset.normalizedRows.length,
            stockRows: store.dataset.stockRows.length,
            stockUpdated: true
        });
    }

    function setCalculatedColumns(columns = []) {
        store.dataset.calculatedColumns = Array.isArray(columns) ? columns : [];
        notify(EVENTS.DATA_NORMALIZED, {
            normalizedRows: store.dataset.normalizedRows.length,
            calculatedColumnsUpdated: true
        });
    }

    function setTransformationSteps(steps = []) {
        store.dataset.transformationSteps = Array.isArray(steps) ? steps : [];
        notify(EVENTS.DATA_NORMALIZED, {
            normalizedRows: store.dataset.normalizedRows.length,
            transformationsUpdated: true
        });
    }

    function setFilteredDataset(rows) {
        store.dataset.filteredRows = Array.isArray(rows) ? rows : [];
        store.dataset.statistics.filteredRows = store.dataset.filteredRows.length;
        notify(EVENTS.FILTERS_CHANGED, {
            filteredRows: store.dataset.filteredRows.length,
            filters: { ...store.filters, values: { ...store.filters.values } }
        });
    }

    function setDateFilter(dateFrom = "", dateTo = "") {
        store.filters.dateFrom = String(dateFrom || "");
        store.filters.dateTo = String(dateTo || "");
        notify(EVENTS.FILTERS_CHANGED, { ...store.filters, values: { ...store.filters.values } });
    }

    function setFilter(fieldId, value) {
        if (value === "" || value === null || value === undefined) {
            delete store.filters.values[fieldId];
        } else {
            store.filters.values[fieldId] = value;
        }
        notify(EVENTS.FILTERS_CHANGED, { ...store.filters, values: { ...store.filters.values } });
    }

    function setFilters(filters = {}) {
        store.filters.dateFrom = String(filters.dateFrom || "");
        store.filters.dateTo = String(filters.dateTo || "");
        store.filters.values = filters.values && typeof filters.values === "object"
            ? { ...filters.values }
            : {};
        notify(EVENTS.FILTERS_CHANGED, { ...store.filters, values: { ...store.filters.values } });
    }

    function clearFilters() {
        store.filters = createInitialState().filters;
        notify(EVENTS.FILTERS_CHANGED, { ...store.filters, values: {} });
    }

    function normalizeAnalysis(next) {
        const current = store.analysis;
        const source = { ...current, ...(next || {}) };
        return {
            rows: uniqueStrings(source.rows),
            columns: uniqueStrings(source.columns),
            values: uniqueStrings(source.values),
            aggregation: AGGREGATION_IDS.includes(source.aggregation)
                ? source.aggregation
                : DEFAULT_ANALYSIS.aggregation,
            chartType: CHART_TYPE_IDS.includes(source.chartType)
                ? source.chartType
                : DEFAULT_ANALYSIS.chartType,
            resultView: Object.values(RESULT_VIEWS).includes(source.resultView)
                ? source.resultView
                : DEFAULT_ANALYSIS.resultView,
            activeTemplate: source.activeTemplate || null,
            sort: {
                field: source.sort?.field || null,
                direction: source.sort?.direction === "desc" ? "desc" : "asc"
            }
        };
    }

    function setAnalysis(nextAnalysis) {
        store.analysis = normalizeAnalysis(nextAnalysis);
        clearPivotResult({ silent: true });
        notify(EVENTS.ANALYSIS_CHANGED, { ...store.analysis });
    }

    function setAnalysisZone(zoneName, fieldIds) {
        if (!["rows", "columns", "values"].includes(zoneName)) {
            throw new Error(`Unknown analysis zone: ${zoneName}`);
        }
        setAnalysis({ ...store.analysis, [zoneName]: uniqueStrings(fieldIds), activeTemplate: null });
    }

    function addAnalysisField(zoneName, fieldId) {
        const values = [...(store.analysis[zoneName] || [])];
        if (!values.includes(fieldId)) {
            values.push(fieldId);
        }
        setAnalysisZone(zoneName, values);
    }

    function removeAnalysisField(zoneName, fieldId) {
        setAnalysisZone(zoneName, (store.analysis[zoneName] || []).filter((item) => item !== fieldId));
    }

    function moveAnalysisField(fieldId, fromZone, toZone, targetIndex = null) {
        const next = {
            ...store.analysis,
            rows: [...store.analysis.rows],
            columns: [...store.analysis.columns],
            values: [...store.analysis.values],
            activeTemplate: null
        };

        ["rows", "columns", "values"].forEach((zone) => {
            next[zone] = next[zone].filter((item) => item !== fieldId);
        });

        if (["rows", "columns", "values"].includes(toZone)) {
            const index = Number.isInteger(targetIndex)
                ? Math.max(0, Math.min(targetIndex, next[toZone].length))
                : next[toZone].length;
            next[toZone].splice(index, 0, fieldId);
        }

        setAnalysis(next);
    }

    function setAggregation(aggregation) {
        setAnalysis({ ...store.analysis, aggregation, activeTemplate: null });
    }

    function setChartType(chartType) {
        store.analysis.chartType = CHART_TYPE_IDS.includes(chartType)
            ? chartType
            : DEFAULT_ANALYSIS.chartType;
        notify(EVENTS.ANALYSIS_CHANGED, { chartType: store.analysis.chartType });
    }

    function setResultView(resultView) {
        store.analysis.resultView = Object.values(RESULT_VIEWS).includes(resultView)
            ? resultView
            : DEFAULT_ANALYSIS.resultView;
        notify(EVENTS.ANALYSIS_CHANGED, { resultView: store.analysis.resultView });
    }

    function resetAnalysis() {
        store.analysis = cloneAnalysisDefaults();
        clearPivotResult({ silent: true });
        notify(EVENTS.ANALYSIS_CHANGED, { ...store.analysis, reset: true });
    }

    function setPivotResult(result = {}) {
        store.pivot = {
            ready: Boolean(result.ready),
            result: result.result || null,
            rowFields: Array.isArray(result.rowFields) ? result.rowFields : [],
            columnFields: Array.isArray(result.columnFields) ? result.columnFields : [],
            valueFields: Array.isArray(result.valueFields) ? result.valueFields : [],
            columnKeys: Array.isArray(result.columnKeys) ? result.columnKeys : [],
            rows: Array.isArray(result.rows) ? result.rows : [],
            totals: result.totals || null,
            statistics: {
                ...createInitialState().pivot.statistics,
                ...(result.statistics || {})
            },
            generatedAt: result.generatedAt || new Date().toISOString()
        };
        notify(EVENTS.PIVOT_BUILT, {
            ready: store.pivot.ready,
            groupCount: store.pivot.statistics.groupCount
        });
    }

    function clearPivotResult(options = {}) {
        store.pivot = createInitialState().pivot;
        if (!options.silent) {
            notify(EVENTS.PIVOT_BUILT, { ready: false, cleared: true });
        }
    }

    function setChartInstance(instance) {
        store.chart.instance = instance || null;
        notify(EVENTS.CHART_RENDERED, { ready: Boolean(instance) });
    }

    function destroyChart() {
        const instance = store.chart?.instance;
        if (instance && typeof instance.destroy === "function") {
            try {
                instance.destroy();
            } catch (error) {
                console.warn("Could not destroy chart:", error);
            }
        }
        if (store.chart) {
            store.chart.instance = null;
        }
    }

    function setActiveSection(sectionId) {
        store.ui.activeSection = String(sectionId || "importSection");
    }

    function setExportMenuOpen(open) {
        store.ui.exportMenuOpen = Boolean(open);
    }

    function setFieldSearch(value) {
        store.ui.fieldSearch = String(value || "");
    }

    function setNormalizationField(fieldId) {
        const allowed = new Set(PMA.constants.NORMALIZABLE_FIELDS || []);
        store.ui.normalizationField = allowed.has(fieldId) ? fieldId : "material";
        return store.ui.normalizationField;
    }

    function getNormalizationRules(fieldId = null) {
        const rules = Array.isArray(store.normalizationRules) ? store.normalizationRules : [];
        return rules
            .filter((rule) => !fieldId || rule.fieldId === fieldId)
            .map((rule) => ({ ...rule }));
    }

    function replaceNormalizationRules(fieldId, rules = []) {
        const allowed = new Set(PMA.constants.NORMALIZABLE_FIELDS || []);
        if (!allowed.has(fieldId)) {
            throw new Error(`Unknown normalization field: ${fieldId}`);
        }

        const retained = store.normalizationRules.filter((rule) => rule.fieldId !== fieldId);
        const normalized = normalizeNormalizationRules((Array.isArray(rules) ? rules : []).map((rule) => ({
            ...rule,
            fieldId
        })));
        const limit = Math.max(1, Number(PROCESSING_LIMITS.maximumStoredNormalizationRules) || 5000);
        store.normalizationRules = [...normalized, ...retained]
            .sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")))
            .slice(0, limit);
        writeStorage(STORAGE_KEYS.normalizationRules, store.normalizationRules);
        notify(EVENTS.NORMALIZATION_RULES_CHANGED, {
            fieldId,
            count: normalized.length,
            totalCount: store.normalizationRules.length
        });
        return getNormalizationRules(fieldId);
    }

    function clearNormalizationRules(fieldId = null) {
        if (fieldId) {
            store.normalizationRules = store.normalizationRules.filter((rule) => rule.fieldId !== fieldId);
        } else {
            store.normalizationRules = [];
        }
        writeStorage(STORAGE_KEYS.normalizationRules, store.normalizationRules);
        notify(EVENTS.NORMALIZATION_RULES_CHANGED, {
            fieldId: fieldId || null,
            count: 0,
            totalCount: store.normalizationRules.length
        });
    }

    function getPreference(name, fallback = undefined) {
        return Object.prototype.hasOwnProperty.call(store.preferences, name)
            ? store.preferences[name]
            : fallback;
    }

    function setPreference(name, value) {
        store.preferences[name] = value;
        writeStorage(STORAGE_KEYS.preferences, store.preferences);
    }

    function saveMappingProfile(profile = {}) {
        const headers = Array.isArray(profile.headers) ? [...profile.headers] : [...store.import.headers];
        const mapping = profile.mapping && typeof profile.mapping === "object"
            ? { ...profile.mapping }
            : { ...store.mapping.values };
        const signature = createHeaderSignature(headers);
        const existingIndex = store.mappingProfiles.findIndex((item) => item.signature === signature);
        const id = existingIndex >= 0
            ? store.mappingProfiles[existingIndex].id
            : createId("mapping-profile");

        const record = {
            id,
            name: String(profile.name || `Mapowanie ${store.import.selectedSheet || ""}`).trim(),
            signature,
            headers,
            mapping,
            updatedAt: new Date().toISOString()
        };

        if (existingIndex >= 0) {
            store.mappingProfiles.splice(existingIndex, 1, record);
        } else {
            store.mappingProfiles.unshift(record);
        }

        store.mappingProfiles = store.mappingProfiles
            .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
            .slice(0, PROCESSING_LIMITS.maximumStoredMappingProfiles || 20);

        writeStorage(STORAGE_KEYS.mappingProfiles, store.mappingProfiles);
        return record;
    }

    function findMappingProfile(headers = store.import.headers) {
        const signature = createHeaderSignature(headers);
        return store.mappingProfiles.find((profile) => profile.signature === signature) || null;
    }

    function addRecentFile(fileMeta) {
        const name = String(fileMeta?.name || "");
        if (!name) {
            return;
        }

        store.recentFiles = [
            {
                name,
                size: Number(fileMeta.size) || 0,
                lastModified: Number(fileMeta.lastModified) || 0,
                openedAt: new Date().toISOString()
            },
            ...store.recentFiles.filter((item) => item.name !== name)
        ].slice(0, 20);

        writeStorage(STORAGE_KEYS.recentFiles, store.recentFiles);
    }

    function getSerializableState() {
        return {
            app: APP,
            import: {
                fileMeta: { ...store.import.fileMeta },
                selectedSheet: store.import.selectedSheet,
                headerRowIndex: store.import.headerRowIndex,
                headers: [...store.import.headers]
            },
            mapping: {
                values: { ...store.mapping.values }
            },
            filters: {
                dateFrom: store.filters.dateFrom,
                dateTo: store.filters.dateTo,
                values: { ...store.filters.values }
            },
            analysis: {
                ...store.analysis,
                rows: [...store.analysis.rows],
                columns: [...store.analysis.columns],
                values: [...store.analysis.values],
                sort: { ...store.analysis.sort }
            },
            preferences: { ...store.preferences }
        };
    }

    // state.js loads before utils.js (see index.html), so PMA.utils is referenced lazily
    // here rather than destructured at module-init time. By the time saveMappingProfile/
    // findMappingProfile actually run, the whole app is already booted.
    // This was previously a separate, weaker local copy (no diacritic folding, no
    // duplicate-suffix stripping) that could silently diverge from utils.js's version.
    function createHeaderSignature(headers) {
        return PMA.utils.createHeaderSignature(headers);
    }

    function normalizeMappingProfiles(value) {
        if (!Array.isArray(value)) {
            return [];
        }
        return value
            .filter((profile) => profile && profile.id && profile.mapping && (profile.signature || Array.isArray(profile.headers)))
            .map((profile) => {
                const headers = Array.isArray(profile.headers) ? profile.headers : [];
                // Migration: recompute the signature from the stored headers using the
                // current algorithm, rather than trusting a signature string that may
                // have been persisted under a previous (weaker) algorithm version. This
                // keeps profiles saved before that change from silently going stale.
                const signature = headers.length ? createHeaderSignature(headers) : profile.signature;
                return { ...profile, headers, signature };
            })
            .filter((profile) => Boolean(profile.signature));
    }

    function normalizeNormalizationRules(value) {
        if (!Array.isArray(value)) {
            return [];
        }
        const allowed = new Set(PMA.constants.NORMALIZABLE_FIELDS || []);
        const seen = new Set();
        return value.reduce((result, rule) => {
            if (!rule || !allowed.has(rule.fieldId)) return result;
            const sourceKey = String(rule.sourceKey || "").trim();
            const target = String(rule.target || "").replace(/\s+/g, " ").trim();
            if (!sourceKey || !target) return result;
            const uniqueKey = `${rule.fieldId}|${sourceKey}`;
            if (seen.has(uniqueKey)) return result;
            seen.add(uniqueKey);
            result.push({
                id: String(rule.id || createId("normalization-rule")),
                fieldId: rule.fieldId,
                sourceKey,
                sourceExample: String(rule.sourceExample || "").replace(/\s+/g, " ").trim(),
                target,
                updatedAt: String(rule.updatedAt || new Date().toISOString())
            });
            return result;
        }, []);
    }

    function initializeStoragePolicy() {
        const targetVersion = Math.max(1, Number(APP.storageSchemaVersion) || 1);
        const savedVersion = Number(readStorage(STORAGE_KEYS.schemaVersion, 0)) || 0;

        // A newer application may have already written a schema this build does not understand.
        // In that case, do not remove or rewrite its storage.
        if (savedVersion > targetVersion) {
            return;
        }

        migratePersistentStorageValue(
            STORAGE_KEYS.preferences,
            LEGACY_PERSISTENT_STORAGE_KEYS.preferences
        );
        migratePersistentStorageValue(
            STORAGE_KEYS.mappingProfiles,
            LEGACY_PERSISTENT_STORAGE_KEYS.mappingProfiles
        );
        migratePersistentStorageValue(
            STORAGE_KEYS.recentFiles,
            LEGACY_PERSISTENT_STORAGE_KEYS.recentFiles
        );
        migratePersistentStorageValue(
            STORAGE_KEYS.normalizationRules,
            LEGACY_PERSISTENT_STORAGE_KEYS.normalizationRules
        );

        const persistentKeys = new Set([
            STORAGE_KEYS.schemaVersion,
            STORAGE_KEYS.preferences,
            STORAGE_KEYS.mappingProfiles,
            STORAGE_KEYS.recentFiles,
            STORAGE_KEYS.normalizationRules
        ]);

        // Only preferences, mapping metadata and user-defined value aliases are persistent.
        // Imported workbooks, raw rows, normalized rows, filters and analysis results remain in memory.
        cleanupPmaStorage(global.localStorage, persistentKeys);
        cleanupPmaStorage(global.sessionStorage, new Set());
        writeStorage(STORAGE_KEYS.schemaVersion, targetVersion);
    }

    function migratePersistentStorageValue(currentKey, legacyKeys) {
        if (hasStorageValue(global.localStorage, currentKey)) {
            return;
        }

        for (const legacyKey of legacyKeys) {
            const legacyValue = readStorage(legacyKey, undefined);
            if (legacyValue !== undefined) {
                writeStorage(currentKey, legacyValue);
                return;
            }
        }
    }

    function cleanupPmaStorage(storage, allowedKeys) {
        if (!storage) {
            return;
        }

        try {
            const keys = [];
            for (let index = 0; index < storage.length; index += 1) {
                const key = storage.key(index);
                if (key) {
                    keys.push(key);
                }
            }

            keys.forEach((key) => {
                const belongsToApplication = PMA_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix));
                if (belongsToApplication && !allowedKeys.has(key)) {
                    storage.removeItem(key);
                }
            });
        } catch (error) {
            console.warn("Could not clean obsolete PMA storage:", error);
        }
    }

    function hasStorageValue(storage, key) {
        try {
            return storage?.getItem(key) !== null;
        } catch {
            return false;
        }
    }

    function readStorage(key, fallback) {
        try {
            const value = global.localStorage?.getItem(key);
            return value !== null && value !== undefined ? JSON.parse(value) : fallback;
        } catch {
            return fallback;
        }
    }

    function writeStorage(key, value) {
        try {
            global.localStorage?.setItem(key, JSON.stringify(value));
        } catch (error) {
            console.warn(`Could not persist ${key}:`, error);
        }
    }

    function clampProgress(value) {
        return Math.max(0, Math.min(100, Number(value) || 0));
    }

    function uniqueStrings(value) {
        return [...new Set((Array.isArray(value) ? value : []).map((item) => String(item || "")).filter(Boolean))];
    }

    function createId(prefix = "id") {
        if (global.crypto?.randomUUID) {
            return `${prefix}-${global.crypto.randomUUID()}`;
        }
        return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }

    function normalizeError(error, context = "") {
        const source = error instanceof Error ? error : new Error(String(error || "Nieznany błąd."));
        return {
            name: source.name || "Error",
            message: context ? `${context}: ${source.message}` : source.message,
            code: source.code || null,
            stack: source.stack || null,
            context: context || null,
            occurredAt: new Date().toISOString()
        };
    }

    const api = Object.freeze({
        initialize,
        getState,
        get,
        subscribe,
        transaction,
        setApplicationStatus,
        setBusy,
        updateBusy,
        clearBusy,
        setError,
        clearError,
        resetWorkspace,
        resetFromImport,
        resetAfterSheetSelection,
        setSelectedFile,
        setWorkbook,
        setSelectedSheet,
        setSheetAnalysis,
        initializeMapping,
        setMapping,
        setMappingField,
        clearMappingField,
        validateMapping,
        setValidationResult,
        clearValidationResult,
        clearProcessedData,
        setNormalizedDataset,
        setStockDataset,
        setCalculatedColumns,
        setTransformationSteps,
        setFilteredDataset,
        setDateFilter,
        setFilter,
        setFilters,
        clearFilters,
        setAnalysis,
        setAnalysisZone,
        addAnalysisField,
        removeAnalysisField,
        moveAnalysisField,
        setAggregation,
        setChartType,
        setResultView,
        resetAnalysis,
        setPivotResult,
        clearPivotResult,
        setChartInstance,
        destroyChart,
        setActiveSection,
        setExportMenuOpen,
        setFieldSearch,
        setNormalizationField,
        getNormalizationRules,
        replaceNormalizationRules,
        clearNormalizationRules,
        getPreference,
        setPreference,
        saveMappingProfile,
        findMappingProfile,
        getSerializableState
    });

    Object.defineProperty(PMA, "state", {
        value: api,
        writable: false,
        enumerable: true,
        configurable: false
    });
})(window);
