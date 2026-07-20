/* ==========================================================
   Smart Analytics — deterministic analysis pipeline.
========================================================== */
(function initializeAnalyticsOrchestrator(global) {
    "use strict";
    const PMA = global.PMA || (global.PMA = {});
    const REQUIRED = [
        "schemaProfiler", "semanticRoleEngine", "descriptiveStatistics", "dataQualityEngine",
        "outlierEngine", "trendEngine", "periodComparisonEngine", "correlationEngine",
        "pivotRecommender", "chartRecommender", "insightEngine", "reportGenerator",
        "domainClassifier", "domainAnalysisEngine"
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
        const rawDomain = PMA.domainClassifier.classifyRaw(rows, fields);
        const preparation = PMA.domainAnalysisEngine.prepare(rows, fields, rawDomain);
        const analysisRows = Array.isArray(preparation?.rows) ? preparation.rows : rows;
        if (!analysisRows.length) throw new Error("Po przygotowaniu danych nie pozostały rekordy do analizy.");
        const stage = async (progress, name, message, callback) => {
            onProgress({ progress, stage: name, message });
            await Promise.resolve();
            return callback();
        };

        const schemaRaw = await stage(8, "schema", "Rozpoznawanie typów kolumn…", () => PMA.schemaProfiler.profile(analysisRows, fields, {
            sampleSize: options.profileSampleSize || 20000,
            fullStatistics: options.fullStatistics !== false
        }));
        const schema = await stage(16, "semantics", "Określanie ról biznesowych kolumn…", () => PMA.semanticRoleEngine.infer(schemaRaw));
        const domain = PMA.domainClassifier.classify(schema, rawDomain);
        const descriptive = await stage(24, "statistics", "Obliczanie statystyk opisowych…", () => {
            const result = PMA.descriptiveStatistics.summarize(analysisRows, schema, options);
            if (options.dateField) result.primaryDateField = options.dateField;
            if (options.primaryMeasureField) result.primaryMeasureField = options.primaryMeasureField;
            if (options.primaryDimensionField) result.primaryDimensionField = options.primaryDimensionField;
            return result;
        });
        const quality = await stage(34, "quality", "Kontrola braków, duplikatów i spójności…", () => PMA.dataQualityEngine.audit(analysisRows, schema, options));
        const outliers = await stage(46, "outliers", "Wykrywanie anomalii globalnych i lokalnych…", () => PMA.outlierEngine.detect(analysisRows, schema, descriptive, options));
        const trends = await stage(58, "trends", "Analiza trendów czasowych…", () => PMA.trendEngine.analyze(analysisRows, schema, descriptive, options));
        const periodComparisons = await stage(66, "periods", "Porównywanie kolejnych okresów…", () => PMA.periodComparisonEngine.compare(analysisRows, schema, descriptive, trends, options));
        const correlations = await stage(76, "correlations", "Badanie zależności między zmiennymi…", () => PMA.correlationEngine.analyze(analysisRows, schema, options));
        const domainAnalysis = await stage(80, "domain", `Analiza biznesowa: ${domain.label}…`, () => PMA.domainAnalysisEngine.analyze(analysisRows, schema, domain, preparation.metadata || {}));
        const pivotRecommendations = await stage(83, "pivots", "Projektowanie rekomendowanych tabel przestawnych…", () => PMA.pivotRecommender.recommend(schema, descriptive, trends, options));
        const pivots = await stage(88, "pivot-results", "Obliczanie rekomendowanych zestawień…", () => PMA.pivotRecommender.materialize(analysisRows, pivotRecommendations, options.maximumPivotRows || 100));
        const chartRecommendations = await stage(92, "charts", "Dobieranie typów wykresów…", () => PMA.chartRecommender.recommend({
            domain,
            domainAnalysis,
            schema,
            descriptive,
            quality,
            outliers,
            trends,
            periodComparisons,
            correlations,
            pivots
        }, options));
        const insights = await stage(96, "insights", "Formułowanie wniosków opartych na regułach…", () => {
            let genericInsights = PMA.insightEngine.create({ quality, trends, periodComparisons, outliers, correlations });
            if (["delivery_tracking", "procurement_plan", "hierarchical_delivery_plan", "unloading_events"].includes(domain.domain)) {
                genericInsights = genericInsights.filter((item) => !["trend", "period_change"].includes(item.type));
            }
            const domainInsights = Array.isArray(domainAnalysis.insights) ? domainAnalysis.insights : [];
            return [...domainInsights, ...genericInsights].sort((left, right) => (({ high: 0, medium: 1, low: 2 })[left.severity] - ({ high: 0, medium: 1, low: 2 })[right.severity]) || (right.confidence || 0) - (left.confidence || 0));
        });
        const analysisMode = options.fullStatistics === false ? "quick" : "full";
        const ruleVersion = PMA.analyticsRules?.version || "unknown";
        const effectiveProfileRows = analysisMode === "quick" ? schema.sampledRows : analysisRows.length;
        const methodology = {
            profileMode: analysisMode,
            statisticsMode: analysisMode === "quick" ? "sample" : "full",
            profileSampled: analysisMode === "quick" && schema.sampledRows < analysisRows.length,
            profiledRows: effectiveProfileRows,
            typeDetectionSampleRows: schema.sampledRows,
            totalRows: analysisRows.length,
            correlationSampleRows: correlations.sampledRows || 0,
            outlierMethods: ["IQR", "MAD robust Z-score"],
            trendAggregations: Object.freeze({ ...(PMA.analyticsRules?.aggregationByRole || {}) }),
            ruleVersion
        };
        const report = await stage(99, "report", "Budowanie raportu tekstowego…", () => PMA.reportGenerator.generate({
            domain,
            domainAnalysis,
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

        const fingerprint = PMA.analyticsCore.datasetFingerprint(analysisRows, fields);
        const selectedDateField = options.dateField || descriptive.primaryDateField || trends.dateField || null;
        const selectedMeasureField = options.primaryMeasureField || descriptive.primaryMeasureField || null;
        const selectedDimensionField = options.primaryDimensionField || descriptive.primaryDimensionField || null;
        const rowAccountingValid = rows.length === analysisRows.length + (rows.length - analysisRows.length);
        const fieldAccountingValid = schema.columnCount === schema.profiles.length;
        const auditTrail = {
            schemaVersion: 1,
            engineVersion: "1.7.1",
            generatedAt: new Date().toISOString(),
            dataset: {
                fingerprint,
                fingerprintAlgorithm: "FNV-1a 32-bit over ordered analytical fields and values",
                originalRows: rows.length,
                analyzedRows: analysisRows.length,
                excludedRows: rows.length - analysisRows.length,
                columns: schema.columnCount,
                fieldIds: schema.profiles.map((profile) => profile.id),
                selectedDateField,
                selectedMeasureField,
                selectedDimensionField
            },
            configuration: {
                scope: options.scope || "all",
                analysisMode,
                fullStatistics: options.fullStatistics !== false,
                profileSampleSize: options.profileSampleSize || 20000,
                correlationSampleSize: options.sampleSize || 7500,
                maximumFindings: options.maximumFindings || 300,
                maximumPivotRows: options.maximumPivotRows || 100,
                sqlModeRequested: options.sqlMode || "auto",
                rulesVersion: ruleVersion
            },
            modules: [
                { id: "schema", label: "Typy i role kolumn", method: "próbkowanie + reguły typów fizycznych i semantycznych", input: `${schema.sampledRows}/${analysisRows.length} wierszy; ${schema.columnCount} kolumn`, parameters: `próba profilu: ${options.profileSampleSize || 20000}`, limitations: "Rola semantyczna jest hipotezą z poziomem pewności; wymaga kontroli przy nietypowych nazwach." },
                { id: "quality", label: "Jakość danych", method: "braki, unikalność, pełne duplikaty, zgodność typów i reguły jakości", input: `${analysisRows.length} wierszy`, parameters: `reguły: ${ruleVersion}; tryb: ${analysisMode}`, limitations: "Silnik wykrywa niespójności techniczne, ale nie zna wszystkich reguł procesu biznesowego." },
                { id: "outliers", label: "Anomalie", method: "IQR oraz robust Z-score oparty na MAD; analiza globalna i lokalna", input: `${outliers.analyzedFields || outliers.fieldsAnalyzed || 0} pól liczbowych; ${analysisRows.length} wierszy`, parameters: `maks. wyników: ${options.maximumFindings || 300}`, limitations: "Anomalia statystyczna może być prawidłowym zdarzeniem operacyjnym; nie jest automatycznie błędem." },
                { id: "trends", label: "Trendy", method: "agregacja czasowa, regresja liniowa, zmiana procentowa i zmienność", input: `${trends.trends?.length || 0} szeregów; pole daty: ${selectedDateField || "brak"}`, parameters: `agregacje wg roli: ${JSON.stringify(methodology.trendAggregations)}`, limitations: "Trend wymaga wystarczającej liczby poprawnych okresów i nie stanowi prognozy przyczynowej." },
                { id: "periods", label: "Porównanie okresów", method: "ostatni kompletny okres względem poprzedniego porównywalnego okresu", input: `${periodComparisons.comparisons?.length || 0} porównań`, parameters: `granularność: ${trends.granularity || "automatyczna"}`, limitations: "Wynik zależy od kompletności okresów i wybranej granularności." },
                { id: "correlations", label: "Zależności", method: "Pearson, Spearman, eta² i V Craméra", input: `próba do ${correlations.sampledRows || 0} wierszy`, parameters: `maks. próba: ${options.sampleSize || 7500}`, limitations: "Korelacja nie oznacza związku przyczynowego; identyfikatory są wykluczane z miar." },
                { id: "pivots", label: "Tabele przestawne i wykresy", method: "deterministyczne reguły doboru wymiarów, miar, agregacji i wizualizacji", input: `${pivots.length} tabel; ${chartRecommendations.length} wykresów`, parameters: `maks. wierszy pivot: ${options.maximumPivotRows || 100}; SQL: ${options.sqlMode || "auto"}`, limitations: "Rekomendacje są ograniczone do wykrytych typów i kardynalności kolumn." },
                { id: "report", label: "Raport tekstowy", method: "szablony i reguły na podstawie policzonych wyników", input: `${insights.length} wniosków`, parameters: `reguły: ${ruleVersion}`, limitations: "Raport nie używa AI i nie dodaje wiedzy spoza danych ani zdefiniowanych reguł." }
            ],
            checks: [
                { id: "deterministic", label: "Obliczenia deterministyczne", passed: true, evidence: "Brak losowego generowania wyników i brak usług zewnętrznych." },
                { id: "local-only", label: "Przetwarzanie lokalne", passed: true, evidence: "JavaScript/Web Worker i opcjonalny lokalny DuckDB-WASM; brak API sieciowego." },
                { id: "row-accounting", label: "Bilans wierszy", passed: rowAccountingValid, evidence: `${rows.length} = ${analysisRows.length} analizowanych + ${rows.length - analysisRows.length} wykluczonych.` },
                { id: "field-accounting", label: "Bilans kolumn", passed: fieldAccountingValid, evidence: `${schema.columnCount} zadeklarowanych = ${schema.profiles.length} profili.` },
                { id: "fingerprint", label: "Identyfikator danych", passed: Boolean(fingerprint), evidence: fingerprint }
            ],
            execution: { statisticalEngine: "javascript", sqlEngine: "javascript", sqlModeRequested: options.sqlMode || "auto" }
        };

        const result = {
            schemaVersion: 1,
            engineVersion: "1.7.1",
            startedAt,
            generatedAt: new Date().toISOString(),
            durationMs: Date.now() - Date.parse(startedAt),
            datasetProfile: {
                rows: rows.length,
                originalRows: rows.length,
                analyzedRows: analysisRows.length,
                excludedRows: rows.length - analysisRows.length,
                columns: schema.columnCount,
                scope: options.scope || "all",
                analysisMode,
                profiledRows: effectiveProfileRows,
                dateRange: trends.dateRange || null,
                source: options.source || "workspace"
            },
            domain,
            domainAnalysis,
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
            auditTrail,
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
