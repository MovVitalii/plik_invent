/* ==========================================================
   Smart Analytics — time-series trend analysis.
========================================================== */
(function initializeTrendEngine(global) {
    "use strict";
    const PMA = global.PMA || (global.PMA = {});
    if (!PMA.analyticsCore) throw new Error("analytics-core.js must be loaded before trend-engine.js.");
    const core = PMA.analyticsCore;

    function aggregationForRole(role) {
        return PMA.analyticsRules?.aggregationByRole?.[role] || "sum";
    }

    function aggregateSeries(rows, dateField, measureField, granularity, aggregation = "sum") {
        const buckets = new Map();
        rows.forEach((row) => {
            const date = core.parseDate(row?.[dateField]);
            const key = core.periodKey(date, granularity);
            const value = core.parseNumber(row?.[measureField]);
            if (!date || !key || !Number.isFinite(value)) return;
            const current = buckets.get(key) || { period: key, value: 0, records: 0, sum: 0, latestTimestamp: -Infinity };
            current.records += 1;
            current.sum += value;
            if (aggregation === "latest") {
                const timestamp = date.getTime();
                if (timestamp >= current.latestTimestamp) {
                    current.latestTimestamp = timestamp;
                    current.value = value;
                }
            } else if (aggregation === "average") {
                current.value = current.sum / current.records;
            } else {
                current.value = current.sum;
            }
            buckets.set(key, current);
        });
        return [...buckets.values()]
            .sort((left, right) => left.period.localeCompare(right.period))
            .map(({ sum, latestTimestamp, ...item }) => item);
    }

    function analyze(rows, semanticProfile, descriptive, options = {}) {
        const profiles = semanticProfile?.profiles || [];
        const dateProfile = profiles.find((profile) => profile.id === options.dateField)
            || profiles.find((profile) => profile.id === descriptive?.primaryDateField)
            || profiles.filter((profile) => profile.semanticRole === "date").sort((a, b) => b.nonNullCount - a.nonNullCount)[0];
        if (!dateProfile) return { dateField: null, granularity: null, trends: [], reason: "Nie wykryto kolumny daty." };
        const range = core.dateRange(rows.map((row) => row?.[dateProfile.id]));
        if (!range) return { dateField: dateProfile.id, granularity: null, trends: [], reason: "Brak poprawnych dat." };
        const granularity = options.granularity || core.chooseGranularity(range.minimum, range.maximum);
        const measureProfiles = profiles
            .filter((profile) => profile.analyticalRole === "measure" && profile.semanticRole !== "identifier" && profile.numeric?.count >= 3)
            .sort((a, b) => b.numeric.count - a.numeric.count)
            .slice(0, options.maximumMeasures || 8);

        const trends = measureProfiles.map((profile) => {
            const aggregation = aggregationForRole(profile.semanticRole);
            const series = aggregateSeries(rows, dateProfile.id, profile.id, granularity, aggregation);
            if (series.length < 2) return null;
            const regression = core.linearRegression(series.map((item, index) => ({ x: index, y: item.value })));
            const first = series[0].value;
            const last = series[series.length - 1].value;
            const change = last - first;
            const changePercent = first !== 0 ? change / Math.abs(first) : null;
            const recentSize = Math.min(3, Math.floor(series.length / 2));
            const previousRecent = recentSize ? core.mean(series.slice(-recentSize * 2, -recentSize).map((item) => item.value)) : null;
            const currentRecent = recentSize ? core.mean(series.slice(-recentSize).map((item) => item.value)) : null;
            const recentChangePercent = previousRecent !== null && previousRecent !== 0 ? (currentRecent - previousRecent) / Math.abs(previousRecent) : null;
            const average = core.mean(series.map((item) => item.value));
            const volatility = average ? core.standardDeviation(series.map((item) => item.value)) / Math.abs(average) : null;
            const normalizedSlope = average ? regression.slope / Math.abs(average) : null;
            const direction = normalizedSlope === null || Math.abs(normalizedSlope) < 0.01 ? "stable"
                : normalizedSlope > 0 ? "up" : "down";
            const confidence = core.round(core.clamp((regression.r2 || 0) * 0.55 + Math.min(0.35, series.length / 30) + (series.length >= 6 ? 0.1 : 0)), 3);
            return {
                fieldId: profile.id,
                label: profile.label,
                role: profile.semanticRole,
                dateField: dateProfile.id,
                granularity,
                aggregation,
                series,
                periods: series.length,
                first,
                last,
                change,
                changePercent,
                recentChangePercent,
                slope: regression.slope,
                normalizedSlope,
                r2: regression.r2,
                volatility,
                direction,
                confidence
            };
        }).filter(Boolean).sort((left, right) => right.confidence - left.confidence);

        return {
            dateField: dateProfile.id,
            dateLabel: dateProfile.label,
            dateRange: { minimum: core.toISODate(range.minimum), maximum: core.toISODate(range.maximum), days: range.days },
            granularity,
            trends
        };
    }

    Object.defineProperty(PMA, "trendEngine", {
        value: Object.freeze({ analyze, aggregateSeries, aggregationForRole }), enumerable: true, configurable: false, writable: false
    });
}(typeof window !== "undefined" ? window : self));
