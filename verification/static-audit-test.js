"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const APP = path.join(ROOT, "apps", "materials");
const checks = [];
function check(label, condition, detail = "") {
    const pass = Boolean(condition);
    checks.push(pass);
    console.log(`${pass ? "PASS" : "FAIL"} — ${label}${detail ? ` (${detail})` : ""}`);
}
function walk(directory, predicate = () => true) {
    const output = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (["node_modules", ".git"].includes(entry.name)) continue;
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) output.push(...walk(full, predicate));
        else if (predicate(full)) output.push(full);
    }
    return output;
}

const jsFiles = walk(APP, (file) => file.endsWith(".js") && !file.includes(`${path.sep}vendor${path.sep}`));
const syntaxErrors = [];
for (const file of jsFiles) {
    try { new vm.Script(fs.readFileSync(file, "utf8"), { filename: file }); }
    catch (error) { syntaxErrors.push(`${path.relative(ROOT, file)}: ${error.message}`); }
}
check("All application JavaScript files parse", syntaxErrors.length === 0, syntaxErrors.join(" | "));

const htmlFiles = [path.join(ROOT, "index.html"), path.join(APP, "index.html")];
const duplicateIds = [];
for (const file of htmlFiles) {
    const html = fs.readFileSync(file, "utf8");
    const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]);
    const seen = new Set();
    ids.forEach((id) => { if (seen.has(id)) duplicateIds.push(`${path.relative(ROOT, file)}#${id}`); else seen.add(id); });
}
check("HTML contains no duplicate IDs", duplicateIds.length === 0, duplicateIds.join(", "));

const missingAssets = [];
for (const file of htmlFiles) {
    const html = fs.readFileSync(file, "utf8");
    for (const match of html.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)) {
        const reference = match[1].split(/[?#]/)[0];
        if (!reference || /^(?:https?:|data:|mailto:|#)/i.test(reference)) continue;
        const target = path.resolve(path.dirname(file), reference);
        if (!fs.existsSync(target)) missingAssets.push(`${path.relative(ROOT, file)} -> ${reference}`);
    }
}
check("All local HTML assets exist", missingAssets.length === 0, missingAssets.join(" | "));

const appHtml = fs.readFileSync(path.join(APP, "index.html"), "utf8");
check("Workspace JSON input is physically present", /id=["']dataLabWorkspaceInput["']/.test(appHtml));
check("Removed value-normalization panel is absent", !/technicalNormalizationElements|normalizationRulesContainer/.test(appHtml));
check("Dedicated stock-clear action is present", /id=["']workspaceClearStockButton["']/.test(appHtml));
check("Manual decision-data form is present", /id=["']workspaceManualStockMaterial["']/.test(appHtml) && /id=["']workspaceManualStockValue["']/.test(appHtml) && /id=["']workspaceSaveManualStockButton["']/.test(appHtml));
check("Data editor exposes direct cell editing", /id=["']workspaceEditCellButton["']/.test(appHtml));
check("Smart Analytics SQL mode is explicit", /id=["']smartAnalyticsSqlMode["']/.test(appHtml) && /value=["']auto["']/.test(appHtml));
check("Smart Analytics verification tab is present", /data-smart-tab=["']verification["']/.test(appHtml) && /id=["']smartVerificationBody["']/.test(appHtml));
check("Smart Analytics workspace is present", /id=["']smartAnalyticsSection["']/.test(appHtml) && /id=["']runSmartAnalyticsButton["']/.test(appHtml));
check("Smart Analytics is workflow step 6", /data-target-section=["']smartAnalyticsSection["'][\s\S]*?workflow-number["']>6</.test(appHtml));

const sourceText = jsFiles.map((file) => fs.readFileSync(file, "utf8")).join("\n");
check("Application source does not use eval", !/\beval\s*\(/.test(sourceText));
check("Application source does not use Function constructor", !/\bnew\s+Function\s*\(/.test(sourceText));
check("Data editor runtime exposes direct cell editing", /function editActiveCell/.test(sourceText) && /workspaceEditCellButton/.test(sourceText));
check("Smart Analytics emits a deterministic audit trail", /datasetFingerprint/.test(sourceText) && /auditTrail/.test(sourceText) && /renderVerification/.test(sourceText));
check("Legacy data-lab-engine reference is absent", !/data-lab-engine\.js/.test(appHtml + sourceText));
const analyticsDirectory = path.join(APP, "src", "analytics");
const requiredAnalyticsModules = [
    "rules/analytics-rules.js", "analytics-core.js", "schema-profiler.js", "semantic-role-engine.js", "workbook-intelligence-engine.js", "domain-classifier.js", "domain-analysis-engine.js", "data-quality-engine.js",
    "outlier-engine.js", "trend-engine.js", "period-comparison-engine.js", "correlation-engine.js",
    "pivot-recommender.js", "chart-recommender.js", "insight-engine.js", "report-generator.js",
    "analytics-orchestrator.js", "analytics.worker.js", "duckdb-engine.js", "smart-analytics-engine.js"
];
check("All Smart Analytics modules exist", requiredAnalyticsModules.every((name) => fs.existsSync(path.join(analyticsDirectory, name))));
check("Smart Analytics uses a dedicated Web Worker", /new Worker\(`src\/analytics\/analytics\.worker\.js/.test(sourceText));
check("Smart Analytics source contains no external service URL", !/https?:\/\//i.test(walk(analyticsDirectory, (file) => file.endsWith(".js")).map((file) => fs.readFileSync(file, "utf8")).join("\n")));
const duckdbVendor = path.join(APP, "vendor", "duckdb");
check("Local DuckDB-WASM runtime is bundled", ["duckdb-browser.bundle.mjs", "duckdb-browser-mvp.worker.js", "duckdb-mvp.wasm"].every((name) => fs.existsSync(path.join(duckdbVendor, name))));

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const constants = fs.readFileSync(path.join(APP, "src", "constants.js"), "utf8");
const uiVersion = appHtml.match(/data-app-version[^>]*>([^<]+)</)?.[1]?.trim();
const constantVersion = constants.match(/version:\s*["']([^"']+)["']/)?.[1];
check("Package, UI and runtime versions match", pkg.version === uiVersion && uiVersion === constantVersion, `${pkg.version}/${uiVersion}/${constantVersion}`);

const workspaceStorage = fs.readFileSync(path.join(APP, "src", "workspace-storage.js"), "utf8");
const serializer = fs.readFileSync(path.join(APP, "src", "spreadsheet-engine.js"), "utf8");
const storageSchema = workspaceStorage.match(/SCHEMA_VERSION\s*=\s*(\d+)/)?.[1];
const serializerSchema = serializer.match(/schemaVersion:\s*(\d+)/)?.[1];
check("Workspace schema version is consistent", storageSchema === serializerSchema, `${storageSchema}/${serializerSchema}`);

const rootHtml = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
check("Root entry redirects to the application", /apps\/materials\/index\.html/.test(rootHtml));
check("Windows launcher has a PowerShell fallback with WASM MIME support", fs.existsSync(path.join(ROOT, "start-server.ps1")) && /application\/wasm/.test(fs.readFileSync(path.join(ROOT, "start-server.ps1"), "utf8")));
check("Workbook Data Model documentation is bundled", fs.existsSync(path.join(ROOT, "WORKBOOK_DATA_MODEL.md")));
const exampleWorkbook = path.join(ROOT, "examples", "Przyklad_Model_Danych.xlsx");
check("Workbook Data Model example workbook is bundled", fs.existsSync(exampleWorkbook) && fs.statSync(exampleWorkbook).size > 1000);
check("Workbook model mapping is not duplicated in preparation step", /id=["']singleSheetMappingPanel["']/.test(appHtml) && /id=["']workbookModelMappingSummary["']/.test(appHtml) && /setMappingMode\(options\.mode/.test(sourceText));
check("Workbook model performs quality validation automatically", /validateMappedData\(\{ force: true \}\)/.test(sourceText));

const passed = checks.filter(Boolean).length;
console.log(`\n${passed}/${checks.length} checks passed.`);
if (passed !== checks.length) process.exitCode = 1;
