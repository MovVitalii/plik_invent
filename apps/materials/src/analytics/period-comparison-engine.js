/* ==========================================================
   Smart Analytics — latest-period comparisons and contributors.
========================================================== */
(function initializePeriodComparisonEngine(global) {
    "use strict";
    const PMA = global.PMA || (global.PMA = {});
    if (!PMA.analyticsCore || !PMA.trendEngine) throw new Error("analytics-core.js and trend-engine.js must be loaded first.");
    const core = PMA.analyticsCore;

    function compare(rows, semanticProfile, descriptive, trendResult, options = {}) {
        if (!trendResult?.dateField || !trendResult?.granularity) return { comparisons: [], reason: "Brak szeregu czasowego." };
        const dateField = trendResult.dateField;
        const granularity = trendResult.granularity;
        const dimensionField = options.dimensionField || descriptive?.primaryDimensionField || null;
        const comparisons = [];

        (trendResult.trends || []).forEach((trend) => {
            const series = trend.series || [];
            if (series.length < 2) return;
            const current = series[series.length - 1];
            const previous = series[series.length - 2];
            const absoluteChange = current.value - previous.value;
            const percentageChange = previous.value !== 0 ? absoluteChange / Math.abs(previous.value) : null;
            let contributors = [];
            if (dimensionField) {
                const currentByDimension = new Map();
                const previousByDimension = new Map();
                const update = (target, dimension, value, timestamp) => {
                    const item = target.get(dimension) || { value: 0, sum: 0, count: 0, latestTimestamp: -Infinity };
                    item.sum += value;
                    item.count += 1;
                    if (trend.aggregation === "latest") {
                        if (timestamp >= item.latestTimestamp) { item.latestTimestamp = timestamp; item.value = value; }
                    } else if (trend.aggregation === "average") item.value = item.sum / item.count;
                    else item.value = item.sum;
                    target.set(dimension, item);
                };
                rows.forEach((row) => {
                    const date = core.parseDate(row?.[dateField]);
                    const period = core.periodKey(date, granularity);
                    if (!date || ![current.period, previous.period].includes(period)) return;
                    const dimension = core.isBlank(row?.[dimensionField]) ? "(brak)" : String(row[dimensionField]);
                    const value = core.parseNumber(row?.[trend.fieldId]);
                    if (!Number.isFinite(value)) return;
                    update(period === current.period ? currentByDimension : previousByDimension, dimension, value, date.getTime());
                });
                const dimensions = new Set([...currentByDimension.keys(), ...previousByDimension.keys()]);
                contributors = [...dimensions].map((dimension) => {
                    const currentValue = currentByDimension.get(dimension)?.value || 0;
                    const previousValue = previousByDimension.get(dimension)?.value || 0;
                    return { dimension, currentValue, previousValue, change: currentValue - previousValue };
                }).sort((left, right) => Math.abs(right.change) - Math.abs(left.change)).slice(0, 10);
            }
            comparisons.push({
                fieldId: trend.fieldId,
                label: trend.label,
                granularity,
                aggregation: trend.aggregation || "sum",
                currentPeriod: current.period,
                previousPeriod: previous.period,
                currentValue: current.value,
                previousValue: previous.value,
                absoluteChange,
                percentageChange,
                direction: absoluteChange > 0 ? "up" : absoluteChange < 0 ? "down" : "stable",
                contributors,
                dimensionField,
                confidence: core.round(core.clamp(trend.confidence * (current.records >= 3 && previous.records >= 3 ? 1 : 0.78)), 3)
            });
        });

        return { dateField, granularity, dimensionField, comparisons };
    }

    Object.defineProperty(PMA, "periodComparisonEngine", {
        value: Object.freeze({ compare }), enumerable: true, configurable: false, writable: false
    });
}(typeof window !== "undefined" ? window : self));
