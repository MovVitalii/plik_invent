"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const ANALYTICS = path.join(ROOT, "apps", "materials", "src", "analytics");
const scripts = [
    "rules/analytics-rules.js",
    "analytics-core.js",
    "schema-profiler.js",
    "semantic-role-engine.js",
    "descriptive-statistics.js",
    "data-quality-engine.js",
    "outlier-engine.js",
    "trend-engine.js",
    "period-comparison-engine.js",
    "correlation-engine.js",
    "confidence-engine.js",
    "pivot-recommender.js",
    "chart-recommender.js",
    "insight-engine.js",
    "report-generator.js",
    "analytics-orchestrator.js"
];

const context = {
    console,
    Date,
    Math,
    Intl,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Promise,
    Object,
    Array,
    String,
    Number,
    Boolean,
    RegExp,
    JSON,
    Error,
    TypeError,
    self: null,
    window: null,
    PMA: {}
};
context.self = context;
context.window = context;
vm.createContext(context);
scripts.forEach((name) => vm.runInContext(fs.readFileSync(path.join(ANALYTICS, name), "utf8"), context, { filename: name }));

const checks = [];
function check(label, condition, detail = "") {
    const pass = Boolean(condition);
    checks.push(pass);
    console.log(`${pass ? "PASS" : "FAIL"} — ${label}${detail ? ` (${detail})` : ""}`);
}

function fixture() {
    const rows = [];
    let id = 1;
    for (let month = 0; month < 18; month += 1) {
        const year = 2025 + Math.floor(month / 12);
        const monthNumber = month % 12 + 1;
        ["Karton", "Folia", "Taśma"].forEach((material, materialIndex) => {
            const base = 100 + month * 8 + materialIndex * 25;
            const quantity = month === 15 && material === "Folia" ? 999 : base;
            rows.push({
                id: `r-${id++}`,
                date: `${year}-${String(monthNumber).padStart(2, "0")}-15`,
                material,
                category: material === "Karton" ? "Papier" : "Tworzywo",
                supplier: month % 7 === 0 ? "" : material === "Karton" ? "Supplier A" : "Supplier B",
                quantity,
                price: quantity * 2 + materialIndex,
                status: month % 5 === 0 ? "Review" : "OK"
            });
        });
    }
    rows.push({ ...rows[5] });
    return rows;
}

const fields = [
    { id: "id", label: "ID rekordu", type: "text", source: "source" },
    { id: "date", label: "Data operacji", type: "date", source: "mapped" },
    { id: "material", label: "Materiał", type: "text", source: "mapped" },
    { id: "category", label: "Kategoria", type: "text", source: "mapped" },
    { id: "supplier", label: "Dostawca", type: "text", source: "source" },
    { id: "quantity", label: "Zużycie / ilość", type: "number", source: "mapped" },
    { id: "price", label: "Wartość PLN", type: "number", source: "source" },
    { id: "status", label: "Status", type: "text", source: "source" }
];

(async () => {
    check("Scientific notation remains numeric", context.PMA.analyticsCore.parseNumber("1e3") === 1000);
    check("Polish currency-formatted number is parsed", context.PMA.analyticsCore.parseNumber("1 234,50 PLN") === 1234.5);
    check("Impossible calendar date is rejected", context.PMA.analyticsCore.parseDate("2025-02-31") === null);
    check("Valid leap-day date is accepted", context.PMA.analyticsCore.toISODate("2024-02-29") === "2024-02-29");
    const periodicRows = Array.from({ length: 50000 }, (_, index) => ({ category: index % 5 }));
    const sampledCategories = new Set(context.PMA.analyticsCore.sampleRows(periodicRows, 5000).map((row) => row.category));
    check("Deterministic sampling avoids periodic category aliasing", sampledCategories.size === 5, sampledCategories.size);
    const quickRows = Array.from({ length: 100 }, (_, index) => ({ amount: index < 50 ? null : index }));
    const quickProfile = context.PMA.schemaProfiler.profile(quickRows, [{ id: "amount", label: "Ilość", type: "number", source: "source" }], { fullStatistics: false, sampleSize: 20 });
    const quickAmount = quickProfile.profiles[0];
    check("Quick profile estimates missing ratio against the full dataset", Math.abs(quickAmount.missingRatio - 0.5) <= 0.1 && quickAmount.missingCount >= 40 && quickAmount.missingCount <= 60, `${quickAmount.missingCount}/${quickAmount.missingRatio}`);
    const monthlyRows = [
        { date: "2026-01-01", stock: 100, price: 10, quantity: 10 },
        { date: "2026-01-31", stock: 80, price: 20, quantity: 20 }
    ];
    check("Stock trend uses the latest snapshot in a period", context.PMA.trendEngine.aggregateSeries(monthlyRows, "date", "stock", "month", "latest")[0].value === 80);
    check("Price trend uses the period average", context.PMA.trendEngine.aggregateSeries(monthlyRows, "date", "price", "month", "average")[0].value === 15);
    check("Quantity trend remains additive", context.PMA.trendEngine.aggregateSeries(monthlyRows, "date", "quantity", "month", "sum")[0].value === 30);
    const averagePivot = context.PMA.pivotRecommender.executePivot([
        { category: "A", month: "M1", price: 10 },
        { category: "A", month: "M1", price: 20 },
        { category: "A", month: "M2", price: 30 }
    ], { rows: ["category"], columns: ["month"], values: [{ field: "price", aggregation: "average" }] });
    check("JavaScript pivot computes a true row average across source records", averagePivot.rows[0]?.total === 20, averagePivot.rows[0]?.total);
    const timePivot = context.PMA.pivotRecommender.executePivot([
        { category: "A", date: "2026-01-01", quantity: 10 },
        { category: "A", date: "2026-01-31", quantity: 20 },
        { category: "A", date: "2026-02-01", quantity: 30 }
    ], { rows: ["category"], columns: ["date"], values: [{ field: "quantity", aggregation: "sum" }], timeGranularity: "month" });
    check("JavaScript pivot groups date columns using the recommended granularity", timePivot.columns.join(",") === "2026-01,2026-02" && timePivot.rows[0]?.values["2026-01"] === 30, timePivot.columns.join(","));
    const latestPivot = context.PMA.pivotRecommender.executePivot([
        { material: "A", date: "2026-01-01", stock: 100 },
        { material: "A", date: "2026-01-31", stock: 80 },
        { material: "A", date: "2026-01-15", stock: 90 }
    ], { rows: ["material"], columns: [], values: [{ field: "stock", aggregation: "latest", orderByField: "date" }] });
    check("JavaScript pivot uses the latest dated stock snapshot", latestPivot.rows[0]?.total === 80, latestPivot.rows[0]?.total);
    const typeRows = Array.from({ length: 100 }, (_, index) => ({ amount: index < 60 ? index : `error-${index}` }));
    const typeSchema = context.PMA.semanticRoleEngine.infer(context.PMA.schemaProfiler.profile(typeRows, [{ id: "amount", label: "Ilość", type: "number", source: "source" }], { fullStatistics: true }));
    const typeQuality = context.PMA.dataQualityEngine.audit(typeRows, typeSchema, { maximumExamples: 5 });
    check("Type-error totals are exact while examples remain bounded", typeQuality.typeErrors[0]?.count === 40 && typeQuality.typeErrors[0]?.examples.length === 5, `${typeQuality.typeErrors[0]?.count}/${typeQuality.typeErrors[0]?.examples.length}`);

    const progress = [];
    const result = await context.PMA.analyticsOrchestrator.analyze({
        rows: fixture(),
        fields,
        options: { fullStatistics: true, profileSampleSize: 10000, sampleSize: 5000, maximumFindings: 100 }
    }, (item) => progress.push(item.progress));

    const byId = new Map(result.schema.profiles.map((profile) => [profile.id, profile]));
    check("Date column is physically detected", byId.get("date")?.physicalType === "date", byId.get("date")?.physicalType);
    check("Quantity column is physically detected", byId.get("quantity")?.physicalType === "number", byId.get("quantity")?.physicalType);
    check("Material semantic role is detected", byId.get("material")?.semanticRole === "material", byId.get("material")?.semanticRole);
    check("Record identifier semantic role is detected", byId.get("id")?.semanticRole === "identifier", byId.get("id")?.semanticRole);
    check("Quantity semantic role is detected", byId.get("quantity")?.semanticRole === "quantity", byId.get("quantity")?.semanticRole);
    check("Missing supplier values are found", result.quality.missingValues.some((item) => item.fieldId === "supplier" && item.count > 0));
    check("Full-row duplicate is found", result.quality.duplicateRows.count >= 1, result.quality.duplicateRows.count);
    check("Injected outlier is found", result.outliers.findings.some((item) => item.fieldId === "quantity" && item.value === 999));
    check("Time trend is generated", result.trends.trends.some((item) => item.fieldId === "quantity" && item.series.length >= 12));
    check("Latest-period comparison is generated", result.periodComparisons.comparisons.some((item) => item.fieldId === "quantity"));
    check("Strong numeric correlation is found", result.correlations.numericPairs.some((item) => [item.leftField, item.rightField].includes("quantity") && [item.leftField, item.rightField].includes("price") && item.strength > 0.9));
    check("Pivot recommendations are materialized", result.pivots.length > 0 && result.pivots[0].result.rows.length > 0);
    check("Chart recommendations are generated", result.recommendedCharts.length >= 2);
    check("Template insights are generated", result.insights.length > 0);
    check("Structured Polish report is generated", result.report.sections.length >= 8 && result.report.plainText.includes("PODSUMOWANIE ZARZĄDCZE") && result.report.plainText.includes("Metodyka"));
    check("Methodology records analysis mode, samples and rule version", result.methodology.profileMode === "full" && result.methodology.profiledRows === result.datasetProfile.profiledRows && result.methodology.ruleVersion === context.PMA.analyticsRules.version);
    check("Execution metadata starts with deterministic local JavaScript engines", result.execution.statisticalEngine === "javascript" && result.execution.sqlEngine === "javascript" && result.execution.rulesVersion === context.PMA.analyticsRules.version);
    check("Pipeline progress reaches 100%", progress.at(-1) === 100, progress.at(-1));
    check("No external AI service is declared", result.execution.externalServices === false && result.execution.deterministic === true);

    const passed = checks.filter(Boolean).length;
    console.log(`\n${passed}/${checks.length} checks passed.`);
    if (passed !== checks.length) process.exitCode = 1;
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
