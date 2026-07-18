/* ==========================================================
   Smart Analytics — descriptive statistics and distributions.
========================================================== */
(function initializeDescriptiveStatistics(global) {
    "use strict";
    const PMA = global.PMA || (global.PMA = {});
    if (!PMA.analyticsCore) throw new Error("analytics-core.js must be loaded before descriptive-statistics.js.");
    const core = PMA.analyticsCore;

    function summarize(rows, semanticProfile, options = {}) {
        const profiles = semanticProfile?.profiles || [];
        const numeric = [];
        const categorical = [];
        const dates = [];

        profiles.forEach((profile) => {
            if (profile.analyticalRole === "measure" && profile.numeric) {
                numeric.push({
                    fieldId: profile.id,
                    label: profile.label,
                    role: profile.semanticRole,
                    ...profile.numeric,
                    missingCount: profile.missingCount,
                    missingRatio: profile.missingRatio
                });
            }
            if (profile.analyticalRole === "dimension") {
                const values = rows.map((row) => row?.[profile.id]);
                categorical.push({
                    fieldId: profile.id,
                    label: profile.label,
                    role: profile.semanticRole,
                    uniqueCount: profile.uniqueCount,
                    missingCount: profile.missingCount,
                    topValues: core.frequency(values, options.topValues || 15)
                });
            }
            if (profile.semanticRole === "date" && profile.date) {
                dates.push({ fieldId: profile.id, label: profile.label, ...profile.date });
            }
        });

        return {
            numeric,
            categorical,
            dates,
            primaryDateField: dates.slice().sort((a, b) => b.count - a.count)[0]?.fieldId || null,
            primaryMeasureField: numeric.slice().sort((a, b) => {
                const priority = { quantity: 8, currency: 7, cost: 6, measure: 5, stock: 4, price: 3, duration: 2, percentage: 1 };
                return (priority[b.role] || 0) - (priority[a.role] || 0) || b.count - a.count;
            })[0]?.fieldId || null,
            primaryDimensionField: categorical
                .filter((item) => item.uniqueCount >= 2 && item.uniqueCount <= 200)
                .sort((a, b) => {
                    const priority = { material: 5, category: 4, brand: 3, supplier: 2, location: 1 };
                    return (priority[b.role] || 0) - (priority[a.role] || 0) || b.topValues.reduce((s, v) => s + v.count, 0) - a.topValues.reduce((s, v) => s + v.count, 0);
                })[0]?.fieldId || null
        };
    }

    Object.defineProperty(PMA, "descriptiveStatistics", {
        value: Object.freeze({ summarize }), enumerable: true, configurable: false, writable: false
    });
}(typeof window !== "undefined" ? window : self));
