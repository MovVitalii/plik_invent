/* ==========================================================
   Smart Analytics — deterministic data-quality audit.
========================================================== */
(function initializeDataQualityEngine(global) {
    "use strict";
    const PMA = global.PMA || (global.PMA = {});
    if (!PMA.analyticsCore) throw new Error("analytics-core.js must be loaded before data-quality-engine.js.");
    const core = PMA.analyticsCore;

    function issue(id, severity, title, statement, details = {}) {
        return { id, severity, title, statement, ...details };
    }

    function audit(rows, semanticProfile, options = {}) {
        const sourceRows = Array.isArray(rows) ? rows : [];
        const profiles = semanticProfile?.profiles || [];
        const fields = profiles.map((profile) => profile.id);
        const issues = [];
        const missingValues = [];
        const typeErrors = [];
        const qualityRules = PMA.analyticsRules?.quality || {};
        const maximumExamples = options.maximumExamples || qualityRules.maximumExamples || 50;

        profiles.forEach((profile) => {
            if (profile.missingCount > 0) {
                missingValues.push({ fieldId: profile.id, label: profile.label, count: profile.missingCount, ratio: profile.missingRatio });
                const severity = profile.missingRatio >= (qualityRules.missingHigh ?? 0.5) ? "high"
                    : profile.missingRatio >= (qualityRules.missingMedium ?? 0.1) ? "medium" : "low";
                issues.push(issue(
                    `missing-${profile.id}`,
                    severity,
                    `Braki w kolumnie „${profile.label}”`,
                    `${profile.missingCount} z ${profile.rowCount} wartości jest pustych (${Math.round(profile.missingRatio * 1000) / 10}%).`,
                    { type: "missing_values", fieldId: profile.id, count: profile.missingCount, ratio: profile.missingRatio }
                ));
            }
            if (profile.physicalType === "mixed") {
                issues.push(issue(
                    `mixed-${profile.id}`,
                    "medium",
                    `Mieszane typy w kolumnie „${profile.label}”`,
                    "Kolumna zawiera wartości o różnych typach i może wymagać konwersji lub rozdzielenia.",
                    { type: "mixed_type", fieldId: profile.id }
                ));
            }
            if (profile.isConstant) {
                issues.push(issue(
                    `constant-${profile.id}`,
                    "low",
                    `Stała kolumna „${profile.label}”`,
                    "Kolumna zawiera tylko jedną niepustą wartość i nie wnosi zmienności do analizy.",
                    { type: "constant_column", fieldId: profile.id }
                ));
            } else if (profile.isAlmostConstant) {
                issues.push(issue(
                    `almost-constant-${profile.id}`,
                    "low",
                    `Prawie stała kolumna „${profile.label}”`,
                    "Jedna wartość stanowi co najmniej 98% niepustych rekordów.",
                    { type: "almost_constant_column", fieldId: profile.id }
                ));
            }

            const expected = profile.physicalType;
            if (["number", "date", "boolean"].includes(expected)) {
                const invalid = [];
                let invalidCount = 0;
                sourceRows.forEach((row, rowIndex) => {
                    const value = row?.[profile.id];
                    if (core.isBlank(value)) return;
                    const valid = expected === "number" ? core.parseNumber(value) !== null
                        : expected === "date" ? Boolean(core.parseDate(value))
                            : core.parseBoolean(value) !== null;
                    if (!valid) {
                        invalidCount += 1;
                        if (invalid.length < maximumExamples) invalid.push({ rowId: row?.id || rowIndex + 1, value });
                    }
                });
                if (invalidCount) {
                    typeErrors.push({ fieldId: profile.id, label: profile.label, count: invalidCount, examples: invalid });
                    issues.push(issue(
                        `type-${profile.id}`,
                        "high",
                        `Błędy typu w kolumnie „${profile.label}”`,
                        `Znaleziono ${invalidCount} wartości niezgodnych z typem ${expected}.`,
                        { type: "type_errors", fieldId: profile.id, count: invalidCount, examples: invalid }
                    ));
                }
            }

            if (["quantity", "stock", "price", "cost", "currency", "percentage", "duration"].includes(profile.semanticRole) && profile.numeric?.negativeCount > 0) {
                issues.push(issue(
                    `negative-${profile.id}`,
                    ["stock", "price", "cost", "duration"].includes(profile.semanticRole) ? "high" : "medium",
                    `Wartości ujemne w kolumnie „${profile.label}”`,
                    `Znaleziono ${profile.numeric.negativeCount} wartości ujemnych. Należy potwierdzić, czy oznaczają korekty, zwroty lub błędy.`,
                    { type: "negative_values", fieldId: profile.id, count: profile.numeric.negativeCount }
                ));
            }
        });

        const duplicateMap = new Map();
        sourceRows.forEach((row, rowIndex) => {
            const signature = core.stableStringify(Object.fromEntries(fields.map((fieldId) => [fieldId, row?.[fieldId] ?? null])));
            if (!duplicateMap.has(signature)) duplicateMap.set(signature, []);
            duplicateMap.get(signature).push(row?.id || rowIndex + 1);
        });
        const duplicateGroups = [...duplicateMap.values()].filter((group) => group.length > 1);
        const duplicateRows = duplicateGroups.reduce((total, group) => total + group.length - 1, 0);
        if (duplicateRows) {
            issues.push(issue(
                "duplicate-rows",
                duplicateRows / Math.max(1, sourceRows.length) >= (qualityRules.duplicateHigh ?? 0.05) ? "high" : "medium",
                "Pełne duplikaty rekordów",
                `Znaleziono ${duplicateRows} nadmiarowych rekordów w ${duplicateGroups.length} grupach identycznych wierszy.`,
                { type: "duplicate_rows", count: duplicateRows, groups: duplicateGroups.length, examples: duplicateGroups.slice(0, maximumExamples) }
            ));
        }

        const identifierFields = profiles.filter((profile) => profile.semanticRole === "identifier" && profile.uniqueRatio < 1 && profile.nonNullCount > 0);
        const businessKeyDuplicates = identifierFields.map((profile) => {
            const counts = core.frequency(sourceRows.map((row) => row?.[profile.id]), Infinity).filter((entry) => entry.count > 1);
            return { fieldId: profile.id, label: profile.label, duplicateValues: counts.slice(0, maximumExamples), duplicateValueCount: counts.length };
        }).filter((item) => item.duplicateValueCount > 0);
        businessKeyDuplicates.forEach((item) => issues.push(issue(
            `business-key-${item.fieldId}`,
            "high",
            `Powtórzone identyfikatory w „${item.label}”`,
            `${item.duplicateValueCount} wartości identyfikatora występuje więcej niż raz.`,
            { type: "business_key_duplicates", ...item }
        )));

        const totalCells = Math.max(1, sourceRows.length * Math.max(1, profiles.length));
        const missingCells = missingValues.reduce((total, item) => total + item.count, 0);
        const highIssues = issues.filter((item) => item.severity === "high").length;
        const mediumIssues = issues.filter((item) => item.severity === "medium").length;
        const penalties = Math.min(45, missingCells / totalCells * 55)
            + Math.min(25, duplicateRows / Math.max(1, sourceRows.length) * 80)
            + Math.min(25, highIssues * 4)
            + Math.min(15, mediumIssues * 1.5);
        const score = Math.max(0, Math.round(100 - penalties));

        return {
            score,
            grade: score >= 90 ? "A" : score >= 80 ? "B" : score >= 65 ? "C" : score >= 50 ? "D" : "E",
            rowCount: sourceRows.length,
            columnCount: profiles.length,
            missingValues,
            duplicateRows: { count: duplicateRows, groups: duplicateGroups.length, examples: duplicateGroups.slice(0, maximumExamples) },
            businessKeyDuplicates,
            typeErrors,
            issues: issues.sort((left, right) => ({ high: 0, medium: 1, low: 2 })[left.severity] - ({ high: 0, medium: 1, low: 2 })[right.severity]),
            summary: {
                high: highIssues,
                medium: mediumIssues,
                low: issues.filter((item) => item.severity === "low").length,
                missingCells,
                duplicateRows
            }
        };
    }

    Object.defineProperty(PMA, "dataQualityEngine", {
        value: Object.freeze({ audit }), enumerable: true, configurable: false, writable: false
    });
}(typeof window !== "undefined" ? window : self));
