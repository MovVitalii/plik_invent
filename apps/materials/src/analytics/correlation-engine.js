/* ==========================================================
   Smart Analytics — numeric and categorical associations.
========================================================== */
(function initializeCorrelationEngine(global) {
    "use strict";
    const PMA = global.PMA || (global.PMA = {});
    if (!PMA.analyticsCore) throw new Error("analytics-core.js must be loaded before correlation-engine.js.");
    const core = PMA.analyticsCore;

    function analyze(rows, semanticProfile, options = {}) {
        const sampled = core.sampleRows(Array.isArray(rows) ? rows : [], options.sampleSize || 5000);
        const profiles = semanticProfile?.profiles || [];
        const numeric = profiles
            .filter((profile) => profile.analyticalRole === "measure" && profile.semanticRole !== "identifier" && profile.numeric?.count >= 5)
            .sort((left, right) => right.numeric.count - left.numeric.count)
            .slice(0, options.maximumNumericFields || 10);
        const categorical = profiles
            .filter((profile) => profile.analyticalRole === "dimension" && profile.uniqueCount >= 2 && profile.uniqueCount <= 50)
            .sort((left, right) => left.uniqueCount - right.uniqueCount)
            .slice(0, options.maximumCategoricalFields || 8);
        const numericPairs = [];
        const categoryMeasure = [];
        const categoryPairs = [];

        for (let leftIndex = 0; leftIndex < numeric.length; leftIndex += 1) {
            for (let rightIndex = leftIndex + 1; rightIndex < numeric.length; rightIndex += 1) {
                const left = numeric[leftIndex];
                const right = numeric[rightIndex];
                const leftValues = sampled.map((row) => core.parseNumber(row?.[left.id]));
                const rightValues = sampled.map((row) => core.parseNumber(row?.[right.id]));
                const pearson = core.pearson(leftValues, rightValues);
                const spearman = core.spearman(leftValues, rightValues);
                if (pearson.sampleSize < 5) continue;
                const strength = Math.max(Math.abs(pearson.coefficient || 0), Math.abs(spearman.coefficient || 0));
                numericPairs.push({
                    leftField: left.id,
                    leftLabel: left.label,
                    rightField: right.id,
                    rightLabel: right.label,
                    pearson: pearson.coefficient,
                    spearman: spearman.coefficient,
                    sampleSize: pearson.sampleSize,
                    strength,
                    direction: (pearson.coefficient || spearman.coefficient || 0) > 0 ? "positive" : "negative",
                    confidence: core.round(core.clamp(0.45 + Math.min(0.3, pearson.sampleSize / 1000) + strength * 0.25), 3),
                    samplePoints: sampled.map((row) => ({ x: core.parseNumber(row?.[left.id]), y: core.parseNumber(row?.[right.id]) }))
                        .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
                        .slice(0, 250)
                });
            }
        }

        categorical.slice(0, 5).forEach((category) => {
            numeric.slice(0, 6).forEach((measure) => {
                const result = core.etaSquared(
                    sampled.map((row) => row?.[category.id]),
                    sampled.map((row) => core.parseNumber(row?.[measure.id]))
                );
                if (result.coefficient === null || result.sampleSize < 8) return;
                categoryMeasure.push({
                    categoryField: category.id,
                    categoryLabel: category.label,
                    measureField: measure.id,
                    measureLabel: measure.label,
                    etaSquared: result.coefficient,
                    sampleSize: result.sampleSize,
                    groups: result.groups,
                    strength: result.coefficient,
                    confidence: core.round(core.clamp(0.45 + Math.min(0.25, result.sampleSize / 1000) + result.coefficient * 0.3), 3)
                });
            });
        });

        for (let leftIndex = 0; leftIndex < Math.min(categorical.length, 6); leftIndex += 1) {
            for (let rightIndex = leftIndex + 1; rightIndex < Math.min(categorical.length, 6); rightIndex += 1) {
                const left = categorical[leftIndex];
                const right = categorical[rightIndex];
                const result = core.cramersV(sampled.map((row) => row?.[left.id]), sampled.map((row) => row?.[right.id]));
                if (result.coefficient === null || result.sampleSize < 8) continue;
                categoryPairs.push({
                    leftField: left.id,
                    leftLabel: left.label,
                    rightField: right.id,
                    rightLabel: right.label,
                    cramersV: result.coefficient,
                    sampleSize: result.sampleSize,
                    strength: result.coefficient,
                    confidence: core.round(core.clamp(0.45 + Math.min(0.25, result.sampleSize / 1000) + result.coefficient * 0.3), 3)
                });
            }
        }

        numericPairs.sort((left, right) => right.strength - left.strength);
        categoryMeasure.sort((left, right) => right.strength - left.strength);
        categoryPairs.sort((left, right) => right.strength - left.strength);

        return {
            sampledRows: sampled.length,
            numericPairs,
            categoryMeasure,
            categoryPairs,
            strongestNumeric: numericPairs[0] || null,
            strongestCategoryMeasure: categoryMeasure[0] || null,
            strongestCategoryPair: categoryPairs[0] || null,
            caveat: "Zależność statystyczna nie dowodzi związku przyczynowego."
        };
    }

    Object.defineProperty(PMA, "correlationEngine", {
        value: Object.freeze({ analyze }), enumerable: true, configurable: false, writable: false
    });
}(typeof window !== "undefined" ? window : self));
