/* ==========================================================
   Smart Analytics — schema and column profile detection.
========================================================== */
(function initializeSchemaProfiler(global) {
    "use strict";
    const PMA = global.PMA || (global.PMA = {});
    if (!PMA.analyticsCore) throw new Error("analytics-core.js must be loaded before schema-profiler.js.");

    const core = PMA.analyticsCore;

    function detectPhysicalType(values, field = {}) {
        const nonBlank = values.filter((value) => !core.isBlank(value));
        if (!nonBlank.length) return { type: "empty", confidence: 1, evidence: ["Kolumna nie zawiera wartości."] };
        let numberCount = 0;
        let dateCount = 0;
        let booleanCount = 0;
        let nativeNumberCount = 0;
        let nativeDateCount = 0;
        nonBlank.forEach((value) => {
            if (typeof value === "number" && Number.isFinite(value)) nativeNumberCount += 1;
            if (value instanceof Date && !Number.isNaN(value.getTime())) nativeDateCount += 1;
            if (core.parseNumber(value) !== null) numberCount += 1;
            if (core.parseDate(value)) dateCount += 1;
            if (core.parseBoolean(value) !== null) booleanCount += 1;
        });
        const ratios = {
            number: numberCount / nonBlank.length,
            date: dateCount / nonBlank.length,
            boolean: booleanCount / nonBlank.length
        };
        const declared = String(field.type || "").toLowerCase();
        if (declared === "date" && ratios.date >= 0.6) return { type: "date", confidence: ratios.date, evidence: [`${Math.round(ratios.date * 100)}% wartości rozpoznano jako daty.`] };
        if (declared === "number" && ratios.number >= 0.6) return { type: "number", confidence: ratios.number, evidence: [`${Math.round(ratios.number * 100)}% wartości rozpoznano jako liczby.`] };
        if ((nativeDateCount > 0 || ratios.date >= 0.9) && ratios.date >= ratios.number + 0.08) return { type: "date", confidence: ratios.date, evidence: [`${Math.round(ratios.date * 100)}% wartości rozpoznano jako daty.`] };
        if ((nativeNumberCount > 0 || ratios.number >= 0.9) && ratios.number >= ratios.date) return { type: "number", confidence: ratios.number, evidence: [`${Math.round(ratios.number * 100)}% wartości rozpoznano jako liczby.`] };
        if (ratios.boolean >= 0.9 && new Set(nonBlank.map((value) => String(value))).size <= 4) return { type: "boolean", confidence: ratios.boolean, evidence: [`${Math.round(ratios.boolean * 100)}% wartości rozpoznano jako logiczne.`] };
        if (ratios.date >= 0.8) return { type: "date", confidence: ratios.date, evidence: [`${Math.round(ratios.date * 100)}% wartości rozpoznano jako daty.`] };
        if (ratios.number >= 0.8) return { type: "number", confidence: ratios.number, evidence: [`${Math.round(ratios.number * 100)}% wartości rozpoznano jako liczby.`] };
        const strongest = Math.max(ratios.number, ratios.date, ratios.boolean);
        if (strongest >= 0.2) return { type: "mixed", confidence: 1 - strongest, evidence: ["Kolumna zawiera mieszane typy wartości."] };
        return { type: "text", confidence: 0.95, evidence: ["Wartości mają charakter tekstowy."] };
    }

    function numericStatistics(values) {
        const numeric = values.map(core.parseNumber).filter(Number.isFinite);
        if (!numeric.length) return null;
        const q1 = core.quantile(numeric, 0.25);
        const q3 = core.quantile(numeric, 0.75);
        let minimum = Infinity;
        let maximum = -Infinity;
        numeric.forEach((value) => {
            if (value < minimum) minimum = value;
            if (value > maximum) maximum = value;
        });
        return {
            count: numeric.length,
            minimum,
            maximum,
            sum: core.sum(numeric),
            mean: core.mean(numeric),
            median: core.median(numeric),
            standardDeviation: core.standardDeviation(numeric),
            q1,
            q3,
            iqr: q3 - q1,
            mad: core.mad(numeric),
            zeroCount: numeric.filter((value) => value === 0).length,
            negativeCount: numeric.filter((value) => value < 0).length,
            histogram: core.histogram(numeric, Math.ceil(Math.sqrt(numeric.length)))
        };
    }

    function dateStatistics(values) {
        const dates = values.map(core.parseDate).filter(Boolean).sort((a, b) => a - b);
        if (!dates.length) return null;
        const uniqueDays = new Set(dates.map(core.toISODate));
        return {
            count: dates.length,
            minimum: core.toISODate(dates[0]),
            maximum: core.toISODate(dates[dates.length - 1]),
            uniqueDays: uniqueDays.size,
            rangeDays: Math.max(1, Math.round((dates[dates.length - 1] - dates[0]) / core.DAY_MS) + 1)
        };
    }

    function textStatistics(values) {
        const text = values.filter((value) => !core.isBlank(value)).map((value) => String(value));
        if (!text.length) return null;
        const lengths = text.map((value) => value.length);
        let minimumLength = Infinity;
        let maximumLength = -Infinity;
        lengths.forEach((length) => {
            if (length < minimumLength) minimumLength = length;
            if (length > maximumLength) maximumLength = length;
        });
        return {
            count: text.length,
            minimumLength,
            maximumLength,
            averageLength: core.mean(lengths),
            topValues: core.frequency(text, 10),
            whitespaceIssueCount: text.filter((value) => value !== value.trim() || /\s{2,}/.test(value)).length
        };
    }

    function profile(rows, fields = [], options = {}) {
        const sourceRows = Array.isArray(rows) ? rows : [];
        const fieldList = core.inferFieldList(sourceRows, fields);
        const sample = core.sampleRows(sourceRows, options.sampleSize || 20000);
        const profiles = fieldList.map((field) => {
            const sampleValues = sample.map((row) => row?.[field.id]);
            const sampledStatistics = options.fullStatistics === false;
            const allValues = sampledStatistics ? sampleValues : sourceRows.map((row) => row?.[field.id]);
            const nonBlankValues = allValues.filter((value) => !core.isBlank(value));
            const typeDetection = detectPhysicalType(sampleValues, field);
            const unique = core.uniqueCount(allValues);
            const observedMissing = allValues.length - nonBlankValues.length;
            const missingRatio = allValues.length ? observedMissing / allValues.length : 0;
            const missing = sampledStatistics ? Math.round(missingRatio * sourceRows.length) : observedMissing;
            const estimatedNonNull = Math.max(0, sourceRows.length - missing);
            const uniqueRatio = nonBlankValues.length ? unique / nonBlankValues.length : 0;
            const profileResult = {
                id: field.id,
                label: field.label || field.id,
                source: field.source || "unknown",
                declaredType: field.type || null,
                physicalType: typeDetection.type,
                typeConfidence: core.round(typeDetection.confidence, 3),
                typeEvidence: typeDetection.evidence,
                rowCount: sourceRows.length,
                sampledRows: sample.length,
                statisticsMode: sampledStatistics ? "sample" : "full",
                analyzedRows: allValues.length,
                observedNonNullCount: nonBlankValues.length,
                nonNullCount: sampledStatistics ? estimatedNonNull : nonBlankValues.length,
                missingCount: missing,
                missingRatio,
                uniqueCount: unique,
                uniqueRatio,
                isConstant: unique <= 1 && nonBlankValues.length > 0,
                isAlmostConstant: unique > 1 && core.frequency(nonBlankValues, 1)[0]?.count / nonBlankValues.length >= 0.98,
                examples: [...new Set(nonBlankValues.slice(0, 100).map((value) => String(value)))].slice(0, 5),
                numeric: null,
                date: null,
                text: null
            };
            if (["number", "mixed"].includes(typeDetection.type)) profileResult.numeric = numericStatistics(allValues);
            if (["date", "mixed"].includes(typeDetection.type)) profileResult.date = dateStatistics(allValues);
            if (!["number", "date", "empty"].includes(typeDetection.type)) profileResult.text = textStatistics(allValues);
            return profileResult;
        });

        return {
            rowCount: sourceRows.length,
            columnCount: profiles.length,
            sampledRows: sample.length,
            profiles,
            generatedAt: new Date().toISOString()
        };
    }

    Object.defineProperty(PMA, "schemaProfiler", {
        value: Object.freeze({ profile, detectPhysicalType, numericStatistics, dateStatistics, textStatistics }),
        enumerable: true,
        configurable: false,
        writable: false
    });
}(typeof window !== "undefined" ? window : self));
