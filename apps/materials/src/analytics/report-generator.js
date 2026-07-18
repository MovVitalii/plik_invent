/* ==========================================================
   Smart Analytics — deterministic Polish report templates.
========================================================== */
(function initializeReportGenerator(global) {
    "use strict";
    const PMA = global.PMA || (global.PMA = {});
    if (!PMA.analyticsCore) throw new Error("analytics-core.js must be loaded before report-generator.js.");
    const core = PMA.analyticsCore;

    function formatNumber(value) {
        return Number.isFinite(value) ? new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 2 }).format(value) : "—";
    }

    function formatPercent(value) {
        return Number.isFinite(value) ? `${core.round(value * 100, 1)}%` : "—";
    }

    function uniqueStrings(values, maximum = Infinity) {
        const seen = new Set();
        const output = [];
        (values || []).forEach((value) => {
            const normalized = String(value || "").trim();
            const key = normalized.toLocaleLowerCase("pl-PL");
            if (!normalized || seen.has(key) || output.length >= maximum) return;
            seen.add(key);
            output.push(normalized);
        });
        return output;
    }

    function directionLabel(value) {
        if (value === "up") return "rosnący";
        if (value === "down") return "malejący";
        return "stabilny";
    }

    function aggregationLabel(value) {
        const labels = { sum: "suma", average: "średnia", avg: "średnia", min: "minimum", max: "maksimum", latest: "ostatnia wartość", count: "liczba rekordów" };
        return labels[value] || value || "nieokreślona";
    }

    function generate(input) {
        const profile = input.schema;
        const quality = input.quality;
        const trends = input.trends;
        const comparisons = input.periodComparisons;
        const outliers = input.outliers;
        const correlations = input.correlations;
        const insights = input.insights || [];
        const methodology = input.methodology || {};
        const options = input.options || {};
        const dateRange = trends?.dateRange;
        const analysisMode = methodology.profileMode || (options.fullStatistics === false ? "quick" : "full");
        const sampled = Boolean(methodology.profileSampled);

        const executiveSummary = [];
        executiveSummary.push(`Przeanalizowano ${profile.rowCount.toLocaleString("pl-PL")} wierszy i ${profile.columnCount} kolumn.`);
        executiveSummary.push(`Ocena jakości danych wynosi ${quality.score}/100 (${quality.grade}).`);
        const strongestTrend = trends?.trends?.[0];
        if (strongestTrend) executiveSummary.push(`${strongestTrend.label}: trend ${directionLabel(strongestTrend.direction)}, zmiana między skrajnymi okresami ${formatPercent(strongestTrend.changePercent)}.`);
        if (outliers?.total) executiveSummary.push(`Wykryto ${outliers.total} potencjalnych anomalii, w tym ${outliers.high} o wysokiej ważności.`);
        if (sampled) executiveSummary.push(`Profilowanie wykonano w trybie próbkowanym na ${Number(methodology.profiledRows || 0).toLocaleString("pl-PL")} rekordach; kontrole krytyczne zachowują pełne liczniki tam, gdzie moduł to deklaruje.`);

        const methodologyParagraphs = [
            `Tryb analizy: ${analysisMode === "quick" ? "szybki" : "pełny"}. Wersja reguł: ${methodology.ruleVersion || "nieznana"}.`,
            sampled
                ? `Statystyki profilu oparto na deterministycznej próbie ${Number(methodology.profiledRows || 0).toLocaleString("pl-PL")} z ${Number(methodology.totalRows || profile.rowCount).toLocaleString("pl-PL")} rekordów.`
                : `Statystyki profilu objęły wszystkie ${Number(methodology.totalRows || profile.rowCount).toLocaleString("pl-PL")} rekordy; rozpoznawanie typu korzystało z maksymalnie ${Number(methodology.typeDetectionSampleRows || methodology.totalRows || 0).toLocaleString("pl-PL")} reprezentatywnych wartości.`,
            `Analiza zależności wykorzystała do ${Number(methodology.correlationSampleRows || 0).toLocaleString("pl-PL")} rekordów. Wykrywanie anomalii: ${(methodology.outlierMethods || ["IQR", "MAD robust Z-score"]).join(" oraz ")}.`
        ];

        const trendParagraphs = trends?.trends?.length ? [
            `Analizę czasu wykonano w granulacji: ${trends.granularity}. Każda miara używa agregacji wynikającej z jej roli semantycznej.`,
            ...trends.trends.slice(0, 5).map((trend) => `${trend.label}: trend ${directionLabel(trend.direction)}, agregacja ${aggregationLabel(trend.aggregation)}, zmiana ${formatPercent(trend.changePercent)}, R² ${formatNumber(trend.r2)}, zmienność ${formatPercent(trend.volatility)}, liczba okresów ${trend.periods}.`)
        ] : ["Brak wystarczających danych do wiarygodnej analizy trendu."];

        const actions = uniqueStrings(insights.filter((item) => item.recommendedAction).map((item) => item.recommendedAction), 12);
        const sections = [
            {
                id: "scope",
                title: "1. Zakres danych",
                paragraphs: [
                    `Liczba rekordów: ${profile.rowCount.toLocaleString("pl-PL")}. Liczba kolumn: ${profile.columnCount}.`,
                    dateRange ? `Zakres dat: ${dateRange.minimum} – ${dateRange.maximum} (${dateRange.days} dni).` : "Nie wykryto wiarygodnego zakresu dat.",
                    ...methodologyParagraphs.slice(0, 2)
                ]
            },
            {
                id: "quality",
                title: "2. Jakość danych",
                paragraphs: [
                    `Wynik jakości: ${quality.score}/100, klasa ${quality.grade}.`,
                    `Brakujące komórki: ${quality.summary.missingCells.toLocaleString("pl-PL")}. Duplikaty: ${quality.summary.duplicateRows.toLocaleString("pl-PL")}. Problemy wysokiej ważności: ${quality.summary.high}; średniej: ${quality.summary.medium}.`
                ],
                bullets: quality.issues.slice(0, 8).map((item) => `${item.title}: ${item.statement}`)
            },
            {
                id: "trends",
                title: "3. Trendy i zmiany okresowe",
                paragraphs: trendParagraphs,
                bullets: comparisons?.comparisons?.slice(0, 5).map((item) => `${item.label}: ${item.currentPeriod} vs ${item.previousPeriod}: ${formatNumber(item.absoluteChange)} (${formatPercent(item.percentageChange)}).`) || []
            },
            {
                id: "anomalies",
                title: "4. Anomalie",
                paragraphs: [outliers?.total
                    ? `Wykryto ${outliers.total} potencjalnych anomalii metodami IQR i robust Z-score. Wysoka ważność: ${outliers.high}; średnia: ${outliers.medium}; niska: ${outliers.low}.`
                    : "Nie wykryto istotnych anomalii przy zastosowanych progach."],
                bullets: (outliers?.findings || []).slice(0, 10).map((item) => `${item.label}: wartość ${formatNumber(item.value)}, rekord ${item.rowId}, metoda ${item.method}${item.groupValue ? `, grupa ${item.groupValue}` : ""}.`)
            },
            {
                id: "correlations",
                title: "5. Zależności",
                paragraphs: correlations?.numericPairs?.length ? correlations.numericPairs.slice(0, 5).map((item) => `${item.leftLabel} ↔ ${item.rightLabel}: Pearson ${formatNumber(item.pearson)}, Spearman ${formatNumber(item.spearman)}, n=${item.sampleSize}.`) : ["Nie znaleziono wystarczająco silnych lub licznych zależności między miarami."],
                bullets: ["Zależność statystyczna nie jest dowodem związku przyczynowego."]
            },
            {
                id: "recommendations",
                title: "6. Rekomendowane działania",
                paragraphs: actions.length ? [] : ["Brak działań o wystarczającej ważności przy aktualnych progach reguł."],
                bullets: actions
            },
            {
                id: "methodology",
                title: "7. Metodyka",
                paragraphs: methodologyParagraphs,
                bullets: uniqueStrings((trends?.trends || []).slice(0, 8).map((trend) => `${trend.label}: ${aggregationLabel(trend.aggregation)}.`), 8)
            },
            {
                id: "limitations",
                title: "8. Ograniczenia analizy",
                paragraphs: [
                    "Wyniki opierają się wyłącznie na danych przekazanych do aplikacji i nie uwzględniają informacji zewnętrznych.",
                    "Automatyczna klasyfikacja kolumn i anomalie mają charakter rekomendacyjny; decyzje operacyjne wymagają weryfikacji biznesowej.",
                    "Korelacje nie wskazują przyczynowości, a trendy z małą liczbą okresów mają obniżoną wiarygodność.",
                    sampled ? "Tryb szybki wykorzystuje deterministyczne próbkowanie w wybranych obliczeniach; do decyzji o wysokim ryzyku należy uruchomić analizę pełną." : "Analiza pełna nadal stosuje bezpieczne limity próby dla kosztownych macierzy korelacji, co jest jawnie opisane w sekcji metodyki."
                ]
            }
        ];

        return {
            title: "Automatyczny raport analityczny",
            generatedAt: new Date().toISOString(),
            executiveSummary: uniqueStrings(executiveSummary),
            sections,
            plainText: [
                "AUTOMATYCZNY RAPORT ANALITYCZNY",
                "",
                "PODSUMOWANIE ZARZĄDCZE",
                ...uniqueStrings(executiveSummary).map((line) => `• ${line}`),
                "",
                ...sections.flatMap((section) => [section.title, ...(section.paragraphs || []), ...(section.bullets || []).map((line) => `• ${line}`), ""])
            ].join("\n")
        };
    }

    Object.defineProperty(PMA, "reportGenerator", {
        value: Object.freeze({ generate, uniqueStrings }), enumerable: true, configurable: false, writable: false
    });
}(typeof window !== "undefined" ? window : self));
