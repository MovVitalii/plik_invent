/* ==========================================================
   Smart Analytics — deterministic domain-specific analysis.
========================================================== */
(function initializeDomainAnalysisEngine(global) {
    "use strict";
    const PMA = global.PMA || (global.PMA = {});
    if (!PMA.analyticsCore) throw new Error("analytics-core.js must be loaded before domain-analysis-engine.js.");
    const core = PMA.analyticsCore;

    function profileByRole(schema, ...roles) {
        return (schema?.profiles || []).find((profile) => roles.includes(profile.businessRole)) || null;
    }
    function numeric(value) { return core.parseNumber(value); }
    function sumField(rows, profile) {
        if (!profile) return { total: null, valid: 0, invalid: 0 };
        let total = 0, valid = 0, invalid = 0;
        rows.forEach((row) => {
            const value = row?.[profile.id];
            if (core.isBlank(value)) return;
            const number = numeric(value);
            if (number === null) invalid += 1; else { total += number; valid += 1; }
        });
        return { total, valid, invalid };
    }
    function uniqueField(rows, profile) {
        return profile ? new Set(rows.map((row) => core.cleanText(row?.[profile.id])).filter(Boolean)).size : 0;
    }
    function topGroups(rows, dimension, measure, maximum = 8) {
        if (!dimension || !measure) return [];
        const groups = new Map();
        rows.forEach((row) => {
            const key = core.cleanText(row?.[dimension.id]) || "(brak)";
            const value = numeric(row?.[measure.id]);
            if (value === null) return;
            groups.set(key, (groups.get(key) || 0) + value);
        });
        return [...groups.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, maximum);
    }

    function prepare(rows = [], fields = [], rawDomain = {}) {
        if (rawDomain.domain !== "hierarchical_delivery_plan") return { rows, metadata: { sourceRows: rows.length, analyzedRows: rows.length, excludedSubtotalRows: 0, filledDownValues: 0 } };
        const materialField = rawDomain.missingMaterialField || PMA.domainClassifier?.findField(fields, [/article/, /artykul/, /material/, /product name/])?.id;
        let currentMaterial = "";
        let excludedSubtotalRows = 0;
        let filledDownValues = 0;
        const prepared = [];
        rows.forEach((sourceRow) => {
            const row = { ...sourceRow };
            if (materialField) {
                const material = core.cleanText(row[materialField]);
                if (material) currentMaterial = material;
            }
            const values = Object.values(row).map(core.cleanText);
            const subtotal = values.some((value) => /^(suma|razem|total)$/i.test(value));
            if (subtotal) { excludedSubtotalRows += 1; return; }
            if (materialField && core.isBlank(row[materialField]) && currentMaterial) {
                row[materialField] = currentMaterial;
                filledDownValues += 1;
            }
            prepared.push(row);
        });
        return { rows: prepared, metadata: { sourceRows: rows.length, analyzedRows: prepared.length, excludedSubtotalRows, filledDownValues, transformation: "fill_down_material_and_exclude_subtotals" } };
    }

    function deliveryAnalysis(rows, schema) {
        const ordered = profileByRole(schema, "ordered_quantity");
        const delivered = profileByRole(schema, "delivered_quantity");
        const remaining = profileByRole(schema, "remaining_quantity");
        const orderedPallets = profileByRole(schema, "pallet_count");
        const deliveredPallets = profileByRole(schema, "delivered_pallet_count");
        const remainingPallets = profileByRole(schema, "remaining_pallet_count");
        const order = profileByRole(schema, "order_id");
        const documentField = profileByRole(schema, "document_id");
        const supplier = profileByRole(schema, "supplier");
        const brand = profileByRole(schema, "brand");
        const material = profileByRole(schema, "material_name");
        const orderedTotal = sumField(rows, ordered);
        const deliveredTotal = sumField(rows, delivered);
        const remainingTotal = sumField(rows, remaining);
        const palletOrderedTotal = sumField(rows, orderedPallets);
        const palletDeliveredTotal = sumField(rows, deliveredPallets);
        const palletRemainingTotal = sumField(rows, remainingPallets);
        const consistency = [];
        const overDeliveries = [];
        const incomplete = [];
        let missingDocuments = 0;
        rows.forEach((row, index) => {
            const o = ordered ? numeric(row?.[ordered.id]) : null;
            const d = delivered ? numeric(row?.[delivered.id]) : null;
            const r = remaining ? numeric(row?.[remaining.id]) : null;
            if (o !== null && d !== null && r !== null) {
                const delta = o - d - r;
                if (Math.abs(delta) > Math.max(1, Math.abs(o) * 0.001)) consistency.push({ rowId: row?.id || index + 1, ordered: o, delivered: d, remaining: r, delta });
            }
            if (o !== null && d !== null && d > o) overDeliveries.push({ rowId: row?.id || index + 1, ordered: o, delivered: d, excess: d - o });
            if ((r !== null && r > 0) || (o !== null && d !== null && d < o)) incomplete.push({ rowId: row?.id || index + 1, order: order ? row?.[order.id] : "", remaining: r, ordered: o, delivered: d });
            if (documentField && d !== null && d > 0 && core.isBlank(row?.[documentField.id])) missingDocuments += 1;
        });
        const completionRate = orderedTotal.total > 0 && deliveredTotal.total !== null ? deliveredTotal.total / orderedTotal.total : null;
        const kpis = [
            { id: "ordered", label: "Zamówiona ilość", value: orderedTotal.total },
            { id: "delivered", label: "Dostarczona ilość", value: deliveredTotal.total },
            { id: "remaining", label: "Pozostała ilość", value: remainingTotal.total },
            { id: "completion", label: "Realizacja", value: completionRate, format: "percent" },
            { id: "orders", label: "Zamówienia", value: uniqueField(rows, order), format: "integer" },
            { id: "incomplete", label: "Niepełne pozycje", value: incomplete.length, format: "integer" }
        ].filter((item) => item.value !== null && item.value !== undefined);
        const warnings = [];
        const invalidNumeric = orderedTotal.invalid + deliveredTotal.invalid + remainingTotal.invalid + palletOrderedTotal.invalid + palletDeliveredTotal.invalid + palletRemainingTotal.invalid;
        if (invalidNumeric) warnings.push(`${invalidNumeric} wartości ilościowych ma format opisowy i nie zostało dodanych do sum.`);
        if (consistency.length) warnings.push(`${consistency.length} wierszy nie spełnia równania: zamówiono = dostarczono + pozostało.`);
        if (overDeliveries.length) warnings.push(`${overDeliveries.length} wierszy wskazuje dostawę większą od zamówienia.`);
        if (missingDocuments) warnings.push(`${missingDocuments} zrealizowanych pozycji nie ma numeru dokumentu WZ.`);
        const insights = [];
        if (completionRate !== null) insights.push({ id: "domain-delivery-completion", type: "delivery", severity: completionRate < 0.8 ? "high" : completionRate < 0.98 ? "medium" : "low", title: "Stopień realizacji dostaw", statement: `Dostarczono ${core.round(completionRate * 100, 1)}% zamówionej ilości.`, confidence: 0.96, evidence: { ordered: orderedTotal.total, delivered: deliveredTotal.total, remaining: remainingTotal.total }, recommendedAction: completionRate < 0.98 ? "Zweryfikuj pozycje z ilością pozostałą i plan kolejnych rozładunków." : "Utrzymuj monitoring dokumentów i terminowości." });
        warnings.forEach((statement, index) => insights.push({ id: `domain-delivery-warning-${index}`, type: "delivery_control", severity: index === 0 ? "medium" : "high", title: "Kontrola spójności dostaw", statement, confidence: 0.95, evidence: {}, recommendedAction: "Otwórz wskazane rekordy w Edytorze danych i potwierdź wartości źródłowe." }));
        return {
            type: "delivery_tracking", title: "Analiza realizacji dostaw", kpis, warnings,
            totals: { ordered: orderedTotal, delivered: deliveredTotal, remaining: remainingTotal, orderedPallets: palletOrderedTotal, deliveredPallets: palletDeliveredTotal, remainingPallets: palletRemainingTotal },
            completionRate, incompleteRows: incomplete.slice(0, 100), consistencyErrors: consistency.slice(0, 100), overDeliveries: overDeliveries.slice(0, 100), missingDocuments,
            rankings: { suppliers: topGroups(rows, supplier, ordered), brands: topGroups(rows, brand, ordered), materials: topGroups(rows, material, ordered) }, insights
        };
    }

    function procurementAnalysis(rows, schema) {
        const ordered = profileByRole(schema, "ordered_quantity");
        const order = profileByRole(schema, "order_id");
        const productCode = profileByRole(schema, "product_code");
        const material = profileByRole(schema, "material_name");
        const supplier = profileByRole(schema, "supplier");
        const transportDate = profileByRole(schema, "transport_date");
        const onSiteDate = profileByRole(schema, "planned_delivery_date");
        const totals = sumField(rows, ordered);
        const leadTimes = [];
        const unresolvedPeriods = [];
        rows.forEach((row, index) => {
            const from = transportDate ? core.parseDate(row?.[transportDate.id], { convention: transportDate.dateConvention || "dmy" }) : null;
            const to = onSiteDate ? core.parseDate(row?.[onSiteDate.id], { convention: onSiteDate.dateConvention || "dmy" }) : null;
            if (from && to) leadTimes.push({ rowId: row?.id || index + 1, days: Math.round((to - from) / core.DAY_MS) });
            else if (onSiteDate && core.parsePeriodToken(row?.[onSiteDate.id])) unresolvedPeriods.push({ rowId: row?.id || index + 1, value: row?.[onSiteDate.id] });
        });
        const leadValues = leadTimes.map((item) => item.days).filter(Number.isFinite);
        const negativeLeadTimes = leadTimes.filter((item) => item.days < 0);
        const kpis = [
            { id: "ordered", label: "Planowana ilość", value: totals.total },
            { id: "orders", label: "Zamówienia", value: uniqueField(rows, order), format: "integer" },
            { id: "products", label: "Produkty", value: uniqueField(rows, productCode) || uniqueField(rows, material), format: "integer" },
            { id: "suppliers", label: "Dostawcy", value: uniqueField(rows, supplier), format: "integer" },
            { id: "lead", label: "Średni lead time", value: core.mean(leadValues), suffix: " dni" }
        ].filter((item) => item.value !== null && item.value !== undefined);
        const warnings = [];
        if (totals.invalid) warnings.push(`${totals.invalid} wartości zamówionej ilości ma nieprawidłowy format.`);
        if (unresolvedPeriods.length) warnings.push(`${unresolvedPeriods.length} terminów podano tylko jako numer tygodnia; nie są traktowane jako dokładny dzień.`);
        if (negativeLeadTimes.length) warnings.push(`${negativeLeadTimes.length} pozycji ma datę dostawy wcześniejszą niż data transportu.`);
        const insights = [{ id: "domain-procurement-scope", type: "procurement", severity: "low", title: "Zakres planu dostaw", statement: `Plan obejmuje ${uniqueField(rows, order)} zamówień i ${totals.total.toLocaleString("pl-PL")} jednostek.`, confidence: 0.97, evidence: { orders: uniqueField(rows, order), totalQuantity: totals.total }, recommendedAction: "Monitoruj terminy według dostawcy i produktu." }];
        warnings.forEach((statement, index) => insights.push({ id: `domain-procurement-warning-${index}`, type: "procurement_control", severity: index === 0 ? "medium" : "high", title: "Kontrola planu dostaw", statement, confidence: 0.95, evidence: {}, recommendedAction: "Uzupełnij lub popraw terminy przed porównaniem planu z wykonaniem." }));
        return {
            type: "procurement_plan", title: "Analiza planu zakupów i dostaw", kpis, warnings,
            totals: { ordered: totals }, leadTime: { count: leadValues.length, average: core.mean(leadValues), median: core.median(leadValues), minimum: leadValues.length ? Math.min(...leadValues) : null, maximum: leadValues.length ? Math.max(...leadValues) : null, negative: negativeLeadTimes.length },
            unresolvedPeriods: unresolvedPeriods.slice(0, 100), rankings: { suppliers: topGroups(rows, supplier, ordered), products: topGroups(rows, material || productCode, ordered) }, insights
        };
    }

    function analyze(rows, schema, domain, preparation = {}) {
        let result = { type: domain?.domain || "generic", title: domain?.label || "Analiza ogólna", kpis: [], warnings: [], insights: [] };
        if (["delivery_tracking", "hierarchical_delivery_plan"].includes(domain?.domain)) result = deliveryAnalysis(rows, schema);
        else if (domain?.domain === "procurement_plan") result = procurementAnalysis(rows, schema);
        result.domain = domain;
        result.preparation = preparation;
        if (preparation.excludedSubtotalRows) result.warnings.unshift(`Wykluczono ${preparation.excludedSubtotalRows} wierszy SUMA, aby uniknąć podwójnego liczenia.`);
        if (preparation.filledDownValues) result.warnings.unshift(`Uzupełniono analitycznie ${preparation.filledDownValues} pustych nazw materiału metodą Fill Down; dane źródłowe pozostały bez zmian.`);
        return result;
    }

    Object.defineProperty(PMA, "domainAnalysisEngine", {
        value: Object.freeze({ prepare, analyze, deliveryAnalysis, procurementAnalysis, profileByRole, sumField }), enumerable: true, configurable: false, writable: false
    });
}(typeof window !== "undefined" ? window : self));
