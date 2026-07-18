/* ==========================================================
   Pack Materials Analytics
   src/chart-engine.js
========================================================== */

(function initializeChartEngine(global) {
    "use strict";

    const PMA = global.PMA || (global.PMA = {});
    if (!PMA.constants || !PMA.state || !PMA.utils || !PMA.dom) {
        throw new Error("PMA core modules must be loaded before src/chart-engine.js.");
    }

    const { STATUS, CHART_TYPES, CHART_TYPE_IDS, DEFAULT_ANALYSIS, PROCESSING_LIMITS, UI_TEXT } = PMA.constants;
    const { cleanText, isBlank, parseNumber, formatNumber, formatInteger, truncate, clonePlain, normalizeError } = PMA.utils;
    const state = PMA.state;
    const dom = PMA.dom;
    const elements = dom.elements;

    const chartTypeMap = new Map(CHART_TYPES.map((item) => [item.id, item]));
    const palette = [
        ["rgba(200,16,46,.78)", "rgb(200,16,46)"],
        ["rgba(39,100,196,.76)", "rgb(39,100,196)"],
        ["rgba(22,131,79,.76)", "rgb(22,131,79)"],
        ["rgba(168,98,0,.76)", "rgb(168,98,0)"],
        ["rgba(111,66,193,.76)", "rgb(111,66,193)"],
        ["rgba(0,128,128,.76)", "rgb(0,128,128)"],
        ["rgba(218,82,22,.76)", "rgb(218,82,22)"],
        ["rgba(78,93,108,.76)", "rgb(78,93,108)"],
        ["rgba(183,33,124,.76)", "rgb(183,33,124)"],
        ["rgba(82,121,111,.76)", "rgb(82,121,111)"]
    ];

    let initialized = false;
    let chartInstance = null;
    let lastModel = null;
    let resizeObserver = null;

    function initialize() {
        if (initialized) return api;
        assertChartJs();
        global.Chart.defaults.color = getCssVariable("--text-secondary", "#5f6b7c");
        global.Chart.defaults.borderColor = getCssVariable("--border", "#dbe1e8");
        global.Chart.defaults.font.family = getCssVariable("--font-family", "Inter, Arial, sans-serif");
        global.Chart.defaults.animation.duration = prefersReducedMotion() ? 0 : 250;
        if (typeof ResizeObserver === "function" && elements.analysisChart.parentElement) {
            resizeObserver = new ResizeObserver(() => chartInstance?.resize?.());
            resizeObserver.observe(elements.analysisChart.parentElement);
        }
        initialized = true;
        return api;
    }

    function destroy() {
        clear();
        resizeObserver?.disconnect();
        resizeObserver = null;
        initialized = false;
    }

    function render(pivotResult = null, options = {}) {
        if (!initialized) initialize();
        const source = pivotResult || state.get("pivot");
        const chartType = normalizeChartType(options.chartType || state.get("analysis.chartType", DEFAULT_ANALYSIS.chartType));
        clearChart(false);
        const model = buildChartModel(source, {
            chartType,
            maximumLabels: options.maximumLabels || PROCESSING_LIMITS.maximumChartLabels
        });
        lastModel = model;
        if (!model.hasNumericData || !model.labels.length || !model.datasets.length) {
            renderNoData();
            state.setChartInstance(null);
            return null;
        }
        const context = elements.analysisChart.getContext("2d");
        if (!context) throw new Error("Nie można utworzyć kontekstu wykresu.");
        chartInstance = new global.Chart(context, createConfiguration(model, chartType, options));
        state.setChartInstance(chartInstance);
        state.setApplicationStatus(STATUS.SUCCESS);
        updateDescription(model, chartType);
        return chartInstance;
    }

    function buildChartModel(pivotResult, options = {}) {
        const chartType = normalizeChartType(options.chartType);
        const maximumLabels = Math.max(1, Math.trunc(options.maximumLabels || PROCESSING_LIMITS.maximumChartLabels));
        const source = pivotResult || {};
        const rows = Array.isArray(source.rows) ? source.rows : [];
        const columns = Array.isArray(source.columnKeys) ? source.columnKeys : [];
        if (!source.ready || !rows.length || !columns.length) return emptyModel(chartType);

        const visibleRows = selectRows(rows, columns, chartType, maximumLabels);
        const labels = visibleRows.map((row, index) => createRowLabel(row, index));
        const datasets = chartType === "pie"
            ? createPieDatasets(visibleRows, columns)
            : createCartesianDatasets(visibleRows, columns, chartType);
        const values = datasets.flatMap((dataset) => dataset.data).filter((value) => typeof value === "number" && Number.isFinite(value));
        return {
            chartType,
            labels,
            datasets,
            sourceRowCount: source.statistics?.sourceRows || 0,
            sourceGroupCount: rows.length,
            visibleGroupCount: visibleRows.length,
            truncated: visibleRows.length < rows.length,
            aggregation: source.result?.aggregation || "sum",
            rowFields: source.rowFields || [],
            columnFields: source.columnFields || [],
            valueFields: source.valueFields || [],
            hasNumericData: values.length > 0,
            minimum: values.length ? values.reduce((minimum, value) => Math.min(minimum, value), Infinity) : null,
            maximum: values.length ? values.reduce((maximum, value) => Math.max(maximum, value), -Infinity) : null,
            total: ["sum", "count"].includes(source.result?.aggregation || "sum")
                ? values.reduce((sum, value) => sum + value, 0)
                : null
        };
    }

    function emptyModel(chartType) {
        return {
            chartType,
            labels: [],
            datasets: [],
            sourceRowCount: 0,
            sourceGroupCount: 0,
            visibleGroupCount: 0,
            truncated: false,
            aggregation: "sum",
            rowFields: [],
            columnFields: [],
            valueFields: [],
            hasNumericData: false,
            minimum: null,
            maximum: null,
            total: 0
        };
    }

    function selectRows(rows, columns, chartType, limit) {
        if (rows.length <= limit) return rows;
        if (chartType === "line") return rows.slice(0, limit);
        return rows
            .map((row, index) => {
                const chartValue = chartType === "pie" ? normalizeNumber(row.chartValue) : null;
                const magnitude = chartValue === null
                    ? columns.reduce((sum, column) => {
                        const value = normalizeNumber(row.cells?.[column.id]);
                        return value === null ? sum : sum + Math.abs(value);
                    }, 0)
                    : Math.abs(chartValue);
                return { row, index, magnitude };
            })
            .sort((a, b) => b.magnitude - a.magnitude)
            .slice(0, limit)
            .map((item) => item.row);
    }

    function createRowLabel(row, index) {
        const label = cleanText(row.rowLabel);
        if (label) return truncate(label, 60);
        if (Array.isArray(row.rowValues) && row.rowValues.length) {
            return truncate(row.rowValues.map((value) => isBlank(value) ? UI_TEXT.emptyValue : String(value)).join(" · "), 60);
        }
        return `Grupa ${index + 1}`;
    }

    function createCartesianDatasets(rows, columns, chartType) {
        return columns.map((column, index) => {
            const color = getColor(index);
            const base = {
                label: column.label || column.valueLabel || `Wartość ${index + 1}`,
                data: rows.map((row) => normalizeNumber(row.cells?.[column.id])),
                backgroundColor: chartType === "line" ? color.soft : color.background,
                borderColor: color.border,
                borderWidth: chartType === "line" ? 2 : 1,
                borderRadius: chartType === "line" ? 0 : 4,
                maxBarThickness: 48,
                spanGaps: true
            };
            if (chartType === "line") {
                return { ...base, fill: false, tension: .24, pointRadius: rows.length > 60 ? 0 : 3, pointHoverRadius: 5 };
            }
            if (chartType === "stacked") return { ...base, stack: "main" };
            return base;
        });
    }

    function createPieDatasets(rows, columns) {
        const data = rows.map((row) => {
            const precomputed = normalizeNumber(row.chartValue);
            if (precomputed !== null) return precomputed;
            const values = columns.map((column) => normalizeNumber(row.cells?.[column.id])).filter((value) => value !== null);
            return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
        });
        return [{
            label: columns.length === 1 ? columns[0].label : "Łączna wartość",
            data,
            backgroundColor: rows.map((_, index) => getColor(index).background),
            borderColor: rows.map((_, index) => getColor(index).border),
            borderWidth: 1,
            hoverOffset: 8
        }];
    }

    function normalizeNumber(value) {
        if (value === null || value === undefined || value === "") return null;
        if (typeof value === "number") return Number.isFinite(value) ? value : null;
        return parseNumber(value);
    }

    function createConfiguration(model, chartType, options = {}) {
        const isPie = chartType === "pie";
        const isLine = chartType === "line";
        const isStacked = chartType === "stacked";
        return {
            type: chartTypeMap.get(chartType)?.chartJsType || "bar",
            data: { labels: model.labels, datasets: model.datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: prefersReducedMotion() ? 0 : options.animationDuration ?? 250 },
                interaction: { mode: isPie ? "nearest" : "index", intersect: isPie },
                layout: { padding: { top: 8, right: 10, bottom: 4, left: 4 } },
                plugins: {
                    legend: {
                        display: isPie || model.datasets.length > 1,
                        position: isPie ? "right" : "bottom",
                        labels: { usePointStyle: true, boxWidth: 12, boxHeight: 12, padding: 16, font: { size: 11 } }
                    },
                    tooltip: { enabled: true, padding: 11, callbacks: createTooltipCallbacks(chartType, model.aggregation) },
                    title: { display: Boolean(options.title), text: cleanText(options.title), font: { size: 15, weight: "600" } }
                },
                scales: isPie ? undefined : {
                    x: {
                        stacked: isStacked,
                        grid: { display: false },
                        ticks: {
                            autoSkip: true,
                            maxTicksLimit: model.labels.length > 40 ? 20 : 30,
                            maxRotation: model.labels.length > 12 ? 45 : 0,
                            callback(_value, index) { return truncate(model.labels[index], 24); }
                        }
                    },
                    y: {
                        stacked: isStacked,
                        beginAtZero: model.minimum === null || model.minimum >= 0,
                        grace: isLine ? "5%" : "3%",
                        grid: { color: "rgba(95,107,124,.12)" },
                        border: { display: false },
                        ticks: { callback: formatAxisNumber }
                    }
                }
            }
        };
    }

    function createTooltipCallbacks(chartType, aggregation) {
        if (chartType === "pie") {
            return {
                label(context) {
                    const value = normalizeNumber(context.raw) || 0;
                    const total = context.dataset.data.reduce((sum, item) => sum + (normalizeNumber(item) || 0), 0);
                    const percentage = total ? value / total * 100 : 0;
                    return `${context.label}: ${formatNumber(value)} (${formatNumber(percentage, { maximumFractionDigits: 1 })}%)`;
                }
            };
        }
        return {
            label(context) {
                const value = normalizeNumber(context.raw);
                return `${context.dataset.label}: ${value === null ? "—" : formatNumber(value)}`;
            },
            footer(items) {
                if (!["sum", "count"].includes(aggregation) || items.length <= 1) return "";
                return `Razem: ${formatNumber(items.reduce((sum, item) => sum + (normalizeNumber(item.raw) || 0), 0))}`;
            }
        };
    }

    function updateDescription(model, chartType) {
        const label = chartTypeMap.get(chartType)?.label || chartType;
        const description = `Wykres ${label.toLowerCase()} · ${formatInteger(model.visibleGroupCount)} grup · ${formatInteger(model.datasets.length)} serii${model.truncated ? ` · pokazano ${formatInteger(model.visibleGroupCount)} z ${formatInteger(model.sourceGroupCount)}` : ""}.`;
        dom.setText(elements.chartDescription, description);
        elements.analysisChart.setAttribute("role", "img");
        const numericSummary = model.total === null
            ? `Zakres widocznych wartości: ${formatNumber(model.minimum)}–${formatNumber(model.maximum)}.`
            : `Łączna wartość widocznych punktów: ${formatNumber(model.total)}.`;
        elements.analysisChart.setAttribute("aria-label", `${description} ${numericSummary}`);
    }

    function renderNoData() {
        clearCanvas();
        dom.setText(elements.chartDescription, "Brak danych liczbowych do wyświetlenia na wykresie.");
        elements.analysisChart.setAttribute("aria-label", "Brak danych do wyświetlenia.");
    }

    function clear() {
        clearChart(true);
        lastModel = null;
        dom.setText(elements.chartDescription, "");
        elements.analysisChart.removeAttribute("aria-label");
    }

    function clearChart(updateState = true) {
        const registered = global.Chart?.getChart?.(elements.analysisChart);
        if (registered && registered !== chartInstance) registered.destroy();
        chartInstance?.destroy?.();
        chartInstance = null;
        clearCanvas();
        if (updateState && state.get("chart.instance")) state.setChartInstance(null);
    }

    function clearCanvas() {
        const context = elements.analysisChart.getContext("2d");
        context?.clearRect(0, 0, elements.analysisChart.width, elements.analysisChart.height);
    }

    function getImageDataUrl(options = {}) {
        if (!chartInstance) return null;
        const exportCanvas = document.createElement("canvas");
        exportCanvas.width = elements.analysisChart.width;
        exportCanvas.height = elements.analysisChart.height;
        const context = exportCanvas.getContext("2d");
        if (!context) return null;
        context.fillStyle = options.backgroundColor || "#ffffff";
        context.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
        context.drawImage(elements.analysisChart, 0, 0);
        return exportCanvas.toDataURL(options.type || "image/png", options.quality ?? 1);
    }

    function getImageBlob(options = {}) {
        return new Promise((resolve) => {
            const url = getImageDataUrl(options);
            if (!url) return resolve(null);
            fetch(url).then((response) => response.blob()).then(resolve).catch(() => resolve(null));
        });
    }

    function getColor(index) {
        if (index < palette.length) {
            return { background: palette[index][0], border: palette[index][1], soft: palette[index][0].replace(/\.[0-9]+\)$/, ".16)") };
        }
        const hue = Math.round(index * 137.508 % 360);
        return { background: `hsla(${hue},58%,50%,.76)`, border: `hsl(${hue},62%,39%)`, soft: `hsla(${hue},58%,50%,.16)` };
    }

    function formatAxisNumber(value) {
        const number = Number(value);
        if (!Number.isFinite(number)) return String(value);
        const absolute = Math.abs(number);
        if (absolute >= 1e9) return `${formatNumber(number / 1e9, { maximumFractionDigits: 1 })} mld`;
        if (absolute >= 1e6) return `${formatNumber(number / 1e6, { maximumFractionDigits: 1 })} mln`;
        if (absolute >= 1e3) return `${formatNumber(number / 1e3, { maximumFractionDigits: 1 })} tys.`;
        return formatNumber(number, { maximumFractionDigits: 1 });
    }

    function getCssVariable(name, fallback) {
        return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
    }

    function prefersReducedMotion() {
        return Boolean(global.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
    }

    function normalizeChartType(type) {
        return CHART_TYPE_IDS.includes(type) ? type : DEFAULT_ANALYSIS.chartType;
    }

    function assertChartJs() {
        if (!global.Chart || typeof global.Chart !== "function") throw new Error("Biblioteka Chart.js nie została załadowana.");
    }

    function handleError(error, context = "Generowanie wykresu") {
        clearChart(true);
        const normalized = normalizeError(error);
        dom.setText(elements.chartDescription, normalized.message);
        dom.setStatusBadge(elements.analysisStatusBadge, "Błąd wykresu", STATUS.ERROR);
        dom.showError(normalized.message, context);
    }

    const api = Object.freeze({
        initialize,
        destroy,
        render,
        clear,
        buildChartModel,
        createChartConfiguration: createConfiguration,
        getImageDataUrl,
        getImageBlob,
        getCurrentChart: () => chartInstance,
        getLastModel: () => lastModel ? clonePlain(lastModel) : null,
        handleError,
        isInitialized: () => initialized
    });

    Object.defineProperty(PMA, "chartEngine", {
        value: api,
        writable: false,
        enumerable: true,
        configurable: false
    });
})(window);
