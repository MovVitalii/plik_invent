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
  if (window.File && !window.File.prototype.arrayBuffer) {
    window.File.prototype.arrayBuffer = function () {
      var file = this;
      return new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onload = function () { resolve(reader.result); };
        reader.onerror = function () { reject(reader.error || new Error("FileReader failed")); };
        reader.readAsArrayBuffer(file);
      });
    };
  }
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

function loadHtml() {
    return fs.readFileSync(INDEX_PATH, "utf8").replace("<head>", `<head>${POLYFILL_SCRIPT}`);
}

function waitFor(condition, timeout = 20000) {
    const started = Date.now();
    return new Promise((resolve, reject) => {
        const tick = () => {
            try {
                if (condition()) return resolve();
            } catch (error) {
                return reject(error);
            }
            if (Date.now() - started > timeout) return reject(new Error("Timed out waiting for application state."));
            setTimeout(tick, 25);
        };
        tick();
    });
}

const checks = [];
function check(label, condition, detail = "") {
    const pass = Boolean(condition);
    checks.push(pass);
    console.log(`${pass ? "PASS" : "FAIL"} — ${label}${detail ? ` (${detail})` : ""}`);
}

function appendSheet(XLSX, workbook, name, rows) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows, { cellDates: true }), name);
}

function buildWorkbook(XLSX) {
    const workbook = XLSX.utils.book_new();
    appendSheet(XLSX, workbook, "Zużycie", [
        ["Data", "Kod materiału", "Materiał", "Zużycie", "Jednostka"],
        ["2026-01-01", "MAT-A", "Folia", 10, "szt."],
        ["2026-01-03", "MAT-A", "Folia", 20, "szt."],
        ["2026-01-04", "MAT-B", "Karton", 5, "szt."]
    ]);
    appendSheet(XLSX, workbook, "Zapasy", [
        ["Kod materiału", "Materiał", "Stan początkowy", "Data stanu", "Jednostka"],
        ["MAT-A", "Folia", 100, "2026-01-01", "szt."],
        ["MAT-B", "Karton", 50, "2026-01-01", "szt."]
    ]);
    appendSheet(XLSX, workbook, "Przyjęcia", [
        ["Kod materiału", "Materiał", "Ilość przyjęta", "Data przyjęcia", "Jednostka"],
        ["MAT-A", "Folia", 5, "2026-01-03", "szt."]
    ]);
    appendSheet(XLSX, workbook, "Zamówienia", [
        ["Kod materiału", "Materiał", "Ilość otwarta", "Dostawca", "MOQ", "Krotność zamówienia"],
        ["MAT-A", "Folia", 20, "Supplier X", 40, 10]
    ]);
    appendSheet(XLSX, workbook, "Kartoteka", [
        ["Kod materiału", "Materiał", "Jednostka", "Lead time (dni)", "Safety stock"],
        ["", "Folia", "szt.", 14, 15],
        ["MAT-B", "Karton", "szt.", 7, 5]
    ]);
    return workbook;
}


function buildCodeOnlyWorkbook(XLSX) {
    const workbook = XLSX.utils.book_new();
    appendSheet(XLSX, workbook, "Użycie kodowe", [
        ["Data", "Kod", "Ilość", "Koszt centrum"],
        ["2026-02-01", "C-001", 20, "PACK"],
        ["2026-02-02", "C-001", 5, "PACK"]
    ]);
    appendSheet(XLSX, workbook, "Zapas kodowy", [
        ["Kod", "Stan początkowy", "Data stanu"],
        ["C-001", 100, "2026-02-01"]
    ]);
    return workbook;
}

function configureRole(role, mapping, stockMode = "snapshot") {
    return { role, mapping, stockMode };
}

(async () => {
    const pageErrors = [];
    const dom = new JSDOM(loadHtml(), {
        url: BASE_URL,
        runScripts: "dangerously",
        resources: "usable",
        pretendToBeVisual: true
    });
    dom.window.addEventListener("error", (event) => pageErrors.push(event.error || event.message));
    dom.window.addEventListener("unhandledrejection", (event) => pageErrors.push(event.reason));
    await waitFor(() => dom.window.document.body.classList.contains("app-ready"));

    const { PMA, XLSX } = dom.window;
    check("Workbook model engine exists", Boolean(PMA.workbookModelEngine));
    check("Workbook model panel exists", Boolean(dom.window.document.getElementById("workbookModelPanel")));

    const workbook = buildWorkbook(XLSX);
    const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array", cellDates: true });
    const file = new dom.window.File([bytes], "workbook-model-test.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    await PMA.importEngine.importFile(file);

    const existing = PMA.state.get("import.dataModel");
    const desired = {
        "Zużycie": configureRole("usage", { date: "Data", materialCode: "Kod materiału", material: "Materiał", quantity: "Zużycie", unit: "Jednostka" }),
        "Zapasy": configureRole("stock", { materialCode: "Kod materiału", material: "Materiał", stockLevel: "Stan początkowy", date: "Data stanu", unit: "Jednostka" }, "opening"),
        "Przyjęcia": configureRole("receipts", { materialCode: "Kod materiału", material: "Materiał", quantity: "Ilość przyjęta", date: "Data przyjęcia", unit: "Jednostka" }),
        "Zamówienia": configureRole("orders", { materialCode: "Kod materiału", material: "Materiał", openOrders: "Ilość otwarta", supplier: "Dostawca", minimumOrderQuantity: "MOQ", orderMultiple: "Krotność zamówienia" }),
        "Kartoteka": configureRole("master", { materialCode: "Kod materiału", material: "Materiał", unit: "Jednostka", leadTimeDays: "Lead time (dni)", safetyStock: "Safety stock" })
    };
    const roles = existing.roles.map((entry) => ({ ...entry, ...(desired[entry.sheetName] || configureRole("ignore", {})) }));
    PMA.state.setWorkbookDataModel({ ...existing, enabled: true, joinStrategy: "auto", roles });

    const result = await PMA.workbookModelEngine.buildDataModel();
    check("Five sheet roles are parsed", result.parsed.usage.length === 3 && result.parsed.stock.length === 2 && result.parsed.receipts.length === 1 && result.parsed.orders.length === 1 && result.parsed.master.length === 2);
    check("Join field resolves to material code", result.model.resolvedJoinField === "materialCode", result.model.resolvedJoinField);
    check("Join audit matches both usage materials", result.audit.matchedMaterials === 2 && result.audit.unmatchedUsage.length === 0, JSON.stringify(result.audit));
    check("Generated usage sheet becomes active", PMA.state.get("import.selectedSheet") === "Model danych — Zużycie");
    check("Ancillary tables are stored independently", PMA.state.get("dataset.stockRows.length") === 2 && PMA.state.get("dataset.receiptRows.length") === 1 && PMA.state.get("dataset.orderRows.length") === 1 && PMA.state.get("dataset.materialMasterRows.length") === 2);
    check("Workbook model hides the duplicate single-sheet mapping panel", dom.window.document.getElementById("singleSheetMappingPanel").hidden === true);
    check("Workbook model shows the mapping-complete summary", dom.window.document.getElementById("workbookModelMappingSummary").hidden === false);
    check("Workbook model runs quality validation during build", PMA.state.get("validation.completed") === true && PMA.state.get("validation.totalRows") === 3);

    await PMA.mappingEngine.validateMappedData({ force: true });
    await PMA.normalizationEngine.processDataset();
    await waitFor(() => PMA.state.get("dataset.normalizedRows.length") === 3);
    check("All usage rows are normalized", PMA.state.get("dataset.normalizedRows.length") === 3);
    check("Original usage provenance is preserved", PMA.state.get("dataset.normalizedRows").every((row) => row.sourceSheet === "Zużycie"));

    const inventory = PMA.workbookModelEngine.getInventoryRows(PMA.state.get("dataset.normalizedRows"));
    const byMaterial = Object.fromEntries(inventory.map((row) => [row.material, row]));
    check("Opening stock subtracts usage and adds receipts", byMaterial.Folia?.stock === 75 && byMaterial.Folia?.usageSince === 30 && byMaterial.Folia?.receiptsSince === 5, JSON.stringify(byMaterial.Folia));
    check("Opening stock is calculated independently per material", byMaterial.Karton?.stock === 45 && byMaterial.Karton?.usageSince === 5, JSON.stringify(byMaterial.Karton));
    check("Name-only master data enriches code-based stock through aliases", byMaterial.Folia?.leadTimeDays === 14 && byMaterial.Folia?.safetyStock === 15 && byMaterial.Folia?.openOrders === 20 && byMaterial.Folia?.minimumOrderQuantity === 40 && byMaterial.Folia?.orderMultiple === 10 && byMaterial.Folia?.supplier === "Supplier X");
    check("Opening stock includes usage recorded on the opening date", byMaterial.Folia?.usageSince === 30 && byMaterial.Folia?.stock === 75, JSON.stringify(byMaterial.Folia));
    check("Stock provenance is exposed", byMaterial.Folia?.sourceSheet === "Zapasy" && byMaterial.Folia?.sourceRow === 2);

    const stockRows = PMA.state.get("dataset.stockRows").map((row) => ({ ...row }));
    const foliaIndex = stockRows.findIndex((row) => row.materialCode === "MAT-A");
    stockRows[foliaIndex] = { ...stockRows[foliaIndex], stockLevel: 90, stockMode: "snapshot", date: "2026-01-05" };
    PMA.state.setStockDataset(stockRows, PMA.workbookModelEngine.stockFieldDefinitions());
    const snapshot = PMA.workbookModelEngine.getInventoryRows(PMA.state.get("dataset.normalizedRows")).find((row) => row.material === "Folia");
    check("Snapshot stock is authoritative and not reduced again", snapshot?.stock === 90 && snapshot?.usageSince === 0 && snapshot?.receiptsSince === 0, JSON.stringify(snapshot));
    PMA.state.setDateFilter("", "2026-01-04");
    const historicalInventory = PMA.workbookModelEngine.getInventoryRows(PMA.state.get("dataset.normalizedRows"));
    check("Historical as-of date never uses a future stock snapshot", !historicalInventory.some((row) => row.material === "Folia"));
    PMA.state.setDateFilter("", "");

    PMA.state.setStockDataset([
        ...stockRows.filter((row) => row.materialCode !== "MAT-A"),
        { id: "manual-folia", material: "Folia", stockLevel: 88, stockMode: "snapshot", date: "2026-01-06", unit: "szt.", manual: true }
    ], PMA.workbookModelEngine.stockFieldDefinitions());
    const manualAlias = PMA.workbookModelEngine.getInventoryRows(PMA.state.get("dataset.normalizedRows")).find((row) => row.material === "Folia");
    check("Manual name-only stock matches code-based usage through aliases", manualAlias?.stock === 88, JSON.stringify(manualAlias));

    const workspace = PMA.spreadsheetEngine.serializeWorkspace();
    check("Workspace schema stores workbook data model", workspace.schemaVersion === 5 && workspace.import.dataModel?.roles?.length === 5 && workspace.dataset.receiptRows.length === 1 && workspace.dataset.orderRows.length === 1 && workspace.dataset.materialMasterRows.length === 2);

    const codeOnlyWorkbook = buildCodeOnlyWorkbook(XLSX);
    const codeOnlyBytes = XLSX.write(codeOnlyWorkbook, { bookType: "xlsx", type: "array", cellDates: true });
    const codeOnlyFile = new dom.window.File([codeOnlyBytes], "code-only.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    await PMA.importEngine.importFile(codeOnlyFile);
    const codeModel = PMA.state.get("import.dataModel");
    const codeRoles = codeModel.roles.map((entry) => {
        if (entry.sheetName === "Użycie kodowe") return { ...entry, ...configureRole("usage", { date: "Data", materialCode: "Kod", quantity: "Ilość" }) };
        if (entry.sheetName === "Zapas kodowy") return { ...entry, ...configureRole("stock", { materialCode: "Kod", stockLevel: "Stan początkowy", date: "Data stanu" }, "opening") };
        return { ...entry, ...configureRole("ignore", {}) };
    });
    PMA.state.setWorkbookDataModel({ ...codeModel, enabled: true, joinStrategy: "materialCode", roles: codeRoles });
    await PMA.workbookModelEngine.buildDataModel();
    await PMA.mappingEngine.validateMappedData({ force: true });
    await PMA.normalizationEngine.processDataset();
    await waitFor(() => PMA.state.get("dataset.normalizedRows.length") === 2);
    const codeRows = PMA.state.get("dataset.normalizedRows");
    const customField = PMA.state.get("dataset.fields").find((field) => field.source === "source" && field.label === "Koszt centrum");
    check("Material code alone satisfies the workbook identity requirement", codeRows.every((row) => row.material === "C-001" && row.materialCode === "C-001"));
    check("Unmapped source columns survive the generated usage model", Boolean(customField) && codeRows.every((row) => row[customField.id] === "PACK"));
    const codeInventory = PMA.workbookModelEngine.getInventoryRows(codeRows).find((row) => row.materialKey === "C-001");
    check("Code-only opening stock includes usage from the same date", codeInventory?.stock === 75 && codeInventory?.usageSince === 25, JSON.stringify(codeInventory));
    check("No uncaught page errors occurred", pageErrors.length === 0, pageErrors.map(String).join(" | "));

    console.log(`\n${checks.filter(Boolean).length}/${checks.length} workbook model checks passed.`);
    dom.window.close();
    if (checks.some((pass) => !pass)) process.exitCode = 1;
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
