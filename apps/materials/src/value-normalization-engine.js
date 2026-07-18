/* ==========================================================
   Materials Analytics
   src/value-normalization-engine.js
   Deterministic technical value cleanup used during import.
   There is no hidden user-rule UI and no persisted silent rules.
========================================================== */
(function initializeValueNormalizationEngine(global) {
    "use strict";

    const PMA = global.PMA || (global.PMA = {});
    if (!PMA.constants || !PMA.state || !PMA.utils) {
        throw new Error("PMA core modules must be loaded before src/value-normalization-engine.js.");
    }

    const { NORMALIZABLE_FIELDS } = PMA.constants;
    const { cleanText, normalizeComparableText } = PMA.utils;

    const unitAliases = new Map([
        ["szt", "szt."], ["szt.", "szt."], ["pcs", "szt."], ["pc", "szt."],
        ["piece", "szt."], ["pieces", "szt."], ["kg", "kg"], ["kilogram", "kg"],
        ["kilograms", "kg"], ["g", "g"], ["gram", "g"], ["grams", "g"],
        ["m", "m"], ["metr", "m"], ["meter", "m"], ["metre", "m"],
        ["cm", "cm"], ["mm", "mm"], ["l", "l"], ["ltr", "l"], ["liter", "l"],
        ["litre", "l"], ["ml", "ml"], ["rolka", "rolka"], ["roll", "rolka"],
        ["opakowanie", "opak."], ["opak", "opak."], ["opak.", "opak."],
        ["karton", "karton"], ["box", "karton"], ["paleta", "paleta"], ["pallet", "paleta"]
    ]);

    const shiftAliases = new Map([
        ["1", "Zmiana 1"], ["01", "Zmiana 1"], ["zmiana 1", "Zmiana 1"], ["shift 1", "Zmiana 1"],
        ["2", "Zmiana 2"], ["02", "Zmiana 2"], ["zmiana 2", "Zmiana 2"], ["shift 2", "Zmiana 2"],
        ["3", "Zmiana 3"], ["03", "Zmiana 3"], ["zmiana 3", "Zmiana 3"], ["shift 3", "Zmiana 3"],
        ["rano", "Rano"], ["morning", "Rano"], ["popoludnie", "Popołudnie"],
        ["afternoon", "Popołudnie"], ["noc", "Noc"], ["night", "Noc"]
    ]);

    let initialized = false;

    function initialize() {
        initialized = true;
        return api;
    }

    function destroy() {
        initialized = false;
    }

    function getBuiltInTarget(fieldId, sourceKey) {
        if (fieldId === "unit") return unitAliases.get(sourceKey) || "";
        if (fieldId === "shift") return shiftAliases.get(sourceKey) || "";
        return "";
    }

    function compareVariants(left, right) {
        const frequency = right.count - left.count;
        if (frequency) return frequency;
        const symbolDifference = countPreferredSymbols(right.value) - countPreferredSymbols(left.value);
        if (symbolDifference) return symbolDifference;
        const lengthDifference = left.value.length - right.value.length;
        if (lengthDifference) return lengthDifference;
        const uppercaseDifference = countUppercaseLetters(right.value) - countUppercaseLetters(left.value);
        if (uppercaseDifference) return uppercaseDifference;
        return left.value.localeCompare(right.value, "pl");
    }

    function countPreferredSymbols(value) {
        return [...String(value || "")].filter((character) => /[&+@]/.test(character)).length;
    }

    function countUppercaseLetters(value) {
        return [...String(value || "")].filter((character) => /[A-ZĄĆĘŁŃÓŚŹŻ]/.test(character)).length;
    }

    function createResolver(rows = [], headers = [], mapping = {}) {
        const resolver = new Map();
        NORMALIZABLE_FIELDS.forEach((fieldId) => {
            const sourceColumn = mapping[fieldId];
            const columnIndex = sourceColumn ? headers.indexOf(sourceColumn) : -1;
            if (columnIndex < 0) return;
            const groups = new Map();
            rows.forEach((row) => {
                const text = cleanText(Array.isArray(row) ? row[columnIndex] : null);
                const sourceKey = normalizeComparableText(text);
                if (!sourceKey) return;
                if (!groups.has(sourceKey)) groups.set(sourceKey, new Map());
                const variants = groups.get(sourceKey);
                variants.set(text, (variants.get(text) || 0) + 1);
            });
            const fieldMap = new Map();
            groups.forEach((variants, sourceKey) => {
                const builtIn = getBuiltInTarget(fieldId, sourceKey);
                const preferred = [...variants.entries()]
                    .map(([value, count]) => ({ value, count }))
                    .sort(compareVariants)[0]?.value || "";
                fieldMap.set(sourceKey, builtIn || preferred);
            });
            resolver.set(fieldId, fieldMap);
        });
        return resolver;
    }

    function resolveValue(fieldId, value, resolver = null) {
        const text = cleanText(value);
        if (!text) return null;
        const sourceKey = normalizeComparableText(text);
        return cleanText(resolver?.get(fieldId)?.get(sourceKey)) || getBuiltInTarget(fieldId, sourceKey) || text;
    }

    function getRuleAudit(fieldId, value, resolver = null) {
        const original = cleanText(value);
        const normalized = resolveValue(fieldId, value, resolver);
        return { original, normalized, changed: Boolean(original && normalized && original !== normalized) };
    }

    // Backward-compatible no-op methods used by older mapping code.
    function prepareFromMapping() { return null; }
    function scanField() { return null; }
    function scanSelectedField() { return null; }

    const api = Object.freeze({
        initialize,
        destroy,
        prepareFromMapping,
        scanField,
        scanSelectedField,
        createResolver,
        resolveValue,
        getRuleAudit,
        getBuiltInTarget,
        hasUnsavedChanges: () => false,
        isInitialized: () => initialized
    });

    Object.defineProperty(PMA, "valueNormalizationEngine", {
        value: api,
        writable: false,
        enumerable: true,
        configurable: false
    });
}(window));
