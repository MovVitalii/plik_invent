/* ==========================================================
   Smart Analytics — explainable automatic chart selection.
========================================================== */
(function initializeChartRecommender(global) {
    "use strict";
    const PMA = global.PMA || (global.PMA = {});
    if (!PMA.analyticsCore) throw new Error("analytics-core.js must be loaded before chart-recommender.js.");
    const core = PMA.analyticsCore;

    function recommend(context, options = {}) {
        const recommendations = [];
        const rules = PMA.analyticsRules?.charts || {};
        const trend = context?.trends?.trends?.[0];
        const primaryPivot = context?.pivots?.[0];
        const strongestCorrelation = context?.correlations?.numericPairs?.[0];
        const numericProfile = context?.schema?.profiles?.find((profile) => profile.analyticalRole === "measure" && profile.numeric?.histogram?.length);

        if (trend?.series?.length >= 2) {
            recommendations.push({
                id: "chart-primary-trend",
                type: "line",
                title: `Trend: ${trend.label}`,
                xField: trend.dateField,
                yField: trend.fieldId,
                reason: "Wykryto uporządkowany wymiar czasu i miarę liczbową.",
                confidence: Math.max(0.8, trend.confidence),
                data: { labels: trend.series.map((item) => item.period), datasets: [{ label: trend.label, data: trend.series.map((item) => item.value) }] }
            });
        }

        if (primaryPivot?.result?.rows?.length) {
            const rows = primaryPivot.result.rows.slice(0, rules.maximumRankingCategories || 20);
            recommendations.push({
                id: "chart-primary-ranking",
                type: rows.length >= (rules.horizontalBarFromCategories || 9) ? "bar-horizontal" : "bar",
                title: primaryPivot.title,
                xField: primaryPivot.rows?.[0],
                yField: primaryPivot.values?.[0]?.field,
                reason: "Porównanie jednej miary między kategoriami najlepiej prezentuje wykres słupkowy.",
                confidence: primaryPivot.confidence || 0.88,
                data: { labels: rows.map((item) => item.key), datasets: [{ label: primaryPivot.title, data: rows.map((item) => item.total) }] }
            });
        }

        if (strongestCorrelation && strongestCorrelation.strength >= (rules.minimumCorrelation || 0.25)) {
            recommendations.push({
                id: "chart-correlation",
                type: "scatter",
                title: `${strongestCorrelation.leftLabel} a ${strongestCorrelation.rightLabel}`,
                xField: strongestCorrelation.leftField,
                yField: strongestCorrelation.rightField,
                reason: "Dwie miary liczbowe można porównać na wykresie rozrzutu.",
                confidence: strongestCorrelation.confidence,
                data: { datasets: [{ label: "Obserwacje", data: strongestCorrelation.samplePoints }] }
            });
        }

        if (numericProfile?.numeric?.histogram?.length) {
            recommendations.push({
                id: "chart-distribution",
                type: "histogram",
                title: `Rozkład: ${numericProfile.label}`,
                xField: numericProfile.id,
                yField: "count",
                reason: "Histogram pokazuje kształt rozkładu, koncentrację i potencjalne ogony.",
                confidence: 0.82,
                data: {
                    labels: numericProfile.numeric.histogram.map((bin) => `${core.round(bin.from, 2)}–${core.round(bin.to, 2)}`),
                    datasets: [{ label: "Liczba rekordów", data: numericProfile.numeric.histogram.map((bin) => bin.count) }]
                }
            });
        }

        const period = context?.periodComparisons?.comparisons?.[0];
        if (period?.contributors?.length) {
            const positiveAndNegative = period.contributors.slice(0, 12);
            recommendations.push({
                id: "chart-change-contributors",
                type: "bar-horizontal",
                title: `Wpływ kategorii na zmianę ${period.label}`,
                xField: period.dimensionField,
                yField: "change",
                reason: "Wykres słupkowy pokazuje, które kategorie zwiększyły lub zmniejszyły wynik.",
                confidence: period.confidence,
                data: { labels: positiveAndNegative.map((item) => item.dimension), datasets: [{ label: "Zmiana", data: positiveAndNegative.map((item) => item.change) }] }
            });
        }

        return recommendations.slice(0, options.maximumRecommendations || rules.maximumRecommendations || 6);
    }

    Object.defineProperty(PMA, "chartRecommender", {
        value: Object.freeze({ recommend }), enumerable: true, configurable: false, writable: false
    });
}(typeof window !== "undefined" ? window : self));
