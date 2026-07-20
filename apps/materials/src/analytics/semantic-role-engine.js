/* ==========================================================
   Smart Analytics — semantic and business-role inference.
========================================================== */
(function initializeSemanticRoleEngine(global) {
    "use strict";
    const PMA = global.PMA || (global.PMA = {});
    if (!PMA.analyticsCore) throw new Error("analytics-core.js must be loaded before semantic-role-engine.js.");
    const core = PMA.analyticsCore;

    const ROLE_RULES = PMA.analyticsRules?.semanticRoles || [];

    function valuePatternEvidence(profile) {
        const values = (profile.examples || []).map((value) => core.cleanText(value)).filter(Boolean);
        if (!values.length || profile.physicalType === "number") return [];
        const ratio = (pattern) => values.filter((value) => pattern.test(value)).length / values.length;
        const evidence = [];
        if (ratio(/^ORD[-\s/]/i) >= 0.6) evidence.push({ role: "identifier", businessRole: "order_id", score: 0.97, text: "Wartości mają format numeru zamówienia ORD." });
        if (ratio(/^CON[-\s/]/i) >= 0.6) evidence.push({ role: "identifier", businessRole: "contract_id", score: 0.96, text: "Wartości mają format numeru kontraktu CON." });
        if (ratio(/^(?:WZ[/-]|SN\d)/i) >= 0.6) evidence.push({ role: "identifier", businessRole: "document_id", score: 0.9, text: "Wartości przypominają numery dokumentów dostawy." });
        return evidence;
    }

    function inferOne(profile) {
        const rawLabel = core.cleanText(profile.label || "");
        const rawId = core.cleanText(profile.id || "");
        const normalizedLabel = core.normalizeLabel(rawLabel);
        const normalizedId = core.normalizeLabel(rawId);
        const labelCandidates = [...new Set([normalizedLabel, normalizedId].filter(Boolean))];
        const label = normalizedLabel || normalizedId;
        const searchableLabel = labelCandidates.join(" ");
        const evidence = [];
        let best = { role: null, businessRole: null, score: 0, priority: 0 };

        ROLE_RULES.forEach((rule) => {
            if (rule.types && !rule.types.includes(profile.physicalType)) return;
            if (rule.excludePatterns?.some((pattern) => labelCandidates.some((candidate) => pattern.test(candidate)))) return;
            const matched = rule.patterns.filter((pattern) => labelCandidates.some((candidate) => pattern.test(candidate)));
            if (!matched.length) return;
            const priority = Number(rule.priority) || 0;
            const score = 0.62 + Math.min(0.18, matched.length * 0.06) + Math.min(0.18, priority / 1000);
            if (score > best.score || (score === best.score && priority > best.priority)) {
                best = { role: rule.role, businessRole: rule.businessRole || rule.role, score, priority };
            }
        });

        valuePatternEvidence(profile).forEach((candidate) => {
            if ((!best.role || best.priority < 120) && candidate.score > best.score) best = { ...candidate, priority: 200 };
            evidence.push(candidate.text);
        });

        if (best.role) evidence.unshift(`Nazwa kolumny wskazuje rolę: ${best.businessRole || best.role}.`);

        if (profile.physicalType === "date") {
            if (!best.role || best.role === "date") best = { role: "date", businessRole: best.businessRole || "date", score: Math.max(best.score, 0.9 * profile.typeConfidence), priority: best.priority };
            evidence.push("Dominują wartości daty.");
            if (profile.dateConvention) evidence.push(`Wykryty układ dat: ${profile.dateConvention.toUpperCase()}.`);
        } else if (profile.physicalType === "boolean") {
            if (!best.role) best = { role: "boolean", businessRole: "boolean", score: 0.9, priority: 0 };
            evidence.push("Kolumna ma wartości logiczne.");
        } else if (profile.physicalType === "number") {
            const measureHint = /qty|quantity|ilosc|zuzyc|amount.*plt|pallet|palet|stock|zapas|cena|price|cost|koszt|wartosc|value|kwota|procent|percent/.test(searchableLabel);
            const identifierHint = /(^|\s)(id|kod|code|numer|number|nr|account)(\s|$)/.test(searchableLabel);
            if (profile.uniqueRatio >= 0.97 && !measureHint && (best.role === "identifier" || identifierHint)) {
                best = { role: "identifier", businessRole: best.businessRole || "record_id", score: Math.max(best.score, 0.94), priority: best.priority };
                evidence.push("Prawie wszystkie wartości są unikalne i nazwa wskazuje identyfikator.");
            } else if (!best.role) {
                best = { role: "measure", businessRole: "measure", score: 0.72, priority: 0 };
                evidence.push("Kolumna liczbowa nadaje się jako miara.");
            }
            if (best.role === "percentage" && profile.numeric && profile.numeric.minimum >= 0 && profile.numeric.maximum <= 1.5) {
                best.score += 0.05;
                evidence.push("Zakres wartości pasuje do udziału/procentu.");
            }
        } else if (["text", "mixed"].includes(profile.physicalType)) {
            const cardinality = profile.uniqueCount;
            const explicitIdentifier = best.role === "identifier";
            if (!best.role && profile.uniqueRatio >= 0.97 && profile.nonNullCount >= 10) {
                best = { role: "identifier", businessRole: "identifier", score: 0.72, priority: 0 };
                evidence.push("Prawie wszystkie wartości tekstowe są unikalne.");
            } else if (!best.role && profile.text?.averageLength >= 45) {
                best = { role: "free_text", businessRole: "free_text", score: 0.78, priority: 0 };
                evidence.push("Wartości są długimi tekstami.");
            } else if (!best.role && cardinality >= 2 && cardinality <= Math.min(200, Math.max(20, profile.nonNullCount * 0.25))) {
                best = { role: "category", businessRole: "category", score: 0.75, priority: 0 };
                evidence.push("Liczba unikalnych wartości wskazuje wymiar kategoryczny.");
            } else if (!best.role) {
                best = { role: "free_text", businessRole: "free_text", score: 0.55, priority: 0 };
                evidence.push("Nie znaleziono silniejszej roli semantycznej.");
            }
            if (explicitIdentifier && profile.uniqueRatio < 0.97) evidence.push("Identyfikator może powtarzać się, ponieważ opisuje obiekt biznesowy, a nie unikalny rekord.");
        } else if (profile.physicalType === "empty") {
            best = { role: "unknown", businessRole: "unknown", score: 0.2, priority: 0 };
            evidence.push("Brak wartości do klasyfikacji.");
        }

        const role = best.role || "unknown";
        const businessRole = best.businessRole || role;
        const confidence = core.confidenceFromEvidence(core.clamp(best.score), profile.nonNullCount || 0, 20);
        const analyticalRole = role === "date" ? "time_dimension"
            : ["measure", "quantity", "currency", "percentage", "stock", "price", "cost", "duration"].includes(role) ? "measure"
                : role === "identifier" ? "identifier"
                    : ["category", "material", "brand", "supplier", "status", "location", "person", "boolean"].includes(role) ? "dimension"
                        : "attribute";
        const expectedUnique = businessRole === "record_id" || (role === "identifier" && profile.uniqueRatio >= 0.995 && /(^|\s)id(\s|$)/.test(searchableLabel));
        return {
            ...profile,
            semanticRole: role,
            businessRole,
            analyticalRole,
            expectedUnique,
            semanticConfidence: confidence,
            semanticEvidence: evidence
        };
    }

    function infer(schemaProfile) {
        const profiles = (schemaProfile?.profiles || []).map(inferOne);
        return { ...schemaProfile, profiles };
    }

    Object.defineProperty(PMA, "semanticRoleEngine", {
        value: Object.freeze({ infer, inferOne, ROLE_RULES }), enumerable: true, configurable: false, writable: false
    });
}(typeof window !== "undefined" ? window : self));
