/* ==========================================================
   Smart Analytics — deterministic analysis pipeline.
========================================================== */
(function initializeAnalyticsOrchestrator(global) {
    "use strict";
    const PMA = global.PMA || (global.PMA = {});
    const REQUIRED = [
        "schemaProfiler", "semanticRoleEngine", "descriptiveStatistics", "dataQualityEngine",
        "outlierEngine", "trendEngine", "periodComparisonEngine", "correlationEngine",
        "pivotRecommender", "chartRecommender", "insightEngine", "reportGenerator"
    ];

    function verifyModules() {
        const missing = REQUIRED.filter((name) => !PMA[name]);
        if (missing.length) throw new Error(`Brak modułów Smart Analytics: ${missing.join(", ")}.`);
    }

    async function analyze(payload = {}, onProgress = () => {}) {
        verifyModules();
        const rows = Array.isArray(payload.rows) ? payload.rows : [];
        const fields = Array.isArray(payload.fields) ? payload.fields : [];
        const options = payload.options || {};
        if (!rows.length) throw new Error("Brak danych do analizy.");

        const startedAt = new Date().toISOString();
        const stage = async (progress, name, message, callback) => {
            onProgress({ progress, stage: name, message });
            await Promise.resolve();
            return callback();
        };

        const schemaRaw = await stage(8, "schema", "Rozpoznawanie typów kolumn…", () => PMA.schemaProfiler.profile(rows, fields, {
            sampleSize: options.profileSampleSize || 20000,
            fullStatistics: options.fullStatistics !== false
        }));
        const schema = await stage(16, "semantics", "Określanie ról biznesowych kolumn…", () => PMA.semanticRoleEngine.infer(schemaRaw));
        const descriptive = await stage(24, "statistics", "Obliczanie statystyk opisowych…", () => {
            const result = PMA.descriptiveStatistics.summarize(rows, schema, options);
            if (options.dateField) result.primaryDateField = options.dateField;
            if (options.primaryMeasureField) result.primaryMeasureField = options.primaryMeasureField;
            if (options.primaryDimensionField) result.primaryDimensionField = options.primaryDimensionField;
            return result;
        });
        const quality = await stage(34, "quality", "Kontrola braków, duplikatów i spójności…", () => PMA.dataQualityEngine.audit(rows, schema, options));
        const outliers = await stage(46, "outliers", "Wykrywanie anomalii globalnych i lokalnych…", () => PMA.outlierEngine.detect(rows, schema, descriptive, options));
        const trends = await stage(58, "trends", "Analiza trendów czasowych…", () => PMA.trendEngine.analyze(rows, schema, descriptive, options));
        const periodComparisons = await stage(66, "periods", "Porównywanie kolejnych okresów…", () => PMA.periodComparisonEngine.compare(rows, schema, descriptive, trends, options));
        const correlations = await stage(76, "correlations", "Badanie zależności między zmiennymi…", () => PMA.correlationEngine.analyze(rows, schema, options));
        const pivotRecommendations = await stage(83, "pivots", "Projektowanie rekomendowanych tabel przestawnych…", () => PMA.pivotRecommender.recommend(schema, descriptive, trends, options));
        const pivots = await stage(88, "pivot-results", "Obliczanie rekomendowanych zestawień…", () => PMA.pivotRecommender.materialize(rows, pivotRecommendations, options.maximumPivotRows || 100));
        const chartRecommendations = await stage(92, "charts", "Dobieranie typów wykresów…", () => PMA.chartRecommender.recommend({
            schema,
            descriptive,
            quality,
            outliers,
            trends,
            periodComparisons,
            correlations,
            pivots
        }, options));
        const insights = await stage(96, "insights", "Formułowanie wniosków opartych na regułach…", () => PMA.insightEngine.create({ quality, trends, periodComparisons, outliers, correlations }));
        const analysisMode = options.fullStatistics === false ? "quick" : "full";
        const ruleVersion = PMA.analyticsRules?.version || "unknown";
        const effectiveProfileRows = analysisMode === "quick" ? schema.sampledRows : rows.length;
        const methodology = {
            profileMode: analysisMode,
            statisticsMode: analysisMode === "quick" ? "sample" : "full",
            profileSampled: analysisMode === "quick" && schema.sampledRows < rows.length,
            profiledRows: effectiveProfileRows,
            typeDetectionSampleRows: schema.sampledRows,
            totalRows: rows.length,
            correlationSampleRows: correlations.sampledRows || 0,
            outlierMethods: ["IQR", "MAD robust Z-score"],
            trendAggregations: Object.freeze({ ...(PMA.analyticsRules?.aggregationByRole || {}) }),
            ruleVersion
        };
        const report = await stage(99, "report", "Budowanie raportu tekstowego…", () => PMA.reportGenerator.generate({
            schema,
            descriptive,
            quality,
            outliers,
            trends,
            periodComparisons,
            correlations,
            pivots,
            chartRecommendations,
            insights,
            methodology,
            options
        }));

        const result = {
            schemaVersion: 1,
            engineVersion: "1.5.0",
            startedAt,
            generatedAt: new Date().toISOString(),
            durationMs: Date.now() - Date.parse(startedAt),
            datasetProfile: {
                rows: rows.length,
                columns: schema.columnCount,
                scope: options.scope || "all",
                analysisMode,
                profiledRows: effectiveProfileRows,
                dateRange: trends.dateRange || null,
                source: options.source || "workspace"
            },
            schema,
            descriptive,
            quality,
            outliers,
            trends,
            periodComparisons,
            correlations,
            pivots,
            recommendedCharts: chartRecommendations,
            insights,
            report,
            methodology,
            execution: {
                statisticalEngine: "javascript",
                sqlEngine: "javascript",
                rulesVersion: ruleVersion,
                deterministic: true,
                externalServices: false
            }
        };
        onProgress({ progress: 100, stage: "complete", message: "Analiza została ukończona." });
        return result;
    }

    Object.defineProperty(PMA, "analyticsOrchestrator", {
        value: Object.freeze({ analyze, verifyModules }), enumerable: true, configurable: false, writable: false
    });
}(typeof window !== "undefined" ? window : self));
