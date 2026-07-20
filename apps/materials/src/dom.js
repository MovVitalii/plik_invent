/* ==========================================================
   Pack Materials Analytics
   src/dom.js
========================================================== */

(function initializeDom(global) {
    "use strict";

    const PMA = global.PMA || (global.PMA = {});

    if (!PMA.constants || !PMA.state || !PMA.utils) {
        throw new Error("PMA.constants, PMA.state and PMA.utils must be loaded before src/dom.js.");
    }

    const { STATUS, PROCESSING_LIMITS, UI_TEXT, HELP_CONTENT, DATA_TYPES } = PMA.constants;
    const {
        formatNumber,
        formatInteger,
        formatDate,
        formatDateTime,
        formatFileSize,
        createId,
        normalizeError
    } = PMA.utils;

    const REQUIRED_IDS = [
        "excelFileInput", "exportButton", "exportMenu", "exportXlsxButton",
        "exportCsvButton", "exportCleanDataButton", "exportErrorsButton",
        "resetWorkspaceButton", "importProgressText", "mappingProgressText",
        "analysisProgressText", "dataLabProgressText", "smartAnalyticsProgressText", "importSection", "importStatusBadge", "importEmptyState",
        "importContent", "workbookFileName", "workbookFileSize", "workbookSheetCount",
        "workbookRowCount", "workbookColumnCount", "sheetSelector",
        "reanalyzeSheetButton", "previewDescription", "previewRowCount",
        "previewTable", "previewTableHead", "previewTableBody", "continueToMappingButton",
        "mappingSection", "mappingHeading", "mappingDescription", "mappingStatusBadge", "mappingLockedState", "mappingContent",
        "workbookModelMappingSummary", "workbookModelMappingSummaryText", "singleSheetMappingPanel",
        "autoMapButton", "sourceColumnsCount", "sourceColumnsList", "mappingFieldsContainer",
        "validateMappingButton", "validationTotalRows", "validationValidRows",
        "validationInvalidRows", "validationDuplicateRows", "validationMessages",
        "backToImportButton", "openRawWorkspaceButton", "processDataButton", "analysisSection", "analysisStatusBadge",
        "analysisLockedState", "analysisContent", "clearFiltersButton", "dateFromFilter",
        "dateToFilter", "dynamicFiltersContainer", "fieldSearchInput", "availableFieldsContainer",
        "rowsDropZone", "columnsDropZone", "aggregationSelector", "valuesDropZone",
        "clearAnalysisButton", "summaryFilteredRows", "summaryGroups", "summaryTotal",
        "summaryAverage", "summaryMinimum", "summaryMaximum", "analysisTip",
        "tableResultView", "chartResultView", "chartTypeControls", "pivotResultTable",
        "pivotResultHead", "pivotResultBody", "pivotResultFoot", "analysisChart",
        "chartDescription", "loadingOverlay", "loadingTitle", "loadingMessage",
        "loadingProgress", "toastContainer",
        "decisionSection", "decisionStatusBadge", "decisionLockedState", "decisionContent",
        "decisionProgressText", "decisionStockNotice", "kpiUsed", "kpiStock", "kpiMaterials",
        "kpiRisk", "decisionSummary", "coverageTableBody", "decisionParetoSummary", "paretoChart",
        "abcTableBody", "forecastSeasonSelect", "forecastDaysInput", "forecastBufferInput",
        "forecastTableBody", "exportForecastCsvButton", "printDecisionReportButton",
        "dataLabSection", "dataLabStatusBadge", "dataLabLockedState", "dataLabContent",
        "smartAnalyticsSection", "smartAnalyticsStatusBadge", "smartAnalyticsLockedState", "smartAnalyticsContent",
        "smartAnalyticsScopeSelect", "smartAnalyticsModeSelect", "smartPrimaryDateSelect",
        "smartPrimaryMeasureSelect", "smartPrimaryDimensionSelect", "smartAnalyticsSqlMode",
        "runSmartAnalyticsButton", "cancelSmartAnalyticsButton", "smartAnalyticsEngineStatus",
        "smartAnalyticsProgressBar", "smartAnalyticsGeneratedAt", "smartRows", "smartColumns",
        "smartQualityScore", "smartInsightsCount", "smartExecutiveSummary", "smartInsightsContainer",
        "smartSchemaTableBody", "smartQualitySummary", "smartQualityIssuesBody", "smartTrendSelector",
        "smartTrendChart", "smartPeriodComparisonBody", "smartOutliersBody", "smartCorrelationChart",
        "smartCorrelationsBody", "smartPivotCards", "smartChartRecommendationButtons",
        "smartRecommendedChart", "smartPivotPreview", "smartReportContent", "smartExportXlsxButton",
        "smartExportJsonButton", "smartExportAuditButton", "smartPrintReportButton",
        "smartVerificationSummary", "smartVerificationBody"
    ];

    const elements = {};
    REQUIRED_IDS.forEach((id) => {
        const element = document.getElementById(id);
        if (!element) {
            throw new Error(`Required DOM element was not found: #${id}`);
        }
        elements[id] = element;
    });

    elements.workflowSteps = [...document.querySelectorAll(".workflow-step[data-target-section]")];
    elements.workflowLines = [...document.querySelectorAll(".workflow-line")];
    elements.analysisTemplateButtons = [...document.querySelectorAll("[data-analysis-template]")];
    elements.resultViewButtons = [...document.querySelectorAll("[data-result-view]")];
    elements.chartTypeButtons = [...document.querySelectorAll("[data-chart-type]")];
    elements.helpButtons = [...document.querySelectorAll(".help-button[data-help]")];
    elements.decisionTabButtons = [...document.querySelectorAll("[data-decision-tab]")];
    elements.decisionViews = [...document.querySelectorAll("[data-decision-view]")];
    Object.freeze(elements);

    let initialized = false;
    let unsubscribeState = null;
    let activeHelpPopover = null;
    const toastTimers = new WeakMap();

    function initialize() {
        if (initialized) {
            return api;
        }

        bindExportMenu();
        bindWorkflowNavigation();
        bindHelpButtons();
        bindGlobalHandlers();
        unsubscribeState = PMA.state.subscribe(handleStateNotification);
        initialized = true;
        return api;
    }

    function destroy() {
        closeExportMenu();
        closeHelpPopover();
        clearToasts();
        if (typeof unsubscribeState === "function") {
            unsubscribeState();
        }
        unsubscribeState = null;
        initialized = false;
    }

    function getElement(reference) {
        if (reference instanceof Element || reference === document || reference === global) {
            return reference;
        }
        if (typeof reference !== "string") {
            return null;
        }
        return elements[reference] || document.getElementById(reference) || document.querySelector(reference);
    }

    function requireElement(reference) {
        const element = getElement(reference);
        if (!element) {
            throw new Error(`DOM element was not found: ${reference}`);
        }
        return element;
    }

    function query(selector, root = document) {
        return root.querySelector(selector);
    }

    function queryAll(selector, root = document) {
        return [...root.querySelectorAll(selector)];
    }

    function createElement(tagName, options = {}) {
        const element = document.createElement(tagName);
        if (options.id) element.id = String(options.id);
        if (options.className) element.className = String(options.className);
        if (Array.isArray(options.classes)) element.classList.add(...options.classes.filter(Boolean));
        if (options.text !== undefined) element.textContent = String(options.text ?? "");
        Object.entries(options.attributes || {}).forEach(([name, value]) => {
            if (value === false || value === null || value === undefined) return;
            element.setAttribute(name, value === true ? "" : String(value));
        });
        Object.entries(options.dataset || {}).forEach(([name, value]) => {
            if (value !== null && value !== undefined) element.dataset[name] = String(value);
        });
        Object.assign(element, options.properties || {});
        (options.children || []).forEach((child) => {
            if (child instanceof Node) element.appendChild(child);
            else if (child !== null && child !== undefined) element.appendChild(document.createTextNode(String(child)));
        });
        Object.entries(options.on || {}).forEach(([eventName, handler]) => {
            if (typeof handler === "function") element.addEventListener(eventName, handler);
        });
        return element;
    }

    function appendChildren(parent, children) {
        const target = requireElement(parent);
        children.forEach((child) => {
            if (child instanceof Node) target.appendChild(child);
            else if (child !== null && child !== undefined) target.appendChild(document.createTextNode(String(child)));
        });
        return target;
    }

    function fragment(children = []) {
        const result = document.createDocumentFragment();
        appendChildren(result, children);
        return result;
    }

    function clear(reference) {
        const element = requireElement(reference);
        element.replaceChildren();
        return element;
    }

    function replaceChildren(reference, children = []) {
        const element = requireElement(reference);
        const values = Array.isArray(children) ? children : [children];
        element.replaceChildren(...values.filter((item) => item instanceof Node));
        return element;
    }

    function setText(reference, value) {
        const element = requireElement(reference);
        element.textContent = value === null || value === undefined ? "" : String(value);
        return element;
    }

    function show(reference) {
        const element = requireElement(reference);
        element.hidden = false;
        element.classList.remove("is-hidden");
        return element;
    }

    function hide(reference) {
        const element = requireElement(reference);
        element.hidden = true;
        element.classList.add("is-hidden");
        return element;
    }

    function toggle(reference, visible) {
        return visible ? show(reference) : hide(reference);
    }

    function setDisabled(reference, disabled = true) {
        const element = requireElement(reference);
        element.disabled = Boolean(disabled);
        element.setAttribute("aria-disabled", String(Boolean(disabled)));
        return element;
    }

    function setAriaExpanded(reference, expanded) {
        const element = requireElement(reference);
        element.setAttribute("aria-expanded", String(Boolean(expanded)));
        return element;
    }

    function setAttribute(reference, name, value) {
        const element = requireElement(reference);
        if (value === null || value === undefined || value === false) element.removeAttribute(name);
        else element.setAttribute(name, value === true ? "" : String(value));
        return element;
    }

    function focus(reference, options = {}) {
        const element = getElement(reference);
        element?.focus?.({ preventScroll: options.preventScroll === true });
    }

    function scrollToElement(reference, options = {}) {
        requireElement(reference).scrollIntoView({
            behavior: options.behavior || (global.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"),
            block: options.block || "start",
            inline: options.inline || "nearest"
        });
    }

    function normalizeVisualStatus(status) {
        if ([STATUS.SUCCESS, "success", "complete"].includes(status)) return "success";
        if ([STATUS.WARNING, "warning"].includes(status)) return "warning";
        if ([STATUS.ERROR, "error", "danger"].includes(status)) return "danger";
        if ([STATUS.LOADING, STATUS.PROCESSING, "loading", "processing", "info"].includes(status)) return "info";
        return "neutral";
    }

    function setStatusBadge(reference, text, status = "neutral") {
        const element = requireElement(reference);
        const visualStatus = normalizeVisualStatus(status);
        element.classList.remove("status-neutral", "status-success", "status-warning", "status-danger", "status-info");
        element.classList.add(`status-${visualStatus}`);
        element.dataset.status = visualStatus;
        element.textContent = String(text ?? "");
        return element;
    }

    function setAnalysisTip(message, status = "info") {
        elements.analysisTip.classList.remove("is-success", "is-warning", "is-error");
        const normalized = normalizeVisualStatus(status);
        if (normalized === "success") elements.analysisTip.classList.add("is-success");
        if (normalized === "warning") elements.analysisTip.classList.add("is-warning");
        if (normalized === "danger") elements.analysisTip.classList.add("is-error");
        elements.analysisTip.textContent = String(message ?? "");
    }


    function setMappingMode(mode = "single-sheet", details = {}) {
        const workbookModelMode = mode === "workbook-model";
        elements.singleSheetMappingPanel.hidden = workbookModelMode;
        elements.workbookModelMappingSummary.hidden = !workbookModelMode;
        elements.openRawWorkspaceButton.hidden = workbookModelMode;

        elements.mappingHeading.textContent = "2. Przygotowanie i jakość danych";
        elements.mappingDescription.textContent = workbookModelMode
            ? "Mapowanie wykonano w modelu skoroszytu. Sprawdź jakość wspólnej tabeli zużycia przed uruchomieniem analiz."
            : "Połącz kolumny wybranego arkusza z polami systemowymi i sprawdź poprawność danych.";
        elements.validateMappingButton.textContent = workbookModelMode ? "Sprawdź dane modelu" : "Sprawdź dane";
        elements.backToImportButton.textContent = workbookModelMode ? "Edytuj model danych" : "Wróć do importu";
        elements.processDataButton.textContent = workbookModelMode ? "Przetwórz model danych" : "Przetwórz do analizy materiałów";

        if (workbookModelMode) {
            const parts = [];
            if (Number.isFinite(details.usageSheets)) parts.push(`arkusze zużycia: ${details.usageSheets}`);
            if (Number.isFinite(details.stockSheets)) parts.push(`arkusze zapasów: ${details.stockSheets}`);
            if (details.joinField) parts.push(`klucz: ${details.joinField}`);
            elements.workbookModelMappingSummaryText.textContent = [
                "Role i kolumny zostały przypisane w sekcji „Model danych skoroszytu”.",
                parts.length ? `Użyty model: ${parts.join(", ")}.` : "",
                "Poniżej pozostaje wyłącznie kontrola jakości przed przetworzeniem."
            ].filter(Boolean).join(" ");
        } else {
            elements.workbookModelMappingSummaryText.textContent =
                "Role i kolumny zostały przypisane w sekcji „Model danych skoroszytu”. Poniżej pozostaje wyłącznie kontrola jakości przed przetworzeniem.";
        }
    }

    function setWorkflowStage(stage) {
        const activeStage = Math.max(1, Math.min(6, Number(stage) || 1));
        elements.workflowSteps.forEach((step, index) => {
            const stepNumber = index + 1;
            step.classList.toggle("is-active", stepNumber === activeStage);
            step.classList.toggle("is-complete", stepNumber < activeStage);
            step.setAttribute("aria-current", stepNumber === activeStage ? "step" : "false");
        });
        elements.workflowLines.forEach((line, index) => line.classList.toggle("is-complete", index + 1 < activeStage));
    }

    function setWorkflowProgress(stage, text) {
        const map = {
            import: elements.importProgressText,
            mapping: elements.mappingProgressText,
            analysis: elements.analysisProgressText,
            decision: elements.decisionProgressText,
            dataLab: elements.dataLabProgressText,
            smartAnalytics: elements.smartAnalyticsProgressText
        };
        if (!map[stage]) throw new Error(`Unknown workflow stage: ${stage}`);
        map[stage].textContent = String(text ?? "");
    }

    function getSectionConfiguration(sectionName) {
        if (sectionName === "mapping") {
            return { section: elements.mappingSection, lockedState: elements.mappingLockedState, content: elements.mappingContent };
        }
        if (sectionName === "analysis") {
            return { section: elements.analysisSection, lockedState: elements.analysisLockedState, content: elements.analysisContent };
        }
        if (sectionName === "decision") {
            return { section: elements.decisionSection, lockedState: elements.decisionLockedState, content: elements.decisionContent };
        }
        if (sectionName === "dataLab") {
            return { section: elements.dataLabSection, lockedState: elements.dataLabLockedState, content: elements.dataLabContent };
        }
        if (sectionName === "smartAnalytics") {
            return { section: elements.smartAnalyticsSection, lockedState: elements.smartAnalyticsLockedState, content: elements.smartAnalyticsContent };
        }
        throw new Error(`Unsupported section: ${sectionName}`);
    }

    function unlockSection(sectionName) {
        const configuration = getSectionConfiguration(sectionName);
        configuration.section.classList.remove("is-locked");
        configuration.lockedState.hidden = true;
        configuration.content.hidden = false;
        const step = elements.workflowSteps.find((item) => item.dataset.targetSection === configuration.section.id);
        if (step) step.disabled = false;
    }

    function lockSection(sectionName, message = "") {
        const configuration = getSectionConfiguration(sectionName);
        configuration.section.classList.add("is-locked");
        configuration.lockedState.hidden = false;
        configuration.content.hidden = true;
        if (message) configuration.lockedState.textContent = message;
        const step = elements.workflowSteps.find((item) => item.dataset.targetSection === configuration.section.id);
        if (step) step.disabled = true;
    }

    function activateSection(sectionName, options = {}) {
        const map = {
            import: [elements.importSection, 1],
            mapping: [elements.mappingSection, 2],
            analysis: [elements.analysisSection, 3],
            decision: [elements.decisionSection, 4],
            dataLab: [elements.dataLabSection, 5],
            smartAnalytics: [elements.smartAnalyticsSection, 6]
        };
        const entry = map[sectionName];
        if (!entry) throw new Error(`Unknown section: ${sectionName}`);
        setWorkflowStage(entry[1]);
        PMA.state.setActiveSection(entry[0].id);
        if (options.scroll !== false) scrollToElement(entry[0]);
    }

    function setImportMode(hasWorkbook) {
        elements.importEmptyState.hidden = Boolean(hasWorkbook);
        elements.importContent.hidden = !hasWorkbook;
    }

    function updateWorkbookMetadata(metadata = {}) {
        setText(elements.workbookFileName, metadata.name || "—");
        setText(elements.workbookFileSize, Number.isFinite(metadata.size) ? formatFileSize(metadata.size) : "—");
        setText(elements.workbookSheetCount, formatInteger(metadata.sheetCount ?? 0, "0"));
        setText(elements.workbookRowCount, formatInteger(metadata.rowCount ?? 0, "0"));
        setText(elements.workbookColumnCount, formatInteger(metadata.columnCount ?? 0, "0"));
    }

    function populateSelect(reference, options, selectedValue = "", configuration = {}) {
        const select = requireElement(reference);
        const fragmentElement = document.createDocumentFragment();
        (Array.isArray(options) ? options : []).forEach((item) => {
            const normalized = typeof item === "object" ? item : { value: item, label: item };
            const option = document.createElement("option");
            option.value = String(normalized.value ?? "");
            option.textContent = String(normalized.label ?? normalized.value ?? "");
            option.disabled = Boolean(normalized.disabled);
            option.selected = String(selectedValue ?? "") === option.value;
            fragmentElement.appendChild(option);
        });
        select.replaceChildren(fragmentElement);
        if (configuration.disabled !== undefined) select.disabled = Boolean(configuration.disabled);
        return select;
    }

    function populateSheetSelector(sheetNames, selectedSheet = "") {
        populateSelect(elements.sheetSelector, [
            { value: "", label: "Wybierz arkusz" },
            ...(Array.isArray(sheetNames) ? sheetNames.map((name) => ({ value: name, label: name })) : [])
        ], selectedSheet);
    }


    function formatCellValue(value, type) {
        if (value === null || value === undefined || value === "") return "";
        if (type === DATA_TYPES.NUMBER) return formatNumber(value, { fallback: String(value) });
        if (type === DATA_TYPES.DATE) {
            const text = String(value);
            return text.includes("T") ? formatDateTime(value, { fallback: text }) : formatDate(value, { fallback: text });
        }
        if (type === DATA_TYPES.BOOLEAN) return value === true ? "Tak" : value === false ? "Nie" : String(value);
        return String(value);
    }

    function renderPreviewTable(headers, rows, detectedTypes = {}) {
        clear(elements.previewTableHead);
        clear(elements.previewTableBody);
        const headRow = document.createElement("tr");
        const numberHeader = document.createElement("th");
        numberHeader.textContent = "#";
        headRow.appendChild(numberHeader);
        headers.forEach((header) => {
            const cell = document.createElement("th");
            cell.textContent = header;
            headRow.appendChild(cell);
        });
        elements.previewTableHead.appendChild(headRow);

        const bodyFragment = document.createDocumentFragment();
        rows.forEach((row, rowIndex) => {
            const tableRow = document.createElement("tr");
            const numberCell = document.createElement("td");
            numberCell.textContent = String(rowIndex + 1);
            numberCell.className = "is-number";
            tableRow.appendChild(numberCell);
            headers.forEach((header, columnIndex) => {
                const cell = document.createElement("td");
                const value = Array.isArray(row) ? row[columnIndex] : row?.[header];
                cell.textContent = formatCellValue(value, detectedTypes[header]);
                if (detectedTypes[header] === DATA_TYPES.NUMBER) cell.classList.add("is-number");
                tableRow.appendChild(cell);
            });
            bodyFragment.appendChild(tableRow);
        });
        if (!rows.length) renderEmptyTableRow(elements.previewTableBody, headers.length + 1, "Arkusz nie zawiera danych.");
        else elements.previewTableBody.appendChild(bodyFragment);
        setText(elements.previewRowCount, formatInteger(rows.length, "0"));
        return { renderedRows: rows.length, totalRows: rows.length };
    }

    function renderEmptyTableRow(bodyElement, columnCount, message) {
        const row = document.createElement("tr");
        const cell = document.createElement("td");
        cell.colSpan = Math.max(1, columnCount);
        cell.className = "table-empty-state";
        cell.textContent = String(message || UI_TEXT.noData);
        row.appendChild(cell);
        bodyElement.appendChild(row);
    }

    function clearPreviewTable() {
        clear(elements.previewTableHead);
        clear(elements.previewTableBody);
        setText(elements.previewRowCount, "0");
    }

    function clearPivotTable(message = "Skonfiguruj analizę, aby wyświetlić wynik.") {
        clear(elements.pivotResultHead);
        clear(elements.pivotResultBody);
        clear(elements.pivotResultFoot);
        renderEmptyTableRow(elements.pivotResultBody, 1, message);
    }

    function updateValidationSummary(result = {}) {
        setText(elements.validationTotalRows, formatInteger(result.totalRows ?? 0, "0"));
        setText(elements.validationValidRows, formatInteger(result.validRows ?? 0, "0"));
        setText(elements.validationInvalidRows, formatInteger(result.invalidRows ?? 0, "0"));
        setText(elements.validationDuplicateRows, formatInteger(result.duplicateRows ?? 0, "0"));
    }

    function renderValidationMessages(messages = []) {
        clear(elements.validationMessages);
        const fragmentElement = document.createDocumentFragment();
        (Array.isArray(messages) ? messages : []).forEach((message) => {
            const normalized = typeof message === "string" ? { text: message, status: "info" } : message;
            const status = normalizeVisualStatus(normalized.status || normalized.type || "info");
            const item = createElement("div", { className: "validation-message" });
            item.classList.add(status === "danger" ? "is-error" : `is-${status}`);
            item.appendChild(createElement("span", {
                className: "validation-icon",
                text: status === "success" ? "✓" : status === "warning" ? "!" : status === "danger" ? "×" : "i",
                attributes: { "aria-hidden": "true" }
            }));
            item.appendChild(createElement("span", { text: normalized.text || normalized.message || "" }));
            fragmentElement.appendChild(item);
        });
        elements.validationMessages.appendChild(fragmentElement);
    }

    function updateAnalysisSummary(statistics = {}) {
        setText(elements.summaryFilteredRows, formatInteger(statistics.filteredRows ?? statistics.sourceRows ?? 0, "0"));
        setText(elements.summaryGroups, formatInteger(statistics.groupCount ?? 0, "0"));
        setText(elements.summaryTotal, formatNumber(statistics.total ?? 0, { fallback: "0" }));
        setText(elements.summaryAverage, formatNumber(statistics.average ?? 0, { fallback: "0" }));
        setText(elements.summaryMinimum, formatNumber(statistics.minimum ?? 0, { fallback: "0" }));
        setText(elements.summaryMaximum, formatNumber(statistics.maximum ?? 0, { fallback: "0" }));
    }

    function setResultView(view) {
        const chartVisible = view === "chart";
        elements.tableResultView.hidden = chartVisible;
        elements.chartResultView.hidden = !chartVisible;
        elements.chartTypeControls.hidden = !chartVisible;
        elements.resultViewButtons.forEach((button) => {
            const active = button.dataset.resultView === view;
            button.classList.toggle("is-active", active);
            button.setAttribute("aria-pressed", String(active));
        });
    }

    function setChartTypeButton(chartType) {
        elements.chartTypeButtons.forEach((button) => {
            const active = button.dataset.chartType === chartType;
            button.classList.toggle("is-active", active);
            button.setAttribute("aria-pressed", String(active));
        });
    }

    function setActiveAnalysisTemplate(templateId) {
        elements.analysisTemplateButtons.forEach((button) => {
            const active = button.dataset.analysisTemplate === templateId;
            button.classList.toggle("is-active", active);
            button.setAttribute("aria-pressed", String(active));
        });
    }

    function setAnalysisTemplateAvailability(availabilityById) {
        elements.analysisTemplateButtons.forEach((button) => {
            const templateId = button.dataset.analysisTemplate;
            const available = availabilityById?.[templateId] !== false;
            button.disabled = !available;
            if (available) {
                button.removeAttribute("title");
                button.removeAttribute("aria-disabled");
            } else {
                button.setAttribute("aria-disabled", "true");
                button.title = "Ten szablon wymaga pola, które nie zostało zmapowane w bieżącym pliku źródłowym.";
            }
        });
    }

    function showLoading(options = {}) {
        setText(elements.loadingTitle, options.title || UI_TEXT.processingData);
        setText(elements.loadingMessage, options.message || "Proszę czekać...");
        setLoadingProgress(options.progress || 0);
        elements.loadingOverlay.hidden = false;
        document.body.classList.add("is-busy");
    }

    function updateLoading(options = {}) {
        if (options.title !== undefined) setText(elements.loadingTitle, options.title);
        if (options.message !== undefined) setText(elements.loadingMessage, options.message);
        if (options.progress !== undefined) setLoadingProgress(options.progress);
    }

    function setLoadingProgress(value) {
        const progress = Math.max(0, Math.min(100, Number(value) || 0));
        elements.loadingProgress.value = progress;
        elements.loadingProgress.setAttribute("aria-valuenow", String(progress));
    }

    function hideLoading() {
        elements.loadingOverlay.hidden = true;
        document.body.classList.remove("is-busy");
        setLoadingProgress(0);
    }

    function toast(options = {}) {
        const normalized = typeof options === "string" ? { message: options } : options;
        const type = normalizeVisualStatus(normalized.type || "info");
        const item = createElement("article", {
            className: "toast",
            attributes: { role: type === "danger" ? "alert" : "status", tabindex: "0" },
            dataset: { toastId: createId("toast") }
        });
        item.classList.add(type === "danger" ? "is-error" : `is-${type}`);
        const content = createElement("div", { className: "toast-content" });
        if (normalized.title) content.appendChild(createElement("strong", { className: "toast-title", text: normalized.title }));
        content.appendChild(createElement("span", { className: "toast-message", text: normalized.message || "" }));
        const closeButton = createElement("button", {
            className: "toast-close",
            text: "×",
            attributes: { type: "button", "aria-label": "Zamknij komunikat" },
            on: { click: () => dismissToast(item) }
        });
        item.append(createElement("span", { className: "toast-symbol", text: type === "success" ? "✓" : type === "warning" ? "!" : type === "danger" ? "×" : "i", attributes: { "aria-hidden": "true" } }), content, closeButton);
        elements.toastContainer.appendChild(item);
        const duration = normalized.persistent ? 0 : Number(normalized.duration ?? PROCESSING_LIMITS.toastDurationMilliseconds);
        if (duration > 0) {
            const timer = global.setTimeout(() => dismissToast(item), duration);
            toastTimers.set(item, timer);
            item.addEventListener("mouseenter", () => clearToastTimer(item), { once: true });
            item.addEventListener("focusin", () => clearToastTimer(item), { once: true });
        }
        return item;
    }

    function clearToastTimer(item) {
        const timer = toastTimers.get(item);
        if (timer) global.clearTimeout(timer);
        toastTimers.delete(item);
    }

    function dismissToast(item) {
        if (!item?.isConnected) return;
        clearToastTimer(item);
        item.classList.add("is-leaving");
        global.setTimeout(() => item.remove(), 180);
    }

    function clearToasts() {
        queryAll(".toast", elements.toastContainer).forEach((item) => {
            clearToastTimer(item);
            item.remove();
        });
    }

    function showSuccess(message, title = "Gotowe") {
        return toast({ title, message, type: "success" });
    }

    function showWarning(message, title = "Uwaga") {
        return toast({ title, message, type: "warning" });
    }

    function showError(error, title = "Błąd") {
        const normalized = normalizeError(error);
        return toast({ title, message: normalized.message, type: "error", duration: 8000 });
    }

    function showInfo(message, title = "") {
        return toast({ title, message, type: "info" });
    }

    function openExportMenu() {
        if (elements.exportButton.disabled) return;
        elements.exportMenu.hidden = false;
        setAriaExpanded(elements.exportButton, true);
        PMA.state.setExportMenuOpen(true);
        query("button:not(:disabled)", elements.exportMenu)?.focus();
    }

    function closeExportMenu() {
        elements.exportMenu.hidden = true;
        setAriaExpanded(elements.exportButton, false);
        PMA.state.setExportMenuOpen(false);
    }

    function toggleExportMenu() {
        if (elements.exportMenu.hidden) openExportMenu();
        else closeExportMenu();
    }

    function setExportAvailability(options = {}) {
        const analysis = Boolean(options.analysis);
        const cleanData = Boolean(options.cleanData);
        const errors = Boolean(options.errors);
        const any = analysis || cleanData || errors;
        setDisabled(elements.exportButton, !any);
        setDisabled(elements.exportXlsxButton, !analysis);
        setDisabled(elements.exportCsvButton, !analysis);
        setDisabled(elements.exportCleanDataButton, !cleanData);
        setDisabled(elements.exportErrorsButton, !errors);
        if (!any) closeExportMenu();
    }

    function bindExportMenu() {
        elements.exportButton.addEventListener("click", (event) => {
            event.stopPropagation();
            toggleExportMenu();
        });
        document.addEventListener("click", (event) => {
            if (!event.target.closest(".export-control")) closeExportMenu();
        });
    }

    function bindWorkflowNavigation() {
        elements.workflowSteps.forEach((step, index) => {
            step.addEventListener("click", () => {
                if (step.disabled) return;
                const section = document.getElementById(step.dataset.targetSection);
                if (!section) return;
                setWorkflowStage(index + 1);
                PMA.state.setActiveSection(section.id);
                scrollToElement(section);
            });
        });
    }

    function bindHelpButtons() {
        elements.helpButtons.forEach((button) => {
            button.addEventListener("click", (event) => {
                event.stopPropagation();
                toggleHelpPopover(button, button.dataset.help);
            });
        });
    }

    function toggleHelpPopover(anchor, key) {
        if (activeHelpPopover?.dataset.helpKey === key) {
            closeHelpPopover();
            return;
        }
        closeHelpPopover();
        const content = HELP_CONTENT[key];
        if (!content) return;
        const popover = createElement("div", {
            className: "help-popover",
            dataset: { helpKey: key },
            attributes: { role: "dialog", "aria-label": content.title }
        });
        popover.append(createElement("strong", { text: content.title }), createElement("span", { text: content.message }));
        document.body.appendChild(popover);
        const anchorRect = anchor.getBoundingClientRect();
        const popoverRect = popover.getBoundingClientRect();
        const margin = 10;
        let left = Math.min(global.innerWidth - popoverRect.width - margin, Math.max(margin, anchorRect.right - popoverRect.width));
        let top = anchorRect.bottom + margin;
        if (top + popoverRect.height > global.innerHeight - margin) top = anchorRect.top - popoverRect.height - margin;
        popover.style.left = `${Math.max(margin, left)}px`;
        popover.style.top = `${Math.max(margin, top)}px`;
        activeHelpPopover = popover;
    }

    function closeHelpPopover() {
        activeHelpPopover?.remove();
        activeHelpPopover = null;
    }

    function bindGlobalHandlers() {
        document.addEventListener("click", (event) => {
            if (!event.target.closest(".help-button") && !event.target.closest(".help-popover")) closeHelpPopover();
        });
        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
                closeExportMenu();
                closeHelpPopover();
            }
        });
        global.addEventListener("resize", closeHelpPopover);
    }

    function handleStateNotification(payload) {
        if (payload.eventName === PMA.constants.EVENTS.APPLICATION_BUSY_CHANGED) {
            const application = payload.state.application;
            if (application.busy) {
                showLoading({
                    title: application.busyTitle || UI_TEXT.processingData,
                    message: application.busyMessage || "Proszę czekać...",
                    progress: application.progress
                });
            } else {
                hideLoading();
            }
        }
    }

    function resetFieldZone(reference, placeholderText) {
        const zone = requireElement(reference);
        zone.replaceChildren(createElement("span", { className: "zone-placeholder", text: placeholderText }));
        zone.classList.remove("is-drag-over");
    }

    function resetUI(options = {}) {
        setImportMode(false);
        updateWorkbookMetadata({ name: "", size: null, sheetCount: 0, rowCount: 0, columnCount: 0 });
        populateSheetSelector([]);
        clearPreviewTable();
        setText(elements.previewDescription, "Pierwsze wiersze wybranego arkusza.");
        setDisabled(elements.reanalyzeSheetButton, true);
        setDisabled(elements.continueToMappingButton, true);
        setStatusBadge(elements.importStatusBadge, "Brak pliku", "neutral");
        setWorkflowProgress("import", "Oczekiwanie na plik");
        lockSection("mapping", "Najpierw wczytaj i przeanalizuj plik Excel.");
        setStatusBadge(elements.mappingStatusBadge, "Niedostępne", "neutral");
        setWorkflowProgress("mapping", "Niedostępne");
        clear(elements.sourceColumnsList);
        clear(elements.mappingFieldsContainer);
        setText(elements.sourceColumnsCount, "0");
        updateValidationSummary({});
        clear(elements.validationMessages);
        setDisabled(elements.autoMapButton, true);
        setDisabled(elements.validateMappingButton, true);
        setDisabled(elements.processDataButton, true);
        lockSection("analysis", "Przetwórz dane, aby rozpocząć analizę.");
        setStatusBadge(elements.analysisStatusBadge, "Niedostępne", "neutral");
        setWorkflowProgress("analysis", "Niedostępne");
        elements.dateFromFilter.value = "";
        elements.dateToFilter.value = "";
        elements.fieldSearchInput.value = "";
        clear(elements.dynamicFiltersContainer);
        clear(elements.availableFieldsContainer);
        resetFieldZone(elements.rowsDropZone, "Dodaj pola grupujące");
        resetFieldZone(elements.columnsDropZone, "Opcjonalny drugi poziom grupowania");
        resetFieldZone(elements.valuesDropZone, "Dodaj pole liczbowe");
        elements.aggregationSelector.value = "sum";
        updateAnalysisSummary({});
        setAnalysisTip("Dodaj pole tekstowe do Wierszy oraz pole liczbowe do Wartości.", "info");
        setResultView("table");
        setChartTypeButton("bar");
        setActiveAnalysisTemplate(null);
        clearPivotTable();
        setText(elements.chartDescription, "");
        setExportAvailability({ analysis: false, cleanData: false, errors: false });
        lockSection("decision", "Przetwórz dane, aby zobaczyć analizę decyzyjną.");
        setStatusBadge(elements.decisionStatusBadge, "Niedostępne", "neutral");
        setWorkflowProgress("decision", "Niedostępne");
        elements.decisionStockNotice.hidden = true;
        clear(elements.coverageTableBody);
        clear(elements.abcTableBody);
        clear(elements.forecastTableBody);
        clear(elements.decisionSummary);
        setText(elements.kpiUsed, "0");
        setText(elements.kpiStock, "—");
        setText(elements.kpiMaterials, "0");
        setText(elements.kpiRisk, "—");
        setText(elements.decisionParetoSummary, "");
        setDisabled(elements.exportForecastCsvButton, true);
        setDisabled(elements.printDecisionReportButton, true);
        lockSection("dataLab", "Przetwórz dane lub zaimportuj workspace, aby uruchomić Edytor danych.");
        setStatusBadge(elements.dataLabStatusBadge, "Niedostępne", "neutral");
        setWorkflowProgress("dataLab", "Niedostępne");
        lockSection("smartAnalytics", "Przetwórz dane, aby uruchomić Smart Analytics.");
        setStatusBadge(elements.smartAnalyticsStatusBadge, "Niedostępne", "neutral");
        setWorkflowProgress("smartAnalytics", "Niedostępne");
        elements.smartAnalyticsProgressBar.value = 0;
        setText(elements.smartAnalyticsGeneratedAt, "Brak wyników");
        setText(elements.smartRows, "0");
        setText(elements.smartColumns, "0");
        setText(elements.smartQualityScore, "—");
        setText(elements.smartInsightsCount, "0");
        setDisabled(elements.smartExportXlsxButton, true);
        setDisabled(elements.smartExportJsonButton, true);
        setDisabled(elements.smartPrintReportButton, true);
        setMappingMode("single-sheet");
        setWorkflowStage(1);
        closeExportMenu();
        closeHelpPopover();
        hideLoading();
        elements.excelFileInput.value = "";
        if (!options.preserveToastMessages) clearToasts();
    }

    const api = Object.freeze({
        elements,
        initialize,
        destroy,
        getElement,
        requireElement,
        query,
        queryAll,
        createElement,
        appendChildren,
        fragment,
        clear,
        replaceChildren,
        setText,
        show,
        hide,
        toggle,
        setDisabled,
        setAriaExpanded,
        setAttribute,
        focus,
        scrollToElement,
        setStatusBadge,
        setAnalysisTip,
        setWorkflowStage,
        setWorkflowProgress,
        setMappingMode,
        unlockSection,
        lockSection,
        activateSection,
        setImportMode,
        updateWorkbookMetadata,
        populateSheetSelector,
        populateSelect,
        renderPreviewTable,
        clearPreviewTable,
        clearPivotTable,
        renderEmptyTableRow,
        formatCellValue,
        updateValidationSummary,
        renderValidationMessages,
        updateAnalysisSummary,
        setResultView,
        setChartTypeButton,
        setActiveAnalysisTemplate,
        setAnalysisTemplateAvailability,
        showLoading,
        updateLoading,
        setLoadingProgress,
        hideLoading,
        toast,
        dismissToast,
        clearToasts,
        showSuccess,
        showWarning,
        showError,
        showInfo,
        openExportMenu,
        closeExportMenu,
        toggleExportMenu,
        setExportAvailability,
        closeHelpPopover,
        resetFieldZone,
        resetUI
    });

    Object.defineProperty(PMA, "dom", {
        value: api,
        writable: false,
        enumerable: true,
        configurable: false
    });
})(window);
