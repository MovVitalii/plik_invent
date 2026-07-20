"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const ANALYTICS = path.join(ROOT, "apps", "materials", "src", "analytics");
const scripts = [
    "rules/analytics-rules.js",
    "analytics-core.js", "schema-profiler.js", "semantic-role-engine.js", "domain-classifier.js", "domain-analysis-engine.js", "descriptive-statistics.js",
    "data-quality-engine.js", "outlier-engine.js", "trend-engine.js", "period-comparison-engine.js",
    "correlation-engine.js", "confidence-engine.js", "pivot-recommender.js", "chart-recommender.js",
    "insight-engine.js", "report-generator.js", "analytics-orchestrator.js"
];
const context = { console, Date, Math, Intl, Map, Set, WeakMap, WeakSet, Promise, Object, Array, String, Number, Boolean, RegExp, JSON, Error, TypeError, self: null, window: null, PMA: {} };
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

function createRows(count) {
    const materials = ["Karton", "Folia", "Taśma", "Etykieta", "Wypełniacz"];
    const rows = new Array(count);
    const start = Date.UTC(2024, 0, 1);
    for (let index = 0; index < count; index += 1) {
        const materialIndex = index % materials.length;
        rows[index] = {
            __internalKey: `internal-${index}`,
            id: `row-${index + 1}`,
            date: new Date(start + (index % 730) * 86400000).toISOString().slice(0, 10),
            material: materials[materialIndex],
            category: materialIndex < 2 ? "Opakowanie" : "Akcesoria",
            quantity: 50 + materialIndex * 10 + (index % 17),
            cost: (50 + materialIndex * 10 + (index % 17)) * 1.75,
            status: index % 23 === 0 ? "Review" : "OK"
        };
    }
    rows[Math.floor(count * 0.7)].quantity = 9999;
    return rows;
}

const fields = [
    { id: "__internalKey", label: "Internal", type: "text", source: "internal" },
    { id: "id", label: "ID", type: "text", source: "source" },
    { id: "date", label: "Data", type: "date", source: "mapped" },
    { id: "material", label: "Materiał", type: "text", source: "mapped" },
    { id: "category", label: "Kategoria", type: "text", source: "source" },
    { id: "quantity", label: "Zużycie", type: "number", source: "mapped" },
    { id: "cost", label: "Koszt", type: "number", source: "source" },
    { id: "status", label: "Status", type: "text", source: "source" }
];

(async () => {
    const largeProfileRows = createRows(150000);
    const profileStart = Date.now();
    const profile = context.PMA.schemaProfiler.profile(largeProfileRows, fields, { fullStatistics: true, sampleSize: 20000 });
    const profileDuration = Date.now() - profileStart;
    check("Full schema profiling handles 150,000 rows without argument overflow", profile.rowCount === 150000, `${profileDuration} ms`);
    check("Internal fields are excluded from automatic analytics", !profile.profiles.some((item) => item.id === "__internalKey"));
    check("Large numeric minimum and maximum are correct", profile.profiles.find((item) => item.id === "quantity")?.numeric?.maximum === 9999);

    const rows = createRows(50000);
    const progress = [];
    const start = Date.now();
    const result = await context.PMA.analyticsOrchestrator.analyze({
        rows,
        fields,
        options: {
            scope: "all",
            fullStatistics: false,
            profileSampleSize: 10000,
            sampleSize: 5000,
            maximumFindings: 120,
            maximumRecommendations: 6
        }
    }, (item) => progress.push(item.progress));
    const duration = Date.now() - start;
    check("Smart Analytics quick pipeline handles 50,000 rows", result.datasetProfile.rows === 50000, `${duration} ms`);
    check("50,000-row pipeline reaches 100%", progress.at(-1) === 100, progress.at(-1));
    check("50,000-row pipeline detects the injected anomaly", result.outliers.findings.some((item) => item.fieldId === "quantity" && item.value === 9999));
    check("50,000-row pipeline produces trends and comparisons", result.trends.trends.length > 0 && result.periodComparisons.comparisons.length > 0);
    check("50,000-row pipeline remains deterministic and local", result.execution.deterministic === true && result.execution.externalServices === false);
    check("50,000-row pipeline completes within the regression budget", duration < 30000, `${duration} ms`);

    const passed = checks.filter(Boolean).length;
    console.log(`\n${passed}/${checks.length} checks passed.`);
    if (passed !== checks.length) process.exitCode = 1;
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
