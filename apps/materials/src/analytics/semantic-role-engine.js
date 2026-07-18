/* ==========================================================
   Smart Analytics — semantic role inference.
========================================================== */
(function initializeSemanticRoleEngine(global) {
    "use strict";
    const PMA = global.PMA || (global.PMA = {});
    if (!PMA.analyticsCore) throw new Error("analytics-core.js must be loaded before semantic-role-engine.js.");
    const core = PMA.analyticsCore;

    const ROLE_RULES = PMA.analyticsRules?.semanticRoles || [];

    function inferOne(profile) {
        const label = core.normalizeLabel(`${profile.label || ""} ${profile.id || ""}`);
        const evidence = [];
        let best = { role: null, score: 0 };

        ROLE_RULES.forEach((rule) => {
            if (rule.types && !rule.types.includes(profile.physicalType)) return;
            const matched = rule.patterns.filter((pattern) => pattern.test(label));
            if (!matched.length) return;
            const score = 0.72 + Math.min(0.18, matched.length * 0.06);
            if (score > best.score) best = { role: rule.role, score };
        });

        if (best.role) evidence.push(`Nazwa kolumny wskazuje rolę: ${best.role}.`);

        if (profile.physicalType === "date") {
            if (!best.role || best.role === "date") best = { role: "date", score: Math.max(best.score, 0.9 * profile.typeConfidence) };
            evidence.push("Dominują wartości daty.");
        } else if (profile.physicalType === "boolean") {
            if (!best.role) best = { role: "boolean", score: 0.9 };
            evidence.push("Kolumna ma wartości logiczne.");
        } else if (profile.physicalType === "number") {
            if (profile.uniqueRatio >= 0.97 && (best.role === "identifier" || /id|kod|code|numer|nr/.test(label))) {
                best = { role: "identifier", score: Math.max(best.score, 0.94) };
                evidence.push("Prawie wszystkie wartości są unikalne.");
            } else if (!best.role) {
                best = { role: "measure", score: 0.72 };
                evidence.push("Kolumna liczbowa nadaje się jako miara.");
            }
            if (best.role === "percentage" && profile.numeric && profile.numeric.minimum >= 0 && profile.numeric.maximum <= 1.5) {
                best.score += 0.05;
                evidence.push("Zakres wartości pasuje do udziału/procentu.");
            }
        } else if (["text", "mixed"].includes(profile.physicalType)) {
            const cardinality = profile.uniqueCount;
            if (!best.role && profile.uniqueRatio >= 0.97 && profile.nonNullCount >= 10) {
                best = { role: "identifier", score: 0.72 };
                evidence.push("Prawie wszystkie wartości tekstowe są unikalne.");
            } else if (!best.role && profile.text?.averageLength >= 45) {
                best = { role: "free_text", score: 0.78 };
                evidence.push("Wartości są długimi tekstami.");
            } else if (!best.role && cardinality >= 2 && cardinality <= Math.min(200, Math.max(20, profile.nonNullCount * 0.25))) {
                best = { role: "category", score: 0.75 };
                evidence.push("Liczba unikalnych wartości wskazuje wymiar kategoryczny.");
            } else if (!best.role) {
                best = { role: "free_text", score: 0.55 };
                evidence.push("Nie znaleziono silniejszej roli semantycznej.");
            }
        } else if (profile.physicalType === "empty") {
            best = { role: "unknown", score: 0.2 };
            evidence.push("Brak wartości do klasyfikacji.");
        }

        const role = best.role || "unknown";
        const confidence = core.confidenceFromEvidence(core.clamp(best.score), profile.nonNullCount || 0, 20);
        const analyticalRole = role === "date" ? "time_dimension"
            : ["measure", "quantity", "currency", "percentage", "stock", "price", "cost", "duration"].includes(role) ? "measure"
                : role === "identifier" ? "identifier"
                    : ["category", "material", "brand", "supplier", "status", "location", "boolean"].includes(role) ? "dimension"
                        : "attribute";
        return { ...profile, semanticRole: role, analyticalRole, semanticConfidence: confidence, semanticEvidence: evidence };
    }

    function infer(schemaProfile) {
        const profiles = (schemaProfile?.profiles || []).map(inferOne);
        return { ...schemaProfile, profiles };
    }

    Object.defineProperty(PMA, "semanticRoleEngine", {
        value: Object.freeze({ infer, inferOne, ROLE_RULES }), enumerable: true, configurable: false, writable: false
    });
}(typeof window !== "undefined" ? window : self));
