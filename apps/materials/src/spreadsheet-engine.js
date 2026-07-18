/* ==========================================================
   Materials Analytics
   src/spreadsheet-engine.js
   Excel-like editor, transformations, formulas, error repair,
   stock snapshots, project persistence and workbook export.
========================================================== */
(function initializeSpreadsheetEngine(global) {
    "use strict";

    const PMA = global.PMA || (global.PMA = {});
    if (!PMA.constants || !PMA.state || !PMA.utils || !PMA.dom || !PMA.formulaEngine || !PMA.workspaceStorage) {
        throw new Error("PMA core, formula engine and workspace storage must be loaded before spreadsheet-engine.js.");
    }

    const { STATUS, EVENTS, DATA_TYPES, SYSTEM_FIELDS, SYSTEM_FIELD_MAP, VALIDATION_MESSAGES } = PMA.constants;
    const {
        parseNumber,
        parseDate,
        round,
        toISODate,
        deriveDateFields,
        cleanText,
        normalizeComparableText,
        formatNumber,
        formatInteger,
        formatDate,
        clonePlain,
        createId,
        downloadBlob,
        createExportFileName,
        normalizeError
    } = PMA.utils;
    const state = PMA.state;
    const dom = PMA.dom;

    const ROW_HEIGHT = 34;
    const OVERSCAN = 10;
    const COMMAND_LIMIT = 50;
    const DEFAULT_COLUMN_WIDTH = 160;
    const bindings = [];
    const undoStack = [];
    const redoStack = [];
    const selectedRowIds = new Set();
    const filters = [];
    const sorts = [];
    const formulaCache = new Map();
    const columnWidths = new Map();

    let initialized = false;
    let unsubscribeState = null;
    let activeTab = "editor";
    let viewMode = "source";
    let searchText = "";
    let activeCell = null;
    let selectionAnchor = null;
    let rendering = false;
    let autosaveTimer = null;
    let analysisRefreshTimer = null;
    let projectId = null;
    let projectCreatedAt = null;
    let stockImportBuffer = null;
    let currentTransformPreview = null;
    let formulaPlanCache = null;

    function el(id) { return document.getElementById(id); }
    function all(selector) { return [...document.querySelectorAll(selector)]; }
    function bind(target, eventName, handler, options = false) {
        if (!target) return;
        target.addEventListener(eventName, handler, options);
        bindings.push({ target, eventName, handler, options });
    }
    function bindId(id, eventName, handler, options = false) { bind(el(id), eventName, handler, options); }
    function setText(id, value) { if (el(id)) el(id).textContent = String(value ?? ""); }

    function initialize() {
        if (initialized) return api;
        bindTabs();
        bindEditor();
        bindTransformations();
        bindFormulas();
        bindErrors();
        bindQuality();
        bindStock();
        bindProjects();
        unsubscribeState = state.subscribe(handleStateEvent);
        PMA.workspaceStorage.initialize()
            .then(recoverAutosaveIfNeeded)
            .catch(() => {});
        initialized = true;
        syncAvailability();
        refreshAll();
        return api;
    }

    function destroy() {
        bindings.splice(0).forEach(({ target, eventName, handler, options }) => target.removeEventListener(eventName, handler, options));
        unsubscribeState?.();
        unsubscribeState = null;
        clearTimeout(autosaveTimer);
        clearTimeout(analysisRefreshTimer);
        initialized = false;
    }

    function handleStateEvent(payload) {
        if (!payload) return;
        if ([EVENTS.DATA_NORMALIZED, EVENTS.WORKSPACE_IMPORTED, EVENTS.FILTERS_CHANGED].includes(payload.eventName)) {
            syncAvailability();
            refreshAll({ keepScroll: true });
        }
        if (payload.eventName === EVENTS.WORKSPACE_RESET) resetRuntime();
    }

    function resetRuntime() {
        undoStack.length = 0;
        redoStack.length = 0;
        selectedRowIds.clear();
        filters.length = 0;
        sorts.length = 0;
        formulaCache.clear();
        formulaPlanCache = null;
        activeCell = null;
        selectionAnchor = null;
        projectId = null;
        projectCreatedAt = null;
        if (el("workspaceProjectName")) el("workspaceProjectName").value = "Nowy projekt";
        PMA.workspaceStorage.clearAutosave?.().catch(() => {});
        refreshAll();
    }

    function syncAvailability() {
        const count = rows().length;
        if (count) {
            dom.unlockSection("dataLab");
            dom.setStatusBadge("dataLabStatusBadge", "Gotowe", STATUS.SUCCESS);
            dom.setWorkflowProgress("dataLab", `${formatInteger(count)} wierszy`);
        } else {
            dom.lockSection("dataLab", "Przetwórz dane, aby uruchomić edytor arkusza.");
            dom.setStatusBadge("dataLabStatusBadge", "Niedostępne", STATUS.IDLE);
            dom.setWorkflowProgress("dataLab", "Niedostępne");
        }
    }

    function rows() { return state.get("dataset.normalizedRows", []); }
    function invalidRows() { return state.get("dataset.invalidRows", []); }
    function duplicateRows() { return state.get("dataset.duplicateRows", []); }
    function fields() { return state.get("dataset.fields", []); }
    function stockRows() { return state.get("dataset.stockRows", []); }
    function calculatedColumns() { return state.get("dataset.calculatedColumns", []); }
    function transformationSteps() { return state.get("dataset.transformationSteps", []); }

    function nonInternalFields() {
        return fields().filter((field) => field && field.source !== "internal");
    }

    function displayFields() {
        const allFields = nonInternalFields().filter((field) => !field.hidden);
        if (viewMode === "all") return allFields;
        if (viewMode === "analysis") {
            return allFields.filter((field) => ["mapped", "derived", "calculated", "manual"].includes(field.source));
        }
        const source = allFields.filter((field) => ["source", "calculated", "manual"].includes(field.source));
        return source.length ? source : allFields.filter((field) => ["mapped", "calculated", "manual"].includes(field.source));
    }

    function fieldById(fieldId) { return fields().find((field) => field.id === fieldId) || null; }
    function rowById(rowId) { return rows().find((row) => row.id === rowId) || null; }

    function bindTabs() {
        all("[data-workspace-tab]").forEach((button) => bind(button, "click", () => switchTab(button.dataset.workspaceTab)));
    }

    function switchTab(name) {
        activeTab = name || "editor";
        all("[data-workspace-tab]").forEach((button) => button.classList.toggle("is-active", button.dataset.workspaceTab === activeTab));
        all("[data-workspace-view]").forEach((view) => { view.hidden = view.dataset.workspaceView !== activeTab; });
        if (activeTab === "editor") renderGrid();
        if (activeTab === "errors") renderErrors();
        if (activeTab === "quality") renderQuality();
        if (activeTab === "stock") renderStockTable();
        if (activeTab === "workspace") renderProjectList();
    }

    function bindEditor() {
        bindId("openRawWorkspaceButton", "click", openRawWorkspace);
        bindId("workspaceSearchInput", "input", (event) => { searchText = normalizeComparableText(event.target.value); renderGrid({ resetScroll: true }); });
        bindId("workspaceViewMode", "change", (event) => { viewMode = event.target.value; populateFieldControls(); renderGrid({ resetScroll: true }); scheduleAutosave(); });
        bindId("workspaceUndoButton", "click", undo);
        bindId("workspaceRedoButton", "click", redo);
        bindId("workspaceAddRowButton", "click", addRow);
        bindId("workspaceAddColumnButton", "click", addColumn);
        bindId("workspaceDeleteRowsButton", "click", deleteSelectedRows);
        bindId("workspaceExportWorkbookButton", "click", exportWorkbook);
        bindId("workspaceAddFilterButton", "click", addFilterFromControls);
        bindId("workspaceFilterOperator", "change", syncFilterValueControl);
        bindId("workspaceAddSortButton", "click", addSortFromControls);
        bindId("workspaceColumnSelector", "change", syncColumnControls);
        bindId("workspaceRenameColumnButton", "click", renameSelectedColumn);
        bindId("workspaceMoveColumnLeftButton", "click", () => moveSelectedColumn(-1));
        bindId("workspaceMoveColumnRightButton", "click", () => moveSelectedColumn(1));
        bindId("workspaceHideColumnButton", "click", toggleSelectedColumn);
        bindId("workspaceDeleteColumnButton", "click", deleteSelectedColumn);
        bindId("workspaceColumnWidth", "change", updateSelectedColumnWidth);
        bindId("workspaceGridViewport", "scroll", () => renderGrid({ keepScroll: true }));
        bindId("workspaceGridViewport", "click", handleGridClick);
        bindId("workspaceGridViewport", "dblclick", handleGridDoubleClick);
        bindId("workspaceGridViewport", "keydown", handleGridKeydown);
        bindId("workspaceGridViewport", "copy", handleCopy);
        bindId("workspaceGridViewport", "paste", handlePaste);
        bindId("workspaceGridHead", "click", handleGridHeaderClick);
    }

    async function openRawWorkspace() {
        const headers = state.get("import.headers", []);
        const sourceRows = state.get("import.dataRows", []);
        if (!headers.length || !sourceRows.length) {
            dom.showWarning("Najpierw wczytaj i przeanalizuj arkusz.", "Ogólny arkusz");
            return;
        }
        const importedAt = new Date().toISOString();
        const defaultFileName = state.get("import.fileMeta.name", "");
        const defaultSheetName = state.get("import.selectedSheet", "");
        const sourceRowNumbers = state.get("import.sourceRowNumbers", []);
        const provenance = state.get("import.rowProvenance", []);
        const nextRows = sourceRows.map((values, index) => {
            const origin = provenance[index] || {};
            const row = {
                id: createId("record"),
                sourceRow: Number(origin.sourceRow) || Number(sourceRowNumbers[index]) || (state.get("import.headerRowIndex", 0) || 0) + index + 2,
                sourceSheet: origin.sheetName || defaultSheetName || null,
                sourceFile: origin.fileName || defaultFileName || null,
                importedAt,
                validationStatus: "raw", validationErrors: [], duplicateKey: "", originalValues: {}
            };
            headers.forEach((header, columnIndex) => { row[`source__${columnIndex}`] = values[columnIndex] ?? null; });
            return row;
        });
        const nextFields = PMA.normalizationEngine.buildDatasetFields({}, headers);
        state.setNormalizedDataset({ normalizedRows: nextRows, invalidRows: [], duplicateRows: [], fields: nextFields, statistics: calculateStatistics(nextRows) });
        try { await PMA.pivotEngine?.prepareAnalysis?.({ buildDefault: false }); } catch (_) { /* raw editor remains usable */ }
        dom.unlockSection("analysis");
        dom.unlockSection("dataLab");
        dom.lockSection("decision", "Mapuj pola Data, Materiał i Zużycie, aby uruchomić analizę decyzyjną.");
        dom.setStatusBadge("dataLabStatusBadge", "Arkusz ogólny", STATUS.SUCCESS);
        dom.setWorkflowProgress("dataLab", `${formatInteger(nextRows.length)} wierszy`);
        dom.activateSection("dataLab");
        dom.showSuccess(`Otworzono ${formatInteger(nextRows.length)} wierszy bez wymuszania schematu materiałowego.`, "Ogólny arkusz danych");
    }

    function refreshAll(options = {}) {
        if (!initialized) return;
        populateFieldControls();
        renderFilterChips();
        renderSortChips();
        renderGrid(options);
        renderErrors();
        renderTransformationHistory();
        renderFormulaList();
        renderQuality();
        renderStockTable();
        updateCommandButtons();
        setText("workspaceErrorCount", invalidRows().length + duplicateRows().length);
    }

    function populateFieldControls() {
        const list = nonInternalFields();
        ["workspaceFilterField", "workspaceSortField", "workspaceColumnSelector", "workspaceTransformField"].forEach((id) => {
            const select = el(id);
            if (!select) return;
            const current = select.value;
            select.replaceChildren();
            list.forEach((field) => {
                const option = document.createElement("option");
                option.value = field.id;
                option.textContent = field.label;
                select.appendChild(option);
            });
            if (list.some((field) => field.id === current)) select.value = current;
        });
        syncColumnControls();
    }

    function syncColumnControls() {
        const field = fieldById(el("workspaceColumnSelector")?.value);
        if (!field) return;
        if (el("workspaceColumnWidth")) el("workspaceColumnWidth").value = String(columnWidths.get(field.id) || field.width || DEFAULT_COLUMN_WIDTH);
        const protectedField = ["mapped", "derived", "internal"].includes(field.source) || (field.source === "source" && field.mappedTo?.length);
        if (el("workspaceDeleteColumnButton")) el("workspaceDeleteColumnButton").disabled = protectedField;
    }

    function filteredAndSortedRows() {
        const visible = displayFields();
        let result = rows().map((row, index) => ({ row, sourceIndex: index }));
        if (searchText) {
            result = result.filter(({ row }) => visible.some((field) => normalizeComparableText(formatRaw(row[field.id])).includes(searchText)));
        }
        filters.forEach((filter) => {
            result = result.filter(({ row }) => matchesFilter(row[filter.fieldId], filter));
        });
        if (sorts.length) {
            result = [...result].sort((left, right) => {
                for (const sort of sorts) {
                    const field = fieldById(sort.fieldId);
                    const comparison = compareValues(left.row[sort.fieldId], right.row[sort.fieldId], field?.type);
                    if (comparison) return sort.direction === "desc" ? -comparison : comparison;
                }
                return left.sourceIndex - right.sourceIndex;
            });
        }
        return result;
    }

    function matchesFilter(value, filter) {
        const operator = filter.operator;
        const blank = value === null || value === undefined || String(value).trim() === "";
        if (operator === "is-empty") return blank;
        if (operator === "is-not-empty") return !blank;
        const comparisonOperators = ["greater-than", "greater-or-equal", "less-than", "less-or-equal"];
        if (comparisonOperators.includes(operator)) {
            const field = fieldById(filter.fieldId);
            let actual;
            let expected;
            if (field?.type === DATA_TYPES.DATE) {
                actual = parseDate(value, { allowExcelSerial: true, allowNumericStringExcelSerial: true })?.getTime() ?? null;
                expected = parseDate(filter.value, { allowExcelSerial: true, allowNumericStringExcelSerial: true })?.getTime() ?? null;
            } else {
                actual = parseNumber(value);
                expected = parseNumber(filter.value);
            }
            if (actual === null || expected === null) return false;
            if (operator === "greater-than") return actual > expected;
            if (operator === "greater-or-equal") return actual >= expected;
            if (operator === "less-than") return actual < expected;
            return actual <= expected;
        }
        const actual = normalizeComparableText(value);
        const expected = normalizeComparableText(filter.value);
        if (operator === "equals") return actual === expected;
        if (operator === "not-equals") return actual !== expected;
        if (operator === "starts-with") return actual.startsWith(expected);
        if (operator === "ends-with") return actual.endsWith(expected);
        return actual.includes(expected);
    }

    function compareValues(left, right, type) {
        if (type === DATA_TYPES.NUMBER) return (parseNumber(left) ?? -Infinity) - (parseNumber(right) ?? -Infinity);
        if (type === DATA_TYPES.DATE) {
            const a = parseDate(left, { allowExcelSerial: true, allowNumericStringExcelSerial: true });
            const b = parseDate(right, { allowExcelSerial: true, allowNumericStringExcelSerial: true });
            return (a?.getTime() || 0) - (b?.getTime() || 0);
        }
        return normalizeComparableText(left).localeCompare(normalizeComparableText(right), "pl");
    }

    function renderGrid(options = {}) {
        if (rendering || activeTab !== "editor") return;
        const viewport = el("workspaceGridViewport");
        const head = el("workspaceGridHead");
        const body = el("workspaceGridBody");
        if (!viewport || !head || !body) return;
        rendering = true;
        try {
            if (options.resetScroll) viewport.scrollTop = 0;
            const visibleFields = displayFields();
            const data = filteredAndSortedRows();
            const currentBounds = selectionBounds(data, visibleFields);
            const viewportHeight = viewport.clientHeight || 520;
            const start = Math.max(0, Math.floor(viewport.scrollTop / ROW_HEIGHT) - OVERSCAN);
            const count = Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN * 2;
            const end = Math.min(data.length, start + count);

            const headerRow = document.createElement("tr");
            const selectorHead = document.createElement("th");
            selectorHead.className = "workspace-row-selector";
            selectorHead.textContent = "#";
            headerRow.appendChild(selectorHead);
            visibleFields.forEach((field) => {
                const th = document.createElement("th");
                th.dataset.fieldId = field.id;
                th.style.width = `${columnWidths.get(field.id) || field.width || DEFAULT_COLUMN_WIDTH}px`;
                th.style.minWidth = th.style.width;
                th.title = `${field.label} · ${field.source}`;
                th.innerHTML = `<button type="button" data-grid-sort="${escapeHtml(field.id)}">${escapeHtml(field.label)}${sortIndicator(field.id)}</button>`;
                headerRow.appendChild(th);
            });
            head.replaceChildren(headerRow);
            body.replaceChildren();
            if (start > 0) body.appendChild(spacerRow(start * ROW_HEIGHT, visibleFields.length + 1));
            for (let displayIndex = start; displayIndex < end; displayIndex += 1) {
                const item = data[displayIndex];
                body.appendChild(renderDataRow(item, displayIndex, visibleFields, currentBounds));
            }
            if (end < data.length) body.appendChild(spacerRow((data.length - end) * ROW_HEIGHT, visibleFields.length + 1));
            setText("workspaceGridStatus", `${formatInteger(data.length)} z ${formatInteger(rows().length)} wierszy · ${visibleFields.length} kolumn`);
            updateSelectionStatus();
        } finally {
            rendering = false;
        }
    }

    function renderDataRow(item, displayIndex, visibleFields, currentBounds) {
        const tr = document.createElement("tr");
        tr.dataset.rowId = item.row.id;
        tr.dataset.displayIndex = String(displayIndex);
        if (selectedRowIds.has(item.row.id)) tr.classList.add("is-row-selected");
        const selector = document.createElement("td");
        selector.className = "workspace-row-selector";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = selectedRowIds.has(item.row.id);
        checkbox.dataset.selectRow = item.row.id;
        checkbox.setAttribute("aria-label", `Zaznacz wiersz ${displayIndex + 1}`);
        selector.append(checkbox, document.createTextNode(String(displayIndex + 1)));
        tr.appendChild(selector);
        visibleFields.forEach((field, fieldIndex) => {
            const td = document.createElement("td");
            td.dataset.rowId = item.row.id;
            td.dataset.fieldId = field.id;
            td.dataset.displayIndex = String(displayIndex);
            td.dataset.fieldIndex = String(fieldIndex);
            td.style.width = `${columnWidths.get(field.id) || field.width || DEFAULT_COLUMN_WIDTH}px`;
            td.style.minWidth = td.style.width;
            td.textContent = formatCell(item.row[field.id], field);
            if (field.type === DATA_TYPES.NUMBER) td.classList.add("is-number");
            if (field.source === "calculated") td.classList.add("is-calculated");
            if (isCellSelected(item.row.id, field.id, displayIndex, fieldIndex, currentBounds)) td.classList.add("is-cell-selected");
            if (activeCell?.rowId === item.row.id && activeCell?.fieldId === field.id) td.classList.add("is-active-cell");
            tr.appendChild(td);
        });
        return tr;
    }

    function spacerRow(height, colspan) {
        const tr = document.createElement("tr");
        tr.className = "workspace-spacer-row";
        const td = document.createElement("td");
        td.colSpan = colspan;
        td.style.height = `${Math.max(0, height)}px`;
        tr.appendChild(td);
        return tr;
    }

    function sortIndicator(fieldId) {
        const index = sorts.findIndex((sort) => sort.fieldId === fieldId);
        if (index < 0) return "";
        return sorts[index].direction === "asc" ? ` ▲${index + 1}` : ` ▼${index + 1}`;
    }

    function handleGridHeaderClick(event) {
        const button = event.target.closest("[data-grid-sort]");
        if (!button) return;
        const fieldId = button.dataset.gridSort;
        const previous = sorts.find((sort) => sort.fieldId === fieldId);
        const nextDirection = previous?.direction === "asc" ? "desc" : "asc";
        if (!event.shiftKey) sorts.splice(0, sorts.length, { id: previous?.id || createId("sort"), fieldId, direction: nextDirection });
        else if (previous) previous.direction = nextDirection;
        else sorts.push({ id: createId("sort"), fieldId, direction: "asc" });
        renderSortChips();
        renderGrid({ resetScroll: true });
        scheduleAutosave();
    }

    function handleGridClick(event) {
        const rowCheckbox = event.target.closest("[data-select-row]");
        if (rowCheckbox) {
            if (rowCheckbox.checked) selectedRowIds.add(rowCheckbox.dataset.selectRow);
            else selectedRowIds.delete(rowCheckbox.dataset.selectRow);
            updateDeleteRowsButton();
            renderGrid({ keepScroll: true });
            return;
        }
        const cell = event.target.closest("td[data-row-id][data-field-id]");
        if (!cell) return;
        const next = {
            rowId: cell.dataset.rowId,
            fieldId: cell.dataset.fieldId,
            displayIndex: Number(cell.dataset.displayIndex),
            fieldIndex: Number(cell.dataset.fieldIndex)
        };
        if (event.shiftKey && selectionAnchor) activeCell = next;
        else { activeCell = next; selectionAnchor = next; }
        if (el("workspaceColumnSelector")) el("workspaceColumnSelector").value = next.fieldId;
        syncColumnControls();
        renderGrid({ keepScroll: true });
        el("workspaceGridViewport")?.focus();
    }

    function handleGridDoubleClick(event) {
        const cell = event.target.closest("td[data-row-id][data-field-id]");
        if (cell) startCellEdit(cell);
    }

    function handleGridKeydown(event) {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") { event.preventDefault(); redo(); return; }
        if (event.key === "Enter" && activeCell) {
            const cell = el("workspaceGridBody")?.querySelector(`td[data-row-id="${cssEscape(activeCell.rowId)}"][data-field-id="${cssEscape(activeCell.fieldId)}"]`);
            if (cell) { event.preventDefault(); startCellEdit(cell); }
        }
        if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key) && activeCell) {
            event.preventDefault(); moveActiveCell(event.key, event.shiftKey);
        }
        if (event.key === "Delete" && activeCell) { event.preventDefault(); clearSelectionValues(); }
    }

    function moveActiveCell(key, extend) {
        const data = filteredAndSortedRows();
        const visible = displayFields();
        let rowIndex = data.findIndex(({ row }) => row.id === activeCell.rowId);
        let fieldIndex = visible.findIndex((field) => field.id === activeCell.fieldId);
        if (key === "ArrowUp") rowIndex -= 1;
        if (key === "ArrowDown") rowIndex += 1;
        if (key === "ArrowLeft") fieldIndex -= 1;
        if (key === "ArrowRight") fieldIndex += 1;
        rowIndex = Math.max(0, Math.min(data.length - 1, rowIndex));
        fieldIndex = Math.max(0, Math.min(visible.length - 1, fieldIndex));
        const next = { rowId: data[rowIndex]?.row.id, fieldId: visible[fieldIndex]?.id, displayIndex: rowIndex, fieldIndex };
        if (!next.rowId || !next.fieldId) return;
        activeCell = next;
        if (!extend) selectionAnchor = next;
        const viewport = el("workspaceGridViewport");
        if (viewport) {
            const top = rowIndex * ROW_HEIGHT;
            if (top < viewport.scrollTop) viewport.scrollTop = top;
            else if (top + ROW_HEIGHT > viewport.scrollTop + viewport.clientHeight) viewport.scrollTop = top - viewport.clientHeight + ROW_HEIGHT;
        }
        renderGrid({ keepScroll: true });
    }

    function startCellEdit(cell) {
        const field = fieldById(cell.dataset.fieldId);
        if (!field || field.source === "derived" || field.source === "calculated") {
            dom.showInfo("Kolumna pochodna lub obliczeniowa jest tylko do odczytu. Zmień jej formułę albo dane źródłowe.", "Edycja komórki");
            return;
        }
        const row = rowById(cell.dataset.rowId);
        if (!row) return;
        const original = row[field.id];
        const input = document.createElement("input");
        input.className = "workspace-cell-editor";
        input.value = rawInputValue(original, field);
        cell.replaceChildren(input);
        input.focus(); input.select();
        let closed = false;
        const finish = (save) => {
            if (closed) return;
            closed = true;
            if (save) editCell(row.id, field.id, input.value);
            else renderGrid({ keepScroll: true });
        };
        input.addEventListener("keydown", (event) => {
            if (event.key === "Enter") { event.preventDefault(); finish(true); }
            if (event.key === "Escape") { event.preventDefault(); finish(false); }
        });
        input.addEventListener("blur", () => finish(true), { once: true });
    }

    function editCell(rowId, fieldId, rawValue) {
        const field = fieldById(fieldId);
        const row = rowById(rowId);
        if (!field || !row) return;
        const patches = buildCellPatches(row, field, rawValue);
        if (!patches.length) { renderGrid({ keepScroll: true }); return; }
        executePatchCommand(`Edycja: ${field.label}`, patches);
    }

    function buildCellPatches(row, field, rawValue) {
        const nextRow = { ...row };
        nextRow[field.id] = normalizeEditedValue(rawValue, field);
        synchronizeMappedFields(nextRow, field);
        recalculateFormulas(nextRow);
        const patches = [];
        Object.keys(nextRow).forEach((fieldId) => {
            if (!sameValue(row[fieldId], nextRow[fieldId])) patches.push({ rowId: row.id, fieldId, oldValue: row[fieldId], newValue: nextRow[fieldId] });
        });
        return patches;
    }

    function buildRowBatchPatches(row, changes) {
        const nextRow = { ...row };
        changes.forEach(({ field, rawValue }) => {
            nextRow[field.id] = normalizeEditedValue(rawValue, field);
            synchronizeMappedFields(nextRow, field);
        });
        recalculateFormulas(nextRow);
        return Object.keys(nextRow)
            .filter((fieldId) => !sameValue(row[fieldId], nextRow[fieldId]))
            .map((fieldId) => ({ rowId: row.id, fieldId, oldValue: row[fieldId], newValue: nextRow[fieldId] }));
    }

    function normalizeEditedValue(value, field) {
        if (value === "") return null;
        if (field.type === DATA_TYPES.NUMBER) return parseNumber(value);
        if (field.type === DATA_TYPES.DATE) {
            const date = parseDate(value, { allowExcelSerial: true, allowNumericStringExcelSerial: true });
            return date ? toISODate(date) : value;
        }
        if (field.type === DATA_TYPES.BOOLEAN) return ["true", "1", "tak", "yes"].includes(normalizeComparableText(value));
        return cleanText(value);
    }

    function synchronizeMappedFields(row, changedField) {
        if (changedField.source === "source") {
            (changedField.mappedTo || []).forEach((systemFieldId) => {
                const systemField = SYSTEM_FIELD_MAP[systemFieldId];
                if (!systemField) return;
                row[systemFieldId] = normalizeEditedValue(row[changedField.id], systemField);
                if (systemFieldId === "date") updateDateDerivedFields(row);
            });
        } else if (changedField.source === "mapped" && changedField.sourceColumn) {
            const sourceField = fields().find((field) => field.source === "source" && field.sourceColumn === changedField.sourceColumn);
            if (sourceField) row[sourceField.id] = row[changedField.id];
            if (changedField.id === "date") updateDateDerivedFields(row);
        }
    }

    function updateDateDerivedFields(row) {
        const parsed = parseDate(row.date, { allowExcelSerial: true, allowNumericStringExcelSerial: true });
        if (!parsed) return;
        Object.assign(row, deriveDateFields(parsed));
    }

    function formulaEnvironmentSignature(fieldList, definitions) {
        return `${fieldList.map((field) => `${field.id}:${field.label}:${field.source || ""}:${field.sourceColumn || ""}`).join("|")}::${definitions.map((definition) => `${definition.id}:${definition.type}:${definition.expression}`).join("|")}`;
    }

    function getFormulaPlan(fieldList = fields(), definitions = calculatedColumns()) {
        const signature = formulaEnvironmentSignature(fieldList, definitions);
        if (formulaPlanCache?.signature === signature) return formulaPlanCache.plan;

        const definitionById = new Map(definitions.map((definition) => [definition.id, definition]));
        const compiledById = new Map();
        definitions.forEach((definition) => {
            const compiledSignature = `${definition.expression}|${fieldList.map((field) => `${field.id}:${field.label}:${field.source || ""}:${field.sourceColumn || ""}`).join("|")}`;
            let compiled = formulaCache.get(definition.id);
            if (!compiled || compiled.signature !== compiledSignature) {
                compiled = { signature: compiledSignature, ...PMA.formulaEngine.compile(definition.expression, fieldList) };
                formulaCache.set(definition.id, compiled);
            }
            compiledById.set(definition.id, compiled);
        });

        const stateById = new Map();
        const ordered = [];
        const stack = [];
        const visit = (id) => {
            const stateValue = stateById.get(id) || 0;
            if (stateValue === 2) return;
            if (stateValue === 1) {
                const start = stack.indexOf(id);
                const cycleIds = [...stack.slice(Math.max(0, start)), id];
                const cycle = cycleIds.map((item) => definitionById.get(item)?.label || item).join(" → ");
                throw new Error(`Wykryto cykliczne odwołanie w kolumnach obliczeniowych: ${cycle}.`);
            }
            stateById.set(id, 1);
            stack.push(id);
            const compiled = compiledById.get(id);
            (compiled?.dependencies || []).filter((dependencyId) => definitionById.has(dependencyId)).forEach(visit);
            stack.pop();
            stateById.set(id, 2);
            ordered.push({ definition: definitionById.get(id), compiled });
        };
        definitions.forEach((definition) => visit(definition.id));
        formulaPlanCache = { signature, plan: ordered };
        return ordered;
    }

    function recalculateFormulas(row, fieldList = fields(), definitions = calculatedColumns(), options = {}) {
        let plan;
        try {
            plan = getFormulaPlan(fieldList, definitions);
        } catch (error) {
            definitions.forEach((definition) => { row[definition.id] = null; });
            if (options.throwOnPlanError) throw error;
            return row;
        }
        plan.forEach(({ definition, compiled }) => {
            try {
                row[definition.id] = coerceFormulaResult(compiled.evaluate(row), definition.type);
            } catch (_) {
                row[definition.id] = null;
            }
        });
        return row;
    }

    function selectionBounds(dataOverride = null, visibleOverride = null) {
        if (!activeCell || !selectionAnchor) return null;
        const data = dataOverride || filteredAndSortedRows();
        const visible = visibleOverride || displayFields();
        const aRow = data.findIndex(({ row }) => row.id === selectionAnchor.rowId);
        const bRow = data.findIndex(({ row }) => row.id === activeCell.rowId);
        const aCol = visible.findIndex((field) => field.id === selectionAnchor.fieldId);
        const bCol = visible.findIndex((field) => field.id === activeCell.fieldId);
        if ([aRow, bRow, aCol, bCol].some((value) => value < 0)) return null;
        return { rowStart: Math.min(aRow, bRow), rowEnd: Math.max(aRow, bRow), colStart: Math.min(aCol, bCol), colEnd: Math.max(aCol, bCol), data, visible };
    }

    function isCellSelected(rowId, fieldId, displayIndex, fieldIndex, currentBounds = null) {
        const bounds = currentBounds || selectionBounds();
        if (!bounds) return activeCell?.rowId === rowId && activeCell?.fieldId === fieldId;
        return displayIndex >= bounds.rowStart && displayIndex <= bounds.rowEnd && fieldIndex >= bounds.colStart && fieldIndex <= bounds.colEnd;
    }

    function clearSelectionValues() {
        const bounds = selectionBounds();
        if (!bounds) return;
        const patches = [];
        for (let rowIndex = bounds.rowStart; rowIndex <= bounds.rowEnd; rowIndex += 1) {
            const row = bounds.data[rowIndex].row;
            const changes = [];
            for (let colIndex = bounds.colStart; colIndex <= bounds.colEnd; colIndex += 1) {
                const field = bounds.visible[colIndex];
                if (["derived", "calculated"].includes(field.source)) continue;
                changes.push({ field, rawValue: "" });
            }
            patches.push(...buildRowBatchPatches(row, changes));
        }
        executePatchCommand("Wyczyszczenie zaznaczenia", dedupePatches(patches));
    }

    function handleCopy(event) {
        const bounds = selectionBounds();
        if (!bounds) return;
        const lines = [];
        for (let rowIndex = bounds.rowStart; rowIndex <= bounds.rowEnd; rowIndex += 1) {
            const row = bounds.data[rowIndex].row;
            const values = [];
            for (let colIndex = bounds.colStart; colIndex <= bounds.colEnd; colIndex += 1) values.push(formatRaw(row[bounds.visible[colIndex].id]));
            lines.push(values.join("\t"));
        }
        event.preventDefault();
        event.clipboardData?.setData("text/plain", lines.join("\n"));
    }

    function handlePaste(event) {
        if (!activeCell) return;
        const text = event.clipboardData?.getData("text/plain");
        if (!text) return;
        event.preventDefault();
        const matrix = text.replace(/\r/g, "").split("\n").filter((line, index, array) => line.length || index < array.length - 1).map((line) => line.split("\t"));
        const data = filteredAndSortedRows();
        const visible = displayFields();
        const startRow = data.findIndex(({ row }) => row.id === activeCell.rowId);
        const startCol = visible.findIndex((field) => field.id === activeCell.fieldId);
        const patches = [];
        matrix.forEach((values, rowOffset) => {
            const row = data[startRow + rowOffset]?.row;
            if (!row) return;
            const changes = [];
            values.forEach((value, colOffset) => {
                const field = visible[startCol + colOffset];
                if (!field || ["derived", "calculated"].includes(field.source)) return;
                changes.push({ field, rawValue: value });
            });
            patches.push(...buildRowBatchPatches(row, changes));
        });
        executePatchCommand(`Wklejenie ${matrix.length} wierszy`, dedupePatches(patches));
    }

    function addRow() {
        const newRow = {
            id: createId("record"),
            sourceRow: rows().length + 2,
            sourceSheet: "Ręcznie",
            sourceFile: null,
            importedAt: new Date().toISOString(),
            validationStatus: "manual",
            validationErrors: [],
            duplicateKey: "",
            originalValues: {}
        };
        nonInternalFields().forEach((field) => { if (!(field.id in newRow)) newRow[field.id] = null; });
        recalculateFormulas(newRow);
        const index = rows().length;
        runCommand({
            label: "Dodanie wiersza",
            redo: () => commitDataset(insertAt(rows(), index, newRow), fields(), "row-added"),
            undo: () => commitDataset(rows().filter((row) => row.id !== newRow.id), fields(), "row-added-undo")
        });
        selectedRowIds.clear(); selectedRowIds.add(newRow.id);
    }

    function deleteSelectedRows() {
        if (!selectedRowIds.size) return;
        const current = rows();
        const removedIds = new Set(selectedRowIds);
        const removed = current.map((row, index) => ({ row, index })).filter(({ row }) => removedIds.has(row.id));
        if (!removed.length) return;
        runCommand({
            label: `Usunięcie ${removed.length} wierszy`,
            redo: () => commitDataset(rows().filter((row) => !removedIds.has(row.id)), fields(), "rows-deleted"),
            undo: () => {
                let restored = [...rows()];
                removed.forEach(({ row, index }) => { restored.splice(Math.min(index, restored.length), 0, row); });
                commitDataset(restored, fields(), "rows-deleted-undo");
            }
        });
        selectedRowIds.clear(); updateDeleteRowsButton();
    }

    function addColumn() {
        const name = global.prompt("Nazwa nowej kolumny:", "Nowa kolumna");
        if (!name?.trim()) return;
        const type = global.prompt("Typ: text, number, date lub boolean", "text") || "text";
        const id = createId("manual").replace(/-/g, "_");
        const field = { id, label: name.trim(), description: "Kolumna dodana ręcznie.", type: Object.values(DATA_TYPES).includes(type) ? type : DATA_TYPES.TEXT, source: "manual", filterable: true, groupable: true, aggregatable: type === DATA_TYPES.NUMBER, hidden: false, width: DEFAULT_COLUMN_WIDTH };
        const nextRows = rows().map((row) => ({ ...row, [id]: null }));
        runCommand({
            label: `Dodanie kolumny ${field.label}`,
            redo: () => commitDataset(nextRows, [...fields(), field], "column-added"),
            undo: () => commitDataset(rows().map((row) => omitKey(row, id)), fields().filter((item) => item.id !== id), "column-added-undo")
        });
    }

    function formulaDependencies(definition, fieldList = fields()) {
        try { return PMA.formulaEngine.compile(definition.expression, fieldList).dependencies || []; }
        catch (_) { return []; }
    }

    function dependentFormulaLabels(fieldId) {
        return calculatedColumns().filter((definition) => definition.id !== fieldId && formulaDependencies(definition).includes(fieldId)).map((definition) => definition.label);
    }

    function replaceFormulaFieldReference(expression, oldLabel, newLabel) {
        const escaped = String(oldLabel).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return String(expression).replace(new RegExp(`\\[\\s*${escaped}\\s*\\]`, "gi"), `[${newLabel}]`);
    }

    function renameSelectedColumn() {
        const fieldId = el("workspaceColumnSelector")?.value;
        const currentFields = clonePlain(fields());
        const currentColumns = clonePlain(calculatedColumns());
        const index = currentFields.findIndex((field) => field.id === fieldId);
        if (index < 0) return;
        const name = global.prompt("Nowa nazwa kolumny:", currentFields[index].label);
        if (!name?.trim() || name.trim() === currentFields[index].label) return;
        if (currentFields.some((field) => field.id !== fieldId && normalizeComparableText(field.label) === normalizeComparableText(name))) {
            dom.showError("Kolumna o tej nazwie już istnieje.", "Zmiana nazwy kolumny");
            return;
        }
        const before = currentFields[index].label;
        const after = name.trim();
        const afterFields = currentFields.map((field) => field.id === fieldId ? { ...field, label: after } : field);
        const afterColumns = currentColumns.map((definition) => ({
            ...definition,
            label: definition.id === fieldId ? after : definition.label,
            expression: replaceFormulaFieldReference(definition.expression, before, after)
        }));
        const afterFieldDefinitions = afterFields.map((field) => field.source === "calculated"
            ? { ...field, description: `Formuła: ${afterColumns.find((item) => item.id === field.id)?.expression || field.expression || ""}` }
            : field);
        const recalc = (columnDefs, fieldDefs) => {
            state.setCalculatedColumns(columnDefs);
            formulaCache.clear();
            formulaPlanCache = null;
            const nextRows = rows().map((row) => { const next = { ...row }; recalculateFormulas(next, fieldDefs, columnDefs); return next; });
            commitDataset(nextRows, fieldDefs, "column-renamed");
        };
        runCommand({
            label: `Zmiana nazwy ${before}`,
            redo: () => recalc(afterColumns, afterFieldDefinitions),
            undo: () => recalc(currentColumns, currentFields)
        });
    }

    function moveSelectedColumn(direction) {
        const fieldId = el("workspaceColumnSelector")?.value;
        const currentFields = [...fields()];
        const index = currentFields.findIndex((field) => field.id === fieldId);
        const target = index + direction;
        if (index < 0 || target < 0 || target >= currentFields.length) return;
        const next = [...currentFields];
        [next[index], next[target]] = [next[target], next[index]];
        runCommand({ label: "Zmiana kolejności kolumn", redo: () => commitDataset(rows(), next, "column-moved"), undo: () => commitDataset(rows(), currentFields, "column-moved-undo") });
    }

    function toggleSelectedColumn() {
        const fieldId = el("workspaceColumnSelector")?.value;
        const field = fieldById(fieldId);
        if (!field) return;
        const next = fields().map((item) => item.id === fieldId ? { ...item, hidden: !item.hidden } : item);
        runCommand({ label: `${field.hidden ? "Pokazanie" : "Ukrycie"} kolumny`, redo: () => commitDataset(rows(), next, "column-visibility"), undo: () => commitDataset(rows(), fields().map((item) => item.id === fieldId ? { ...item, hidden: field.hidden } : item), "column-visibility-undo") });
    }

    function deleteSelectedColumn() {
        const fieldId = el("workspaceColumnSelector")?.value;
        const field = fieldById(fieldId);
        if (!field) return;
        if (["mapped", "derived", "internal"].includes(field.source) || (field.source === "source" && field.mappedTo?.length)) return;
        const dependents = dependentFormulaLabels(fieldId);
        if (dependents.length) {
            dom.showWarning(`Kolumna jest używana przez formuły: ${dependents.join(", ")}. Najpierw usuń lub zmień te formuły.`, "Usuwanie kolumny");
            return;
        }
        if (!global.confirm(`Usunąć kolumnę „${field.label}” z danych roboczych?`)) return;
        const beforeFields = clonePlain(fields());
        const beforeColumns = clonePlain(calculatedColumns());
        const index = beforeFields.findIndex((item) => item.id === fieldId);
        const values = rows().map((row) => ({ rowId: row.id, value: row[fieldId] }));
        const afterColumns = beforeColumns.filter((item) => item.id !== fieldId);
        runCommand({
            label: `Usunięcie kolumny ${field.label}`,
            redo: () => {
                state.setCalculatedColumns(afterColumns);
                formulaCache.clear();
                commitDataset(rows().map((row) => omitKey(row, fieldId)), beforeFields.filter((item) => item.id !== fieldId), "column-deleted");
            },
            undo: () => {
                const restoredFields = [...beforeFields];
                const valueMap = new Map(values.map((item) => [item.rowId, item.value]));
                state.setCalculatedColumns(beforeColumns);
                formulaCache.clear();
                commitDataset(rows().map((row) => ({ ...row, [fieldId]: valueMap.get(row.id) })), restoredFields, "column-deleted-undo");
            }
        });
    }

    function updateSelectedColumnWidth() {
        const fieldId = el("workspaceColumnSelector")?.value;
        const width = Math.max(70, Math.min(600, Number(el("workspaceColumnWidth")?.value) || DEFAULT_COLUMN_WIDTH));
        if (!fieldId) return;
        columnWidths.set(fieldId, width);
        renderGrid({ keepScroll: true });
        scheduleAutosave();
    }

    function addFilterFromControls() {
        const fieldId = el("workspaceFilterField")?.value;
        const operator = el("workspaceFilterOperator")?.value || "contains";
        const value = el("workspaceFilterValue")?.value || "";
        if (!fieldId || (!value && !["is-empty", "is-not-empty"].includes(operator))) return;
        if (["greater-than", "greater-or-equal", "less-than", "less-or-equal"].includes(operator)) {
            const field = fieldById(fieldId);
            const valid = field?.type === DATA_TYPES.DATE
                ? Boolean(parseDate(value, { allowExcelSerial: true, allowNumericStringExcelSerial: true }))
                : parseNumber(value) !== null;
            if (!valid) {
                dom.showWarning(field?.type === DATA_TYPES.DATE ? "Podaj poprawną datę graniczną." : "Podaj poprawną wartość liczbową.", "Filtr danych");
                return;
            }
        }
        filters.push({ id: createId("filter"), fieldId, operator, value });
        if (el("workspaceFilterValue")) el("workspaceFilterValue").value = "";
        renderFilterChips(); renderGrid({ resetScroll: true }); scheduleAutosave();
    }

    function syncFilterValueControl() {
        const emptyOperator = ["is-empty", "is-not-empty"].includes(el("workspaceFilterOperator")?.value);
        if (el("workspaceFilterValue")) el("workspaceFilterValue").disabled = emptyOperator;
    }

    function renderFilterChips() {
        const container = el("workspaceActiveFilters"); if (!container) return;
        container.replaceChildren();
        if (!filters.length) { container.innerHTML = '<span class="muted">Brak filtrów.</span>'; return; }
        filters.forEach((filter) => container.appendChild(createChip(`${fieldById(filter.fieldId)?.label || filter.fieldId} · ${operatorLabel(filter.operator)}${filter.value ? ` · ${filter.value}` : ""}`, () => {
            filters.splice(filters.findIndex((item) => item.id === filter.id), 1); renderFilterChips(); renderGrid({ resetScroll: true }); scheduleAutosave();
        })));
    }

    function addSortFromControls() {
        const fieldId = el("workspaceSortField")?.value;
        if (!fieldId) return;
        const existing = sorts.find((sort) => sort.fieldId === fieldId);
        if (existing) existing.direction = el("workspaceSortDirection")?.value || "asc";
        else sorts.push({ id: createId("sort"), fieldId, direction: el("workspaceSortDirection")?.value || "asc" });
        renderSortChips(); renderGrid({ resetScroll: true }); scheduleAutosave();
    }

    function renderSortChips() {
        const container = el("workspaceActiveSorts"); if (!container) return;
        container.replaceChildren();
        if (!sorts.length) { container.innerHTML = '<span class="muted">Brak sortowania.</span>'; return; }
        sorts.forEach((sort, index) => container.appendChild(createChip(`${index + 1}. ${fieldById(sort.fieldId)?.label || sort.fieldId} · ${sort.direction === "asc" ? "rosnąco" : "malejąco"}`, () => {
            sorts.splice(sorts.findIndex((item) => item.id === sort.id), 1); renderSortChips(); renderGrid({ resetScroll: true }); scheduleAutosave();
        })));
    }

    function createChip(text, onRemove) {
        const span = document.createElement("span"); span.className = "workspace-chip";
        span.appendChild(document.createTextNode(text));
        const button = document.createElement("button"); button.type = "button"; button.textContent = "×"; button.setAttribute("aria-label", "Usuń"); button.addEventListener("click", onRemove);
        span.appendChild(button); return span;
    }

    function operatorLabel(operator) {
        return ({ contains: "zawiera", equals: "równe", "not-equals": "różne", "starts-with": "zaczyna się", "ends-with": "kończy się", "greater-than": ">", "greater-or-equal": "≥", "less-than": "<", "less-or-equal": "≤", "is-empty": "puste", "is-not-empty": "niepuste" })[operator] || operator;
    }

    function updateSelectionStatus() {
        const bounds = selectionBounds();
        if (!bounds) { setText("workspaceSelectionStatus", "Brak zaznaczenia"); return; }
        setText("workspaceSelectionStatus", `${bounds.rowEnd - bounds.rowStart + 1} × ${bounds.colEnd - bounds.colStart + 1} komórek · ${selectedRowIds.size} zaznaczonych wierszy`);
    }
    function updateDeleteRowsButton() { if (el("workspaceDeleteRowsButton")) el("workspaceDeleteRowsButton").disabled = selectedRowIds.size === 0; }

    /* ---------------- Transformations ---------------- */
    function bindTransformations() {
        bindId("workspacePreviewTransformButton", "click", previewTransformation);
        bindId("workspaceApplyTransformButton", "click", applyTransformation);
    }

    function transformationConfig() {
        return {
            fieldId: el("workspaceTransformField")?.value,
            scope: el("workspaceTransformScope")?.value || "all",
            operation: el("workspaceTransformOperation")?.value || "trim",
            arg1: el("workspaceTransformArg1")?.value || "",
            arg2: el("workspaceTransformArg2")?.value || ""
        };
    }

    function scopeRows(scope) {
        if (scope === "filtered") return filteredAndSortedRows().map((item) => item.row);
        if (scope === "selected") {
            const bounds = selectionBounds();
            if (bounds) return bounds.data.slice(bounds.rowStart, bounds.rowEnd + 1).map((item) => item.row);
            return rows().filter((row) => selectedRowIds.has(row.id));
        }
        return rows();
    }

    function previewTransformation() {
        try {
            currentTransformPreview = buildTransformation(transformationConfig(), false);
            setText("workspaceTransformPreview", currentTransformPreview.description);
        } catch (error) {
            currentTransformPreview = null;
            setText("workspaceTransformPreview", normalizeError(error).message);
        }
    }

    function applyTransformation() {
        try {
            const result = buildTransformation(transformationConfig(), true);
            if (!result.affected) { setText("workspaceTransformPreview", "Brak wartości do zmiany."); return; }
            if (result.kind === "patch") executePatchCommand(result.label, result.patches, result.step);
            else executeRowsCommand(result.label, result.nextRows, result.step);
            setText("workspaceTransformPreview", result.description);
        } catch (error) {
            dom.showError(normalizeError(error).message, "Transformacja danych");
        }
    }

    function buildTransformation(config) {
        const field = fieldById(config.fieldId);
        if (!field) throw new Error("Wybierz kolumnę.");
        const targetRows = scopeRows(config.scope);
        const operation = config.operation;
        const label = `${transformationLabel(operation)} · ${field.label}`;
        if (operation === "remove-empty") {
            const targetIds = new Set(targetRows.filter((row) => isBlank(row[field.id])).map((row) => row.id));
            return rowsTransformationResult(label, targetIds, config, `Usunięte zostaną ${targetIds.size} wiersze z pustą wartością.`);
        }
        if (operation === "remove-duplicates") {
            const seen = new Set(); const targetIds = new Set(); const fieldIds = nonInternalFields().map((item) => item.id);
            targetRows.forEach((row) => {
                const key = JSON.stringify(fieldIds.map((id) => row[id] ?? null));
                if (seen.has(key)) targetIds.add(row.id); else seen.add(key);
            });
            return rowsTransformationResult(label, targetIds, config, `Usunięte zostaną ${targetIds.size} pełne duplikaty.`);
        }
        const patches = [];
        if (["fill-down", "fill-up"].includes(operation)) {
            const ordered = operation === "fill-up" ? [...targetRows].reverse() : targetRows;
            let carried = null;
            ordered.forEach((row) => {
                const value = row[field.id];
                if (!isBlank(value)) carried = value;
                else if (!isBlank(carried)) patches.push({ rowId: row.id, fieldId: field.id, oldValue: value, newValue: carried });
            });
        } else {
            targetRows.forEach((row) => {
                const oldValue = row[field.id];
                const newValue = transformValue(oldValue, operation, config.arg1, config.arg2, field);
                if (!sameValue(oldValue, newValue)) patches.push({ rowId: row.id, fieldId: field.id, oldValue, newValue });
            });
        }
        const expanded = expandPatchesForSynchronization(patches);
        return {
            kind: "patch", label, patches: expanded, affected: patches.length,
            description: `${transformationLabel(operation)} zmieni ${formatInteger(patches.length)} wartości w kolumnie „${field.label}”.`,
            step: createTransformationStep(label, config, patches.length)
        };
    }

    function rowsTransformationResult(label, targetIds, config, description) {
        return {
            kind: "rows", label, nextRows: rows().filter((row) => !targetIds.has(row.id)), affected: targetIds.size, description,
            step: createTransformationStep(label, config, targetIds.size)
        };
    }

    function transformValue(value, operation, arg1, arg2, field) {
        if (operation === "replace") {
            const source = String(value ?? "");
            if (!arg1) return source;
            if (/^\/.+\/[gimsuy]*$/.test(arg1)) {
                const last = arg1.lastIndexOf("/");
                return source.replace(new RegExp(arg1.slice(1, last), arg1.slice(last + 1)), arg2);
            }
            return source.split(arg1).join(arg2);
        }
        if (operation === "trim") return String(value ?? "").trim();
        if (operation === "clean") return String(value ?? "").replace(/[\u0000-\u001F\u007F]/g, "");
        if (operation === "upper") return String(value ?? "").toLocaleUpperCase("pl-PL");
        if (operation === "lower") return String(value ?? "").toLocaleLowerCase("pl-PL");
        if (operation === "proper") return String(value ?? "").toLocaleLowerCase("pl-PL").replace(/(^|[\s\-])\p{L}/gu, (match) => match.toLocaleUpperCase("pl-PL"));
        if (operation === "number") return parseNumber(value);
        if (operation === "date") { const date = parseDate(value, { allowExcelSerial: true, allowNumericStringExcelSerial: true }); return date ? toISODate(date) : value; }
        if (operation === "round") { const number = parseNumber(value); if (number === null) return value; const digits = Math.max(-10, Math.min(10, Math.trunc(parseNumber(arg1) || 0))); return round(number, digits); }
        if (operation === "abs") { const number = parseNumber(value); return number === null ? value : Math.abs(number); }
        return normalizeEditedValue(value, field);
    }

    function expandPatchesForSynchronization(patches) {
        const result = [];
        patches.forEach((patch) => {
            const row = rowById(patch.rowId); const field = fieldById(patch.fieldId);
            if (!row || !field) return;
            const nextRow = { ...row, [patch.fieldId]: patch.newValue };
            synchronizeMappedFields(nextRow, field); recalculateFormulas(nextRow);
            Object.keys(nextRow).forEach((fieldId) => {
                if (!sameValue(row[fieldId], nextRow[fieldId])) result.push({ rowId: row.id, fieldId, oldValue: row[fieldId], newValue: nextRow[fieldId] });
            });
        });
        return dedupePatches(result);
    }

    function createTransformationStep(label, config, affected) {
        return { id: createId("step"), label, operation: config.operation, fieldId: config.fieldId, scope: config.scope, args: [config.arg1, config.arg2], affected, appliedAt: new Date().toISOString() };
    }

    function renderTransformationHistory() {
        const list = el("workspaceTransformHistory"); if (!list) return;
        list.replaceChildren();
        const steps = transformationSteps();
        if (!steps.length) { list.innerHTML = "<li>Brak kroków.</li>"; return; }
        steps.forEach((step, index) => {
            const li = document.createElement("li");
            li.innerHTML = `<strong>${index + 1}. ${escapeHtml(step.label)}</strong><span>${formatInteger(step.affected || 0)} zmian · ${escapeHtml(formatDateTimeLocal(step.appliedAt))}</span>`;
            list.appendChild(li);
        });
    }

    function transformationLabel(operation) {
        return ({ replace: "Zamiana tekstu", trim: "Trim", clean: "Clean", upper: "Wielkie litery", lower: "Małe litery", proper: "Proper case", "fill-down": "Wypełnienie w dół", "fill-up": "Wypełnienie w górę", number: "Konwersja na liczbę", date: "Konwersja na datę", round: "Zaokrąglenie", abs: "Wartość bezwzględna", "remove-empty": "Usunięcie pustych wierszy", "remove-duplicates": "Usunięcie duplikatów" })[operation] || operation;
    }

    /* ---------------- Calculated columns ---------------- */
    function bindFormulas() {
        bindId("workspacePreviewFormulaButton", "click", previewFormula);
        bindId("workspaceAddFormulaButton", "click", addFormulaColumn);
        bindId("workspaceFormulaList", "click", handleFormulaListClick);
    }

    function formulaInput() {
        return { name: cleanText(el("workspaceFormulaName")?.value), type: el("workspaceFormulaType")?.value || DATA_TYPES.NUMBER, expression: el("workspaceFormulaExpression")?.value || "" };
    }

    function previewFormula() {
        try {
            const input = formulaInput();
            if (!input.expression.trim()) throw new Error("Wprowadź formułę.");
            const compiled = PMA.formulaEngine.compile(input.expression, fields());
            const sample = rows().slice(0, 5).map((row) => compiled.evaluate(row));
            setText("workspaceFormulaPreview", `Podgląd pierwszych wyników: ${sample.map((value) => formatRaw(value)).join(" · ") || "brak wierszy"}`);
        } catch (error) { setText("workspaceFormulaPreview", normalizeError(error).message); }
    }

    function addFormulaColumn() {
        try {
            const input = formulaInput();
            if (!input.name) throw new Error("Podaj nazwę kolumny.");
            if (!input.expression.trim()) throw new Error("Wprowadź formułę.");
            if (fields().some((field) => normalizeComparableText(field.label) === normalizeComparableText(input.name))) throw new Error("Kolumna o tej nazwie już istnieje.");
            const id = createId("calc").replace(/-/g, "_");
            const definition = { id, label: input.name, type: input.type, expression: input.expression.trim(), createdAt: new Date().toISOString() };
            const field = { ...definition, source: "calculated", description: `Formuła: ${definition.expression}`, filterable: true, groupable: true, aggregatable: input.type === DATA_TYPES.NUMBER, hidden: false, width: DEFAULT_COLUMN_WIDTH };
            const previousColumns = calculatedColumns();
            const nextColumns = [...previousColumns, definition];
            const nextFields = [...fields(), field];
            getFormulaPlan(nextFields, nextColumns);
            const nextRows = rows().map((row) => {
                const next = { ...row };
                recalculateFormulas(next, nextFields, nextColumns, { throwOnPlanError: true });
                return next;
            });
            runCommand({
                label: `Kolumna obliczeniowa ${input.name}`,
                redo: () => { state.setCalculatedColumns(nextColumns); commitDataset(nextRows, nextFields, "formula-added"); },
                undo: () => { state.setCalculatedColumns(previousColumns); commitDataset(rows().map((row) => omitKey(row, id)), fields().filter((item) => item.id !== id), "formula-added-undo"); }
            });
            if (el("workspaceFormulaName")) el("workspaceFormulaName").value = "";
            if (el("workspaceFormulaExpression")) el("workspaceFormulaExpression").value = "";
            setText("workspaceFormulaPreview", `Dodano kolumnę „${input.name}”.`);
        } catch (error) { dom.showError(normalizeError(error).message, "Kolumna obliczeniowa"); }
    }

    function handleFormulaListClick(event) {
        const button = event.target.closest("[data-remove-formula]");
        if (!button) return;
        const id = button.dataset.removeFormula;
        if (el("workspaceColumnSelector")) el("workspaceColumnSelector").value = id;
        deleteSelectedColumn();
    }

    function renderFormulaList() {
        const body = el("workspaceFormulaList"); if (!body) return;
        body.replaceChildren();
        calculatedColumns().forEach((definition) => {
            const tr = document.createElement("tr");
            tr.innerHTML = `<td>${escapeHtml(definition.label)}</td><td>${escapeHtml(definition.type)}</td><td><code>${escapeHtml(definition.expression)}</code></td><td><button class="button button-ghost button-small" type="button" data-remove-formula="${escapeHtml(definition.id)}">Usuń</button></td>`;
            body.appendChild(tr);
        });
        if (!calculatedColumns().length) body.innerHTML = '<tr><td colspan="4">Brak kolumn obliczeniowych.</td></tr>';
    }

    function coerceFormulaResult(value, type) {
        if (type === DATA_TYPES.NUMBER) return parseNumber(value);
        if (type === DATA_TYPES.DATE) { const date = parseDate(value, { allowExcelSerial: true, allowNumericStringExcelSerial: true }); return date ? toISODate(date) : null; }
        if (type === DATA_TYPES.BOOLEAN) {
            if (typeof value === "boolean") return value;
            if (typeof value === "number") return value !== 0;
            const normalized = normalizeComparableText(value);
            if (["false", "fałsz", "falsz", "nie", "no", "0", ""].includes(normalized)) return false;
            if (["true", "prawda", "tak", "yes", "1"].includes(normalized)) return true;
            return Boolean(value);
        }
        return value === null || value === undefined ? null : String(value);
    }

    /* ---------------- Error repair ---------------- */
    function bindErrors() {
        bindId("workspaceErrorsBody", "input", handleErrorCellInput);
        bindId("workspaceErrorsBody", "click", handleErrorAction);
        bindId("workspaceRevalidateAllButton", "click", revalidateAllErrors);
    }

    function renderErrors() {
        const head = el("workspaceErrorsHead"), body = el("workspaceErrorsBody");
        if (!head || !body) return;
        const headers = state.get("import.headers", []);
        const records = [...invalidRows(), ...duplicateRows()];
        const tr = document.createElement("tr");
        tr.innerHTML = `<th>Wiersz</th><th>Błąd</th>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}<th>Akcja</th>`;
        head.replaceChildren(tr); body.replaceChildren();
        records.slice(0, 1000).forEach((record) => {
            const row = document.createElement("tr");
            row.dataset.invalidId = record.id;
            row.innerHTML = `<td>${escapeHtml(record.sourceRow)}</td><td class="workspace-error-message">${escapeHtml((record.errorMessages || []).join("; "))}</td>${headers.map((header) => `<td contenteditable="true" data-error-field="${escapeHtml(header)}">${escapeHtml(record.sourceValues?.[header] ?? "")}</td>`).join("")}<td><button class="button button-primary button-small" type="button" data-revalidate-row="${escapeHtml(record.id)}">Waliduj</button></td>`;
            body.appendChild(row);
        });
        if (!records.length) body.innerHTML = `<tr><td colspan="${headers.length + 3}">Brak błędnych wierszy.</td></tr>`;
        setText("workspaceErrorsStatus", records.length ? `${formatInteger(records.length)} wierszy wymaga poprawy. Wyświetlany limit: 1000.` : "Brak błędnych wierszy.");
        setText("workspaceErrorCount", records.length);
    }

    function handleErrorCellInput(event) {
        const cell = event.target.closest("[data-error-field]"); if (!cell) return;
        const record = [...invalidRows(), ...duplicateRows()].find((item) => item.id === cell.closest("tr")?.dataset.invalidId);
        if (record) {
            record.sourceValues[cell.dataset.errorField] = cell.textContent;
            scheduleAutosave();
        }
    }

    function handleErrorAction(event) {
        const button = event.target.closest("[data-revalidate-row]");
        if (button) revalidateErrorRecord(button.dataset.revalidateRow);
    }

    function revalidateAllErrors() {
        const ids = [...invalidRows(), ...duplicateRows()].map((record) => record.id);
        let fixed = 0;
        ids.forEach((id) => { if (revalidateErrorRecord(id, { silent: true })) fixed += 1; });
        dom.showInfo(`Poprawiono ${fixed} z ${ids.length} wierszy.`, "Ponowna walidacja");
        renderErrors();
    }

    function revalidateErrorRecord(recordId, options = {}) {
        const invalid = invalidRows(); const duplicates = duplicateRows();
        const record = [...invalid, ...duplicates].find((item) => item.id === recordId);
        if (!record) return false;
        const mapping = state.get("mapping.values", {});
        const headers = state.get("import.headers", Object.keys(record.sourceValues || {}));
        const mapped = Object.fromEntries(SYSTEM_FIELDS.map((field) => [field.id, mapping[field.id] ? record.sourceValues?.[mapping[field.id]] : null]));
        const result = PMA.normalizationEngine.normalizeSingleRecord(mapped, {
            sourceRowNumber: record.sourceRow,
            sourceFile: record.sourceFile,
            sourceSheet: record.sourceSheet,
            sourceValues: record.sourceValues,
            headers,
            sourceRow: headers.map((header) => record.sourceValues?.[header])
        });
        if (!result.valid) {
            record.errors = result.errors;
            record.errorMessages = result.errors.map((code) => VALIDATION_MESSAGES[code] || code);
            if (!options.silent) dom.showWarning(record.errorMessages.join(" "), "Wiersz nadal zawiera błędy");
            scheduleAutosave();
            return false;
        }
        const duplicate = result.record.duplicateKey && rows().some((item) => item.duplicateKey === result.record.duplicateKey);
        if (duplicate) {
            record.errors = ["DUPLICATE_RECORD"];
            record.errorMessages = [VALIDATION_MESSAGES.DUPLICATE_RECORD || "Duplikat rekordu."];
            if (!options.silent) dom.showWarning(record.errorMessages[0], "Wiersz nadal jest duplikatem");
            scheduleAutosave();
            return false;
        }
        const nextInvalid = invalid.filter((item) => item.id !== recordId);
        const nextDuplicates = duplicates.filter((item) => item.id !== recordId);
        commitDataset([...rows(), result.record], fields(), "invalid-row-fixed", { invalidRows: nextInvalid, duplicateRows: nextDuplicates });
        updateValidationSummary(nextInvalid, nextDuplicates);
        if (!options.silent) dom.showSuccess(`Wiersz ${record.sourceRow} przeniesiono do poprawnych danych.`, "Walidacja zakończona");
        return true;
    }

    function updateValidationSummary(nextInvalid, nextDuplicates) {
        const current = state.get("validation", {});
        state.setValidationResult({ ...current, completed: true, totalRows: rows().length + nextInvalid.length + nextDuplicates.length, validRows: rows().length, invalidRows: nextInvalid.length, duplicateRows: nextDuplicates.length, invalidRecords: nextInvalid, duplicateRecords: nextDuplicates });
    }

    /* ---------------- Quality ---------------- */
    function bindQuality() { bindId("workspaceRefreshQualityButton", "click", renderQuality); }
    function renderQuality() {
        const body = el("workspaceQualityBody"); if (!body) return;
        const data = rows(); const columns = nonInternalFields();
        let emptyCount = 0;
        const duplicateCount = countDuplicates(data, columns);
        setText("workspaceQualityRows", formatInteger(data.length)); setText("workspaceQualityColumns", formatInteger(columns.length)); setText("workspaceQualityDuplicates", formatInteger(duplicateCount));
        body.replaceChildren();
        columns.forEach((field) => {
            const values = data.map((row) => row[field.id]);
            const nonEmpty = values.filter((value) => !isBlank(value));
            const empty = values.length - nonEmpty.length; emptyCount += empty;
            const unique = new Set(nonEmpty.map((value) => normalizeComparableText(value))).size;
            const numbers = nonEmpty.map(parseNumber).filter((value) => value !== null);
            const score = values.length ? Math.round((1 - empty / values.length) * 100) : 0;
            const tr = document.createElement("tr");
            tr.innerHTML = `<td>${escapeHtml(field.label)}</td><td>${escapeHtml(field.type || "text")}</td><td>${formatInteger(empty)}</td><td>${formatInteger(unique)}</td><td>${numbers.length ? formatNumber(numbers.reduce((minimum, value) => Math.min(minimum, value), Infinity)) : "—"}</td><td>${numbers.length ? formatNumber(numbers.reduce((maximum, value) => Math.max(maximum, value), -Infinity)) : "—"}</td><td>${numbers.length ? formatNumber(numbers.reduce((sum, value) => sum + value, 0) / numbers.length) : "—"}</td><td><span class="status-badge ${score >= 95 ? "status-success" : score >= 75 ? "status-warning" : "status-danger"}">${score}%</span></td>`;
            body.appendChild(tr);
        });
        setText("workspaceQualityEmpty", formatInteger(emptyCount));
    }

    function countDuplicates(data, columns) {
        const seen = new Set(); let duplicates = 0; const ids = columns.map((field) => field.id);
        data.forEach((row) => { const key = JSON.stringify(ids.map((id) => row[id] ?? null)); if (seen.has(key)) duplicates += 1; else seen.add(key); });
        return duplicates;
    }

    /* ---------------- Stock snapshots ---------------- */
    function bindStock() {
        bindId("workspaceStockFileInput", "change", handleStockFile);
        bindId("workspaceApplyStockMappingButton", "click", () => {
            try { applyStockMapping(); } catch (error) { dom.showError(normalizeError(error).message, "Mapowanie zapasów"); }
        });
        bindId("workspaceClearStockButton", "click", clearStockDataset);
    }

    async function handleStockFile(event) {
        const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
        try {
            const buffer = await file.arrayBuffer();
            const workbook = global.XLSX.read(buffer, { type: "array", cellDates: true, raw: true });
            const sheetName = workbook.SheetNames[0];
            const matrix = global.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true, defval: "", blankrows: false });
            if (matrix.length < 2) throw new Error("Plik zapasów nie zawiera danych.");
            const headers = makeUniqueHeaders(matrix[0]);
            stockImportBuffer = { fileName: file.name, sheetName, headers, rows: matrix.slice(1).filter((row) => row.some((value) => !isBlank(value))) };
            [
                "workspaceStockMaterialField", "workspaceStockValueField", "workspaceStockDateField", "workspaceStockUnitField",
                "workspaceStockLeadTimeField", "workspaceStockMoqField", "workspaceStockMultipleField", "workspaceStockSafetyField",
                "workspaceStockOpenOrdersField", "workspaceStockSupplierField"
            ].forEach((id) => populateHeaderSelect(el(id), headers, !["workspaceStockMaterialField", "workspaceStockValueField"].includes(id)));
            autoSelectStockFields(headers);
            if (el("workspaceStockMapping")) el("workspaceStockMapping").hidden = false;
            setText("workspaceStockStatus", `Wczytano ${formatInteger(stockImportBuffer.rows.length)} wierszy z pliku „${file.name}”. Ustaw mapowanie.`);
        } catch (error) { dom.showError(normalizeError(error).message, "Import zapasów"); }
    }

    function populateHeaderSelect(select, headers, optional) {
        if (!select) return;
        select.replaceChildren();
        const option = document.createElement("option");
        option.value = "";
        option.textContent = optional ? "— brak —" : "— wybierz —";
        select.appendChild(option);
        headers.forEach((header, index) => { const item = document.createElement("option"); item.value = String(index); item.textContent = header; select.appendChild(item); });
        select.value = "";
    }

    function autoSelectStockFields(headers) {
        const pick = (id, aliases) => {
            const index = headers.findIndex((header) => aliases.some((alias) => normalizeComparableText(header).includes(alias)));
            if (index >= 0 && el(id)) el(id).value = String(index);
        };
        pick("workspaceStockMaterialField", ["material", "materiał", "nazwa", "item"]);
        pick("workspaceStockValueField", ["stan", "stock", "zapas", "inventory", "on hand"]);
        pick("workspaceStockDateField", ["data", "date", "snapshot"]);
        pick("workspaceStockUnitField", ["jednostka", "unit", "uom"]);
        pick("workspaceStockLeadTimeField", ["lead time", "czas dostawy", "dni dostawy"]);
        pick("workspaceStockMoqField", ["moq", "minimum order", "minimalne zamówienie"]);
        pick("workspaceStockMultipleField", ["krotność", "krotnosc", "order multiple", "pack multiple"]);
        pick("workspaceStockSafetyField", ["safety stock", "zapas bezpieczeństwa", "zapas bezpieczenstwa"]);
        pick("workspaceStockOpenOrdersField", ["open orders", "otwarte zamówienia", "otwarte zamowienia", "w drodze"]);
        pick("workspaceStockSupplierField", ["supplier", "dostawca", "vendor"]);
    }

    function applyStockMapping() {
        if (!stockImportBuffer) throw new Error("Najpierw wybierz plik zapasów.");
        const requiredIndex = (id) => {
            const raw = el(id)?.value;
            return raw === "" || raw == null ? null : Number(raw);
        };
        const materialIndex = requiredIndex("workspaceStockMaterialField");
        const stockIndex = requiredIndex("workspaceStockValueField");
        const optionalIndex = (id) => el(id)?.value === "" ? null : Number(el(id)?.value);
        const dateIndex = optionalIndex("workspaceStockDateField");
        const unitIndex = optionalIndex("workspaceStockUnitField");
        const leadTimeIndex = optionalIndex("workspaceStockLeadTimeField");
        const moqIndex = optionalIndex("workspaceStockMoqField");
        const multipleIndex = optionalIndex("workspaceStockMultipleField");
        const safetyIndex = optionalIndex("workspaceStockSafetyField");
        const openOrdersIndex = optionalIndex("workspaceStockOpenOrdersField");
        const supplierIndex = optionalIndex("workspaceStockSupplierField");
        if (!Number.isInteger(materialIndex) || !Number.isInteger(stockIndex)) throw new Error("Wybierz kolumnę materiału i stanu zapasu.");
        const rejected = [];
        const normalized = stockImportBuffer.rows.map((row, index) => {
            const material = cleanText(row[materialIndex]);
            const stock = parseNumber(row[stockIndex]);
            const parsedDate = dateIndex === null ? new Date() : parseDate(row[dateIndex], { allowExcelSerial: true, allowNumericStringExcelSerial: true });
            if (!material || stock === null || !Number.isFinite(stock) || stock < 0 || (dateIndex !== null && !parsedDate)) {
                rejected.push(index + 2);
                return null;
            }
            const nonNegative = (columnIndex) => {
                if (columnIndex === null) return null;
                const value = parseNumber(row[columnIndex]);
                return value === null ? null : Math.max(0, value);
            };
            return {
                id: createId("stock"), material, stockLevel: stock,
                date: toISODate(parsedDate || new Date()),
                unit: unitIndex === null ? null : cleanText(row[unitIndex]),
                leadTimeDays: nonNegative(leadTimeIndex),
                minimumOrderQuantity: nonNegative(moqIndex),
                orderMultiple: nonNegative(multipleIndex),
                safetyStock: nonNegative(safetyIndex),
                openOrders: nonNegative(openOrdersIndex),
                supplier: supplierIndex === null ? null : cleanText(row[supplierIndex]),
                sourceFile: stockImportBuffer.fileName, sourceSheet: stockImportBuffer.sheetName, sourceRow: index + 2
            };
        }).filter(Boolean);
        if (!normalized.length) throw new Error("Nie znaleziono poprawnych snapshotów zapasu.");
        state.setStockDataset(normalized, [
            { id: "material", label: "Materiał", type: DATA_TYPES.TEXT },
            { id: "stockLevel", label: "Stan zapasu", type: DATA_TYPES.NUMBER },
            { id: "date", label: "Data", type: DATA_TYPES.DATE },
            { id: "unit", label: "Jednostka", type: DATA_TYPES.TEXT },
            { id: "leadTimeDays", label: "Lead time (dni)", type: DATA_TYPES.NUMBER },
            { id: "minimumOrderQuantity", label: "MOQ", type: DATA_TYPES.NUMBER },
            { id: "orderMultiple", label: "Krotność zamówienia", type: DATA_TYPES.NUMBER },
            { id: "safetyStock", label: "Safety stock", type: DATA_TYPES.NUMBER },
            { id: "openOrders", label: "Otwarte zamówienia", type: DATA_TYPES.NUMBER },
            { id: "supplier", label: "Dostawca", type: DATA_TYPES.TEXT }
        ]);
        const suffix = rejected.length ? ` Pominięto ${rejected.length} błędnych wierszy (${rejected.slice(0, 8).join(", ")}${rejected.length > 8 ? ", …" : ""}).` : "";
        setText("workspaceStockStatus", `Zapisano ${formatInteger(normalized.length)} poprawnych snapshotów zapasu.${suffix}`);
        renderStockTable(); scheduleAutosave(); scheduleAnalysisRefresh();
    }

    function clearStockDataset() {
        if (!stockRows().length) return;
        if (!global.confirm("Usunąć osobną tabelę zapasów z projektu?")) return;
        state.setStockDataset([], []);
        stockImportBuffer = null;
        if (el("workspaceStockMapping")) el("workspaceStockMapping").hidden = true;
        setText("workspaceStockStatus", "Usunięto osobną tabelę zapasów. Analiza użyje pola zapasu z danych głównych, jeśli jest zmapowane.");
        renderStockTable(); scheduleAutosave(); scheduleAnalysisRefresh();
    }

    function renderStockTable() {
        const body = el("workspaceStockBody"); if (!body) return; body.replaceChildren();
        stockRows().slice(0, 1000).forEach((row) => {
            const tr = document.createElement("tr");
            tr.innerHTML = [
                `<td>${escapeHtml(row.material)}</td>`,
                `<td class="is-number">${formatNumber(row.stockLevel)}</td>`,
                `<td>${escapeHtml(row.date || "—")}</td>`,
                `<td>${escapeHtml(row.unit || "—")}</td>`,
                `<td class="is-number">${row.leadTimeDays == null ? "—" : formatNumber(row.leadTimeDays)}</td>`,
                `<td class="is-number">${row.minimumOrderQuantity == null ? "—" : formatNumber(row.minimumOrderQuantity)}</td>`,
                `<td class="is-number">${row.orderMultiple == null ? "—" : formatNumber(row.orderMultiple)}</td>`,
                `<td class="is-number">${row.safetyStock == null ? "—" : formatNumber(row.safetyStock)}</td>`,
                `<td class="is-number">${row.openOrders == null ? "—" : formatNumber(row.openOrders)}</td>`,
                `<td>${escapeHtml(row.supplier || "—")}</td>`,
                `<td>${escapeHtml(row.sourceFile || "—")}</td>`
            ].join("");
            body.appendChild(tr);
        });
        if (!stockRows().length) body.innerHTML = '<tr><td colspan="11">Nie wczytano osobnej tabeli zapasów.</td></tr>';
    }

    /* ---------------- Projects / persistence ---------------- */
    function bindProjects() {
        bindId("workspaceSaveProjectButton", "click", saveCurrentProject);
        bindId("workspaceNewProjectButton", "click", () => PMA.app?.resetWorkspace?.());
        bindId("workspaceExportJsonButton", "click", exportWorkspaceJson);
        bindId("dataLabWorkspaceInput", "change", importWorkspaceJson);
        bindId("workspaceProjectList", "click", handleProjectListAction);
        bindId("workspaceProjectName", "input", scheduleAutosave);
    }

    function serializeWorkspace() {
        return {
            schema: "materials-analytics-workspace",
            schemaVersion: 4,
            appVersion: PMA.constants.APP.version,
            project: { id: projectId, name: cleanText(el("workspaceProjectName")?.value) || "Nowy projekt", createdAt: projectCreatedAt },
            import: {
                fileMeta: clonePlain(state.get("import.fileMeta", {})),
                selectedSheet: state.get("import.selectedSheet", ""),
                headers: clonePlain(state.get("import.headers", [])),
                detectedTypes: clonePlain(state.get("import.detectedTypes", {})),
                headerRowIndex: state.get("import.headerRowIndex", 0),
                sourceRowNumbers: clonePlain(state.get("import.sourceRowNumbers", [])),
                rowProvenance: clonePlain(state.get("import.rowProvenance", [])),
                sheetProvenance: clonePlain(state.get("import.sheetProvenance", {}))
            },
            mapping: clonePlain(state.get("mapping", {})),
            dataset: {
                normalizedRows: clonePlain(rows()), invalidRows: clonePlain(invalidRows()), duplicateRows: clonePlain(duplicateRows()), fields: clonePlain(fields()), stockRows: clonePlain(stockRows()), stockFields: clonePlain(state.get("dataset.stockFields", [])), calculatedColumns: clonePlain(calculatedColumns()), transformationSteps: clonePlain(transformationSteps())
            },
            filters: clonePlain(state.get("filters", {})),
            analysis: clonePlain(state.get("analysis", {})),
            smartAnalyticsResult: clonePlain(state.get("smartAnalytics.result", null)),
            editor: { viewMode, filters: clonePlain(filters), sorts: clonePlain(sorts), columnWidths: Object.fromEntries(columnWidths) },
            savedAt: new Date().toISOString()
        };
    }

    async function recoverAutosaveIfNeeded() {
        if (rows().length) return;
        try {
            const autosave = await PMA.workspaceStorage.loadAutosave();
            if (!autosave?.dataset?.normalizedRows?.length) return;
            const answer = global.confirm(`Znaleziono automatyczny zapis projektu „${autosave.project?.name || autosave.name || "bez nazwy"}” z ${formatDateTimeLocal(autosave.updatedAt)}. Przywrócić?`);
            if (answer) restoreWorkspace(autosave);
        } catch (_) { /* recovery is optional */ }
    }

    async function saveCurrentProject() {
        try {
            const payload = serializeWorkspace();
            const saved = await PMA.workspaceStorage.saveProject({ ...payload, id: projectId || undefined, name: payload.project.name, createdAt: projectCreatedAt || undefined, rowCount: rows().length });
            projectId = saved.id; projectCreatedAt = saved.createdAt;
            setText("workspacePersistenceStatus", `Projekt „${saved.name}” zapisano ${formatDateTimeLocal(saved.updatedAt)}.`);
            await renderProjectList();
        } catch (error) { dom.showError(normalizeError(error).message, "Zapis projektu"); }
    }

    function scheduleAutosave() {
        clearTimeout(autosaveTimer);
        if (!rows().length) return;
        autosaveTimer = global.setTimeout(async () => {
            try {
                const payload = serializeWorkspace();
                await PMA.workspaceStorage.saveAutosave({ ...payload, name: payload.project.name, rowCount: rows().length });
                setText("workspacePersistenceStatus", `Automatycznie zapisano ${formatDateTimeLocal(new Date().toISOString())}.`);
            } catch (_) { setText("workspacePersistenceStatus", "Automatyczny zapis nie powiódł się. Użyj eksportu JSON."); }
        }, 1000);
    }

    async function renderProjectList() {
        const body = el("workspaceProjectList"); if (!body) return;
        try {
            const projects = await PMA.workspaceStorage.listProjects({ includeAutosave: true });
            body.replaceChildren();
            projects.forEach((project) => {
                const tr = document.createElement("tr");
                tr.innerHTML = `<td>${project.id === PMA.workspaceStorage.AUTOSAVE_ID ? "⟳ " : ""}${escapeHtml(project.name)}</td><td>${escapeHtml(formatDateTimeLocal(project.updatedAt))}</td><td>${formatInteger(project.rowCount || project.dataset?.normalizedRows?.length || 0)}</td><td><button class="button button-primary button-small" type="button" data-load-project="${escapeHtml(project.id)}">Otwórz</button>${project.id === PMA.workspaceStorage.AUTOSAVE_ID ? "" : `<button class="button button-ghost button-small" type="button" data-delete-project="${escapeHtml(project.id)}">Usuń</button>`}</td>`;
                body.appendChild(tr);
            });
            if (!projects.length) body.innerHTML = '<tr><td colspan="4">Brak zapisanych projektów.</td></tr>';
        } catch (error) { body.innerHTML = `<tr><td colspan="4">${escapeHtml(normalizeError(error).message)}</td></tr>`; }
    }

    async function handleProjectListAction(event) {
        const load = event.target.closest("[data-load-project]");
        if (load) {
            const payload = await PMA.workspaceStorage.loadProject(load.dataset.loadProject);
            if (payload) restoreWorkspace(payload);
            return;
        }
        const remove = event.target.closest("[data-delete-project]");
        if (remove && global.confirm("Usunąć zapisany projekt?")) { await PMA.workspaceStorage.deleteProject(remove.dataset.deleteProject); renderProjectList(); }
    }

    function exportWorkspaceJson() {
        const payload = serializeWorkspace();
        downloadBlob(JSON.stringify(payload, null, 2), createExportFileName(cleanText(el("workspaceProjectName")?.value) || "workspace", "json"), "application/json");
    }

    async function importWorkspaceJson(event) {
        const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
        try { restoreWorkspace(JSON.parse(await file.text())); dom.showSuccess(`Zaimportowano workspace „${file.name}”.`, "Import projektu"); }
        catch (error) { dom.showError(normalizeError(error).message, "Import workspace"); }
    }


    function resetEditorRuntimeForRestore() {
        clearTimeout(autosaveTimer);
        clearTimeout(analysisRefreshTimer);
        undoStack.length = 0;
        redoStack.length = 0;
        selectedRowIds.clear();
        filters.length = 0;
        sorts.length = 0;
        columnWidths.clear();
        formulaCache.clear();
        formulaPlanCache = null;
        activeCell = null;
        selectionAnchor = null;
        searchText = "";
        stockImportBuffer = null;
        currentTransformPreview = null;
        if (el("workspaceSearchInput")) el("workspaceSearchInput").value = "";
        if (el("workspaceTransformPreview")) el("workspaceTransformPreview").textContent = "Najpierw przygotuj podgląd operacji.";
    }

    function restoreWorkspace(payload) {
        if (payload?.schema !== "materials-analytics-workspace" || !Array.isArray(payload.dataset?.normalizedRows) || !Array.isArray(payload.dataset?.fields)) throw new Error("Plik nie jest zgodnym workspace Materials Analytics.");
        const version = Number(payload.schemaVersion || 1);
        if (!Number.isInteger(version) || version < 1 || version > 4) throw new Error(`Nieobsługiwana wersja schematu workspace: ${payload.schemaVersion}.`);

        const restoredFields = clonePlain(payload.dataset.fields);
        const fieldIds = new Set();
        restoredFields.forEach((field, index) => {
            if (!field || !cleanText(field.id) || !cleanText(field.label)) throw new Error(`Nieprawidłowa definicja kolumny nr ${index + 1}.`);
            if (fieldIds.has(field.id)) throw new Error(`Workspace zawiera zduplikowany identyfikator kolumny: ${field.id}.`);
            fieldIds.add(field.id);
        });
        const restoredColumns = clonePlain(payload.dataset.calculatedColumns || []);
        const formulaIds = new Set();
        restoredColumns.forEach((definition) => {
            if (!definition || !fieldIds.has(definition.id)) throw new Error(`Definicja formuły „${definition?.label || definition?.id || "bez nazwy"}” nie ma odpowiadającej kolumny.`);
            if (formulaIds.has(definition.id)) throw new Error(`Workspace zawiera zduplikowaną definicję formuły: ${definition.id}.`);
            formulaIds.add(definition.id);
        });

        formulaCache.clear();
        formulaPlanCache = null;
        getFormulaPlan(restoredFields, restoredColumns);
        const usedRowIds = new Set();
        const restoredRows = clonePlain(payload.dataset.normalizedRows).map((row) => {
            const next = row && typeof row === "object" ? { ...row } : {};
            let rowId = cleanText(next.id);
            if (!rowId || usedRowIds.has(rowId)) rowId = createId("record");
            next.id = rowId;
            usedRowIds.add(rowId);
            recalculateFormulas(next, restoredFields, restoredColumns, { throwOnPlanError: true });
            return next;
        });

        resetEditorRuntimeForRestore();
        projectId = payload.id === PMA.workspaceStorage.AUTOSAVE_ID ? null : payload.id || payload.project?.id || null;
        projectCreatedAt = payload.createdAt || payload.project?.createdAt || null;
        const restoredName = payload.project?.name || (payload.id === PMA.workspaceStorage.AUTOSAVE_ID ? null : payload.name) || "Zaimportowany projekt";
        if (el("workspaceProjectName")) el("workspaceProjectName").value = restoredName;
        state.setCalculatedColumns(restoredColumns);
        state.setNormalizedDataset({ normalizedRows: restoredRows, invalidRows: payload.dataset.invalidRows || [], duplicateRows: payload.dataset.duplicateRows || [], fields: restoredFields, statistics: calculateStatistics(restoredRows) });
        state.setStockDataset(payload.dataset.stockRows || [], payload.dataset.stockFields || []);
        state.setTransformationSteps(payload.dataset.transformationSteps || []);
        if (payload.mapping?.values) state.setMapping(payload.mapping.values, { confidence: payload.mapping.confidence || {}, origins: payload.mapping.origins || {} });
        if (payload.filters) state.setFilters(payload.filters);
        if (payload.analysis) state.setAnalysis(payload.analysis);
        if (payload.import) {
            const importState = state.getState().import;
            importState.fileMeta = clonePlain(payload.import.fileMeta || {});
            importState.selectedSheet = payload.import.selectedSheet || "";
            importState.headers = clonePlain(payload.import.headers || []);
            importState.sourceHeaders = clonePlain(payload.import.headers || []);
            importState.detectedTypes = clonePlain(payload.import.detectedTypes || {});
            importState.headerRowIndex = Number(payload.import.headerRowIndex || 0);
            importState.sourceRowNumbers = clonePlain(payload.import.sourceRowNumbers || []);
            importState.rowProvenance = clonePlain(payload.import.rowProvenance || []);
            importState.sheetProvenance = clonePlain(payload.import.sheetProvenance || {});
        }
        viewMode = payload.editor?.viewMode || "source";
        filters.splice(0, filters.length, ...(payload.editor?.filters || []));
        sorts.splice(0, sorts.length, ...(payload.editor?.sorts || []));
        columnWidths.clear(); Object.entries(payload.editor?.columnWidths || {}).forEach(([id, width]) => columnWidths.set(id, Number(width)));
        if (el("workspaceViewMode")) el("workspaceViewMode").value = viewMode;
        const restoredSmartResult = payload.smartAnalyticsResult;
        if (restoredSmartResult && typeof restoredSmartResult === "object"
            && restoredSmartResult.execution?.deterministic === true
            && restoredSmartResult.execution?.externalServices === false
            && Number(restoredSmartResult.datasetProfile?.rows) === restoredRows.length) {
            state.setSmartAnalyticsResult(clonePlain(restoredSmartResult));
        }
        const mappingValid = state.validateMapping?.().isValid;
        dom.unlockSection("analysis");
        if (mappingValid) dom.unlockSection("decision"); else dom.lockSection("decision", "Mapuj pola Data, Materiał i Zużycie, aby uruchomić analizę decyzyjną.");
        dom.unlockSection("dataLab");
        scheduleAnalysisRefresh(); refreshAll(); scheduleAutosave();
    }

    /* ---------------- Export workbook ---------------- */
    function exportWorkbook() {
        try {
            const workbook = global.XLSX.utils.book_new();
            appendSheet(workbook, "Dane źródłowe", rows(), nonInternalFields().filter((field) => ["source", "manual", "calculated"].includes(field.source)));
            appendSheet(workbook, "Dane analityczne", rows(), nonInternalFields().filter((field) => ["mapped", "derived", "calculated"].includes(field.source)));
            const errors = [...invalidRows(), ...duplicateRows()].map((record) => ({ Wiersz: record.sourceRow, Błędy: (record.errorMessages || []).join("; "), ...record.sourceValues }));
            global.XLSX.utils.book_append_sheet(workbook, global.XLSX.utils.json_to_sheet(errors.length ? errors : [{ Informacja: "Brak błędów" }]), "Błędy");
            global.XLSX.utils.book_append_sheet(workbook, global.XLSX.utils.json_to_sheet(stockRows().length ? stockRows() : [{ Informacja: "Brak osobnej tabeli zapasów" }]), "Zapasy");
            const pivotRows = state.get("pivot.rows", []);
            if (pivotRows.length) global.XLSX.utils.book_append_sheet(workbook, global.XLSX.utils.json_to_sheet(pivotRows), "Pivot");
            const metadata = [
                { Pole: "Wersja aplikacji", Wartość: PMA.constants.APP.version }, { Pole: "Projekt", Wartość: cleanText(el("workspaceProjectName")?.value) || "Nowy projekt" }, { Pole: "Wiersze", Wartość: rows().length }, { Pole: "Kolumny", Wartość: nonInternalFields().length }, { Pole: "Błędy", Wartość: invalidRows().length + duplicateRows().length }, { Pole: "Snapshoty zapasu", Wartość: stockRows().length }, { Pole: "Eksport", Wartość: new Date().toISOString() }
            ];
            global.XLSX.utils.book_append_sheet(workbook, global.XLSX.utils.json_to_sheet(metadata), "Metadane");
            global.XLSX.writeFile(workbook, createExportFileName(cleanText(el("workspaceProjectName")?.value) || "materials-analytics", "xlsx"));
        } catch (error) { dom.showError(normalizeError(error).message, "Eksport projektu"); }
    }

    function appendSheet(workbook, name, data, fieldList) {
        const labels = uniqueLabels(fieldList);
        const objects = data.map((row) => Object.fromEntries(fieldList.map((field) => [labels.get(field.id), exportValue(row[field.id], field)])));
        global.XLSX.utils.book_append_sheet(workbook, global.XLSX.utils.json_to_sheet(objects.length ? objects : [{}]), name);
    }

    function uniqueLabels(fieldList) {
        const used = new Map(); const result = new Map();
        fieldList.forEach((field) => { const count = (used.get(field.label) || 0) + 1; used.set(field.label, count); result.set(field.id, count === 1 ? field.label : `${field.label} (${count})`); });
        return result;
    }

    /* ---------------- Commands / state commits ---------------- */
    function executePatchCommand(label, patches, step = null) {
        if (!patches.length) return;
        runCommand({
            label,
            redo: () => { applyPatches(patches, "newValue"); if (step) appendTransformationStep(step); },
            undo: () => { applyPatches(patches, "oldValue"); if (step) removeTransformationStep(step.id); }
        });
    }

    function executeRowsCommand(label, nextRows, step = null) {
        const previousRows = [...rows()];
        runCommand({
            label,
            redo: () => { commitDataset(nextRows, fields(), "rows-transform"); if (step) appendTransformationStep(step); },
            undo: () => { commitDataset(previousRows, fields(), "rows-transform-undo"); if (step) removeTransformationStep(step.id); }
        });
    }

    function applyPatches(patches, valueKey) {
        const grouped = new Map();
        patches.forEach((patch) => { if (!grouped.has(patch.rowId)) grouped.set(patch.rowId, []); grouped.get(patch.rowId).push(patch); });
        const nextRows = rows().map((row) => {
            const rowPatches = grouped.get(row.id); if (!rowPatches) return row;
            const next = { ...row }; rowPatches.forEach((patch) => { next[patch.fieldId] = patch[valueKey]; }); return next;
        });
        commitDataset(nextRows, fields(), "cells-changed");
    }

    function runCommand(command) {
        try {
            command.redo();
            undoStack.push(command); if (undoStack.length > COMMAND_LIMIT) undoStack.shift();
            redoStack.length = 0; updateCommandButtons(); scheduleAutosave();
        } catch (error) { dom.showError(normalizeError(error).message, command.label || "Operacja danych"); }
    }

    function undo() {
        const command = undoStack.pop(); if (!command) return;
        command.undo(); redoStack.push(command); updateCommandButtons(); scheduleAutosave();
    }
    function redo() {
        const command = redoStack.pop(); if (!command) return;
        command.redo(); undoStack.push(command); updateCommandButtons(); scheduleAutosave();
    }
    function updateCommandButtons() {
        if (el("workspaceUndoButton")) el("workspaceUndoButton").disabled = !undoStack.length;
        if (el("workspaceRedoButton")) el("workspaceRedoButton").disabled = !redoStack.length;
        updateDeleteRowsButton();
    }

    function appendTransformationStep(step) { state.setTransformationSteps([...transformationSteps().filter((item) => item.id !== step.id), step]); renderTransformationHistory(); }
    function removeTransformationStep(id) { state.setTransformationSteps(transformationSteps().filter((item) => item.id !== id)); renderTransformationHistory(); }

    function commitDataset(nextRows, nextFields, reason, overrides = {}) {
        state.setNormalizedDataset({
            normalizedRows: nextRows,
            invalidRows: overrides.invalidRows || invalidRows(),
            duplicateRows: overrides.duplicateRows || duplicateRows(),
            fields: nextFields,
            statistics: calculateStatistics(nextRows)
        });
        scheduleAnalysisRefresh();
        scheduleAutosave();
        return reason;
    }

    function calculateStatistics(data) {
        const quantities = data.map((row) => parseNumber(row.quantity)).filter((value) => value !== null);
        const dates = data.map((row) => row.date).filter(Boolean).sort();
        const total = quantities.reduce((sum, value) => sum + value, 0);
        return {
            totalSourceRows: data.length + invalidRows().length + duplicateRows().length,
            normalizedRows: data.length, filteredRows: data.length, invalidRows: invalidRows().length, duplicateRows: duplicateRows().length,
            totalQuantity: total, averageQuantity: quantities.length ? total / quantities.length : 0,
            minimumQuantity: quantities.length ? quantities.reduce((minimum, value) => Math.min(minimum, value), Infinity) : null,
            maximumQuantity: quantities.length ? quantities.reduce((maximum, value) => Math.max(maximum, value), -Infinity) : null,
            minimumDate: dates[0] || null, maximumDate: dates[dates.length - 1] || null
        };
    }

    function scheduleAnalysisRefresh() {
        clearTimeout(analysisRefreshTimer);
        analysisRefreshTimer = global.setTimeout(async () => {
            try {
                if (PMA.pivotEngine?.applyFilters) await PMA.pivotEngine.applyFilters({ rebuild: true, showBusy: false });
                PMA.decisionEngine?.refresh?.();
            } catch (_) { /* editing remains available even if analysis cannot rebuild */ }
        }, 250);
    }

    /* ---------------- Helpers ---------------- */
    function formatCell(value, field) {
        if (isBlank(value)) return "";
        if (field.type === DATA_TYPES.NUMBER) return formatNumber(value);
        if (field.type === DATA_TYPES.DATE) return formatDate(value);
        if (field.type === DATA_TYPES.BOOLEAN) return value ? "Tak" : "Nie";
        return String(value);
    }
    function rawInputValue(value, field) { return field.type === DATA_TYPES.DATE && value ? String(value).slice(0, 10) : formatRaw(value); }
    function formatRaw(value) { return value === null || value === undefined ? "" : String(value); }
    function exportValue(value, field) {
        if (field.type === DATA_TYPES.DATE && value) { const date = parseDate(value, { allowExcelSerial: true, allowNumericStringExcelSerial: true }); return date || value; }
        return value ?? "";
    }
    function isBlank(value) { return value === null || value === undefined || String(value).trim() === ""; }
    function sameValue(left, right) { return left === right || (Number.isNaN(left) && Number.isNaN(right)) || JSON.stringify(left) === JSON.stringify(right); }
    function insertAt(array, index, value) { const next = [...array]; next.splice(Math.min(index, next.length), 0, value); return next; }
    function omitKey(object, key) { const next = { ...object }; delete next[key]; return next; }
    function dedupePatches(patches) {
        const map = new Map();
        patches.forEach((patch) => {
            const key = `${patch.rowId}|${patch.fieldId}`;
            if (!map.has(key)) map.set(key, { ...patch });
            else map.get(key).newValue = patch.newValue;
        });
        return [...map.values()].filter((patch) => !sameValue(patch.oldValue, patch.newValue));
    }
    function makeUniqueHeaders(source) {
        const used = new Map();
        return source.map((value, index) => {
            const base = cleanText(value) || `Kolumna ${index + 1}`;
            const count = (used.get(base) || 0) + 1; used.set(base, count);
            return count === 1 ? base : `${base} (${count})`;
        });
    }
    function formatDateTimeLocal(value) {
        const date = parseDate(value, { allowExcelSerial: true, allowNumericStringExcelSerial: true });
        return date ? new Intl.DateTimeFormat("pl-PL", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date) : "—";
    }
    function escapeHtml(value) { return String(value ?? "").replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]); }
    function cssEscape(value) { return global.CSS?.escape ? global.CSS.escape(String(value)) : String(value).replace(/["\\]/g, "\\$&"); }

    const api = Object.freeze({
        initialize,
        destroy,
        refresh: refreshAll,
        undo,
        redo,
        exportWorkbook,
        serializeWorkspace,
        restoreWorkspace,
        isInitialized: () => initialized,
        getRuntimeState: () => ({ activeTab, viewMode, filters: clonePlain(filters), sorts: clonePlain(sorts), undo: undoStack.length, redo: redoStack.length })
    });
    Object.defineProperty(PMA, "spreadsheetEngine", { value: api, writable: false, enumerable: true, configurable: false });
    Object.defineProperty(PMA, "dataLabEngine", { value: api, writable: false, enumerable: true, configurable: false });
}(window));
