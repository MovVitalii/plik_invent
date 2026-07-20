/* ==========================================================
   Smart Analytics — automatic pivot recommendations.
========================================================== */
(function initializePivotRecommender(global) {
    "use strict";
    const PMA = global.PMA || (global.PMA = {});
    if (!PMA.analyticsCore) throw new Error("analytics-core.js must be loaded before pivot-recommender.js.");
    const core = PMA.analyticsCore;

    function createAccumulator() {
        return { count: 0, numericCount: 0, sum: 0, minimum: Infinity, maximum: -Infinity, latestTimestamp: -Infinity, latestSequence: -Infinity, latestValue: null };
    }

    function addToAccumulator(accumulator, value, orderValue = null, sequence = 0, dateConvention = "dmy") {
        if (!core.isBlank(value)) accumulator.count += 1;
        const numeric = core.parseNumber(value);
        if (!Number.isFinite(numeric)) return accumulator;
        accumulator.numericCount += 1;
        accumulator.sum += numeric;
        if (numeric < accumulator.minimum) accumulator.minimum = numeric;
        if (numeric > accumulator.maximum) accumulator.maximum = numeric;
        const orderDate = core.parseDate(orderValue, { convention: dateConvention });
        const timestamp = orderDate ? orderDate.getTime() : -Infinity;
        if (timestamp > accumulator.latestTimestamp || (timestamp === accumulator.latestTimestamp && sequence >= accumulator.latestSequence)) {
            accumulator.latestTimestamp = timestamp;
            accumulator.latestSequence = sequence;
            accumulator.latestValue = numeric;
        }
        return accumulator;
    }

    function finishAccumulator(accumulator, aggregation) {
        if (aggregation === "count") return accumulator.count;
        if (!accumulator.numericCount) return null;
        if (aggregation === "latest") return accumulator.latestValue;
        if (aggregation === "average" || aggregation === "avg") return accumulator.sum / accumulator.numericCount;
        if (aggregation === "min") return accumulator.minimum;
        if (aggregation === "max") return accumulator.maximum;
        return accumulator.sum;
    }

    function aggregate(values, aggregation) {
        const accumulator = createAccumulator();
        values.forEach((value, index) => addToAccumulator(accumulator, value, null, index, "dmy"));
        return finishAccumulator(accumulator, aggregation);
    }

    function executePivot(rows, configuration, maximumRows = 100) {
        const rowField = configuration.rows?.[0] || null;
        const columnField = configuration.columns?.[0] || null;
        const valueConfig = configuration.values?.[0] || {};
        const valueField = valueConfig.field;
        const aggregation = valueConfig.aggregation || "sum";
        const orderByField = valueConfig.orderByField || null;
        const groups = new Map();
        const totals = new Map();
        const columnKeys = new Set();

        rows.forEach((row, rowIndex) => {
            const rowKey = rowField ? (core.isBlank(row?.[rowField]) ? "(brak)" : String(row[rowField])) : "Wszystkie";
            const rawColumnValue = columnField ? row?.[columnField] : null;
            const columnKey = columnField
                ? configuration.timeGranularity
                    ? (core.periodKey(rawColumnValue, configuration.timeGranularity, { convention: configuration.dateConvention || "dmy" }) || "(brak)")
                    : (core.isBlank(rawColumnValue) ? "(brak)" : String(rawColumnValue))
                : "Wartość";
            const value = valueField ? row?.[valueField] : 1;
            const orderValue = orderByField ? row?.[orderByField] : null;
            columnKeys.add(columnKey);
            if (!groups.has(rowKey)) groups.set(rowKey, new Map());
            const bucket = groups.get(rowKey);
            if (!bucket.has(columnKey)) bucket.set(columnKey, createAccumulator());
            addToAccumulator(bucket.get(columnKey), value, orderValue, rowIndex, configuration.dateConvention || "dmy");
            if (!totals.has(rowKey)) totals.set(rowKey, createAccumulator());
            addToAccumulator(totals.get(rowKey), value, orderValue, rowIndex, configuration.dateConvention || "dmy");
        });

        const columns = [...columnKeys].sort((left, right) => left.localeCompare(right, "pl"));
        const outputRows = [...groups.entries()].map(([rowKey, bucket]) => {
            const values = Object.fromEntries(columns.map((column) => [column, bucket.has(column) ? finishAccumulator(bucket.get(column), aggregation) : null]));
            return { key: rowKey, values, total: finishAccumulator(totals.get(rowKey), aggregation) };
        }).sort((left, right) => Math.abs(right.total || 0) - Math.abs(left.total || 0)).slice(0, maximumRows);

        return { columns, rows: outputRows, sourceRows: rows.length, aggregation, generatedBy: "javascript" };
    }

    function aggregationForRole(role) {
        return PMA.analyticsRules?.aggregationByRole?.[role] || "sum";
    }

    function valueConfiguration(profile, dateField) {
        const configured = aggregationForRole(profile.semanticRole);
        const aggregation = configured === "latest" && !dateField ? "average" : configured;
        return {
            field: profile.id,
            aggregation,
            ...(aggregation === "latest" ? { orderByField: dateField } : {})
        };
    }

    function recommend(semanticProfile, descriptive, trendResult, options = {}) {
        const profiles = semanticProfile?.profiles || [];
        const dimensions = profiles.filter((profile) => profile.analyticalRole === "dimension" && profile.uniqueCount >= 2 && profile.uniqueCount <= 500);
        const measures = profiles.filter((profile) => profile.analyticalRole === "measure" && profile.semanticRole !== "identifier" && profile.numeric?.count > 0);
        const dateField = trendResult?.dateField || descriptive?.primaryDateField;
        const dateProfile = profiles.find((profile) => profile.id === dateField);
        const dateConvention = dateProfile?.dateConvention || trendResult?.dateConvention || "dmy";
        const primaryMeasure = measures.find((profile) => profile.id === descriptive?.primaryMeasureField) || measures[0];
        const preferredDimensions = dimensions.slice().sort((left, right) => {
            const priority = { material: 7, category: 6, brand: 5, supplier: 4, location: 3, status: 2, boolean: 1 };
            return (priority[right.semanticRole] || 0) - (priority[left.semanticRole] || 0) || left.uniqueCount - right.uniqueCount;
        });
        const recommendations = [];

        if (primaryMeasure && preferredDimensions[0]) {
            recommendations.push({
                id: "pivot-primary-dimension",
                title: `${primaryMeasure.label} według ${preferredDimensions[0].label}`,
                rows: [preferredDimensions[0].id],
                columns: [],
                values: [valueConfiguration(primaryMeasure, dateField)],
                dateConvention,
                reason: `Wykryto główną miarę (${primaryMeasure.semanticRole}) i najważniejszy wymiar biznesowy.`,
                confidence: 0.94
            });
        }
        if (primaryMeasure && preferredDimensions[0] && dateField) {
            recommendations.push({
                id: "pivot-time-dimension",
                title: `${primaryMeasure.label} według ${preferredDimensions[0].label} i okresu`,
                rows: [preferredDimensions[0].id],
                columns: [dateField],
                values: [valueConfiguration(primaryMeasure, dateField)],
                timeGranularity: trendResult?.granularity || "month",
                dateConvention,
                reason: "Połączenie wymiaru czasu, kategorii i miary umożliwia analizę zmian.",
                confidence: 0.91
            });
        }
        preferredDimensions.slice(1, 4).forEach((dimension, index) => {
            if (!primaryMeasure) return;
            recommendations.push({
                id: `pivot-dimension-${index + 2}`,
                title: `${primaryMeasure.label} według ${dimension.label}`,
                rows: [dimension.id],
                columns: [],
                values: [valueConfiguration(primaryMeasure, dateField)],
                dateConvention,
                reason: "Wymiar ma użyteczną liczebność i nadaje się do porównania grup.",
                confidence: core.round(0.84 - index * 0.05, 2)
            });
        });
        if (measures[1] && preferredDimensions[0]) {
            recommendations.push({
                id: "pivot-secondary-measure",
                title: `${measures[1].label} według ${preferredDimensions[0].label}`,
                rows: [preferredDimensions[0].id],
                columns: [],
                values: [valueConfiguration(measures[1], dateField)],
                dateConvention,
                reason: "Druga istotna miara może ujawnić odmienny ranking kategorii.",
                confidence: 0.78
            });
        }
        return recommendations.slice(0, options.maximumRecommendations || 6);
    }

    function materialize(rows, recommendations, maximumRows = 100) {
        return (recommendations || []).map((recommendation) => ({ ...recommendation, result: executePivot(rows, recommendation, maximumRows) }));
    }

    Object.defineProperty(PMA, "pivotRecommender", {
        value: Object.freeze({ recommend, executePivot, materialize, aggregate, aggregationForRole, valueConfiguration }), enumerable: true, configurable: false, writable: false
    });
}(typeof window !== "undefined" ? window : self));
