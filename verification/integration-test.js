"use strict";

const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const APP_DIR = path.resolve(__dirname, "../apps/materials");
const INDEX_PATH = path.join(APP_DIR, "index.html");
const BASE_URL = "http://127.0.0.1:8804/index.html";

const POLYFILL_SCRIPT = `
<script>
  window.URL.createObjectURL = window.URL.createObjectURL || function () { return "blob:stub"; };
  window.URL.revokeObjectURL = window.URL.revokeObjectURL || function () {};
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || function () {};
  window.MutationObserver = function () { this.observe=function(){}; this.disconnect=function(){}; this.takeRecords=function(){return[];}; };
  window.ResizeObserver = window.ResizeObserver || function () {
    this.observe = function () {};
    this.unobserve = function () {};
    this.disconnect = function () {};
  };
  window.requestAnimationFrame = window.requestAnimationFrame || function (cb) { return setTimeout(cb, 0); };
  window.cancelAnimationFrame = window.cancelAnimationFrame || function (id) { clearTimeout(id); };

  function stubContext2d() {
    var noop = function () {};
    var ctx = {
      canvas: null,
      fillStyle: "#000", strokeStyle: "#000", lineWidth: 1, lineCap: "butt", lineJoin: "miter",
      miterLimit: 10, lineDashOffset: 0, shadowOffsetX: 0, shadowOffsetY: 0, shadowBlur: 0,
      shadowColor: "rgba(0,0,0,0)", globalAlpha: 1, globalCompositeOperation: "source-over",
      font: "10px sans-serif", textAlign: "start", textBaseline: "alphabetic", direction: "ltr",
      imageSmoothingEnabled: true,
      save: noop, restore: noop, scale: noop, rotate: noop, translate: noop, transform: noop,
      setTransform: noop, resetTransform: noop, getTransform: function () { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; },
      clearRect: noop, fillRect: noop, strokeRect: noop,
      beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop, bezierCurveTo: noop,
      quadraticCurveTo: noop, arc: noop, arcTo: noop, ellipse: noop, rect: noop, roundRect: noop,
      fill: noop, stroke: noop, clip: noop,
      isPointInPath: function () { return false; }, isPointInStroke: function () { return false; },
      drawImage: noop,
      createImageData: function () { return { data: [] }; },
      getImageData: function () { return { data: [] }; },
      putImageData: noop,
      setLineDash: noop, getLineDash: function () { return []; },
      measureText: function () { return { width: 10, actualBoundingBoxAscent: 5, actualBoundingBoxDescent: 2, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 10 }; },
      fillText: noop, strokeText: noop,
      createLinearGradient: function () { return { addColorStop: noop }; },
      createRadialGradient: function () { return { addColorStop: noop }; },
      createPattern: function () { return {}; }
    };
    return ctx;
  }
  HTMLCanvasElement.prototype.getContext = function (type) {
    if (type === "2d") { var ctx = stubContext2d(); ctx.canvas = this; return ctx; }
    return null;
  };
  HTMLCanvasElement.prototype.getBoundingClientRect = function () {
    return { width: 600, height: 300, top: 0, left: 0, right: 600, bottom: 300, x: 0, y: 0, toJSON: function () {} };
  };
</script>
`;

function loadHtml() {
    const html = fs.readFileSync(INDEX_PATH, "utf-8");
    return html.replace("<head>", "<head>" + POLYFILL_SCRIPT);
}

function waitFor(conditionFn, { timeout = 15000, interval = 25 } = {}) {
    const start = Date.now();
    return new Promise((resolve, reject) => {
        const tick = () => {
            let result;
            try {
                result = conditionFn();
            } catch (error) {
                reject(error);
                return;
            }
            if (result) {
                resolve();
                return;
            }
            if (Date.now() - start > timeout) {
                reject(new Error("waitFor: timed out"));
                return;
            }
            setTimeout(tick, interval);
        };
        tick();
    });
}

const results = [];
function check(label, actual, expected) {
    const pass = JSON.stringify(actual) === JSON.stringify(expected);
    results.push({ label, pass, actual, expected });
    console.log(`${pass ? "PASS" : "FAIL"} — ${label}` + (pass ? "" : ` (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`));
    return pass;
}

function checkTrue(label, condition, extra) {
    results.push({ label, pass: Boolean(condition) });
    console.log(`${Boolean(condition) ? "PASS" : "FAIL"} — ${label}` + (extra ? ` (${extra})` : ""));
    return Boolean(condition);
}

async function main() {
    const consoleErrors = [];
    const pageErrors = [];

    const dom = new JSDOM(loadHtml(), {
        url: BASE_URL,
        runScripts: "dangerously",
        resources: "usable",
        pretendToBeVisual: true
    });

    dom.window.addEventListener("error", (event) => pageErrors.push(event.error || event.message));
    dom.window.addEventListener("unhandledrejection", (event) => pageErrors.push(event.reason));
    const originalConsoleError = dom.window.console.error;
    dom.window.console.error = (...args) => {
        consoleErrors.push(args.map(String).join(" "));
        originalConsoleError(...args);
    };

    const { window } = dom;

    await waitFor(() => window.document.body.classList.contains("app-ready"), { timeout: 20000 });
    console.log("\n--- boot ---");
    checkTrue("app booted (body.app-ready)", window.document.body.classList.contains("app-ready"));
    checkTrue("PMA.decisionEngine exists", Boolean(window.PMA && window.PMA.decisionEngine));
    checkTrue("PMA.decisionEngine initialized", window.PMA.decisionEngine.initialized === true);
    checkTrue("SheetJS loaded", Boolean(window.XLSX && window.XLSX.version));
    checkTrue("Chart.js loaded", Boolean(window.Chart && window.Chart.version));

    const { PMA } = window;

    // ---- build synthetic mapped rows and push them through the REAL
    // normalization engine, exactly like a real import would. ----
    function mappedRow({ date, material, quantity, stockLevel, brand }) {
        const base = Object.fromEntries(PMA.constants.SYSTEM_FIELDS.map((f) => [f.id, null]));
        return { ...base, date, material, quantity, stockLevel, brand };
    }

    const inputs = [
        // Taśma pakowa — 10 consecutive December days, high reliability, clear stockout risk.
        ...Array.from({ length: 10 }, (_, i) => mappedRow({
            date: `2025-12-${String(20 + i).padStart(2, "0")}`,
            material: "Taśma pakowa", quantity: 70, brand: "H&M",
            stockLevel: i === 9 ? 300 : null
        })),
        // Folia stretch — spans the Dec/Jan winter boundary, medium reliability.
        mappedRow({ date: "2025-12-25", material: "Folia stretch", quantity: 60, brand: "COS", stockLevel: null }),
        mappedRow({ date: "2025-12-31", material: "Folia stretch", quantity: 40, brand: "COS", stockLevel: null }),
        mappedRow({ date: "2026-01-02", material: "Folia stretch", quantity: 55, brand: "COS", stockLevel: null }),
        mappedRow({ date: "2026-01-05", material: "Folia stretch", quantity: 45, brand: "COS", stockLevel: 300 }),
        // Karton — only 2 observed days: must be flagged "insufficient" data.
        mappedRow({ date: "2026-01-10", material: "Karton", quantity: 40, brand: "ARKET", stockLevel: null }),
        mappedRow({ date: "2026-01-11", material: "Karton", quantity: 60, brand: "ARKET", stockLevel: 200 })
    ];

    const normalizedRows = [];
    const canonicalMaps = PMA.normalizationEngine.buildDatasetFields
        ? null
        : null;
    inputs.forEach((mappedRecord, index) => {
        const result = PMA.normalizationEngine.normalizeSingleRecord(mappedRecord, {
            sourceRowNumber: index + 2,
            sourceFile: "test.xlsx",
            sourceSheet: "Dane",
            importedAt: new Date().toISOString()
        });
        if (!result.valid) {
            throw new Error(`Synthetic row ${index} failed validation: ${JSON.stringify(result.errors)}`);
        }
        normalizedRows.push(result.record);
    });

    console.log("\n--- synthetic data through the real normalization engine ---");
    checkTrue("16 rows normalized", normalizedRows.length === 16);
    checkTrue("stockLevel parsed as number where present", normalizedRows.find((r) => r.material === "Taśma pakowa" && r.stockLevel === 300) !== undefined);
    checkTrue("stockLevel is null where absent", normalizedRows.find((r) => r.material === "Folia stretch" && r.date === "2025-12-25").stockLevel === null);
    checkTrue("season computed via existing utils (Dec row)", normalizedRows.find((r) => r.material === "Folia stretch" && r.date === "2025-12-25").season === "Zima");
    checkTrue("season computed via existing utils (Jan row)", normalizedRows.find((r) => r.material === "Folia stretch" && r.date === "2026-01-05").season === "Zima");
    checkTrue("seasonPeriod ties Dec+Jan to the same winter", normalizedRows.filter((r) => r.material === "Folia stretch").every((r) => r.seasonPeriod === "Zima 2025/2026"));

    // ---- scenario A: stockLevel mapped ----
    PMA.state.setMapping({ date: "Data", material: "Materiał", quantity: "Ilość", brand: "Marka", stockLevel: "Stan zapasu" });
    PMA.state.setNormalizedDataset({ normalizedRows, invalidRows: [], duplicateRows: [], fields: [] });

    await waitFor(() => !window.document.getElementById("decisionSection").classList.contains("is-locked"));

    console.log("\n--- scenario A: stockLevel mapped ---");
    checkTrue("decisionSection unlocked via DATA_NORMALIZED event", !window.document.getElementById("decisionSection").classList.contains("is-locked"));
    checkTrue("decisionStockNotice hidden when mapped", window.document.getElementById("decisionStockNotice").hidden === true);

    const coverage = PMA.decisionEngine.getCoverageRows(normalizedRows);
    const tasma = coverage.find((r) => r.material === "Taśma pakowa");
    const folia = coverage.find((r) => r.material === "Folia stretch");
    const karton = coverage.find((r) => r.material === "Karton");

    check("Taśma reliability = high", tasma.reliability, "high");
    check("Taśma averageDaily = 70", Math.round(tasma.averageDaily * 100) / 100, 70);
    check("Taśma coverageDays ≈ 4.29 (300/70)", Math.round(tasma.coverageDays * 100) / 100, Math.round((300 / 70) * 100) / 100);
    checkTrue("Taśma flagged at risk (<7 days)", tasma.coverageDays < PMA.constants.DECISION.riskCoverageDays);

    check("Folia reliability = medium", folia.reliability, "medium");
    checkTrue("Folia NOT at risk (>=7 days)", folia.coverageDays >= PMA.constants.DECISION.riskCoverageDays);

    check("Karton reliability = insufficient", karton.reliability, "insufficient");
    check("Karton coverageDays is null despite having stock", karton.coverageDays, null);

    const abc = PMA.decisionEngine.getAbcRows(normalizedRows);
    const abcByMaterial = Object.fromEntries(abc.map((r) => [r.material, r.classification]));
    check("ABC classification", abcByMaterial, { "Taśma pakowa": "A", "Folia stretch": "B", "Karton": "C" });

    const pareto = PMA.decisionEngine.getParetoResult(normalizedRows);
    check("Pareto materialsFor80 = 2", pareto.materialsFor80, 2);

    const forecastZima = PMA.decisionEngine.getForecastRows("Zima", normalizedRows);
    checkTrue("Forecast (Zima) includes all 3 materials — Dec+Jan pooled correctly", forecastZima.length === 3);
    const forecastTasma = forecastZima.find((r) => r.material === "Taśma pakowa");
    checkTrue("Forecast toOrder > 0 for Taśma (high usage, low stock)", forecastTasma.toOrder > 0);
    const forecastOther = PMA.decisionEngine.getForecastRows("Lato", normalizedRows);
    check("Forecast (Lato) is empty — no summer data", forecastOther.length, 0);

    // ---- DOM rendering checks (scenario A) ----
    console.log("\n--- DOM rendering (scenario A) ---");
    check("KPI materials count", window.document.getElementById("kpiMaterials").textContent, "3");
    checkTrue("KPI stock is not the placeholder dash", window.document.getElementById("kpiStock").textContent !== "—");
    checkTrue("KPI risk count is not the placeholder dash", window.document.getElementById("kpiRisk").textContent !== "—");
    check("Coverage table has 3 body rows", window.document.getElementById("coverageTableBody").children.length, 3);
    check("ABC table has 3 body rows", window.document.getElementById("abcTableBody").children.length, 3);
    checkTrue("Coverage table's first row is the lowest-coverage material (Taśma)", window.document.getElementById("coverageTableBody").children[0].textContent.includes("Taśma"));
    checkTrue("A risk badge renders with danger status", Boolean(window.document.querySelector("#coverageTableBody .status-danger")));

    // ---- tab switching ----
    console.log("\n--- tab switching ---");
    window.document.querySelector('[data-decision-tab="pareto"]').dispatchEvent(new window.Event("click", { bubbles: true }));
    checkTrue("Pareto view visible after tab click", window.document.querySelector('[data-decision-view="pareto"]').hidden === false);
    checkTrue("Dashboard view hidden after switching tabs", window.document.querySelector('[data-decision-view="dashboard"]').hidden === true);
    checkTrue("Pareto chart canvas has a live Chart.js instance", Boolean(window.Chart.getChart ? window.Chart.getChart(window.document.getElementById("paretoChart")) : true));

    // ---- forecast controls ----
    const seasonSelect = window.document.getElementById("forecastSeasonSelect");
    seasonSelect.value = "Zima";
    seasonSelect.dispatchEvent(new window.Event("change", { bubbles: true }));
    check("Forecast table has 3 body rows for Zima", window.document.getElementById("forecastTableBody").children.length, 3);

    // ---- scenario B: stockLevel NOT mapped — graceful degradation ----
    console.log("\n--- scenario B: stockLevel not mapped ---");
    PMA.state.setMapping({ date: "Data", material: "Materiał", quantity: "Ilość", brand: "Marka" });
    PMA.decisionEngine.refresh();

    checkTrue("Stock notice becomes visible", window.document.getElementById("decisionStockNotice").hidden === false);
    check("KPI stock falls back to dash", window.document.getElementById("kpiStock").textContent, "—");
    check("KPI risk falls back to dash", window.document.getElementById("kpiRisk").textContent, "—");
    checkTrue("Coverage table shows the graceful notice row instead of data", window.document.getElementById("coverageTableBody").textContent.includes("Aktualny stan zapasu"));
    checkTrue("Forecast table shows the graceful notice row instead of data", window.document.getElementById("forecastTableBody").textContent.includes("Aktualny stan zapasu"));
    check("ABC table still has 3 rows (Pareto/ABC don't need stock)", window.document.getElementById("abcTableBody").children.length, 3);

    // ---- scenario C: empty dataset must not throw ----
    console.log("\n--- scenario C: empty dataset ---");
    let emptyDatasetThrew = false;
    try {
        PMA.state.setNormalizedDataset({ normalizedRows: [], invalidRows: [], duplicateRows: [], fields: [] });
    } catch (error) {
        emptyDatasetThrew = true;
        console.error(error);
    }
    checkTrue("Empty dataset does not throw", !emptyDatasetThrew);
    check("Coverage table falls back to the no-data row", window.document.getElementById("coverageTableBody").children.length, 1);

    // ---- workspace reset clears decision UI ----
    console.log("\n--- workspace reset ---");
    PMA.state.setNormalizedDataset({ normalizedRows, invalidRows: [], duplicateRows: [], fields: [] });
    await waitFor(() => window.document.getElementById("kpiMaterials").textContent !== "0");
    await PMA.app.resetWorkspace({ force: true });
    check("KPI materials resets to 0", window.document.getElementById("kpiMaterials").textContent, "0");
    checkTrue("decisionSection re-locked after reset", window.document.getElementById("decisionSection").classList.contains("is-locked"));

    // ---- console/error hygiene ----
    console.log("\n--- console & error hygiene ---");
    checkTrue("no window 'error' events", pageErrors.length === 0, pageErrors.join(" | "));
    checkTrue("no console.error calls", consoleErrors.length === 0, consoleErrors.join(" | "));

    const failed = results.filter((r) => !r.pass);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
    if (failed.length) {
        console.log("\nFAILED CHECKS:");
        failed.forEach((f) => console.log(` - ${f.label}`));
        process.exitCode = 1;
    } else {
        process.exitCode = 0;
    }

    PMA.decisionEngine?.destroy?.();
    PMA.chartEngine?.destroy?.();
    PMA.spreadsheetEngine?.destroy?.();
    PMA.state?.destroy?.();
    window.close();
}

main().catch((error) => {
    console.error("FATAL TEST ERROR:", error);
    process.exitCode = 1;
});
