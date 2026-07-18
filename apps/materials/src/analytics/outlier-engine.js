/* ==========================================================
   Smart Analytics — global and group-aware anomaly detection.
========================================================== */
(function initializeOutlierEngine(global) {
    "use strict";
    const PMA = global.PMA || (global.PMA = {});
    if (!PMA.analyticsCore) throw new Error("analytics-core.js must be loaded before outlier-engine.js.");
    const core = PMA.analyticsCore;

    function robustBounds(values, multiplier = 1.5) {
        const numeric = values.filter(Number.isFinite);
        if (numeric.length < 4) return null;
        const q1 = core.quantile(numeric, 0.25);
        const q3 = core.quantile(numeric, 0.75);
        const iqr = q3 - q1;
        const center = core.median(numeric);
        const dispersion = core.mad(numeric);
        return {
            q1,
            q3,
            iqr,
            lower: q1 - multiplier * iqr,
            upper: q3 + multiplier * iqr,
            median: center,
            mad: dispersion
        };
    }

    function detect(rows, semanticProfile, descriptive, options = {}) {
        const maximumFindings = options.maximumFindings || 300;
        const profiles = semanticProfile?.profiles || [];
        const numericProfiles = profiles.filter((profile) => profile.analyticalRole === "measure" && profile.semanticRole !== "identifier" && profile.numeric?.count >= 8);
        const dimensionCandidates = profiles
            .filter((profile) => profile.analyticalRole === "dimension" && profile.uniqueCount >= 2 && profile.uniqueCount <= 100)
            .sort((left, right) => {
                const priority = { material: 5, category: 4, brand: 3, supplier: 2, location: 1 };
                return (priority[right.semanticRole] || 0) - (priority[left.semanticRole] || 0);
            });
        const groupField = descriptive?.primaryDimensionField || dimensionCandidates[0]?.id || null;
        const findings = [];

        numericProfiles.forEach((profile) => {
            const points = rows.map((row, rowIndex) => ({ row, rowIndex, value: core.parseNumber(row?.[profile.id]) })).filter((item) => Number.isFinite(item.value));
            const bounds = robustBounds(points.map((item) => item.value));
            if (!bounds) return;
            const globalFindings = new Map();
            points.forEach((item) => {
                const iqrOutlier = bounds.iqr > 0 && (item.value < bounds.lower || item.value > bounds.upper);
                const robustZ = bounds.mad > 0 ? 0.6745 * (item.value - bounds.median) / bounds.mad : 0;
                if (!iqrOutlier && Math.abs(robustZ) < 3.5) return;
                const distance = bounds.iqr > 0
                    ? item.value > bounds.upper ? (item.value - bounds.upper) / bounds.iqr : (bounds.lower - item.value) / bounds.iqr
                    : Math.abs(robustZ);
                globalFindings.set(item.rowIndex, {
                    rowId: item.row?.id || item.rowIndex + 1,
                    rowIndex: item.rowIndex,
                    fieldId: profile.id,
                    label: profile.label,
                    value: item.value,
                    method: iqrOutlier && Math.abs(robustZ) >= 3.5 ? "IQR + robust Z-score" : iqrOutlier ? "IQR" : "robust Z-score",
                    robustZ,
                    expectedRange: [bounds.lower, bounds.upper],
                    distance,
                    groupField: null,
                    groupValue: null,
                    local: false
                });
            });

            if (groupField) {
                const groups = core.groupBy(points, (item) => core.isBlank(item.row?.[groupField]) ? null : String(item.row[groupField]));
                groups.forEach((group, groupValue) => {
                    if (group.length < 8) return;
                    const localBounds = robustBounds(group.map((item) => item.value));
                    if (!localBounds) return;
                    group.forEach((item) => {
                        const iqrOutlier = localBounds.iqr > 0 && (item.value < localBounds.lower || item.value > localBounds.upper);
                        const robustZ = localBounds.mad > 0 ? 0.6745 * (item.value - localBounds.median) / localBounds.mad : 0;
                        if (!iqrOutlier && Math.abs(robustZ) < 3.5) return;
                        const existing = globalFindings.get(item.rowIndex);
                        const localDistance = localBounds.iqr > 0
                            ? item.value > localBounds.upper ? (item.value - localBounds.upper) / localBounds.iqr : (localBounds.lower - item.value) / localBounds.iqr
                            : Math.abs(robustZ);
                        globalFindings.set(item.rowIndex, {
                            ...(existing || {
                                rowId: item.row?.id || item.rowIndex + 1,
                                rowIndex: item.rowIndex,
                                fieldId: profile.id,
                                label: profile.label,
                                value: item.value,
                                method: "lokalny IQR / robust Z-score",
                                robustZ,
                                distance: localDistance
                            }),
                            local: true,
                            localMethod: "IQR / robust Z-score w grupie",
                            groupField,
                            groupValue,
                            localExpectedRange: [localBounds.lower, localBounds.upper],
                            localRobustZ: robustZ,
                            distance: Math.max(existing?.distance || 0, localDistance)
                        });
                    });
                });
            }

            [...globalFindings.values()].forEach((finding) => {
                const magnitude = Math.max(Math.abs(finding.robustZ || 0), Math.abs(finding.localRobustZ || 0), finding.distance || 0);
                findings.push({
                    ...finding,
                    severity: magnitude >= 8 ? "high" : magnitude >= 4.5 ? "medium" : "low",
                    confidence: core.round(core.clamp(0.68 + Math.min(0.3, magnitude / 20) + (finding.local ? 0.04 : 0)), 3)
                });
            });
        });

        findings.sort((left, right) => (({ high: 0, medium: 1, low: 2 })[left.severity] - ({ high: 0, medium: 1, low: 2 })[right.severity]) || right.distance - left.distance);
        return {
            groupField,
            total: findings.length,
            high: findings.filter((item) => item.severity === "high").length,
            medium: findings.filter((item) => item.severity === "medium").length,
            low: findings.filter((item) => item.severity === "low").length,
            findings: findings.slice(0, maximumFindings),
            truncated: findings.length > maximumFindings
        };
    }

    Object.defineProperty(PMA, "outlierEngine", {
        value: Object.freeze({ detect, robustBounds }), enumerable: true, configurable: false, writable: false
    });
}(typeof window !== "undefined" ? window : self));
