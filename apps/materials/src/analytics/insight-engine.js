/* ==========================================================
   Smart Analytics — evidence-based insight generation.
========================================================== */
(function initializeInsightEngine(global) {
    "use strict";
    const PMA = global.PMA || (global.PMA = {});
    if (!PMA.analyticsCore || !PMA.confidenceEngine) throw new Error("analytics-core.js and confidence-engine.js must be loaded first.");
    const core = PMA.analyticsCore;

    function percent(value) {
        return Number.isFinite(value) ? `${core.round(value * 100, 1)}%` : "—";
    }

    function number(value) {
        return Number.isFinite(value) ? new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 2 }).format(value) : "—";
    }

    function create(input) {
        const insights = [];
        const quality = input.quality;
        const trends = input.trends;
        const comparisons = input.periodComparisons;
        const outliers = input.outliers;
        const correlations = input.correlations;
        const rules = PMA.analyticsRules?.insights || {};

        if (quality) {
            insights.push({
                id: "insight-quality-score",
                type: "quality",
                severity: quality.score < 65 ? "high" : quality.score < 85 ? "medium" : "low",
                title: `Jakość danych: ${quality.score}/100 (${quality.grade})`,
                statement: quality.score >= 90
                    ? "Dane mają wysoką kompletność i niewiele problemów strukturalnych."
                    : `Wykryto ${quality.summary.high} problemów wysokiej oraz ${quality.summary.medium} średniej ważności.`,
                confidence: 0.98,
                evidence: quality.summary,
                recommendedAction: quality.score >= 90 ? "Można kontynuować analizę bez istotnych korekt." : "Przejrzyj problemy jakości przed podjęciem decyzji operacyjnych."
            });
            quality.issues.slice(0, 5).forEach((item, index) => insights.push({
                id: `insight-quality-${index}`,
                type: "quality_issue",
                severity: item.severity,
                title: item.title,
                statement: item.statement,
                confidence: 0.95,
                evidence: item,
                recommendedAction: item.type === "missing_values" ? "Uzupełnij wartości lub jawnie oznacz przyczynę braku."
                    : item.type === "duplicate_rows" ? "Zweryfikuj i usuń nadmiarowe rekordy po potwierdzeniu klucza biznesowego."
                        : "Zweryfikuj wskazane rekordy w Edytorze danych."
            }));
        }

        (trends?.trends || []).slice(0, 5).forEach((trend, index) => {
            const magnitude = Math.abs(trend.changePercent || trend.normalizedSlope || 0);
            if (magnitude < (rules.stableTrendThreshold ?? 0.03) && trend.direction === "stable") return;
            insights.push({
                id: `insight-trend-${index}`,
                type: "trend",
                severity: magnitude >= (rules.highTrendThreshold ?? 0.25) ? "high" : magnitude >= (rules.mediumTrendThreshold ?? 0.1) ? "medium" : "low",
                title: `${trend.direction === "up" ? "Wzrost" : trend.direction === "down" ? "Spadek" : "Stabilizacja"}: ${trend.label}`,
                statement: `${trend.label} zmieniło się od pierwszego do ostatniego okresu o ${percent(trend.changePercent)}. Kierunek trendu: ${trend.direction === "up" ? "rosnący" : trend.direction === "down" ? "malejący" : "stabilny"}.`,
                confidence: trend.confidence,
                evidence: { periods: trend.periods, first: trend.first, last: trend.last, changePercent: trend.changePercent, r2: trend.r2, volatility: trend.volatility },
                recommendedAction: trend.direction === "up" ? "Sprawdź, czy wzrost jest planowany i czy zasoby lub zapasy są wystarczające." : "Zweryfikuj przyczyny spadku i odróżnij efekt biznesowy od braków danych."
            });
        });

        (comparisons?.comparisons || []).slice(0, 5).forEach((comparison, index) => {
            if (!Number.isFinite(comparison.percentageChange) || Math.abs(comparison.percentageChange) < (rules.periodChangeThreshold ?? 0.05)) return;
            const top = comparison.contributors?.[0];
            insights.push({
                id: `insight-period-${index}`,
                type: "period_change",
                severity: Math.abs(comparison.percentageChange) >= (rules.highTrendThreshold ?? 0.25) ? "high" : "medium",
                title: `${comparison.label}: ${comparison.currentPeriod} vs ${comparison.previousPeriod}`,
                statement: `Wartość zmieniła się o ${number(comparison.absoluteChange)} (${percent(comparison.percentageChange)}).${top ? ` Największy wpływ miała kategoria „${top.dimension}” (${number(top.change)}).` : ""}`,
                confidence: comparison.confidence,
                evidence: comparison,
                recommendedAction: "Przeanalizuj główne kategorie odpowiedzialne za zmianę."
            });
        });

        if (outliers?.total) {
            insights.push({
                id: "insight-outliers",
                type: "anomaly",
                severity: outliers.high ? "high" : outliers.medium ? "medium" : "low",
                title: `Wykryto ${outliers.total} potencjalnych anomalii`,
                statement: `${outliers.high} ma wysoką, ${outliers.medium} średnią, a ${outliers.low} niską ważność. Anomalie wykryto metodami IQR i robust Z-score${outliers.groupField ? " również wewnątrz grup" : ""}.`,
                confidence: 0.88,
                evidence: { high: outliers.high, medium: outliers.medium, low: outliers.low, groupField: outliers.groupField },
                recommendedAction: "Zweryfikuj rekordy o najwyższej ważności przed usuwaniem; mogą reprezentować rzeczywiste zdarzenia biznesowe."
            });
        }

        const correlation = correlations?.strongestNumeric;
        if (correlation && correlation.strength >= (rules.minimumCorrelationThreshold ?? 0.35)) {
            insights.push({
                id: "insight-correlation",
                type: "correlation",
                severity: correlation.strength >= (rules.strongCorrelationThreshold ?? 0.75) ? "medium" : "low",
                title: `Zależność: ${correlation.leftLabel} i ${correlation.rightLabel}`,
                statement: `Pearson: ${core.round(correlation.pearson, 3)}, Spearman: ${core.round(correlation.spearman, 3)}, liczba obserwacji: ${correlation.sampleSize}.`,
                confidence: correlation.confidence,
                evidence: correlation,
                caveats: ["Korelacja nie oznacza związku przyczynowego."],
                recommendedAction: "Sprawdź zależność na wykresie rozrzutu i oceń możliwe czynniki wspólne."
            });
        }

        return insights.sort((left, right) => (({ high: 0, medium: 1, low: 2 })[left.severity] - ({ high: 0, medium: 1, low: 2 })[right.severity]) || right.confidence - left.confidence);
    }

    Object.defineProperty(PMA, "insightEngine", {
        value: Object.freeze({ create, percent, number }), enumerable: true, configurable: false, writable: false
    });
}(typeof window !== "undefined" ? window : self));
