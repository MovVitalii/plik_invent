"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const APP = path.join(ROOT, "apps", "materials");
const VENDOR = path.join(APP, "vendor", "duckdb");
const checks = [];

function check(label, condition, detail = "") {
    const pass = Boolean(condition);
    checks.push(pass);
    console.log(`${pass ? "PASS" : "FAIL"} — ${label}${detail ? ` (${detail})` : ""}`);
}

const bundle = path.join(VENDOR, "duckdb-browser.bundle.mjs");
const worker = path.join(VENDOR, "duckdb-browser-mvp.worker.js");
const wasm = path.join(VENDOR, "duckdb-mvp.wasm");
check("Local DuckDB browser bundle exists", fs.existsSync(bundle));
check("Local DuckDB worker exists", fs.existsSync(worker));
check("Local DuckDB WASM exists", fs.existsSync(wasm));
check("DuckDB bundle is non-empty", fs.statSync(bundle).size > 100_000, fs.statSync(bundle).size);
check("DuckDB worker is non-empty", fs.statSync(worker).size > 500_000, fs.statSync(worker).size);
check("DuckDB WASM is non-empty", fs.statSync(wasm).size > 10_000_000, fs.statSync(wasm).size);
const magic = fs.readFileSync(wasm).subarray(0, 4);
check("DuckDB WASM has a valid WebAssembly header", magic.equals(Buffer.from([0x00, 0x61, 0x73, 0x6d])), magic.toString("hex"));

const adapterPath = path.join(APP, "src", "analytics", "duckdb-engine.js");
const adapterSource = fs.readFileSync(adapterPath, "utf8");
check("DuckDB adapter uses only local vendor assets", !/https?:\/\//i.test(adapterSource) && /vendor\/duckdb\/duckdb-mvp\.wasm/.test(adapterSource));

const context = {
    console,
    URL,
    document: { baseURI: "http://localhost/apps/materials/" },
    Worker: function WorkerStub() {},
    window: null,
    PMA: {}
};
context.window = context;
vm.createContext(context);
vm.runInContext(adapterSource, context, { filename: "duckdb-engine.js" });

const query = context.PMA.duckdbEngine.buildGroupedQuery("smart_data", {
    rows: ['Material "A"'],
    columns: ["Data"],
    values: [{ field: "Zużycie", aggregation: "sum" }],
    timeGranularity: "month"
}, 5000);
check("SQL builder escapes quoted identifiers", query.includes('"Material ""A"""'));
check("SQL builder applies local date grouping", query.includes("strftime(try_cast(\"Data\" AS DATE), '%Y-%m')"));
check("SQL builder applies numeric aggregation safely", query.includes('sum(try_cast(raw_value AS DOUBLE))'));
check("SQL builder computes grouped and row-total aggregates from the same base", query.includes("WITH base AS") && query.includes("grouped AS") && query.includes("totals AS") && query.includes("totals.total_value"));
check("SQL builder applies a bounded limit", query.includes("LIMIT 5000"));
const countQuery = context.PMA.duckdbEngine.buildGroupedQuery("smart_data", {
    rows: ["Material"], columns: ["Status"], values: [{ field: "Kod", aggregation: "count" }]
}, 100);
check("Count aggregation excludes null and blank strings", countQuery.includes("count(*) FILTER") && countQuery.includes("nullif(trim(cast(raw_value AS VARCHAR)), '') IS NOT NULL"));
const latestQuery = context.PMA.duckdbEngine.buildGroupedQuery("smart_data", {
    rows: ["Material"], columns: [], values: [{ field: "Stan", aggregation: "latest", orderByField: "Data" }]
}, 100);
check("Latest aggregation is deterministically ordered by date and source sequence", latestQuery.includes('"Data" AS order_value') && latestQuery.includes('"__pma_duckdb_row_order" AS order_sequence') && latestQuery.includes("arg_max(try_cast(raw_value AS DOUBLE)") && latestQuery.includes("order_sequence"));
const averagePivot = context.PMA.duckdbEngine.toPivotResult([
    { row_key: "A", column_key: "M1", value: 15, total_value: 20 },
    { row_key: "A", column_key: "M2", value: 30, total_value: 20 }
], 3, "average", 100);
check("DuckDB pivot preserves a true row average instead of summing cell averages", averagePivot.rows[0]?.total === 20, averagePivot.rows[0]?.total);
check("DuckDB adapter exposes deterministic fallback status API", typeof context.PMA.duckdbEngine.getStatus === "function" && context.PMA.duckdbEngine.getStatus().status === "idle");

const passed = checks.filter(Boolean).length;
console.log(`\n${passed}/${checks.length} checks passed.`);
if (passed !== checks.length) process.exitCode = 1;
