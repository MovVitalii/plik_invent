/* ==========================================================
   Smart Analytics — confidence scoring and evidence labels.
========================================================== */
(function initializeConfidenceEngine(global) {
    "use strict";
    const PMA = global.PMA || (global.PMA = {});
    if (!PMA.analyticsCore) throw new Error("analytics-core.js must be loaded before confidence-engine.js.");
    const core = PMA.analyticsCore;

    function label(score) {
        const normalized = core.clamp(score);
        if (normalized >= 0.85) return "wysoka";
        if (normalized >= 0.65) return "średnia";
        if (normalized >= 0.45) return "ograniczona";
        return "niska";
    }

    function score(options = {}) {
        const sample = Math.max(0, Number(options.sampleSize) || 0);
        const completeness = core.clamp(options.completeness ?? 1);
        const stability = core.clamp(options.stability ?? 0.5);
        const effect = core.clamp(options.effect ?? 0.5);
        const sampleFactor = core.clamp(Math.log10(Math.max(1, sample)) / 3);
        const result = core.clamp(sampleFactor * 0.25 + completeness * 0.25 + stability * 0.25 + effect * 0.25);
        return { score: core.round(result, 3), label: label(result) };
    }

    Object.defineProperty(PMA, "confidenceEngine", {
        value: Object.freeze({ score, label }), enumerable: true, configurable: false, writable: false
    });
}(typeof window !== "undefined" ? window : self));
