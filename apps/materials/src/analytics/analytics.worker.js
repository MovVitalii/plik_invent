/* Smart Analytics dedicated Web Worker. */
"use strict";

self.PMA = self.PMA || {};
importScripts(
    "rules/analytics-rules.js",
    "analytics-core.js",
    "schema-profiler.js",
    "semantic-role-engine.js",
    "domain-classifier.js",
    "domain-analysis-engine.js",
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
);

self.addEventListener("message", async (event) => {
    const message = event.data || {};
    if (message.type !== "analyze") return;
    try {
        const result = await self.PMA.analyticsOrchestrator.analyze(message.payload, (progress) => {
            self.postMessage({ type: "progress", requestId: message.requestId, progress });
        });
        self.postMessage({ type: "complete", requestId: message.requestId, result });
    } catch (error) {
        self.postMessage({
            type: "error",
            requestId: message.requestId,
            error: { name: error?.name || "Error", message: error?.message || String(error), stack: error?.stack || null }
        });
    }
});
