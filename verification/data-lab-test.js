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
  window.print = window.print || function () {};
  window.prompt = window.prompt || function (_, value) { return value || ""; };
  window.confirm = window.confirm || function () { return true; };
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || function () {};
  window.MutationObserver = function () { this.observe=function(){}; this.disconnect=function(){}; this.takeRecords=function(){return[];}; };
  window.ResizeObserver = window.ResizeObserver || function () { this.observe=function(){}; this.unobserve=function(){}; this.disconnect=function(){}; };
  window.requestAnimationFrame = window.requestAnimationFrame || function (cb) { return setTimeout(cb, 0); };
  window.cancelAnimationFrame = window.cancelAnimationFrame || function (id) { clearTimeout(id); };
  function stubContext2d() {
    var noop=function(){};
    return { canvas:null, save:noop, restore:noop, scale:noop, rotate:noop, translate:noop, transform:noop,
      setTransform:noop, resetTransform:noop, clearRect:noop, fillRect:noop, strokeRect:noop, beginPath:noop,
      closePath:noop, moveTo:noop, lineTo:noop, bezierCurveTo:noop, quadraticCurveTo:noop, arc:noop, arcTo:noop,
      ellipse:noop, rect:noop, roundRect:noop, fill:noop, stroke:noop, clip:noop, drawImage:noop, setLineDash:noop,
      getLineDash:function(){return[];}, measureText:function(){return{width:10};}, fillText:noop, strokeText:noop,
      createLinearGradient:function(){return{addColorStop:noop};}, createRadialGradient:function(){return{addColorStop:noop};},
      createPattern:function(){return{};}, getTransform:function(){return{a:1,b:0,c:0,d:1,e:0,f:0};} };
  }
  HTMLCanvasElement.prototype.getContext=function(type){ if(type==="2d"){var c=stubContext2d();c.canvas=this;return c;} return null; };
  HTMLCanvasElement.prototype.getBoundingClientRect=function(){return{width:600,height:300,top:0,left:0,right:600,bottom:300,x:0,y:0,toJSON:function(){}};};
</script>`;

function loadHtml() { return fs.readFileSync(INDEX_PATH, "utf8").replace("<head>", "<head>" + POLYFILL_SCRIPT); }
function waitFor(fn, timeout = 15000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      try { if (fn()) return resolve(); } catch (error) { return reject(error); }
      if (Date.now() - started > timeout) return reject(new Error("waitFor timeout"));
      setTimeout(tick, 25);
    };
    tick();
  });
}
const results = [];
function check(label, condition, detail = "") {
  const pass = Boolean(condition); results.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"} — ${label}${detail ? ` (${detail})` : ""}`);
}

async function main() {
  const errors = [];
  const dom = new JSDOM(loadHtml(), { url: BASE_URL, runScripts: "dangerously", resources: "usable", pretendToBeVisual: true });
  dom.window.addEventListener("error", (event) => errors.push(event.error || event.message));
  dom.window.addEventListener("unhandledrejection", (event) => errors.push(event.reason));
  const { window } = dom;
  await waitFor(() => window.document.body.classList.contains("app-ready"), 20000);
  const { PMA } = window;

  check("Spreadsheet engine exists", Boolean(PMA.spreadsheetEngine));
  check("Spreadsheet engine initialized", PMA.spreadsheetEngine.isInitialized());
  check("Formula engine exists", Boolean(PMA.formulaEngine));
  check("Workspace storage exists", Boolean(PMA.workspaceStorage));
  check("Multiple-file input enabled", window.document.getElementById("excelFileInput").multiple === true);
  check("Header row can be selected", Boolean(window.document.getElementById("headerRowNumber")));
  const headerAnalysis = PMA.importEngine.buildSheetAnalysis([
    ["Raport magazynowy", ""],
    ["Data", "Materiał", "Ilość"],
    ["2026-01-01", "Taśma", 10]
  ], 1);
  check("Import supports a configurable header row", headerAnalysis.headers.join("|") === "Data|Materiał|Ilość" && headerAnalysis.dataRows.length === 1);

  const headers = ["Data", "Materiał", "Ilość", "Marka", "Cena", "Komentarz"];
  const mapping = { date: "Data", material: "Materiał", quantity: "Ilość", brand: "Marka", stockLevel: "" };
  PMA.state.setSheetAnalysis({ rawRows: [], headerRowIndex: 0, headers, sourceHeaders: headers, dataRows: [], previewRows: [], detectedTypes: { Data: "date", Materiał: "text", Ilość: "number", Marka: "text", Cena: "number", Komentarz: "text" }, emptyRowCount: 0 });
  PMA.state.setMapping(mapping);
  const sourceRows = [
    ["2026-01-01", "Taśma", 10, "H&M", 2.5, " A "],
    ["2026-01-02", "Taśma", 20, "H&M", 2.5, "B"],
    ["2026-01-03", "Taśma", 5, "COS", 5, "C"],
    ["2026-01-04", "Folia", 8, "ARKET", 3, "D"]
  ];
  const normalized = sourceRows.map((values, index) => {
    const sourceValues = Object.fromEntries(headers.map((header, column) => [header, values[column]]));
    const mapped = { date: values[0], material: values[1], quantity: values[2], brand: values[3] };
    const base = Object.fromEntries(PMA.constants.SYSTEM_FIELDS.map((field) => [field.id, null]));
    const result = PMA.normalizationEngine.normalizeSingleRecord({ ...base, ...mapped }, { sourceRowNumber: index + 2, sourceFile: "test.xlsx", sourceSheet: "Dane", sourceValues, headers, sourceRow: values });
    if (!result.valid) throw new Error(JSON.stringify(result.errors));
    return result.record;
  });
  const fields = PMA.normalizationEngine.buildDatasetFields(mapping, headers);
  PMA.state.setNormalizedDataset({ normalizedRows: normalized, invalidRows: [], duplicateRows: [], fields, statistics: {} });
  await PMA.pivotEngine.prepareAnalysis({ buildDefault: true });
  await waitFor(() => !window.document.getElementById("dataLabSection").classList.contains("is-locked"));

  check("Editor unlocks after normalization", !window.document.getElementById("dataLabSection").classList.contains("is-locked"));
  check("All six original columns are preserved", PMA.state.get("dataset.fields").filter((field) => field.source === "source").length === 6);
  check("Original unmapped column value is retained", PMA.state.get("dataset.normalizedRows.0.source__5") === " A ");
  await waitFor(() => window.document.querySelectorAll("#workspaceGridBody tr[data-row-id]").length === 4);
  check("Virtual grid renders four rows", window.document.querySelectorAll("#workspaceGridBody tr[data-row-id]").length === 4);

  const compiled = PMA.formulaEngine.compile("ROUND([Ilość] * [Cena], 2)", PMA.state.get("dataset.fields"));
  check("Formula engine evaluates column references", compiled.evaluate(PMA.state.get("dataset.normalizedRows.0")) === 25);

  window.document.getElementById("workspaceFormulaName").value = "Wartość";
  window.document.getElementById("workspaceFormulaType").value = "number";
  window.document.getElementById("workspaceFormulaExpression").value = "ROUND([Ilość] * [Cena], 2)";
  window.document.getElementById("workspaceAddFormulaButton").click();
  await waitFor(() => PMA.state.get("dataset.calculatedColumns.length", 0) === 1);
  const formulaId = PMA.state.get("dataset.calculatedColumns.0.id");
  check("Calculated column is added", Boolean(formulaId));
  check("Calculated values are stored per row", PMA.state.get("dataset.normalizedRows.1")[formulaId] === 50);

  const sourceMaterialField = PMA.state.get("dataset.fields").find((field) => field.source === "source" && field.sourceColumn === "Materiał");
  window.document.getElementById("workspaceTransformField").value = sourceMaterialField.id;
  window.document.getElementById("workspaceTransformOperation").value = "replace";
  window.document.getElementById("workspaceTransformArg1").value = "Taśma";
  window.document.getElementById("workspaceTransformArg2").value = "Taśma test";
  window.document.getElementById("workspaceApplyTransformButton").click();
  await waitFor(() => PMA.state.get("dataset.normalizedRows").some((row) => row.material === "Taśma test"));
  check("Transformation changes source and mapped analytical field", PMA.state.get("dataset.normalizedRows").filter((row) => row.material === "Taśma test").length === 3);
  PMA.spreadsheetEngine.undo();
  check("Undo restores transformed values", PMA.state.get("dataset.normalizedRows").filter((row) => row.material === "Taśma").length === 3);
  PMA.spreadsheetEngine.redo();
  check("Redo reapplies transformed values", PMA.state.get("dataset.normalizedRows").filter((row) => row.material === "Taśma test").length === 3);

  PMA.state.setStockDataset([{
    id: "s1", material: "Taśma test", stockLevel: 100, date: "2026-01-31", unit: "szt.",
    leadTimeDays: 120, minimumOrderQuantity: 50, orderMultiple: 20,
    safetyStock: 10, openOrders: 5, supplier: "Supplier A"
  }], []);
  PMA.decisionEngine.refresh();
  check("Separate stock snapshot activates stock analytics", window.document.getElementById("decisionStockNotice").hidden === true);
  const planned = PMA.decisionEngine.getForecastRows("Zima", PMA.state.get("dataset.normalizedRows")).find((row) => row.material === "Taśma test");
  check("Planning horizon respects lead time", planned?.planningDays === 120);
  check("Open orders reduce required order", Math.abs(planned?.rawToOrder - (planned?.recommendedQuantity - 105)) < 1e-9);
  check("Order quantity respects package multiple", planned?.toOrder % 20 === 0);
  check("Forecast carries supplier and unit metadata", planned?.supplier === "Supplier A" && planned?.unit === "szt.");

  PMA.state.setSmartAnalyticsResult({
    generatedAt: "2026-07-18T12:00:00.000Z",
    datasetProfile: { rows: 4, columns: PMA.state.get("dataset.fields.length"), scope: "all" },
    execution: { deterministic: true, externalServices: false, statisticalEngine: "javascript-worker", sqlEngine: "javascript-fallback" },
    report: { title: "Test", executiveSummary: [], sections: [], plainText: "Test" },
    schema: { profiles: [] }, quality: { score: 100, grade: "A", issues: [], summary: {} }, outliers: { total: 0, findings: [] },
    trends: { trends: [] }, periodComparisons: { comparisons: [] }, correlations: { numericPairs: [], categoryMeasure: [], categoryPairs: [] },
    pivots: [], recommendedCharts: [], insights: []
  });
  const workspace = PMA.spreadsheetEngine.serializeWorkspace();
  check("Workspace schema v4 is generated", workspace.schemaVersion === 4 && workspace.dataset.stockRows.length === 1);
  check("Workspace stores deterministic Smart Analytics result", workspace.smartAnalyticsResult?.execution?.deterministic === true);
  PMA.state.resetWorkspace({ preservePreferences: true, preserveMappingProfiles: true, preserveRecentFiles: true });
  PMA.dom.resetUI();
  PMA.spreadsheetEngine.restoreWorkspace(workspace);
  await waitFor(() => PMA.state.get("dataset.normalizedRows.length", 0) === 4);
  check("Workspace restore returns all rows", PMA.state.get("dataset.normalizedRows.length") === 4);
  check("Workspace restore returns calculated columns", PMA.state.get("dataset.calculatedColumns.length") === 1);
  check("Workspace restore returns separate stock table", PMA.state.get("dataset.stockRows.length") === 1);
  check("Workspace restore returns Smart Analytics result", PMA.state.get("smartAnalytics.result.datasetProfile.rows") === 4);
  check("No page errors", errors.length === 0, errors.map(String).join(" | "));

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} checks passed.`);
  dom.window.close();
  if (passed !== results.length) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
