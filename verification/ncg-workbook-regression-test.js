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
    var noop = function () {};
    var ctx = {
      canvas: null, fillStyle: "#000", strokeStyle: "#000", lineWidth: 1,
      font: "10px sans-serif", textAlign: "start", textBaseline: "alphabetic",
      save: noop, restore: noop, scale: noop, rotate: noop, translate: noop, transform: noop,
      setTransform: noop, resetTransform: noop, clearRect: noop, fillRect: noop, strokeRect: noop,
      beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop, bezierCurveTo: noop,
      quadraticCurveTo: noop, arc: noop, arcTo: noop, ellipse: noop, rect: noop, roundRect: noop,
      fill: noop, stroke: noop, clip: noop, drawImage: noop, setLineDash: noop,
      getLineDash: function () { return []; },
      measureText: function () { return { width: 10, actualBoundingBoxAscent: 5, actualBoundingBoxDescent: 2 }; },
      fillText: noop, strokeText: noop,
      createLinearGradient: function () { return { addColorStop: noop }; },
      createRadialGradient: function () { return { addColorStop: noop }; },
      createPattern: function () { return {}; },
      isPointInPath: function () { return false; }, isPointInStroke: function () { return false; }
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

function appendSheet(XLSX, workbook, name, rows, refOverride = null) {
    const worksheet = XLSX.utils.aoa_to_sheet(rows, { cellDates: true });
    if (refOverride) worksheet["!ref"] = refOverride;
    XLSX.utils.book_append_sheet(workbook, worksheet, name);
}

function buildRepresentativeWorkbook(XLSX) {
    const workbook = XLSX.utils.book_new();
    const deliveryHeaders = [
        "Article", "Brand", "QTY Ordered", "Amount of PLT", "Delivery Date", "ORD/REQ Number",
        "Rozładowana ilość pallet", "QTY", "Pozostała ilość pallet", "Pozostała ilość QTY",
        "Supplier", "Numer WZ", "paleta", "rozmiar"
    ];
    const deliveryRows = [
        deliveryHeaders,
        ["ART-001", "H&M", 1000, 10, "2/23/2026", "ORD-001", 6, 600, 4, 400, "Supplier A", "WZ-001", "EURO", "120x80"],
        ["ART-002", "COS", 500, 5, "2/24/2026", "ORD-002", 3, 300, 2, 200, "Supplier B", "", "EURO", "120x80"],
        ["ART-002", "COS", "70 (66)", 1, "2/24/2026", "ORD-002", 1, 66, 0, 4, "Supplier B", "", "EURO", "120x80"]
    ];
    appendSheet(XLSX, workbook, "Ewidencja dostaw", deliveryRows);
    appendSheet(XLSX, workbook, "(old)Arkusz1", deliveryRows.map((row) => row.slice(0, 11)), "A1:IV4");

    appendSheet(XLSX, workbook, "Arkusz2", [
        ["ORD/REQ Number", "Delivery Date", "QTY", "Supplier"],
        ["ORD-001", "2/23/2026", 600, "Supplier A"],
        ["ORD-002", "2/24/2026", 366, "Supplier B"]
    ]);

    appendSheet(XLSX, workbook, "NCG nie zawizowane", [
        ["Article", "Brand", "QTY Ordered", "Delivery Date", "ORD/REQ Number", "QTY", "Pozostała ilość QTY", "Supplier", "Numer WZ"],
        ["ART-H1", "H&M", 100, "02.03.2026", "ORD-H1", 40, 60, "Supplier H", "WZ-H1"],
        ["", "H&M", 50, "03.03.2026", "ORD-H1", 20, 30, "Supplier H", "WZ-H2"],
        ["", "", 150, "", "", 60, 90, "", "SUMA"],
        ["ART-H2", "COS", 80, "04.03.2026", "ORD-H2", 50, 30, "Supplier C", "WZ-H3"],
        ["", "COS", 20, "05.03.2026", "ORD-H2", 10, 10, "Supplier C", "WZ-H4"],
        ["", "", 100, "", "", 60, 40, "", "SUMA"]
    ]);

    appendSheet(XLSX, workbook, "planowane dostawy", [
        ["Article", "Planning category", "Language code", "Store Placement Code", "QTY Ordered", "ORD/REQ Number", "Transport Date", "On site date", "Supplier"],
        ["ART-001", "Launch", "PL", "A01", 1000, "ORD-001", "01.02.2026", "23.02.2026", "Supplier A"],
        ["ART-002", "Replenishment", "EN", "B02", 500, "ORD-002", "10.02.2026", "24.02.2026", "Supplier B"],
        ["ART-002", "Replenishment", "EN", "B02", 70, "ORD-002", "15.08.2026", "week 35", "Supplier B"]
    ]);

    appendSheet(XLSX, workbook, "Sheet1", [
        ["Brand", "Sum of QTY Ordered"],
        ["H&M", 1000], ["COS", 570], ["Grand Total", 1570]
    ]);
    appendSheet(XLSX, workbook, "Arkusz1", [
        ["Supplier", "Count of ORD/REQ Number"],
        ["Supplier A", 1], ["Supplier B", 2], ["Grand Total", 3]
    ]);
    appendSheet(XLSX, workbook, "Sheet2", [
        ["Article", "Sum of QTY"], ["ART-001", 600], ["ART-002", 366]
    ]);
    appendSheet(XLSX, workbook, "Arkusz4", [
        ["Raport pomocniczy — stan na dziś"],
        ["Article", "QTY Ordered", "Supplier"],
        ["ART-001", 1000, "Supplier A"]
    ]);
    appendSheet(XLSX, workbook, "na potrzeby ułożenia na HR", [
        deliveryHeaders,
        ["ART-001", "H&M", 1000, 10, "2/23/2026", "ORD-001", 6, 600, 4, 400, "Supplier A", "WZ-001", "EURO", "120x80"]
    ]);
    return workbook;
}

function currentDataset(PMA) {
    const headers = PMA.state.get("import.headers", []);
    const rows = PMA.state.get("import.dataRows", []);
    return {
        rows: rows.map((row, rowIndex) => Object.fromEntries(headers.map((header, columnIndex) => [`source__${columnIndex}`, row[columnIndex] ?? ""]).concat([["id", `row-${rowIndex + 1}`]]))),
        fields: headers.map((header, columnIndex) => ({ id: `source__${columnIndex}`, label: header, type: "auto", source: "source" }))
    };
}

async function analyzeCurrent(PMA) {
    const dataset = currentDataset(PMA);
    return PMA.analyticsOrchestrator.analyze({ rows: dataset.rows, fields: dataset.fields, options: { fullStatistics: true, maximumFindings: 100 } });
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
    const workbook = buildRepresentativeWorkbook(XLSX);
    const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array", cellDates: true });
    const file = new dom.window.File([bytes], "NCG-representative.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    await PMA.importEngine.importFile(file);

    const intelligence = PMA.state.get("import.workbookIntelligence");
    const sheets = Object.fromEntries((intelligence?.sheets || []).map((sheet) => [sheet.name, sheet]));
    check("Workbook recommends the delivery register", intelligence?.recommendedSheet === "Ewidencja dostaw", intelligence?.recommendedSheet);
    check("Recommended sheet is opened automatically", PMA.state.get("import.selectedSheet") === "Ewidencja dostaw", PMA.state.get("import.selectedSheet"));
    check("Main sheet is classified as delivery tracking", sheets["Ewidencja dostaw"]?.type === "delivery_tracking", sheets["Ewidencja dostaw"]?.type);
    check("Procurement sheet is classified correctly", sheets["planowane dostawy"]?.type === "procurement_plan", sheets["planowane dostawy"]?.type);
    check("Old copy is marked as archive", sheets["(old)Arkusz1"]?.type === "archive", sheets["(old)Arkusz1"]?.type);
    check("Ghost columns from A:IV are removed", sheets["(old)Arkusz1"]?.columnCount <= 11, sheets["(old)Arkusz1"]?.columnCount);
    check("Offset header row is detected", sheets["Arkusz4"]?.headerRow === 2, sheets["Arkusz4"]?.headerRow);
    const plannedActualRelation = (intelligence?.relations || []).find((relation) => [relation.leftSheet, relation.rightSheet].includes("Ewidencja dostaw") && [relation.leftSheet, relation.rightSheet].includes("planowane dostawy"));
    check("Plan-to-actual relation is detected", Boolean(plannedActualRelation));
    check("Plan-to-actual order coverage is complete", plannedActualRelation?.commonValues === 2 && Math.abs((plannedActualRelation?.coverage || 0) - 1) < 1e-9, `${plannedActualRelation?.commonValues}/${plannedActualRelation?.coverage}`);
    check("Main import keeps the fourteen business columns", PMA.state.get("import.headers.length") === 14, PMA.state.get("import.headers.length"));
    check("Main header row is detected at row 1", PMA.state.get("import.headerRowIndex") === 0, PMA.state.get("import.headerRowIndex"));

    await waitFor(() => PMA.state.get("dataset.normalizedRows.length") === 3);
    check("Data editor is prepared automatically immediately after import", !dom.window.document.getElementById("dataLabSection").classList.contains("is-locked") && PMA.state.get("dataset.normalizedRows.length") === 3);
    dom.window.document.getElementById("smartAnalyticsSqlMode").value = "javascript";
    await PMA.smartAnalyticsEngine.run();
    const main = PMA.smartAnalyticsEngine.getResult();
    check("General-sheet path preserves every imported row", PMA.state.get("dataset.normalizedRows.length") === 3, PMA.state.get("dataset.normalizedRows.length"));
    check("Smart Analytics omits internal and empty derived fields", main.schema.profiles.every((profile) => profile.source !== "internal" && !(profile.source === "derived" && profile.physicalType === "empty")), main.schema.columnCount);
    const mainProfiles = Object.fromEntries(main.schema.profiles.map((profile) => [profile.label, profile]));
    check("Main domain is delivery tracking", main.domain.domain === "delivery_tracking", main.domain.domain);
    check("MDY date convention is inferred", mainProfiles["Delivery Date"]?.dateConvention === "mdy", mainProfiles["Delivery Date"]?.dateConvention);
    check("US-style date is parsed as 2026-02-23", PMA.analyticsCore.toISODate(PMA.analyticsCore.parseDate("2/23/2026", { convention: "mdy" })) === "2026-02-23");
    check("Delivered quantity role is distinguished from ordered quantity", mainProfiles.QTY?.businessRole === "delivered_quantity", mainProfiles.QTY?.businessRole);
    check("Remaining quantity role is detected", mainProfiles["Pozostała ilość QTY"]?.businessRole === "remaining_quantity", mainProfiles["Pozostała ilość QTY"]?.businessRole);
    check("Repeated order numbers are not treated as unique-key violations", main.quality.businessKeyDuplicates.every((item) => item.fieldId !== "ORD/REQ Number"), main.quality.businessKeyDuplicates.length);
    check("Descriptive quantity is excluded and reported", main.domainAnalysis.totals.ordered.invalid === 1, main.domainAnalysis.totals.ordered.invalid);
    check("Delivery completion KPI is calculated", Number.isFinite(main.domainAnalysis.completionRate), main.domainAnalysis.completionRate);
    check("Generic demand trend text is suppressed for delivery schedules", !main.insights.some((insight) => insight.type === "trend"));

    await PMA.importEngine.selectAndAnalyzeSheet("planowane dostawy", { autoDetectHeader: true });
    const plan = await analyzeCurrent(PMA);
    const planProfiles = Object.fromEntries(plan.schema.profiles.map((profile) => [profile.label, profile]));
    check("Procurement domain is recognized", plan.domain.domain === "procurement_plan", plan.domain.domain);
    check("Polish DMY date is parsed correctly", PMA.analyticsCore.toISODate(PMA.analyticsCore.parseDate("02.03.2026", { convention: "dmy" })) === "2026-03-02");
    check("Week-only planning marker is recognized", PMA.analyticsCore.parsePeriodToken("week 35")?.type === "iso_week");
    check("Week-only marker is kept as a partial date, not a type error", plan.domainAnalysis.unresolvedPeriods.length === 1 && !plan.quality.typeErrors.some((item) => item.fieldId === "On site date"), plan.domainAnalysis.unresolvedPeriods.length);
    check("Planning category semantic role is correct", planProfiles["Planning category"]?.businessRole === "planning_category", planProfiles["Planning category"]?.businessRole);
    check("Language semantic role is correct", planProfiles["Language code"]?.businessRole === "language", planProfiles["Language code"]?.businessRole);
    check("Placement code semantic role is correct", planProfiles["Store Placement Code"]?.businessRole === "placement_code", planProfiles["Store Placement Code"]?.businessRole);

    await PMA.importEngine.selectAndAnalyzeSheet("NCG nie zawizowane", { autoDetectHeader: true });
    const hierarchy = await analyzeCurrent(PMA);
    check("Hierarchical delivery plan is recognized", ["hierarchical_delivery_plan", "delivery_tracking"].includes(hierarchy.domain.domain), hierarchy.domain.domain);
    check("Subtotal rows are excluded before totals", hierarchy.datasetProfile.excludedRows === 2, hierarchy.datasetProfile.excludedRows);
    check("Blank material cells are filled down analytically", hierarchy.domainAnalysis.preparation.filledDownValues >= 2, hierarchy.domainAnalysis.preparation.filledDownValues);
    check("Source rows remain intact while analytical rows are prepared", hierarchy.datasetProfile.originalRows > hierarchy.datasetProfile.analyzedRows, `${hierarchy.datasetProfile.originalRows}/${hierarchy.datasetProfile.analyzedRows}`);
    check("Business-analysis section is included in the report", hierarchy.report.sections.some((section) => section.id === "domain"));

    check("No uncaught page errors occurred", pageErrors.length === 0, pageErrors.map(String).join(" | "));
    console.log(`\n${checks.filter(Boolean).length}/${checks.length} NCG workbook regression checks passed.`);
    dom.window.close();
    if (checks.some((pass) => !pass)) process.exitCode = 1;
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
