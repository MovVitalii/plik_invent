/* ==========================================================
   Pack Materials Analytics
   src/pivot-engine.js
========================================================== */

(function initializePivotEngine(global) {
    "use strict";

    const PMA = global.PMA || (global.PMA = {});
    if (!PMA.constants || !PMA.state || !PMA.utils || !PMA.dom) {
        throw new Error("PMA core modules must be loaded before src/pivot-engine.js.");
    }

    const {
        STATUS,
        DATA_TYPES,
        SYSTEM_FIELD_MAP,
        DERIVED_FIELDS,
        FILTER_FIELDS,
        ANALYSIS_TEMPLATES,
        DEFAULT_ANALYSIS,
        AGGREGATION_IDS,
        CHART_TYPE_IDS,
        RESULT_VIEWS,
        MONTHS,
        WEEKDAYS,
        SEASONS,
        PROCESSING_LIMITS,
        UI_TEXT
    } = PMA.constants;
    const {
        isBlank,
        cleanText,
        normalizeComparableText,
        parseNumber,
        toISODate,
        formatNumber,
        formatInteger,
        formatDate,
        naturalCompare,
        clonePlain,
        debounce,
        yieldToBrowser,
        normalizeError
    } = PMA.utils;
    const state = PMA.state;
    const dom = PMA.dom;
    const elements = dom.elements;

    const EMPTY_FILTER_VALUE = "__PMA_EMPTY_VALUE__";
    const DRAG_TYPE = "application/x-pma-analysis-field";
    const handlers = [];
    const fieldCache = new Map();
    let initialized = false;
    let buildToken = 0;
    let filterToken = 0;
    let draggedField = null;
    let lastResult = null;

    const debouncedFilterRefresh = debounce(() => refreshFilteredAnalysis().catch(handleError), 120);
    const debouncedSearch = debounce(() => {
        state.setFieldSearch(elements.fieldSearchInput.value);
        renderAvailableFields();
    }, 80);

    function initialize() {
        if (initialized) return api;
        bind(elements.clearFiltersButton, "click", handleClearFilters);
        bind(elements.dateFromFilter, "change", handleDateFilterChange);
        bind(elements.dateToFilter, "change", handleDateFilterChange);
        bind(elements.dynamicFiltersContainer, "change", handleDynamicFilterChange);
        bind(elements.fieldSearchInput, "input", debouncedSearch);
        bind(elements.availableFieldsContainer, "click", handleAvailableFieldClick);
        bind(elements.availableFieldsContainer, "dragstart", handleDragStart);
        bind(elements.availableFieldsContainer, "dragend", handleDragEnd);
        bindZone(elements.rowsDropZone, "rows");
        bindZone(elements.columnsDropZone, "columns");
        bindZone(elements.valuesDropZone, "values");
        bind(elements.aggregationSelector, "change", handleAggregationChange);
        bind(elements.clearAnalysisButton, "click", handleClearAnalysis);
        elements.analysisTemplateButtons.forEach((button) => bind(button, "click", handleTemplateClick));
        elements.resultViewButtons.forEach((button) => bind(button, "click", handleResultViewClick));
        elements.chartTypeButtons.forEach((button) => bind(button, "click", handleChartTypeClick));
        initialized = true;
        return api;
    }

    function destroy() {
        buildToken += 1;
        filterToken += 1;
        debouncedFilterRefresh.cancel();
        debouncedSearch.cancel();
        handlers.forEach(({ element, eventName, handler }) => element.removeEventListener(eventName, handler));
        handlers.length = 0;
        fieldCache.clear();
        draggedField = null;
        lastResult = null;
        initialized = false;
    }

    function bind(element, eventName, handler) {
        element.addEventListener(eventName, handler);
        handlers.push({ element, eventName, handler });
    }

    function bindZone(element, zoneName) {
        element.dataset.analysisZone = zoneName;
        bind(element, "dragover", handleZoneDragOver);
        bind(element, "dragenter", handleZoneDragEnter);
        bind(element, "dragleave", handleZoneDragLeave);
        bind(element, "drop", handleZoneDrop);
        bind(element, "click", handleZoneClick);
        bind(element, "dragstart", handleDragStart);
        bind(element, "dragend", handleDragEnd);
    }

    async function prepareAnalysis(options = {}) {
        const rows = state.get("dataset.normalizedRows", []);
        if (!rows.length) throw new Error("Brak znormalizowanych danych do analizy.");
        rebuildFieldCache();
        dom.unlockSection("analysis");
        configureDateFilters();
        renderDynamicFilters();
        renderAvailableFields();
        updateTemplateAvailability();
        syncControls();
        renderAnalysisZones();
        dom.setWorkflowStage(3);
        dom.setStatusBadge(elements.analysisStatusBadge, "Analiza gotowa", STATUS.SUCCESS);
        dom.setWorkflowProgress("analysis", `${formatInteger(rows.length)} wierszy`);
        await applyFilters({ rebuild: false, showBusy: false });
        return options.buildDefault === false ? null : buildPivot({ showBusy: rows.length > 30000 });
    }

    function updateTemplateAvailability() {
        // "Available" means the field was actually mapped/derived for this dataset —
        // not merely defined in SYSTEM_FIELD_MAP (rebuildFieldCache() pads the cache
        // with unmapped system fields too, so fieldCache alone can't answer this).
        const availableFieldIds = new Set(state.get("dataset.fields", []).map((field) => field.id));
        const availability = {};
        Object.values(ANALYSIS_TEMPLATES).forEach((template) => {
            const requiredFieldIds = [...template.rows, ...template.columns, ...template.values];
            availability[template.id] = requiredFieldIds.every((fieldId) => availableFieldIds.has(fieldId));
        });
        dom.setAnalysisTemplateAvailability(availability);
        return availability;
    }

    function rebuildFieldCache() {
        fieldCache.clear();
        state.get("dataset.fields", []).forEach((field) => fieldCache.set(field.id, field));
        Object.values(SYSTEM_FIELD_MAP).forEach((field) => {
            if (!fieldCache.has(field.id)) {
                fieldCache.set(field.id, {
                    ...field,
                    source: "mapped",
                    groupable: field.type !== DATA_TYPES.NUMBER,
                    aggregatable: field.type === DATA_TYPES.NUMBER,
                    filterable: true,
                    hidden: false
                });
            }
        });
        DERIVED_FIELDS.forEach((field) => {
            if (!fieldCache.has(field.id)) {
                fieldCache.set(field.id, {
                    ...field,
                    source: "derived",
                    groupable: field.groupable !== false,
                    aggregatable: false,
                    filterable: field.filterable !== false,
                    hidden: field.hidden === true
                });
            }
        });
    }

    function getFieldDefinition(fieldId) {
        if (!fieldCache.size) rebuildFieldCache();
        return fieldCache.get(fieldId) || null;
    }

    function getFieldLabel(fieldId) {
        return getFieldDefinition(fieldId)?.label || fieldId;
    }

    function configureDateFilters() {
        const statistics = state.get("dataset.statistics", {});
        const minimum = statistics.minimumDate || "";
        const maximum = statistics.maximumDate || "";
        elements.dateFromFilter.min = minimum;
        elements.dateFromFilter.max = maximum;
        elements.dateToFilter.min = minimum;
        elements.dateToFilter.max = maximum;
        elements.dateFromFilter.value = state.get("filters.dateFrom", "");
        elements.dateToFilter.value = state.get("filters.dateTo", "");
    }

    function syncControls() {
        const analysis = state.get("analysis");
        elements.aggregationSelector.value = analysis.aggregation;
        elements.fieldSearchInput.value = state.get("ui.fieldSearch", "");
        dom.setResultView(analysis.resultView);
        dom.setChartTypeButton(analysis.chartType);
        dom.setActiveAnalysisTemplate(analysis.activeTemplate);
    }

    function renderDynamicFilters() {
        dom.clear(elements.dynamicFiltersContainer);
        const rows = state.get("dataset.normalizedRows", []);
        const selected = state.get("filters.values", {});
        const available = new Set(state.get("dataset.fields", [])
            .filter((field) => !field.hidden && field.filterable !== false)
            .map((field) => field.id));
        const fragment = document.createDocumentFragment();

        FILTER_FIELDS.filter((fieldId) => available.has(fieldId)).forEach((fieldId) => {
            const values = collectFilterValues(rows, fieldId);
            if (!values.length) return;
            const wrapper = dom.createElement("label", { className: "filter-control" });
            wrapper.appendChild(dom.createElement("span", { text: getFieldLabel(fieldId) }));
            const select = dom.createElement("select", {
                dataset: { filterField: fieldId },
                attributes: { "aria-label": `Filtr: ${getFieldLabel(fieldId)}` }
            });
            select.appendChild(createOption("", UI_TEXT.allValues, selected[fieldId]));
            values.forEach((value) => {
                const serialized = value === EMPTY_FILTER_VALUE ? EMPTY_FILTER_VALUE : serializeFilterValue(value);
                const label = value === EMPTY_FILTER_VALUE ? UI_TEXT.emptyValue : formatFilterValue(fieldId, value);
                select.appendChild(createOption(serialized, label, selected[fieldId]));
            });
            wrapper.appendChild(select);
            fragment.appendChild(wrapper);
        });
        elements.dynamicFiltersContainer.appendChild(fragment);
    }

    function collectFilterValues(rows, fieldId) {
        const entries = [];
        const seen = new Set();
        let hasEmpty = false;
        for (const row of rows) {
            const value = row[fieldId];
            if (isBlank(value)) {
                hasEmpty = true;
                continue;
            }
            const key = serializeFilterValue(value);
            if (!seen.has(key)) {
                seen.add(key);
                entries.push({ value, sortValue: getFieldSortValue(fieldId, row) });
            }
            if (entries.length >= PROCESSING_LIMITS.maximumFilterOptions) break;
        }
        entries.sort((left, right) => compareFieldValues(
            fieldId,
            left.value,
            right.value,
            left.sortValue,
            right.sortValue
        ));
        const values = entries.map((entry) => entry.value);
        if (hasEmpty) values.push(EMPTY_FILTER_VALUE);
        return values;
    }

    function createOption(value, label, selectedValue) {
        const option = document.createElement("option");
        option.value = String(value ?? "");
        option.textContent = String(label ?? "");
        option.selected = String(selectedValue ?? "") === option.value;
        return option;
    }

    function serializeFilterValue(value) {
        if (value === null) return "null:";
        if (value === undefined) return "undefined:";
        if (typeof value === "number") return `number:${value}`;
        if (typeof value === "boolean") return `boolean:${value ? "1" : "0"}`;
        return `string:${String(value)}`;
    }

    function deserializeFilterValue(value) {
        const source = String(value ?? "");
        const index = source.indexOf(":");
        if (index < 0) return source;
        const type = source.slice(0, index);
        const payload = source.slice(index + 1);
        if (type === "number") return Number(payload);
        if (type === "boolean") return payload === "1";
        if (type === "null") return null;
        if (type === "undefined") return undefined;
        return payload;
    }

    function formatFilterValue(fieldId, value) {
        const field = getFieldDefinition(fieldId);
        if (field?.type === DATA_TYPES.DATE) return formatDate(value, { fallback: String(value) });
        if (field?.type === DATA_TYPES.BOOLEAN) return value === true ? "Tak" : value === false ? "Nie" : String(value);
        return String(value);
    }

    function handleDateFilterChange() {
        const dateFrom = elements.dateFromFilter.value;
        const dateTo = elements.dateToFilter.value;
        if (dateFrom && dateTo && dateFrom > dateTo) {
            elements.dateToFilter.setCustomValidity("Data końcowa nie może być wcześniejsza niż data początkowa.");
            elements.dateToFilter.reportValidity();
            return;
        }
        elements.dateToFilter.setCustomValidity("");
        state.setDateFilter(dateFrom, dateTo);
        debouncedFilterRefresh();
    }

    function handleDynamicFilterChange(event) {
        const select = event.target.closest("select[data-filter-field]");
        if (!select) return;
        state.setFilter(select.dataset.filterField, select.value);
        debouncedFilterRefresh();
    }

    async function handleClearFilters() {
        try {
            debouncedFilterRefresh.cancel();
            state.clearFilters();
            elements.dateFromFilter.value = "";
            elements.dateToFilter.value = "";
            elements.dynamicFiltersContainer.querySelectorAll("select").forEach((select) => select.value = "");
            await applyFilters({ rebuild: false, showBusy: false });
            await buildPivot({ showBusy: false });
            dom.showInfo("Wszystkie filtry zostały usunięte.", "Filtry");
        } catch (error) {
            handleError(error);
        }
    }

    async function refreshFilteredAnalysis() {
        await applyFilters({ rebuild: false, showBusy: false });
        return buildPivot({ showBusy: false });
    }

    async function applyFilters(options = {}) {
        const token = ++filterToken;
        const sourceRows = state.get("dataset.normalizedRows", []);
        const filters = state.get("filters");
        const activeFilters = Object.entries(filters.values || {}).filter(([, value]) => value !== "" && value !== null && value !== undefined);
        if (!filters.dateFrom && !filters.dateTo && !activeFilters.length) {
            state.setFilteredDataset(sourceRows);
            if (options.rebuild !== false) await buildPivot({ showBusy: options.showBusy });
            return sourceRows;
        }

        const filtered = [];
        const batchSize = Math.max(1000, PROCESSING_LIMITS.batchSize);
        const showBusy = options.showBusy === true || sourceRows.length > 50000;
        if (showBusy) state.setBusy({ title: "Filtrowanie danych", message: "Stosowanie filtrów...", progress: 0 });

        for (let start = 0; start < sourceRows.length; start += batchSize) {
            ensureFilterToken(token);
            const end = Math.min(start + batchSize, sourceRows.length);
            for (let index = start; index < end; index += 1) {
                if (rowMatchesFilters(sourceRows[index], filters.dateFrom, filters.dateTo, activeFilters)) filtered.push(sourceRows[index]);
            }
            if (showBusy) state.updateBusy({
                message: `Sprawdzono ${formatInteger(end)} z ${formatInteger(sourceRows.length)} wierszy.`,
                progress: Math.round(end / Math.max(1, sourceRows.length) * 100)
            });
            if (end < sourceRows.length) await yieldToBrowser();
        }

        ensureFilterToken(token);
        state.setFilteredDataset(filtered);
        if (showBusy) state.clearBusy(STATUS.READY);
        if (options.rebuild !== false) await buildPivot({ showBusy: options.showBusy });
        return filtered;
    }

    function rowMatchesFilters(row, dateFrom, dateTo, activeFilters) {
        const date = toISODate(row.date) || cleanText(row.date);
        if (dateFrom && (!date || date < dateFrom)) return false;
        if (dateTo && (!date || date > dateTo)) return false;
        for (const [fieldId, serialized] of activeFilters) {
            const rowValue = row[fieldId];
            if (serialized === EMPTY_FILTER_VALUE) {
                if (!isBlank(rowValue)) return false;
                continue;
            }
            if (!valuesEqual(rowValue, deserializeFilterValue(serialized))) return false;
        }
        return true;
    }

    function valuesEqual(left, right) {
        if (left === right) return true;
        if (typeof left === "number" || typeof right === "number") {
            const a = parseNumber(left);
            const b = parseNumber(right);
            return a !== null && b !== null && a === b;
        }
        return normalizeComparableText(left) === normalizeComparableText(right);
    }

    function renderAvailableFields() {
        dom.clear(elements.availableFieldsContainer);
        const search = normalizeComparableText(state.get("ui.fieldSearch", ""));
        const analysis = state.get("analysis");
        const used = new Set([...analysis.rows, ...analysis.columns, ...analysis.values]);
        const fields = state.get("dataset.fields", [])
            .filter((field) => !field.hidden && (field.groupable !== false || field.aggregatable === true))
            .filter((field) => !search || normalizeComparableText(`${field.label} ${field.id} ${field.description || ""}`).includes(search))
            .sort((a, b) => naturalCompare(a.label, b.label));

        if (!fields.length) {
            elements.availableFieldsContainer.appendChild(dom.createElement("span", {
                className: "zone-placeholder",
                text: search ? "Brak pól pasujących do wyszukiwania." : "Brak dostępnych pól."
            }));
            return;
        }
        const fragment = document.createDocumentFragment();
        fields.forEach((field) => fragment.appendChild(createFieldChip(field, "available", used.has(field.id))));
        elements.availableFieldsContainer.appendChild(fragment);
    }

    function createFieldChip(field, sourceZone, used = false) {
        const chip = dom.createElement("button", {
            className: "field-chip",
            text: field.label || field.id,
            attributes: { type: "button", draggable: "true", title: field.description || field.label },
            dataset: { fieldId: field.id, fieldType: field.type || DATA_TYPES.TEXT, sourceZone }
        });
        chip.classList.add(field.type === DATA_TYPES.NUMBER ? "is-numeric" : field.type === DATA_TYPES.DATE ? "is-date" : "is-text");
        if (used) chip.classList.add("is-used");
        return chip;
    }

    function handleAvailableFieldClick(event) {
        const chip = event.target.closest(".field-chip[data-field-id]");
        if (!chip) return;
        const field = getFieldDefinition(chip.dataset.fieldId);
        const zone = field?.aggregatable || field?.type === DATA_TYPES.NUMBER ? "values" : "rows";
        addFieldToZone(chip.dataset.fieldId, zone).catch(handleError);
    }

    function renderAnalysisZones() {
        const analysis = state.get("analysis");
        renderZone(elements.rowsDropZone, "rows", analysis.rows, "Dodaj pola grupujące");
        renderZone(elements.columnsDropZone, "columns", analysis.columns, "Opcjonalny drugi poziom grupowania");
        renderZone(elements.valuesDropZone, "values", analysis.values, "Dodaj pole liczbowe");
        renderAvailableFields();
    }

    function renderZone(element, zoneName, fieldIds, placeholder) {
        dom.clear(element);
        if (!fieldIds.length) {
            element.appendChild(dom.createElement("span", { className: "zone-placeholder", text: placeholder }));
            return;
        }
        fieldIds.forEach((fieldId) => {
            const field = getFieldDefinition(fieldId) || { id: fieldId, label: fieldId, type: DATA_TYPES.TEXT };
            const item = dom.createElement("span", {
                className: "selected-field",
                attributes: { draggable: "true" },
                dataset: { fieldId, fieldType: field.type, sourceZone: zoneName }
            });
            item.append(
                dom.createElement("span", { text: field.label }),
                dom.createElement("button", {
                    text: "×",
                    attributes: { type: "button", "aria-label": `Usuń pole ${field.label}` },
                    dataset: { removeField: fieldId, zone: zoneName }
                })
            );
            element.appendChild(item);
        });
    }

    function handleZoneClick(event) {
        const button = event.target.closest("button[data-remove-field]");
        if (button) removeFieldFromZone(button.dataset.removeField, button.dataset.zone).catch(handleError);
    }

    function handleDragStart(event) {
        const element = event.target.closest("[data-field-id][draggable='true']");
        if (!element) return;
        draggedField = { fieldId: element.dataset.fieldId, sourceZone: element.dataset.sourceZone || "available" };
        element.classList.add("is-dragging");
        event.dataTransfer?.setData(DRAG_TYPE, JSON.stringify(draggedField));
        event.dataTransfer?.setData("text/plain", draggedField.fieldId);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    }

    function handleDragEnd(event) {
        event.target.closest("[data-field-id]")?.classList.remove("is-dragging");
        draggedField = null;
        document.querySelectorAll(".field-zone.is-drag-over").forEach((zone) => zone.classList.remove("is-drag-over"));
    }

    function getDragPayload(event) {
        if (draggedField) return draggedField;
        const serialized = event.dataTransfer?.getData(DRAG_TYPE);
        if (serialized) {
            try { return JSON.parse(serialized); } catch { return null; }
        }
        const fieldId = event.dataTransfer?.getData("text/plain");
        return fieldId ? { fieldId, sourceZone: "available" } : null;
    }

    function canAddFieldToZone(fieldId, zoneName) {
        const field = getFieldDefinition(fieldId);
        if (!field) return false;
        if (zoneName === "values") return field.aggregatable === true || field.type === DATA_TYPES.NUMBER;
        return ["rows", "columns"].includes(zoneName) && field.groupable !== false && !field.hidden;
    }

    function handleZoneDragOver(event) {
        const payload = getDragPayload(event);
        if (payload && canAddFieldToZone(payload.fieldId, event.currentTarget.dataset.analysisZone)) {
            event.preventDefault();
            if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
        }
    }

    function handleZoneDragEnter(event) {
        const payload = getDragPayload(event);
        if (payload && canAddFieldToZone(payload.fieldId, event.currentTarget.dataset.analysisZone)) {
            event.preventDefault();
            event.currentTarget.classList.add("is-drag-over");
        }
    }

    function handleZoneDragLeave(event) {
        if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.classList.remove("is-drag-over");
    }

    async function handleZoneDrop(event) {
        event.preventDefault();
        event.currentTarget.classList.remove("is-drag-over");
        const payload = getDragPayload(event);
        const targetZone = event.currentTarget.dataset.analysisZone;
        if (!payload || !canAddFieldToZone(payload.fieldId, targetZone)) {
            dom.showWarning(targetZone === "values" ? "Do Wartości można dodać tylko pole liczbowe." : "Pole nie może być użyte w tej sekcji.", "Nieprawidłowe pole");
            return;
        }
        await moveFieldBetweenZones(payload.fieldId, payload.sourceZone, targetZone);
    }

    function nextAnalysisWithField(fieldId, targetZone) {
        const analysis = state.get("analysis");
        const next = {
            ...analysis,
            rows: analysis.rows.filter((id) => id !== fieldId),
            columns: analysis.columns.filter((id) => id !== fieldId),
            values: analysis.values.filter((id) => id !== fieldId),
            activeTemplate: null
        };
        if (!next[targetZone].includes(fieldId)) next[targetZone].push(fieldId);
        return next;
    }

    async function addFieldToZone(fieldId, zoneName) {
        if (!canAddFieldToZone(fieldId, zoneName)) throw new Error("Wybrane pole nie może być użyte w tej sekcji.");
        state.setAnalysis(nextAnalysisWithField(fieldId, zoneName));
        renderAnalysisZones();
        syncControls();
        await buildPivot({ showBusy: false });
    }

    async function removeFieldFromZone(fieldId, zoneName) {
        const analysis = state.get("analysis");
        state.setAnalysis({
            ...analysis,
            [zoneName]: analysis[zoneName].filter((id) => id !== fieldId),
            activeTemplate: null
        });
        renderAnalysisZones();
        syncControls();
        await buildPivot({ showBusy: false });
    }

    async function moveFieldBetweenZones(fieldId, _sourceZone, targetZone) {
        state.setAnalysis(nextAnalysisWithField(fieldId, targetZone));
        renderAnalysisZones();
        syncControls();
        await buildPivot({ showBusy: false });
    }

    async function handleAggregationChange(event) {
        if (!AGGREGATION_IDS.includes(event.target.value)) return;
        state.setAggregation(event.target.value);
        dom.setActiveAnalysisTemplate(null);
        try { await buildPivot({ showBusy: false }); } catch (error) { handleError(error); }
    }

    async function handleClearAnalysis() {
        try {
            state.resetAnalysis();
            renderAnalysisZones();
            syncControls();
            await buildPivot({ showBusy: false });
            dom.showInfo("Przywrócono domyślną konfigurację analizy.", "Analiza");
        } catch (error) { handleError(error); }
    }

    async function handleTemplateClick(event) {
        try { await applyTemplate(event.currentTarget.dataset.analysisTemplate); }
        catch (error) { handleError(error); }
    }

    async function applyTemplate(templateId) {
        const template = ANALYSIS_TEMPLATES[templateId];
        if (!template) throw new Error(`Nieznany szablon analizy: ${templateId}.`);
        const available = new Set(state.get("dataset.fields", []).map((field) => field.id));
        const rows = template.rows.filter((id) => available.has(id));
        const columns = template.columns.filter((id) => available.has(id));
        const values = template.values.filter((id) => available.has(id));
        if (!values.length) throw new Error("Szablon wymaga pola liczbowego, którego nie ma w danych.");
        if (template.rows.length && !rows.length && template.columns.length === 0) {
            throw new Error(`Szablon „${template.label}” wymaga pola, które nie zostało zmapowane w bieżącym pliku źródłowym.`);
        }
        state.setAnalysis({
            rows,
            columns,
            values,
            aggregation: template.aggregation,
            chartType: template.chartType,
            resultView: state.get("analysis.resultView", RESULT_VIEWS.TABLE),
            activeTemplate: templateId,
            sort: { field: null, direction: "asc" }
        });
        renderAnalysisZones();
        syncControls();
        return buildPivot({ showBusy: false });
    }

    function handleResultViewClick(event) {
        const view = event.currentTarget.dataset.resultView;
        if (!Object.values(RESULT_VIEWS).includes(view)) return;
        state.setResultView(view);
        dom.setResultView(view);
        if (view === RESULT_VIEWS.CHART) renderCurrentChart();
    }

    function handleChartTypeClick(event) {
        const chartType = event.currentTarget.dataset.chartType;
        if (!CHART_TYPE_IDS.includes(chartType)) return;
        state.setChartType(chartType);
        dom.setChartTypeButton(chartType);
        renderCurrentChart();
    }

    async function buildPivot(options = {}) {
        const token = ++buildToken;
        const rows = state.get("dataset.filteredRows", []);
        const analysis = state.get("analysis");
        const validation = validateAnalysis(analysis);
        if (!validation.valid) {
            clearPivotResult(validation.message);
            return null;
        }

        const showBusy = options.showBusy === true || rows.length > 30000;
        if (showBusy) state.setBusy({ title: UI_TEXT.buildingAnalysis, message: "Grupowanie danych...", progress: 0 });
        try {
            const result = await createPivotResult(rows, analysis, { token, showBusy });
            ensureBuildToken(token);
            state.setPivotResult(result);
            lastResult = result;
            renderPivotTable(result);
            dom.updateAnalysisSummary({ filteredRows: result.statistics.sourceRows, ...result.statistics });
            renderStatus(result);
            dom.setExportAvailability({
                analysis: true,
                cleanData: state.get("dataset.normalizedRows.length", 0) > 0,
                errors: state.get("dataset.invalidRows.length", 0) + state.get("dataset.duplicateRows.length", 0) > 0
            });
            if (state.get("analysis.resultView") === RESULT_VIEWS.CHART) renderCurrentChart();
            if (showBusy) state.clearBusy(STATUS.SUCCESS);
            return result;
        } catch (error) {
            if (showBusy) state.clearBusy(STATUS.ERROR);
            if (error?.code === "PIVOT_CANCELLED") return null;
            throw error;
        }
    }

    function validateAnalysis(analysis) {
        if (!analysis.values.length) return { valid: false, message: "Dodaj co najmniej jedno pole liczbowe do sekcji Wartości." };
        const invalid = analysis.values.find((id) => !canAddFieldToZone(id, "values"));
        if (invalid) return { valid: false, message: `Pole „${getFieldLabel(invalid)}” nie jest polem liczbowym.` };
        if (!AGGREGATION_IDS.includes(analysis.aggregation)) return { valid: false, message: "Wybierz prawidłową funkcję agregującą." };
        return { valid: true, message: "" };
    }

    async function createPivotResult(sourceRows, analysis, options = {}) {
        const rowFields = [...analysis.rows];
        const columnFields = [...analysis.columns];
        const valueFields = [...analysis.values];
        const groups = new Map();
        const columnGroups = new Map();
        const grand = new Map();
        const sourceAccumulators = new Map(valueFields.map((fieldId) => [fieldId, createAccumulator()]));
        if (!columnFields.length) columnGroups.set("[]", { key: "[]", values: [], label: "" });
        const batchSize = Math.max(1000, PROCESSING_LIMITS.batchSize);

        for (let start = 0; start < sourceRows.length; start += batchSize) {
            ensureBuildToken(options.token);
            const end = Math.min(start + batchSize, sourceRows.length);
            for (let index = start; index < end; index += 1) {
                const row = sourceRows[index];
                const rowValues = rowFields.map((id) => normalizeGroupValue(row[id]));
                const rowSortValues = rowFields.map((id) => normalizeGroupValue(getFieldSortValue(id, row)));
                const rowKey = JSON.stringify(rowValues);
                if (!groups.has(rowKey)) {
                    groups.set(rowKey, {
                        key: rowKey,
                        rowValues,
                        rowSortValues,
                        rowLabel: rowValues.map(formatGroupValue).join(" · "),
                        buckets: new Map(),
                        recordCount: 0,
                        combinedAccumulator: createAccumulator()
                    });
                }
                const group = groups.get(rowKey);
                group.recordCount += 1;
                const columnValues = columnFields.map((id) => normalizeGroupValue(row[id]));
                const columnSortValues = columnFields.map((id) => normalizeGroupValue(getFieldSortValue(id, row)));
                const columnKey = JSON.stringify(columnValues);
                if (!columnGroups.has(columnKey)) columnGroups.set(columnKey, {
                    key: columnKey,
                    values: columnValues,
                    sortValues: columnSortValues,
                    label: columnValues.map(formatGroupValue).join(" · ")
                });
                valueFields.forEach((valueField) => {
                    const leafId = JSON.stringify({ columns: columnValues, valueField });
                    if (!group.buckets.has(leafId)) group.buckets.set(leafId, createAccumulator());
                    if (!grand.has(leafId)) grand.set(leafId, createAccumulator());
                    addToAccumulator(group.buckets.get(leafId), row[valueField]);
                    addToAccumulator(grand.get(leafId), row[valueField]);
                    addToAccumulator(group.combinedAccumulator, row[valueField]);
                    addToAccumulator(sourceAccumulators.get(valueField), row[valueField]);
                });
            }
            if (options.showBusy) state.updateBusy({
                message: `Zgrupowano ${formatInteger(end)} z ${formatInteger(sourceRows.length)} wierszy.`,
                progress: Math.round(end / Math.max(1, sourceRows.length) * 80)
            });
            if (end < sourceRows.length) await yieldToBrowser();
        }

        const sortedColumns = [...columnGroups.values()].sort((a, b) => compareGroupedValues(
            columnFields,
            a.values,
            b.values,
            a.sortValues,
            b.sortValues
        ));
        const leafColumns = [];
        sortedColumns.forEach((columnGroup) => valueFields.forEach((valueField) => {
            const valueLabel = getFieldLabel(valueField);
            leafColumns.push({
                id: JSON.stringify({ columns: columnGroup.values, valueField }),
                key: columnGroup.key,
                label: columnFields.length ? (valueFields.length > 1 ? `${columnGroup.label} · ${valueLabel}` : columnGroup.label) : valueLabel,
                groupLabel: columnGroup.label,
                valueField,
                valueLabel,
                columnValues: columnGroup.values,
                type: DATA_TYPES.NUMBER
            });
        }));

        const resultRows = [...groups.values()]
            .sort((a, b) => compareGroupedValues(
                rowFields,
                a.rowValues,
                b.rowValues,
                a.rowSortValues,
                b.rowSortValues
            ))
            .map((group) => ({
                key: group.key,
                rowValues: group.rowValues,
                rowSortValues: group.rowSortValues,
                rowLabel: group.rowLabel,
                chartValue: aggregateCombinedAccumulator(group.combinedAccumulator, analysis.aggregation, group.recordCount),
                cells: Object.fromEntries(leafColumns.map((column) => [
                    column.id,
                    aggregateAccumulator(group.buckets.get(column.id) || createAccumulator(), analysis.aggregation)
                ]))
            }));

        const totalCells = Object.fromEntries(leafColumns.map((column) => [
            column.id,
            aggregateAccumulator(grand.get(column.id) || createAccumulator(), analysis.aggregation)
        ]));
        const table = createTableProjection(rowFields, leafColumns, resultRows, totalCells);
        return {
            ready: true,
            result: { aggregation: analysis.aggregation, tableColumns: table.columns, tableRows: table.rows, tableFooter: table.footer },
            rowFields,
            columnFields,
            valueFields,
            columnKeys: leafColumns,
            rows: resultRows,
            totals: { cells: totalCells },
            statistics: calculateSourceStatistics(sourceAccumulators, sourceRows.length, resultRows.length),
            generatedAt: new Date().toISOString()
        };
    }

    function createAccumulator() {
        return { rowCount: 0, valueCount: 0, numericCount: 0, sum: 0, minimum: null, maximum: null };
    }

    function addToAccumulator(accumulator, rawValue) {
        accumulator.rowCount += 1;
        if (!isBlank(rawValue)) accumulator.valueCount += 1;
        const value = parseNumber(rawValue);
        if (value === null) return;
        accumulator.numericCount += 1;
        accumulator.sum += value;
        if (accumulator.minimum === null || value < accumulator.minimum) accumulator.minimum = value;
        if (accumulator.maximum === null || value > accumulator.maximum) accumulator.maximum = value;
    }

    function aggregateAccumulator(accumulator, aggregation) {
        if (aggregation === "count") return accumulator.rowCount;
        if (aggregation === "avg") return accumulator.numericCount ? accumulator.sum / accumulator.numericCount : null;
        if (aggregation === "min") return accumulator.minimum;
        if (aggregation === "max") return accumulator.maximum;
        return accumulator.numericCount ? accumulator.sum : 0;
    }

    function createTableProjection(rowFields, leafColumns, resultRows, totalCells) {
        const dimensionFields = rowFields.length ? rowFields : [null];
        const columns = [
            ...dimensionFields.map((fieldId, index) => ({
                id: `row-${index}`,
                key: `row-${index}`,
                label: fieldId ? getFieldLabel(fieldId) : "Grupa",
                type: fieldId ? getFieldDefinition(fieldId)?.type || DATA_TYPES.TEXT : DATA_TYPES.TEXT,
                role: "dimension",
                fieldId
            })),
            ...leafColumns.map((column) => ({ ...column, key: column.id, role: "measure" }))
        ];
        const rows = resultRows.map((resultRow) => {
            const record = {};
            if (rowFields.length) rowFields.forEach((_fieldId, index) => record[`row-${index}`] = resultRow.rowValues[index]);
            else record["row-0"] = "Wszystkie dane";
            leafColumns.forEach((column) => record[column.id] = resultRow.cells[column.id]);
            return record;
        });
        const footer = {};
        dimensionFields.forEach((_fieldId, index) => footer[`row-${index}`] = index === 0 ? "Razem" : "");
        leafColumns.forEach((column) => footer[column.id] = totalCells[column.id]);
        return { columns, rows, footer };
    }

    function aggregateCombinedAccumulator(accumulator, aggregation, recordCount) {
        if (aggregation === "count") return recordCount;
        return aggregateAccumulator(accumulator, aggregation);
    }

    function calculateSourceStatistics(accumulators, sourceRows, groupCount) {
        let numericCount = 0;
        let total = 0;
        let minimum = null;
        let maximum = null;
        const fields = {};

        accumulators.forEach((accumulator, fieldId) => {
            fields[fieldId] = {
                count: accumulator.numericCount,
                total: accumulator.sum,
                average: accumulator.numericCount ? accumulator.sum / accumulator.numericCount : 0,
                minimum: accumulator.minimum,
                maximum: accumulator.maximum
            };
            numericCount += accumulator.numericCount;
            total += accumulator.sum;
            if (accumulator.minimum !== null && (minimum === null || accumulator.minimum < minimum)) minimum = accumulator.minimum;
            if (accumulator.maximum !== null && (maximum === null || accumulator.maximum > maximum)) maximum = accumulator.maximum;
        });

        return {
            sourceRows,
            groupCount,
            numericValueCount: numericCount,
            total,
            average: numericCount ? total / numericCount : 0,
            minimum: minimum ?? 0,
            maximum: maximum ?? 0,
            fields
        };
    }

    function normalizeGroupValue(value) {
        if (isBlank(value)) return null;
        if (value instanceof Date) return toISODate(value) || value.toISOString();
        return value;
    }

    function formatGroupValue(value) {
        if (isBlank(value)) return UI_TEXT.emptyValue;
        if (value === true) return "Tak";
        if (value === false) return "Nie";
        return String(value);
    }

    function getFieldSortValue(fieldId, row) {
        const sortFieldId = getFieldDefinition(fieldId)?.sortFieldId;
        return sortFieldId ? row?.[sortFieldId] : row?.[fieldId];
    }

    function compareGroupedValues(fieldIds, leftValues, rightValues, leftSortValues = [], rightSortValues = []) {
        for (let index = 0; index < Math.max(leftValues.length, rightValues.length); index += 1) {
            const comparison = compareFieldValues(
                fieldIds[index],
                leftValues[index],
                rightValues[index],
                leftSortValues[index],
                rightSortValues[index]
            );
            if (comparison) return comparison;
        }
        return 0;
    }

    function compareFieldValues(fieldId, left, right, leftSortValue, rightSortValue) {
        if (isBlank(left) || isBlank(right)) {
            if (isBlank(left) && isBlank(right)) return 0;
            return isBlank(left) ? 1 : -1;
        }

        const sortFieldId = getFieldDefinition(fieldId)?.sortFieldId;
        if (sortFieldId) {
            const leftKey = parseNumber(leftSortValue);
            const rightKey = parseNumber(rightSortValue);
            if (leftKey !== null || rightKey !== null) {
                if (leftKey === null) return 1;
                if (rightKey === null) return -1;
                if (leftKey !== rightKey) return leftKey - rightKey;
            }
        }

        let ranking = null;
        if (fieldId === "month") ranking = MONTHS.map((item) => item.label);
        if (fieldId === "weekday") ranking = WEEKDAYS.map((item) => item.label);
        if (fieldId === "season") ranking = [...SEASONS].sort((a, b) => a.sortOrder - b.sortOrder).map((item) => item.label);
        if (fieldId === "quarter") ranking = ["Q1", "Q2", "Q3", "Q4"];
        if (ranking) {
            const a = ranking.indexOf(String(left));
            const b = ranking.indexOf(String(right));
            if (a >= 0 || b >= 0) return a < 0 ? 1 : b < 0 ? -1 : a - b;
        }
        return naturalCompare(left, right, { nullsLast: true });
    }

    function renderPivotTable(result) {
        dom.clear(elements.pivotResultHead);
        dom.clear(elements.pivotResultBody);
        dom.clear(elements.pivotResultFoot);
        const { tableColumns, tableRows, tableFooter } = result.result;
        const headerRow = document.createElement("tr");
        tableColumns.forEach((column) => {
            const cell = document.createElement("th");
            cell.textContent = column.label;
            if (column.role === "measure") cell.classList.add("is-number");
            headerRow.appendChild(cell);
        });
        elements.pivotResultHead.appendChild(headerRow);

        const visibleRows = tableRows.slice(0, PROCESSING_LIMITS.maximumRenderedPivotRows);
        if (!visibleRows.length) {
            const row = document.createElement("tr");
            const cell = document.createElement("td");
            cell.colSpan = tableColumns.length || 1;
            cell.className = "table-empty-state";
            cell.textContent = "Brak danych dla wybranych filtrów.";
            row.appendChild(cell);
            elements.pivotResultBody.appendChild(row);
        } else {
            const fragment = document.createDocumentFragment();
            visibleRows.forEach((record) => {
                const row = document.createElement("tr");
                tableColumns.forEach((column) => {
                    const cell = document.createElement("td");
                    const value = record[column.key];
                    if (column.role === "measure") {
                        cell.className = "is-number";
                        cell.textContent = value === null || value === undefined ? "—" : formatNumber(value, { fallback: "—" });
                    } else {
                        cell.textContent = formatDimensionValue(value, column.type);
                    }
                    row.appendChild(cell);
                });
                fragment.appendChild(row);
            });
            elements.pivotResultBody.appendChild(fragment);
        }

        if (tableRows.length) {
            const row = document.createElement("tr");
            tableColumns.forEach((column) => {
                const cell = document.createElement("td");
                const value = tableFooter[column.key];
                if (column.role === "measure") {
                    cell.className = "is-number";
                    cell.textContent = value === null || value === undefined ? "—" : formatNumber(value, { fallback: "—" });
                } else cell.textContent = String(value ?? "");
                row.appendChild(cell);
            });
            elements.pivotResultFoot.appendChild(row);
        }

        if (tableRows.length > PROCESSING_LIMITS.maximumRenderedPivotRows) {
            dom.setAnalysisTip(`Wyświetlono pierwsze ${formatInteger(PROCESSING_LIMITS.maximumRenderedPivotRows)} z ${formatInteger(tableRows.length)} grup. Eksport obejmie pełny wynik.`, "warning");
        }
    }

    function formatDimensionValue(value, type) {
        if (isBlank(value)) return UI_TEXT.emptyValue;
        if (type === DATA_TYPES.DATE) return formatDate(value, { fallback: String(value) });
        if (type === DATA_TYPES.BOOLEAN) return value === true ? "Tak" : value === false ? "Nie" : String(value);
        if (type === DATA_TYPES.NUMBER) return formatNumber(value, { fallback: String(value) });
        return String(value);
    }

    function renderStatus(result) {
        if (!result.statistics.sourceRows) {
            dom.setStatusBadge(elements.analysisStatusBadge, "Brak wyników", STATUS.WARNING);
            dom.setWorkflowProgress("analysis", "Brak danych po filtrowaniu");
            dom.setAnalysisTip("Wybrane filtry nie zwracają żadnych danych.", "warning");
        } else {
            dom.setStatusBadge(elements.analysisStatusBadge, "Wynik gotowy", STATUS.SUCCESS);
            dom.setWorkflowProgress("analysis", `${formatInteger(result.statistics.groupCount)} grup`);
            dom.setAnalysisTip(`Analiza obejmuje ${formatInteger(result.statistics.sourceRows)} wierszy i ${formatInteger(result.statistics.groupCount)} grup.`, "success");
        }
    }

    function clearPivotResult(message) {
        lastResult = null;
        state.clearPivotResult();
        dom.clearPivotTable(message);
        dom.updateAnalysisSummary({ filteredRows: state.get("dataset.filteredRows.length", 0) });
        dom.setAnalysisTip(message, "warning");
        dom.setExportAvailability({
            analysis: false,
            cleanData: state.get("dataset.normalizedRows.length", 0) > 0,
            errors: state.get("dataset.invalidRows.length", 0) + state.get("dataset.duplicateRows.length", 0) > 0
        });
        PMA.chartEngine?.clear?.();
    }

    function renderCurrentChart() {
        const result = state.get("pivot.ready", false) ? state.get("pivot") : lastResult;
        if (result?.ready) PMA.chartEngine?.render?.(result, { chartType: state.get("analysis.chartType", DEFAULT_ANALYSIS.chartType) });
    }

    function ensureBuildToken(token) {
        if (token !== undefined && token !== buildToken) {
            const error = new Error("Budowanie analizy zostało anulowane.");
            error.code = "PIVOT_CANCELLED";
            throw error;
        }
    }

    function ensureFilterToken(token) {
        if (token !== filterToken) {
            const error = new Error("Filtrowanie zostało anulowane.");
            error.code = "FILTER_CANCELLED";
            throw error;
        }
    }

    function handleError(error) {
        if (["PIVOT_CANCELLED", "FILTER_CANCELLED"].includes(error?.code)) return;
        state.clearBusy(STATUS.ERROR);
        dom.setStatusBadge(elements.analysisStatusBadge, "Błąd analizy", STATUS.ERROR);
        dom.setWorkflowProgress("analysis", "Analiza nieudana");
        dom.showError(normalizeError(error).message, "Analiza danych");
        console.error("[PMA] Analiza danych:", error);
    }

    const api = Object.freeze({
        initialize,
        destroy,
        prepareAnalysis,
        renderDynamicFilters,
        renderAvailableFields,
        renderAnalysisZones,
        syncAnalysisControls: syncControls,
        applyFilters,
        refreshFilteredAnalysis,
        applyTemplate,
        buildPivot,
        createPivotResult,
        renderPivotTable,
        clearPivotResult,
        createAccumulator,
        addToAccumulator,
        aggregateAccumulator,
        aggregateCombinedAccumulator,
        calculateSourceStatistics,
        getFieldDefinition,
        getFieldLabel,
        getLastResult: () => lastResult ? clonePlain(lastResult) : null,
        isInitialized: () => initialized
    });

    Object.defineProperty(PMA, "pivotEngine", {
        value: api,
        writable: false,
        enumerable: true,
        configurable: false
    });
})(window);
