"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const duckdb = require("@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs");

const root = path.resolve(__dirname, "..");
const enginePath = path.join(root, "apps", "materials", "src", "analytics", "duckdb-engine.js");
const wasmPath = path.join(root, "apps", "materials", "vendor", "duckdb", "duckdb-mvp.wasm");
const packageDist = path.dirname(require.resolve("@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs"));

function loadProjectEngine() {
    const source = fs.readFileSync(enginePath, "utf8");
    const window = {};
    const context = vm.createContext({
        window,
        URL,
        document: { baseURI: "http://127.0.0.1/" },
        Worker: function WorkerStub() {},
        console,
        setTimeout,
        clearTimeout
    });
    vm.runInContext(source, context, { filename: enginePath });
    return window.PMA.duckdbEngine;
}

function plainRows(table) {
    return table.toArray().map((row) => {
        const value = typeof row?.toJSON === "function" ? row.toJSON() : { ...row };
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, typeof item === "bigint" ? Number(item) : item]));
    });
}

async function main() {
    const checks = [];
    const check = (condition, label, details = "") => {
        checks.push(Boolean(condition));
        console.log(`${condition ? "PASS" : "FAIL"} — ${label}${details ? ` (${details})` : ""}`);
    };

    const engine = loadProjectEngine();
    const bundles = {
        mvp: {
            mainModule: wasmPath,
            mainWorker: path.join(packageDist, "duckdb-node-mvp.worker.cjs")
        }
    };

    const db = await duckdb.createDuckDB(bundles, new duckdb.VoidLogger(), duckdb.NODE_RUNTIME);
    await db.instantiate();
    db.open({});
    check(db.getVersion().length > 0, "Bundled DuckDB-WASM instantiates through the native Node verification binding", db.getVersion());

    const connection = db.connect();
    try {
        connection.query(`
            CREATE TABLE sample (
                Material VARCHAR,
                Month VARCHAR,
                Usage VARCHAR,
                SnapshotDate VARCHAR,
                Stock VARCHAR,
                __pma_duckdb_row_order BIGINT
            )
        `);
        connection.query(`
            INSERT INTO sample VALUES
                ('A', '2026-01', '10', '2026-01-01', '100', 0),
                ('A', '2026-01', '20', '2026-01-02', '90', 1),
                ('A', '2026-02', '30', '2026-02-01', '80', 2),
                ('A', '2026-02', '40', '2026-02-01', '70', 3),
                ('B', '2026-01', '5',  '2026-01-01', '50', 4),
                ('B', '2026-01', '',   '2026-01-02', '45', 5),
                ('B', '2026-02', '15', '2026-02-01', '40', 6)
        `);

        const averageRecommendation = {
            rows: ["Material"],
            columns: ["Month"],
            values: [{ field: "Usage", aggregation: "average" }]
        };
        const averageRows = plainRows(connection.query(engine.buildGroupedQuery("sample", averageRecommendation, 100)));
        const averageAJanuary = averageRows.find((row) => row.row_key === "A" && row.column_key === "2026-01");
        const averageA = averageRows.find((row) => row.row_key === "A");
        check(Number(averageAJanuary?.value) === 15, "DuckDB pivot calculates the average inside a pivot cell", averageAJanuary?.value);
        check(Number(averageA?.total_value) === 25, "DuckDB pivot total is the true raw-row average, not the sum of cell averages", averageA?.total_value);

        const countRecommendation = {
            rows: ["Material"],
            columns: ["Month"],
            values: [{ field: "Usage", aggregation: "count" }]
        };
        const countRows = plainRows(connection.query(engine.buildGroupedQuery("sample", countRecommendation, 100)));
        const countBJanuary = countRows.find((row) => row.row_key === "B" && row.column_key === "2026-01");
        const countB = countRows.find((row) => row.row_key === "B");
        check(Number(countBJanuary?.value) === 1, "DuckDB count excludes blank strings", countBJanuary?.value);
        check(Number(countB?.total_value) === 2, "DuckDB count total excludes blanks across all pivot columns", countB?.total_value);

        const latestRecommendation = {
            rows: ["Material"],
            columns: [],
            values: [{ field: "Stock", aggregation: "latest", orderByField: "SnapshotDate" }]
        };
        const latestRows = plainRows(connection.query(engine.buildGroupedQuery("sample", latestRecommendation, 100)));
        const latestA = latestRows.find((row) => row.row_key === "A");
        const latestB = latestRows.find((row) => row.row_key === "B");
        check(Number(latestA?.value) === 70, "Latest stock uses the newest date and source-row sequence as deterministic tie-breaker", latestA?.value);
        check(Number(latestA?.total_value) === 70, "Latest-stock row total uses the same deterministic snapshot", latestA?.total_value);
        check(Number(latestB?.value) === 40 && Number(latestB?.total_value) === 40, "Latest-stock aggregation remains correct for another material", `${latestB?.value}/${latestB?.total_value}`);
    } finally {
        connection.close();
        db.reset();
    }

    const passed = checks.filter(Boolean).length;
    console.log(`\n${passed}/${checks.length} checks passed.`);
    if (passed !== checks.length) process.exitCode = 1;
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
