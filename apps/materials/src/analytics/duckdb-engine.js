/* ==========================================================
   Smart Analytics — local DuckDB-WASM adapter.
   Loaded only when automatic pivot materialization is requested.
========================================================== */
(function initializeDuckDbEngine(global) {
    "use strict";
    const PMA = global.PMA || (global.PMA = {});

    let modulePromise = null;
    let databasePromise = null;
    let worker = null;
    let status = "idle";
    let lastError = null;

    function moduleUrl() {
        return new URL("vendor/duckdb/duckdb-browser.bundle.mjs", document.baseURI).href;
    }

    function wasmUrl() {
        return new URL("vendor/duckdb/duckdb-mvp.wasm", document.baseURI).href;
    }

    function workerUrl() {
        return new URL("vendor/duckdb/duckdb-browser-mvp.worker.js", document.baseURI).href;
    }

    async function loadModule() {
        if (!modulePromise) modulePromise = import(moduleUrl());
        return modulePromise;
    }

    async function initialize() {
        if (databasePromise) return databasePromise;
        status = "loading";
        lastError = null;
        databasePromise = (async () => {
            const duckdb = await loadModule();
            worker = new Worker(workerUrl());
            const logger = new duckdb.VoidLogger();
            const db = new duckdb.AsyncDuckDB(logger, worker);
            await db.instantiate(wasmUrl(), null);
            status = "ready";
            return db;
        })().catch((error) => {
            status = "error";
            lastError = error;
            databasePromise = null;
            try { worker?.terminate(); } catch (_) { /* noop */ }
            worker = null;
            throw error;
        });
        return databasePromise;
    }

    function quoteIdentifier(value) {
        return `"${String(value).replace(/"/g, '""')}"`;
    }

    function safeTableName(prefix = "smart_data") {
        return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`.replace(/[^a-z0-9_]/gi, "_");
    }

    function serializableValue(value) {
        if (value === undefined || value === null) return null;
        if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
        if (typeof value === "bigint") return Number(value);
        if (typeof value === "number") return Number.isFinite(value) ? value : null;
        if (["string", "boolean"].includes(typeof value)) return value;
        return JSON.stringify(value);
    }

    function normalizeRows(rows, fieldIds) {
        return rows.map((row, rowIndex) => ({
            ...Object.fromEntries(fieldIds.map((fieldId) => [fieldId, serializableValue(row?.[fieldId])])),
            __pma_duckdb_row_order: rowIndex
        }));
    }

    function timeExpression(fieldId, granularity) {
        const field = quoteIdentifier(fieldId);
        const cast = `try_cast(${field} AS DATE)`;
        if (granularity === "day") return `strftime(${cast}, '%Y-%m-%d')`;
        if (granularity === "week") return `strftime(${cast}, '%G-W%V')`;
        if (granularity === "quarter") return `concat(year(${cast}), '-Q', quarter(${cast}))`;
        if (granularity === "year") return `cast(year(${cast}) AS VARCHAR)`;
        return `strftime(${cast}, '%Y-%m')`;
    }

    function aggregationExpression(aggregation, fieldExpression = "raw_value", orderExpression = "order_value", sequenceExpression = "order_sequence") {
        if (aggregation === "count") {
            return `count(*) FILTER (WHERE nullif(trim(cast(${fieldExpression} AS VARCHAR)), '') IS NOT NULL)`;
        }
        const numeric = `try_cast(${fieldExpression} AS DOUBLE)`;
        if (aggregation === "latest") {
            const orderKey = `(cast(coalesce(epoch_ms(try_cast(${orderExpression} AS TIMESTAMP)), 0) AS HUGEINT) * 1000000000 + cast(${sequenceExpression} AS HUGEINT))`;
            return `arg_max(${numeric}, ${orderKey}) FILTER (WHERE ${numeric} IS NOT NULL)`;
        }
        if (aggregation === "average" || aggregation === "avg") return `avg(${numeric})`;
        if (aggregation === "min") return `min(${numeric})`;
        if (aggregation === "max") return `max(${numeric})`;
        return `sum(${numeric})`;
    }

    function buildGroupedQuery(tableName, recommendation, limit = 5000) {
        const rowField = recommendation.rows?.[0];
        const columnField = recommendation.columns?.[0];
        const value = recommendation.values?.[0] || {};
        if (!rowField || !value.field) throw new Error("Rekomendacja tabeli przestawnej nie zawiera wymaganych pól.");
        const rowExpression = `coalesce(nullif(trim(cast(${quoteIdentifier(rowField)} AS VARCHAR)), ''), '(brak)')`;
        const columnExpression = columnField
            ? recommendation.timeGranularity
                ? `coalesce(${timeExpression(columnField, recommendation.timeGranularity)}, '(brak)')`
                : `coalesce(nullif(trim(cast(${quoteIdentifier(columnField)} AS VARCHAR)), ''), '(brak)')`
            : `'Wartość'`;
        const aggregation = value.aggregation || "sum";
        if (aggregation === "latest" && !value.orderByField) throw new Error("Agregacja latest wymaga kolumny porządkującej.");
        const groupedMeasure = aggregationExpression(aggregation);
        const totalMeasure = aggregationExpression(aggregation);
        const boundedLimit = Math.max(1, Math.min(50000, Number(limit) || 5000));
        return `
            WITH base AS (
                SELECT ${rowExpression} AS row_key,
                       ${columnExpression} AS column_key,
                       ${quoteIdentifier(value.field)} AS raw_value,
                       ${value.orderByField ? quoteIdentifier(value.orderByField) : "NULL"} AS order_value,
                       ${quoteIdentifier("__pma_duckdb_row_order")} AS order_sequence
                FROM ${quoteIdentifier(tableName)}
            ),
            grouped AS (
                SELECT row_key,
                       column_key,
                       ${groupedMeasure} AS value
                FROM base
                GROUP BY 1, 2
            ),
            totals AS (
                SELECT row_key,
                       ${totalMeasure} AS total_value
                FROM base
                GROUP BY 1
            )
            SELECT grouped.row_key,
                   grouped.column_key,
                   grouped.value,
                   totals.total_value
            FROM grouped
            INNER JOIN totals USING (row_key)
            ORDER BY abs(grouped.value) DESC NULLS LAST
            LIMIT ${boundedLimit}
        `;
    }

    function arrowRows(table) {
        return table.toArray().map((row) => {
            const object = typeof row?.toJSON === "function" ? row.toJSON() : { ...row };
            return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, typeof value === "bigint" ? Number(value) : value]));
        });
    }

    function finiteNumberOrNull(value) {
        if (value === null || value === undefined || value === "") return null;
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : null;
    }

    function toPivotResult(longRows, sourceRows, aggregation, maximumRows = 100) {
        const columns = [...new Set(longRows.map((row) => String(row.column_key ?? "Wartość")))].sort((a, b) => a.localeCompare(b, "pl"));
        const groups = new Map();
        longRows.forEach((row) => {
            const key = String(row.row_key ?? "(brak)");
            if (!groups.has(key)) groups.set(key, { values: {}, total: finiteNumberOrNull(row.total_value) });
            const group = groups.get(key);
            group.values[String(row.column_key ?? "Wartość")] = finiteNumberOrNull(row.value);
            if (group.total === null) group.total = finiteNumberOrNull(row.total_value);
        });
        const rows = [...groups.entries()].map(([key, group]) => ({
            key,
            values: Object.fromEntries(columns.map((column) => [column, Object.prototype.hasOwnProperty.call(group.values, column) ? group.values[column] : null])),
            total: group.total
        })).sort((a, b) => Math.abs(b.total ?? 0) - Math.abs(a.total ?? 0)).slice(0, maximumRows);
        return { columns, rows, sourceRows, aggregation, generatedBy: "duckdb-wasm" };
    }

    async function materializePivots(rows, recommendations, options = {}) {
        if (!Array.isArray(rows) || !rows.length || !Array.isArray(recommendations) || !recommendations.length) return [];
        const db = await initialize();
        const fieldIds = [...new Set(recommendations.flatMap((recommendation) => [
            ...(recommendation.rows || []),
            ...(recommendation.columns || []),
            ...(recommendation.values || []).flatMap((value) => [value.field, value.orderByField])
        ]).filter(Boolean))];
        const tableName = safeTableName();
        const fileName = `${tableName}.json`;
        const normalizedRows = normalizeRows(rows, fieldIds);
        const text = JSON.stringify(normalizedRows);
        const connection = await db.connect();
        try {
            await db.registerFileText(fileName, text);
            await connection.insertJSONFromPath(fileName, { schema: "main", name: tableName });
            const outputs = [];
            for (const recommendation of recommendations) {
                const query = buildGroupedQuery(tableName, recommendation, options.maximumLongRows || 10000);
                const table = await connection.query(query);
                outputs.push({
                    ...recommendation,
                    result: toPivotResult(
                        arrowRows(table),
                        rows.length,
                        recommendation.values?.[0]?.aggregation || "sum",
                        options.maximumPivotRows || 100
                    )
                });
            }
            return outputs;
        } finally {
            try { await connection.query(`DROP TABLE IF EXISTS ${quoteIdentifier(tableName)}`); } catch (_) { /* noop */ }
            try { await db.dropFile(fileName); } catch (_) { /* noop */ }
            await connection.close();
        }
    }

    async function query(sql) {
        const db = await initialize();
        const connection = await db.connect();
        try {
            return arrowRows(await connection.query(sql));
        } finally {
            await connection.close();
        }
    }

    async function terminate() {
        try {
            const db = databasePromise ? await databasePromise : null;
            await db?.terminate?.();
        } catch (_) { /* noop */ }
        try { worker?.terminate(); } catch (_) { /* noop */ }
        worker = null;
        databasePromise = null;
        modulePromise = null;
        status = "idle";
    }

    const api = Object.freeze({
        initialize,
        materializePivots,
        query,
        terminate,
        buildGroupedQuery,
        toPivotResult,
        aggregationExpression,
        quoteIdentifier,
        getStatus: () => ({ status, error: lastError ? String(lastError.message || lastError) : null })
    });

    Object.defineProperty(PMA, "duckdbEngine", { value: api, enumerable: true, configurable: false, writable: false });
}(window));
