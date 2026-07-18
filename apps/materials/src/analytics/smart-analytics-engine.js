/* ==========================================================
   Materials Analytics — Smart Analytics UI and runtime.
========================================================== */
(function initializeSmartAnalyticsEngine(global) {
    "use strict";
    const PMA = global.PMA || (global.PMA = {});
    if (!PMA.state || !PMA.dom || !PMA.utils || !PMA.analyticsOrchestrator || !PMA.duckdbEngine) {
        throw new Error("Smart Analytics dependencies are missing.");
    }

    const state = PMA.state;
    const dom = PMA.dom;
    const bindings = [];
    let initialized = false;
    let worker = null;
    let activeRequestId = null;
    let activeTab = "overview";
    let activeTrendField = null;
    let activePivotIndex = 0;
    let activeChartIndex = 0;
    let trendChart = null;
    let correlationChart = null;
    let recommendedChart = null;
    let unsubscribeState = null;

    function el(id) { return document.getElementById(id); }
    function all(selector) { return [...document.querySelectorAll(selector)]; }
    function bind(target, eventName, handler, options = false) {
        if (!target) return;
        target.addEventListener(eventName, handler, options);
        bindings.push({ target, eventName, handler, options });
    }
    function bindId(id, eventName, handler, options = false) { bind(el(id), eventName, handler, options); }

    function initialize() {
        if (initialized) return api;
        bindId("runSmartAnalyticsButton", "click", run);
        bindId("cancelSmartAnalyticsButton", "click", cancel);
        bindId("smartAnalyticsModeSelect", "change", updateRunButtonLabel);
        bindId("smartTrendSelector", "change", (event) => { activeTrendField = event.target.value; renderTrendChart(); });
        bindId("smartExportXlsxButton", "click", exportXlsx);
        bindId("smartExportJsonButton", "click", exportJson);
        bindId("smartPrintReportButton", "click", printReport);
        all("[data-smart-tab]").forEach((button) => bind(button, "click", () => switchTab(button.dataset.smartTab)));
        bind(el("smartPivotCards"), "click", handlePivotCardClick);
        bind(el("smartChartRecommendationButtons"), "click", handleChartRecommendationClick);
        unsubscribeState = state.subscribe(handleStateEvent);
        initialized = true;
        syncAvailability();
        populateOverrideSelectors();
        renderResult(state.get("smartAnalytics.result", null));
        return api;
    }

    function destroy() {
        cancel({ silent: true });
        bindings.splice(0).forEach(({ target, eventName, handler, options }) => target.removeEventListener(eventName, handler, options));
        unsubscribeState?.();
        unsubscribeState = null;
        destroyCharts();
        initialized = false;
    }

    function handleStateEvent(payload) {
        if (!payload) return;
        if ([PMA.constants.EVENTS.DATA_NORMALIZED, PMA.constants.EVENTS.FILTERS_CHANGED, PMA.constants.EVENTS.WORKSPACE_IMPORTED].includes(payload.eventName)) {
            syncAvailability();
            populateOverrideSelectors();
        }
        if (payload.eventName === PMA.constants.EVENTS.SMART_ANALYTICS_INVALIDATED) resetResultUI();
        if (payload.eventName === PMA.constants.EVENTS.WORKSPACE_RESET) {
            cancel({ silent: true });
            resetResultUI();
            syncAvailability();
        }
    }

    function syncAvailability() {
        const count = state.get("dataset.normalizedRows.length", 0);
        if (count > 0) {
            dom.unlockSection("smartAnalytics");
            dom.setStatusBadge("smartAnalyticsStatusBadge", state.get("smartAnalytics.result") ? "Gotowe" : "Gotowy", state.get("smartAnalytics.result") ? "success" : "ready");
            dom.setWorkflowProgress("smartAnalytics", state.get("smartAnalytics.result") ? "Raport gotowy" : `${formatInteger(count)} wierszy`);
            el("runSmartAnalyticsButton").disabled = false;
        } else {
            dom.lockSection("smartAnalytics", "Przetwórz dane, aby uruchomić Smart Analytics.");
            dom.setStatusBadge("smartAnalyticsStatusBadge", "Niedostępne", "idle");
            dom.setWorkflowProgress("smartAnalytics", "Niedostępne");
            el("runSmartAnalyticsButton").disabled = true;
        }
    }

    function populateOverrideSelectors() {
        const fields = state.get("dataset.fields", []).filter((field) => field && field.source !== "internal");
        const current = {
            date: el("smartPrimaryDateSelect")?.value || "",
            measure: el("smartPrimaryMeasureSelect")?.value || "",
            dimension: el("smartPrimaryDimensionSelect")?.value || ""
        };
        populateSelect(el("smartPrimaryDateSelect"), fields.filter((field) => field.type === "date"), current.date);
        populateSelect(el("smartPrimaryMeasureSelect"), fields.filter((field) => field.type === "number"), current.measure);
        populateSelect(el("smartPrimaryDimensionSelect"), fields.filter((field) => field.type !== "number" && field.type !== "date"), current.dimension);
    }

    function populateSelect(select, fields, selected) {
        if (!select) return;
        const fragment = document.createDocumentFragment();
        const automatic = document.createElement("option");
        automatic.value = "";
        automatic.textContent = "Automatycznie";
        fragment.appendChild(automatic);
        fields.forEach((field) => {
            const option = document.createElement("option");
            option.value = field.id;
            option.textContent = field.label || field.id;
            fragment.appendChild(option);
        });
        select.replaceChildren(fragment);
        select.value = fields.some((field) => field.id === selected) ? selected : "";
    }

    function updateRunButtonLabel() {
        el("runSmartAnalyticsButton").textContent = el("smartAnalyticsModeSelect").value === "quick" ? "Uruchom szybki audyt" : "Uruchom pełną analizę";
    }

    function getSourceRows() {
        const scope = el("smartAnalyticsScopeSelect").value;
        const allRows = state.get("dataset.normalizedRows", []);
        const filteredRows = state.get("dataset.filteredRows", []);
        if (scope === "filtered") return filteredRows.length ? filteredRows : allRows;
        return allRows;
    }

    function analysisOptions() {
        const quick = el("smartAnalyticsModeSelect").value === "quick";
        return {
            scope: el("smartAnalyticsScopeSelect").value,
            source: "materials-analytics-workspace",
            fullStatistics: !quick,
            profileSampleSize: quick ? 5000 : 20000,
            sampleSize: quick ? 2500 : 7500,
            maximumFindings: quick ? 120 : 300,
            maximumRecommendations: 6,
            maximumPivotRows: 100,
            dateField: el("smartPrimaryDateSelect").value || null,
            primaryMeasureField: el("smartPrimaryMeasureSelect").value || null,
            primaryDimensionField: el("smartPrimaryDimensionSelect").value || null
        };
    }

    async function run() {
        if (activeRequestId) return;
        const rows = getSourceRows();
        const fields = state.get("dataset.fields", []);
        if (!rows.length) {
            dom.showError("Brak danych do analizy.", "Smart Analytics");
            return;
        }
        const requestId = `smart-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        activeRequestId = requestId;
        state.clearSmartAnalyticsResult({ silent: true });
        setRunning(true);
        updateProgress({ progress: 1, stage: "start", message: "Przygotowanie danych do analizy…" });

        try {
            const options = analysisOptions();
            let result;
            if (typeof Worker === "function") {
                try {
                    result = await runInWorker(requestId, { rows, fields, options });
                    result.execution.statisticalEngine = "javascript-worker";
                } catch (workerError) {
                    if (activeRequestId !== requestId) return;
                    updateProgress({ progress: 2, stage: "worker-fallback", message: "Web Worker niedostępny — kontynuacja w lokalnym wątku głównym…" });
                    result = await PMA.analyticsOrchestrator.analyze({ rows, fields, options }, updateProgress);
                    result.execution.statisticalEngine = "javascript-main-thread";
                    result.execution.workerError = String(workerError?.message || workerError);
                }
            } else {
                result = await PMA.analyticsOrchestrator.analyze({ rows, fields, options }, updateProgress);
                result.execution.statisticalEngine = "javascript-main-thread";
            }
            if (activeRequestId !== requestId) return;

            if (el("smartAnalyticsUseDuckDb").checked && result.pivots?.length) {
                updateProgress({ progress: 99, stage: "duckdb", message: "Materializacja tabel przestawnych w lokalnym DuckDB-WASM…" });
                try {
                    result.pivots = await PMA.duckdbEngine.materializePivots(rows, result.pivots, { maximumPivotRows: 100 });
                    result.execution.sqlEngine = "duckdb-wasm";
                    result.recommendedCharts = PMA.chartRecommender.recommend({
                        schema: result.schema,
                        descriptive: result.descriptive,
                        quality: result.quality,
                        outliers: result.outliers,
                        trends: result.trends,
                        periodComparisons: result.periodComparisons,
                        correlations: result.correlations,
                        pivots: result.pivots
                    });
                } catch (error) {
                    result.execution.sqlEngine = "javascript-fallback";
                    result.execution.duckdbError = String(error?.message || error);
                }
            }

            state.setSmartAnalyticsResult(result);
            renderResult(result);
            dom.setStatusBadge("smartAnalyticsStatusBadge", "Gotowe", "success");
            dom.setWorkflowProgress("smartAnalytics", `${result.insights.length} wniosków`);
            dom.showSuccess("Automatyczny audyt analityczny został zakończony.", "Smart Analytics");
        } catch (error) {
            if (activeRequestId !== requestId) return;
            state.setSmartAnalyticsError(error);
            dom.setStatusBadge("smartAnalyticsStatusBadge", "Błąd", "error");
            dom.showError(error?.message || String(error), "Smart Analytics");
        } finally {
            if (activeRequestId === requestId) activeRequestId = null;
            setRunning(false);
        }
    }

    function runInWorker(requestId, payload) {
        return new Promise((resolve, reject) => {
            const token = global.__PMA_ASSET_TOKEN__ || Date.now().toString(36);
            worker = new Worker(`src/analytics/analytics.worker.js?build=${encodeURIComponent(token)}`);
            const cleanup = () => {
                worker?.terminate();
                worker = null;
            };
            worker.addEventListener("message", (event) => {
                const message = event.data || {};
                if (message.requestId !== requestId) return;
                if (message.type === "progress") updateProgress(message.progress || {});
                if (message.type === "complete") { cleanup(); resolve(message.result); }
                if (message.type === "error") { cleanup(); reject(Object.assign(new Error(message.error?.message || "Błąd silnika analitycznego."), message.error || {})); }
            });
            worker.addEventListener("error", (event) => {
                cleanup();
                reject(new Error(event.message || "Nie udało się uruchomić Web Workera Smart Analytics."));
            });
            worker.postMessage({ type: "analyze", requestId, payload });
        });
    }

    function cancel(options = {}) {
        if (!activeRequestId && !worker) return;
        worker?.terminate();
        worker = null;
        activeRequestId = null;
        setRunning(false);
        state.clearSmartAnalyticsResult({ silent: true });
        if (!options.silent) dom.showInfo("Analiza została anulowana.", "Smart Analytics");
    }

    function setRunning(running) {
        el("runSmartAnalyticsButton").disabled = running || state.get("dataset.normalizedRows.length", 0) === 0;
        el("cancelSmartAnalyticsButton").hidden = !running;
        ["smartAnalyticsScopeSelect", "smartAnalyticsModeSelect", "smartPrimaryDateSelect", "smartPrimaryMeasureSelect", "smartPrimaryDimensionSelect", "smartAnalyticsUseDuckDb"].forEach((id) => { el(id).disabled = running; });
        if (running) dom.setStatusBadge("smartAnalyticsStatusBadge", "Analiza…", "processing");
    }

    function updateProgress(progress = {}) {
        const value = Math.max(0, Math.min(100, Number(progress.progress) || 0));
        el("smartAnalyticsProgressBar").value = value;
        el("smartAnalyticsEngineStatus").textContent = progress.message || "Przetwarzanie…";
        state.setSmartAnalyticsStatus({ status: "running", progress: value, stage: progress.stage, message: progress.message });
    }

    function resetResultUI() {
        destroyCharts();
        el("smartAnalyticsProgressBar").value = 0;
        el("smartAnalyticsGeneratedAt").textContent = "Brak wyników";
        el("smartAnalyticsEngineStatus").textContent = "Silnik gotowy. Dane nie opuszczają przeglądarki.";
        el("smartRows").textContent = "0";
        el("smartColumns").textContent = "0";
        el("smartQualityScore").textContent = "—";
        el("smartInsightsCount").textContent = "0";
        ["smartExecutiveSummary", "smartInsightsContainer", "smartSchemaTableBody", "smartQualityIssuesBody", "smartPeriodComparisonBody", "smartOutliersBody", "smartCorrelationsBody", "smartPivotCards", "smartChartRecommendationButtons", "smartPivotPreview", "smartReportContent"].forEach((id) => el(id)?.replaceChildren());
        el("smartQualitySummary").textContent = "Uruchom analizę, aby uzyskać ocenę jakości.";
        ["smartExportXlsxButton", "smartExportJsonButton", "smartPrintReportButton"].forEach((id) => { el(id).disabled = true; });
    }

    function renderResult(result) {
        if (!result) { resetResultUI(); return; }
        el("smartRows").textContent = formatInteger(result.datasetProfile.rows);
        el("smartColumns").textContent = formatInteger(result.datasetProfile.columns);
        el("smartQualityScore").textContent = `${result.quality.score}/100`;
        el("smartInsightsCount").textContent = formatInteger(result.insights.length);
        el("smartAnalyticsGeneratedAt").textContent = `Wygenerowano: ${formatDateTime(result.generatedAt)}`;
        el("smartAnalyticsProgressBar").value = 100;
        const statisticsLabel = result.execution.statisticalEngine === "javascript-worker" ? "Web Worker"
            : result.execution.statisticalEngine === "javascript-main-thread" ? "JavaScript (wątek główny)" : "JavaScript";
        const modeLabel = result.datasetProfile.analysisMode === "quick" ? "szybki" : "pełny";
        el("smartAnalyticsEngineStatus").textContent = `Tryb: ${modeLabel} · Statystyka: ${statisticsLabel} · SQL: ${result.execution.sqlEngine === "duckdb-wasm" ? "DuckDB-WASM" : "JavaScript"} · Reguły: ${result.execution.rulesVersion || "—"} · ${formatInteger(result.durationMs)} ms`;
        ["smartExportXlsxButton", "smartExportJsonButton", "smartPrintReportButton"].forEach((id) => { el(id).disabled = false; });
        renderOverview(result);
        renderSchema(result);
        renderQuality(result);
        renderTrends(result);
        renderOutliers(result);
        renderCorrelations(result);
        renderRecommendations(result);
        renderReport(result);
        switchTab(activeTab);
    }

    function renderOverview(result) {
        const summary = el("smartExecutiveSummary");
        summary.replaceChildren(...result.report.executiveSummary.map((line) => create("li", line)));
        const container = el("smartInsightsContainer");
        container.replaceChildren(...result.insights.slice(0, 12).map((insight) => {
            const card = create("article", null, `insight-card severity-${insight.severity}`);
            card.append(
                create("div", insight.title, "insight-title"),
                create("p", insight.statement),
                create("small", `Pewność: ${formatPercent(insight.confidence)} · Zalecenie: ${insight.recommendedAction || "weryfikacja biznesowa"}`)
            );
            return card;
        }));
        if (!result.insights.length) container.append(create("p", "Nie wykryto istotnych wniosków przy aktualnych progach."));
    }

    function renderSchema(result) {
        const body = el("smartSchemaTableBody");
        body.replaceChildren(...result.schema.profiles.map((profile) => {
            const range = profile.numeric ? `${formatNumber(profile.numeric.minimum)} – ${formatNumber(profile.numeric.maximum)}`
                : profile.date ? `${profile.date.minimum} – ${profile.date.maximum}`
                    : (profile.examples || []).join(", ");
            return row([
                profile.label,
                typeLabel(profile.physicalType),
                roleLabel(profile.semanticRole),
                formatPercent(profile.semanticConfidence),
                `${formatInteger(profile.missingCount)} (${formatPercent(profile.missingRatio)})`,
                `${formatInteger(profile.uniqueCount)} (${formatPercent(profile.uniqueRatio)})`,
                range || "—",
                [...(profile.typeEvidence || []), ...(profile.semanticEvidence || [])].join(" ") || "—"
            ]);
        }));
    }

    function renderQuality(result) {
        el("smartQualitySummary").textContent = `Wynik ${result.quality.score}/100 (${result.quality.grade}). Problemy wysokie: ${result.quality.summary.high}, średnie: ${result.quality.summary.medium}, niskie: ${result.quality.summary.low}.`;
        const labels = fieldLabelMap(result);
        el("smartQualityIssuesBody").replaceChildren(...result.quality.issues.map((issue) => row([
            severityLabel(issue.severity), issue.title, issue.statement, labels.get(issue.fieldId) || issue.fieldId || "—"
        ], `severity-row-${issue.severity}`)));
    }

    function renderTrends(result) {
        const select = el("smartTrendSelector");
        const trends = result.trends.trends || [];
        select.replaceChildren(...trends.map((trend) => {
            const option = document.createElement("option");
            option.value = trend.fieldId;
            option.textContent = trend.label;
            return option;
        }));
        activeTrendField = trends.some((trend) => trend.fieldId === activeTrendField) ? activeTrendField : trends[0]?.fieldId || null;
        select.value = activeTrendField || "";
        select.disabled = !trends.length;
        el("smartPeriodComparisonBody").replaceChildren(...(result.periodComparisons.comparisons || []).map((comparison) => {
            const top = comparison.contributors?.[0];
            return row([
                comparison.label,
                `${comparison.currentPeriod}: ${formatNumber(comparison.currentValue)}`,
                `${comparison.previousPeriod}: ${formatNumber(comparison.previousValue)}`,
                formatNumber(comparison.absoluteChange),
                formatPercent(comparison.percentageChange),
                top ? `${top.dimension}: ${formatNumber(top.change)}` : "—"
            ]);
        }));
        renderTrendChart();
    }

    function renderTrendChart() {
        trendChart?.destroy();
        trendChart = null;
        const result = state.get("smartAnalytics.result");
        const trend = result?.trends?.trends?.find((item) => item.fieldId === activeTrendField) || result?.trends?.trends?.[0];
        if (!trend || typeof Chart !== "function") return;
        trendChart = new Chart(el("smartTrendChart"), {
            type: "line",
            data: { labels: trend.series.map((item) => item.period), datasets: [{ label: trend.label, data: trend.series.map((item) => item.value), tension: 0.2 }] },
            options: { responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false }, scales: { y: { beginAtZero: false } } }
        });
    }

    function renderOutliers(result) {
        el("smartOutliersBody").replaceChildren(...result.outliers.findings.map((item) => row([
            severityLabel(item.severity),
            item.rowId,
            item.label,
            formatNumber(item.value),
            (item.localExpectedRange || item.expectedRange || []).map(formatNumber).join(" – "),
            item.local ? `${item.method}; ${item.localMethod}` : item.method,
            item.groupValue || "—"
        ], `severity-row-${item.severity}`)));
    }

    function renderCorrelations(result) {
        const rows = [];
        result.correlations.numericPairs.slice(0, 20).forEach((item) => rows.push(row([item.leftLabel, item.rightLabel, "Pearson / Spearman", `${formatNumber(item.pearson)} / ${formatNumber(item.spearman)}`, formatInteger(item.sampleSize), formatPercent(item.confidence)])));
        result.correlations.categoryMeasure.slice(0, 10).forEach((item) => rows.push(row([item.categoryLabel, item.measureLabel, "η²", formatNumber(item.etaSquared), formatInteger(item.sampleSize), formatPercent(item.confidence)])));
        result.correlations.categoryPairs.slice(0, 10).forEach((item) => rows.push(row([item.leftLabel, item.rightLabel, "V Craméra", formatNumber(item.cramersV), formatInteger(item.sampleSize), formatPercent(item.confidence)])));
        el("smartCorrelationsBody").replaceChildren(...rows);
        correlationChart?.destroy();
        correlationChart = null;
        const strongest = result.correlations.strongestNumeric;
        if (strongest && typeof Chart === "function") {
            correlationChart = new Chart(el("smartCorrelationChart"), {
                type: "scatter",
                data: { datasets: [{ label: `${strongest.leftLabel} ↔ ${strongest.rightLabel}`, data: strongest.samplePoints }] },
                options: { responsive: true, maintainAspectRatio: false, scales: { x: { title: { display: true, text: strongest.leftLabel } }, y: { title: { display: true, text: strongest.rightLabel } } } }
            });
        }
    }

    function renderRecommendations(result) {
        const pivotContainer = el("smartPivotCards");
        pivotContainer.replaceChildren(...result.pivots.map((pivot, index) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = `recommendation-card${index === activePivotIndex ? " is-active" : ""}`;
            button.dataset.pivotIndex = String(index);
            button.append(create("strong", pivot.title), create("span", pivot.reason), create("small", `Pewność ${formatPercent(pivot.confidence)} · ${pivot.result?.generatedBy === "duckdb-wasm" ? "DuckDB" : "JavaScript"}`));
            return button;
        }));
        const chartContainer = el("smartChartRecommendationButtons");
        chartContainer.replaceChildren(...result.recommendedCharts.map((chart, index) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = `recommendation-card${index === activeChartIndex ? " is-active" : ""}`;
            button.dataset.chartIndex = String(index);
            button.append(create("strong", chart.title), create("span", chart.reason), create("small", `${chartTypeLabel(chart.type)} · Pewność ${formatPercent(chart.confidence)}`));
            return button;
        }));
        activePivotIndex = Math.min(activePivotIndex, Math.max(0, result.pivots.length - 1));
        activeChartIndex = Math.min(activeChartIndex, Math.max(0, result.recommendedCharts.length - 1));
        renderPivotPreview();
        renderRecommendedChart();
    }

    function handlePivotCardClick(event) {
        const button = event.target.closest("[data-pivot-index]");
        if (!button) return;
        activePivotIndex = Number(button.dataset.pivotIndex) || 0;
        renderRecommendations(state.get("smartAnalytics.result"));
    }

    function handleChartRecommendationClick(event) {
        const button = event.target.closest("[data-chart-index]");
        if (!button) return;
        activeChartIndex = Number(button.dataset.chartIndex) || 0;
        renderRecommendations(state.get("smartAnalytics.result"));
    }

    function renderPivotPreview() {
        const result = state.get("smartAnalytics.result");
        const pivot = result?.pivots?.[activePivotIndex];
        const container = el("smartPivotPreview");
        container.replaceChildren();
        if (!pivot?.result?.rows?.length) { container.append(create("p", "Brak danych do podglądu tabeli.")); return; }
        const table = document.createElement("table");
        const thead = document.createElement("thead");
        thead.append(row([fieldLabelMap(result).get(pivot.rows?.[0]) || "Wiersz", ...pivot.result.columns, "Razem"], "", "th"));
        const tbody = document.createElement("tbody");
        pivot.result.rows.slice(0, 50).forEach((item) => tbody.append(row([item.key, ...pivot.result.columns.map((column) => formatNumber(item.values[column])), formatNumber(item.total)])));
        table.append(thead, tbody);
        container.append(table);
    }

    function renderRecommendedChart() {
        recommendedChart?.destroy();
        recommendedChart = null;
        const recommendation = state.get("smartAnalytics.result.recommendedCharts", [])[activeChartIndex];
        if (!recommendation || typeof Chart !== "function") return;
        const type = recommendation.type === "scatter" ? "scatter" : recommendation.type === "line" ? "line" : "bar";
        recommendedChart = new Chart(el("smartRecommendedChart"), {
            type,
            data: recommendation.data,
            options: {
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: recommendation.type === "bar-horizontal" ? "y" : "x",
                scales: type === "bar" ? { y: { beginAtZero: true } } : undefined
            }
        });
    }

    function renderReport(result) {
        const root = el("smartReportContent");
        root.replaceChildren(create("h2", result.report.title));
        const executive = create("section");
        executive.append(create("h3", "Podsumowanie zarządcze"));
        const list = create("ul", null, "report-list");
        result.report.executiveSummary.forEach((line) => list.append(create("li", line)));
        executive.append(list);
        root.append(executive);
        result.report.sections.forEach((section) => {
            const sectionElement = create("section");
            sectionElement.append(create("h3", section.title));
            (section.paragraphs || []).forEach((paragraph) => sectionElement.append(create("p", paragraph)));
            if (section.bullets?.length) {
                const bullets = create("ul", null, "report-list");
                section.bullets.forEach((line) => bullets.append(create("li", line)));
                sectionElement.append(bullets);
            }
            root.append(sectionElement);
        });
    }

    function switchTab(name) {
        activeTab = name || "overview";
        all("[data-smart-tab]").forEach((button) => button.classList.toggle("is-active", button.dataset.smartTab === activeTab));
        all("[data-smart-view]").forEach((view) => { view.hidden = view.dataset.smartView !== activeTab; });
        if (activeTab === "trends") renderTrendChart();
        if (activeTab === "correlations") renderCorrelations(state.get("smartAnalytics.result") || { correlations: { numericPairs: [], categoryMeasure: [], categoryPairs: [] } });
        if (activeTab === "recommendations") { renderPivotPreview(); renderRecommendedChart(); }
    }

    function exportJson() {
        const result = state.get("smartAnalytics.result");
        if (!result) return;
        download(new Blob([JSON.stringify(result, null, 2)], { type: "application/json;charset=utf-8" }), `smart-analytics-${dateStamp()}.json`);
    }

    function exportXlsx() {
        const result = state.get("smartAnalytics.result");
        if (!result || !global.XLSX?.utils) return;
        const workbook = global.XLSX.utils.book_new();
        appendSheet(workbook, "Podsumowanie", [
            ["Smart Analytics", "Wartość"],
            ["Wiersze", result.datasetProfile.rows],
            ["Kolumny", result.datasetProfile.columns],
            ["Jakość", result.quality.score],
            ["Klasa jakości", result.quality.grade],
            ["Anomalie", result.outliers.total],
            ["Wnioski", result.insights.length],
            ["Tryb analizy", result.datasetProfile.analysisMode],
            ["Profilowane wiersze", result.datasetProfile.profiledRows],
            ["Silnik statystyczny", result.execution.statisticalEngine],
            ["Silnik SQL", result.execution.sqlEngine],
            ["Wersja reguł", result.execution.rulesVersion],
            ["Wygenerowano", result.generatedAt]
        ], true);
        appendObjects(workbook, "Kolumny", result.schema.profiles.map((profile) => ({
            Kolumna: profile.label, ID: profile.id, Typ: profile.physicalType, Rola: profile.semanticRole,
            "Pewność roli": profile.semanticConfidence, Braki: profile.missingCount, "Braki %": profile.missingRatio,
            Unikalne: profile.uniqueCount, "Unikalne %": profile.uniqueRatio, Minimum: profile.numeric?.minimum ?? profile.date?.minimum ?? "", Maximum: profile.numeric?.maximum ?? profile.date?.maximum ?? "",
            Uzasadnienie: [...(profile.typeEvidence || []), ...(profile.semanticEvidence || [])].join(" ")
        })));
        appendObjects(workbook, "Jakość", result.quality.issues.map((item) => ({ Ważność: item.severity, Problem: item.title, Opis: item.statement, Kolumna: item.fieldId || "", Typ: item.type || "" })));
        appendObjects(workbook, "Trendy", result.trends.trends.map((item) => ({ Miara: item.label, Kierunek: item.direction, Okresy: item.periods, Zmiana: item.change, "Zmiana %": item.changePercent, Nachylenie: item.slope, R2: item.r2, Zmienność: item.volatility, Pewność: item.confidence })));
        appendObjects(workbook, "Porównanie okresów", result.periodComparisons.comparisons.map((item) => ({ Miara: item.label, "Okres bieżący": item.currentPeriod, Bieżący: item.currentValue, "Okres poprzedni": item.previousPeriod, Poprzedni: item.previousValue, Zmiana: item.absoluteChange, "Zmiana %": item.percentageChange })));
        appendObjects(workbook, "Anomalie", result.outliers.findings.map((item) => ({ Ważność: item.severity, Rekord: item.rowId, Kolumna: item.label, Wartość: item.value, "Zakres od": (item.localExpectedRange || item.expectedRange || [])[0], "Zakres do": (item.localExpectedRange || item.expectedRange || [])[1], Metoda: item.method, Grupa: item.groupValue || "", Pewność: item.confidence })));
        appendObjects(workbook, "Korelacje", result.correlations.numericPairs.map((item) => ({ "Zmienna 1": item.leftLabel, "Zmienna 2": item.rightLabel, Pearson: item.pearson, Spearman: item.spearman, Próba: item.sampleSize, Pewność: item.confidence })));
        appendObjects(workbook, "Wnioski", result.insights.map((item) => ({ Ważność: item.severity, Typ: item.type, Tytuł: item.title, Wniosek: item.statement, Pewność: item.confidence, Działanie: item.recommendedAction || "" })));
        appendSheet(workbook, "Raport", result.report.plainText.split("\n").map((line) => [line]), true);
        result.pivots.slice(0, 4).forEach((pivot, index) => {
            const headers = [fieldLabelMap(result).get(pivot.rows?.[0]) || "Wiersz", ...pivot.result.columns, "Razem"];
            const rows = pivot.result.rows.map((item) => [item.key, ...pivot.result.columns.map((column) => item.values[column]), item.total]);
            appendSheet(workbook, `Pivot ${index + 1}`, [headers, ...rows], true);
        });
        global.XLSX.writeFile(workbook, `smart-analytics-${dateStamp()}.xlsx`, { compression: true });
    }

    function appendObjects(workbook, name, objects) {
        global.XLSX.utils.book_append_sheet(workbook, global.XLSX.utils.json_to_sheet(objects.length ? objects : [{}]), name.slice(0, 31));
    }

    function appendSheet(workbook, name, arrays, arrayMode = false) {
        const sheet = arrayMode ? global.XLSX.utils.aoa_to_sheet(arrays) : global.XLSX.utils.json_to_sheet(arrays);
        global.XLSX.utils.book_append_sheet(workbook, sheet, name.slice(0, 31));
    }

    function printReport() {
        if (!state.get("smartAnalytics.result")) return;
        document.body.classList.add("print-smart-report");
        global.setTimeout(() => {
            global.print();
            global.setTimeout(() => document.body.classList.remove("print-smart-report"), 300);
        }, 0);
    }

    function destroyCharts() {
        [trendChart, correlationChart, recommendedChart].forEach((chart) => { try { chart?.destroy(); } catch (_) { /* noop */ } });
        trendChart = null;
        correlationChart = null;
        recommendedChart = null;
    }

    function create(tag, text = null, className = "") {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== null && text !== undefined) node.textContent = String(text);
        return node;
    }

    function row(values, className = "", cellTag = "td") {
        const tr = document.createElement("tr");
        if (className) tr.className = className;
        values.forEach((value) => tr.append(create(cellTag, value)));
        return tr;
    }

    function fieldLabelMap(result) {
        return new Map((result?.schema?.profiles || []).map((profile) => [profile.id, profile.label]));
    }

    function formatInteger(value) { return new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 0 }).format(Number(value) || 0); }
    function formatNumber(value) { return Number.isFinite(Number(value)) ? new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 2 }).format(Number(value)) : "—"; }
    function formatPercent(value) { return Number.isFinite(Number(value)) ? `${Math.round(Number(value) * 1000) / 10}%` : "—"; }
    function formatDateTime(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("pl-PL", { dateStyle: "short", timeStyle: "medium" }).format(date); }
    function dateStamp() { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
    function download(blob, filename) { const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    function severityLabel(value) { return ({ high: "Wysoka", medium: "Średnia", low: "Niska" })[value] || value || "—"; }
    function typeLabel(value) { return ({ number: "Liczba", date: "Data", boolean: "Tak/Nie", text: "Tekst", mixed: "Mieszany", empty: "Pusta" })[value] || value || "—"; }
    function roleLabel(value) { return ({ date: "Data", identifier: "Identyfikator", category: "Kategoria", measure: "Miara", quantity: "Ilość", currency: "Kwota", percentage: "Procent", stock: "Zapas", price: "Cena", cost: "Koszt", duration: "Czas", status: "Status", supplier: "Dostawca", material: "Materiał", brand: "Marka", location: "Lokalizacja", free_text: "Opis", boolean: "Tak/Nie", unknown: "Nieznana" })[value] || value || "—"; }
    function chartTypeLabel(value) { return ({ line: "Liniowy", bar: "Słupkowy", "bar-horizontal": "Słupkowy poziomy", scatter: "Rozrzut", histogram: "Histogram" })[value] || value; }

    const api = Object.freeze({
        initialize,
        destroy,
        run,
        cancel,
        renderResult,
        exportXlsx,
        exportJson,
        printReport,
        getResult: () => state.get("smartAnalytics.result", null),
        isRunning: () => Boolean(activeRequestId)
    });

    Object.defineProperty(PMA, "smartAnalyticsEngine", { value: api, enumerable: true, configurable: false, writable: false });
}(window));
