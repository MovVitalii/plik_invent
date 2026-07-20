/* ==========================================================
   Smart Analytics — deterministic business-domain classifier.
========================================================== */
(function initializeDomainClassifier(global) {
    "use strict";
    const PMA = global.PMA || (global.PMA = {});
    if (!PMA.analyticsCore) throw new Error("analytics-core.js must be loaded before domain-classifier.js.");
    const core = PMA.analyticsCore;

    function labelOf(field) {
        const label = core.cleanText(field?.label || "");
        const id = core.cleanText(field?.id || "");
        return core.normalizeLabel(label && id && label !== id ? `${label} ${id}` : (label || id));
    }
    function findField(fields, patterns) { return (fields || []).find((field) => patterns.some((pattern) => pattern.test(labelOf(field)))) || null; }

    function classifyRaw(rows = [], fields = []) {
        const labels = fields.map(labelOf);
        const has = (patterns) => labels.some((label) => patterns.some((pattern) => pattern.test(label)));
        const missingMaterialField = findField(fields, [/article/, /artykul/, /material/, /product name/]);
        const missingMaterialRatio = missingMaterialField && rows.length
            ? rows.filter((row) => core.isBlank(row?.[missingMaterialField.id])).length / rows.length : 0;
        const hasSubtotal = rows.some((row) => Object.values(row || {}).some((value) => /^(suma|razem|total)$/i.test(core.cleanText(value))));
        const signals = {
            date: has([/delivery date/, /transport date/, /on site date/, /data dostaw/, /data rozlad/, /\bdate\b/, /\bdata\b/]),
            ordered: has([/qty ordered/, /ord qty/, /ordered qty/, /zamowion/]),
            delivered: has([/^qty$/, /rozladowan/, /delivered/]),
            remaining: has([/pozostal/, /remaining/]),
            usage: has([/zuzyc/, /usage/, /consumption/]),
            stock: has([/stan zapasu/, /^stock$/, /inventory (?:level|qty|quantity)/, /on hand/]),
            order: has([/ord req number/, /order number/, /numer zamow/]),
            product: has([/article/, /artykul/, /material/, /product name/, /product number/]),
            planDates: has([/transport date/]) && has([/on site date/]),
            supplier: has([/supplier/, /dostawc/, /vendor/])
        };
        let domain = "generic";
        let confidence = 0.5;
        const evidence = [];
        if (signals.product && signals.ordered && signals.date && missingMaterialRatio > 0.5 && hasSubtotal) {
            domain = "hierarchical_delivery_plan"; confidence = 0.94; evidence.push("Hierarchiczne materiały, wiersze SUMA i harmonogram dostaw.");
        } else if (signals.product && signals.ordered && signals.planDates && signals.order) {
            domain = "procurement_plan"; confidence = 0.93; evidence.push("Wykryto produkt, ilość zamówioną, numer zamówienia oraz daty transportu i dostawy.");
        } else if (signals.product && signals.ordered && signals.date && signals.order && (signals.delivered || signals.remaining)) {
            domain = "delivery_tracking"; confidence = 0.95; evidence.push("Wykryto zamówienie, planowaną dostawę oraz realizację lub ilość pozostałą.");
        } else if (signals.product && signals.usage && signals.date) {
            domain = "consumption"; confidence = 0.93; evidence.push("Wykryto materiał, zużycie i datę.");
        } else if (signals.product && signals.stock) {
            domain = "inventory_snapshot"; confidence = 0.9; evidence.push("Wykryto materiał i aktualny stan zapasu.");
        } else if (signals.order && signals.date && signals.delivered) {
            domain = "unloading_events"; confidence = 0.82; evidence.push("Wykryto rozładunki powiązane z zamówieniem i datą.");
        }
        return { domain, confidence, evidence, signals, missingMaterialField: missingMaterialField?.id || null, missingMaterialRatio, hasSubtotal };
    }

    function classify(schema, rawClassification = null) {
        const profiles = schema?.profiles || [];
        const roles = new Set(profiles.map((profile) => profile.businessRole));
        const has = (...names) => names.some((name) => roles.has(name));
        let domain = rawClassification?.domain || "generic";
        let confidence = rawClassification?.confidence || 0.5;
        const evidence = [...(rawClassification?.evidence || [])];
        if (has("ordered_quantity") && has("order_id") && has("planned_delivery_date") && (has("delivered_quantity", "remaining_quantity", "delivered_pallet_count", "remaining_pallet_count"))) {
            domain = "delivery_tracking"; confidence = Math.max(confidence, 0.96);
        } else if (has("ordered_quantity") && has("order_id") && has("transport_date") && has("planned_delivery_date")) {
            domain = "procurement_plan"; confidence = Math.max(confidence, 0.95);
        } else if (has("usage_quantity") && has("material_name") && has("date", "actual_delivery_date", "planned_delivery_date")) {
            domain = "consumption"; confidence = Math.max(confidence, 0.95);
        } else if (has("stock") && has("material_name")) {
            domain = "inventory_snapshot"; confidence = Math.max(confidence, 0.92);
        }
        const labels = {
            delivery_tracking: "Ewidencja realizacji dostaw",
            procurement_plan: "Plan zakupów i dostaw",
            hierarchical_delivery_plan: "Hierarchiczny plan dostaw",
            consumption: "Zużycie materiałów",
            inventory_snapshot: "Stan zapasu",
            unloading_events: "Zdarzenia rozładunku",
            generic: "Analiza ogólna"
        };
        return { domain, label: labels[domain] || domain, confidence, evidence, raw: rawClassification };
    }

    Object.defineProperty(PMA, "domainClassifier", {
        value: Object.freeze({ classifyRaw, classify, findField }), enumerable: true, configurable: false, writable: false
    });
}(typeof window !== "undefined" ? window : self));
