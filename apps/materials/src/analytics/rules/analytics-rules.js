/* ==========================================================
   Smart Analytics — versioned deterministic rule library.
   No external model, prompt or network service is used.
========================================================== */
(function initializeAnalyticsRules(global) {
    "use strict";
    const PMA = global.PMA || (global.PMA = {});

    const semanticRoles = Object.freeze([
        { role: "date", types: ["date"], patterns: [/\bdata\b/, /\bdate\b/, /czas/, /timestamp/, /utworz/, /created/, /updated/] },
        { role: "identifier", patterns: [/\bid\b/, /identyfik/, /numer/, /number/, /nr\b/, /kod/, /code/, /sku/, /ean/, /order/, /zamow/] },
        { role: "quantity", types: ["number"], patterns: [/ilosc/, /quantity/, /qty/, /zuzyc/, /usage/, /consumption/, /wolumen/, /volume/] },
        { role: "currency", types: ["number"], patterns: [/wartosc/, /value/, /kwota/, /amount/, /revenue/, /przychod/, /sprzedaz/, /sales/, /pln/, /eur/, /usd/] },
        { role: "percentage", types: ["number"], patterns: [/procent/, /percent/, /udzial/, /share/, /rate/, /ratio/, /%/] },
        { role: "stock", types: ["number"], patterns: [/zapas/, /stan/, /stock/, /inventory/, /saldo/, /on hand/] },
        { role: "price", types: ["number"], patterns: [/cena/, /price/, /unit cost/, /koszt jednostk/] },
        { role: "cost", types: ["number"], patterns: [/koszt/, /cost/, /expense/, /wydat/] },
        { role: "duration", types: ["number"], patterns: [/czas/, /duration/, /dni/, /days/, /godzin/, /hours/, /lead time/] },
        { role: "material", patterns: [/material/, /artykul/, /article/, /item name/, /nazwa.*towar/] },
        { role: "brand", patterns: [/marka/, /brand/, /client/] },
        { role: "supplier", patterns: [/dostawc/, /supplier/, /vendor/] },
        { role: "status", patterns: [/status/, /stan procesu/, /state/, /result/, /wynik/] },
        { role: "location", patterns: [/lokac/, /location/, /magazyn/, /warehouse/, /site/, /oddzial/, /department/, /dzial/, /linia/, /station/, /stanowisko/] },
        { role: "category", patterns: [/kategor/, /category/, /typ/, /type/, /grupa/, /group/, /segment/] },
        { role: "free_text", patterns: [/opis/, /description/, /uwagi/, /notes/, /comment/, /komentar/] }
    ]);

    const aggregationByRole = Object.freeze({
        stock: "latest",
        price: "average",
        percentage: "average",
        duration: "average",
        quantity: "sum",
        currency: "sum",
        cost: "sum",
        measure: "sum"
    });

    const quality = Object.freeze({
        missingHigh: 0.5,
        missingMedium: 0.1,
        duplicateHigh: 0.05,
        almostConstant: 0.98,
        maximumExamples: 50
    });

    const charts = Object.freeze({
        minimumCorrelation: 0.25,
        horizontalBarFromCategories: 9,
        maximumRankingCategories: 20,
        maximumRecommendations: 6
    });

    const insights = Object.freeze({
        stableTrendThreshold: 0.03,
        mediumTrendThreshold: 0.1,
        highTrendThreshold: 0.25,
        periodChangeThreshold: 0.05,
        strongCorrelationThreshold: 0.75,
        minimumCorrelationThreshold: 0.35
    });

    Object.defineProperty(PMA, "analyticsRules", {
        value: Object.freeze({ version: "1.0.0", semanticRoles, aggregationByRole, quality, charts, insights }),
        enumerable: true,
        configurable: false,
        writable: false
    });
}(typeof window !== "undefined" ? window : self));
