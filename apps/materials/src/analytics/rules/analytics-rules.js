/* ==========================================================
   Smart Analytics — versioned deterministic rule library.
   No external model, prompt or network service is used.
========================================================== */
(function initializeAnalyticsRules(global) {
    "use strict";
    const PMA = global.PMA || (global.PMA = {});

    const semanticRoles = Object.freeze([
        { role: "date", businessRole: "actual_delivery_date", priority: 120, types: ["date"], patterns: [/data rozladunku/, /unload.*date/, /actual.*date/] },
        { role: "date", businessRole: "planned_delivery_date", priority: 115, types: ["date"], patterns: [/delivery date/, /on site date/, /data dostaw/, /termin dostaw/] },
        { role: "date", businessRole: "transport_date", priority: 110, types: ["date"], patterns: [/transport date/, /shipping date/, /data transport/] },
        { role: "date", businessRole: "date", priority: 60, types: ["date"], patterns: [/\bdata\b/, /\bdate\b/, /czas/, /timestamp/, /utworz/, /created/, /updated/] },

        { role: "quantity", businessRole: "remaining_pallet_count", priority: 150, types: ["number", "mixed"], patterns: [/pozostal.*pall?et/, /remaining.*pall?et/] },
        { role: "quantity", businessRole: "delivered_pallet_count", priority: 145, types: ["number", "mixed"], patterns: [/rozladowan.*pall?et/, /delivered.*pall?et/, /unloaded.*pall?et/] },
        { role: "quantity", businessRole: "pallet_count", priority: 135, types: ["number", "mixed"], patterns: [/amount.*plt/, /ilosc.*palet/, /liczba.*opakowan/, /pallet.*count/, /\bplt\b/] },
        { role: "quantity", businessRole: "remaining_quantity", priority: 145, types: ["number", "mixed"], patterns: [/pozostal.*qty/, /remaining.*qty/, /pozostal.*ilosc/] },
        { role: "quantity", businessRole: "ordered_quantity", priority: 140, types: ["number", "mixed"], patterns: [/qty.*ordered/, /ord qty/, /ordered.*qty/, /zamowion.*ilosc/, /ilosc.*zamow/] },
        { role: "quantity", businessRole: "delivered_quantity", priority: 120, types: ["number", "mixed"], patterns: [/delivered.*qty/, /rozladowan.*qty/, /^qty$/, /ilosc dostarcz/] },
        { role: "quantity", businessRole: "usage_quantity", priority: 115, types: ["number", "mixed"], patterns: [/zuzyc/, /usage/, /consumption/] },
        { role: "quantity", businessRole: "quantity", priority: 75, types: ["number", "mixed"], patterns: [/ilosc/, /quantity/, /qty/, /wolumen/, /volume/] },

        { role: "identifier", businessRole: "order_id", priority: 140, patterns: [/ord \/ req/, /order number/, /numer orderu/, /nr zamow/, /numer zamow/] },
        { role: "identifier", businessRole: "document_id", priority: 135, patterns: [/numer wz/, /\bwz\b/, /delivery note/, /document number/] },
        { role: "identifier", businessRole: "product_code", priority: 130, patterns: [/product number/, /material code/, /article number/, /sku/, /ean/] },
        { role: "identifier", businessRole: "contract_id", priority: 125, patterns: [/contract number/, /numer umow/] },
        { role: "identifier", businessRole: "account_id", priority: 120, patterns: [/account number/, /konto/, /account code/] },
        { role: "identifier", businessRole: "record_id", priority: 80, patterns: [/^id$/, /identyfikator rekordu/, /record id/] },
        { role: "identifier", businessRole: "identifier", priority: 45, patterns: [/identyfik/, /\bnumer\b/, /\bnumber\b/, /\bnr\b/, /\bkod\b/, /\bcode\b/] },

        { role: "category", businessRole: "planning_category", priority: 155, patterns: [/planning category/, /kategoria planowania/] },
        { role: "category", businessRole: "language", priority: 150, patterns: [/language code/, /kod jezyk/, /język/] },
        { role: "location", businessRole: "placement_code", priority: 150, patterns: [/store placement code/, /placement code/, /kod lokalizacji/] },
        { role: "supplier", businessRole: "supplier", priority: 170, patterns: [/^supplier/, /dostawc/, /vendor/] },
        { role: "material", businessRole: "material_name", priority: 125, patterns: [/product name/, /material/, /artykul/, /article/, /item name/, /nazwa.*towar/] },
        { role: "brand", businessRole: "brand", priority: 110, patterns: [/marka/, /brand/, /client/] },
        { role: "person", businessRole: "owner", priority: 105, patterns: [/responsible/, /owner/, /opiekun/, /odpowiedzial/] },
        { role: "location", businessRole: "location", priority: 70, patterns: [/lokac/, /location/, /magazyn/, /warehouse/, /site/, /oddzial/, /department/, /dzial/, /linia/, /station/, /stanowisko/, /recipient/] },
        { role: "category", businessRole: "pallet_type", priority: 110, patterns: [/^paleta$/, /pallet type/] },
        { role: "category", businessRole: "size", priority: 105, patterns: [/rozmiar/, /size/, /dimension/] },
        { role: "category", businessRole: "product_category", priority: 90, patterns: [/product category/, /kategor/, /category/, /typ/, /type/, /grupa/, /group/, /segment/] },
        { role: "status", businessRole: "status", priority: 85, patterns: [/status/, /stan procesu/, /state/, /result/, /wynik/] },

        { role: "stock", businessRole: "stock", priority: 100, types: ["number"], patterns: [/zapas/, /stan/, /stock/, /inventory/, /saldo/, /on hand/] },
        { role: "price", businessRole: "unit_price", priority: 100, types: ["number"], patterns: [/cena/, /price/, /unit cost/, /koszt jednostk/] },
        { role: "cost", businessRole: "cost", priority: 90, types: ["number"], patterns: [/koszt/, /cost/, /expense/, /wydat/] },
        { role: "currency", businessRole: "currency_value", priority: 65, types: ["number"], excludePatterns: [/pallet/, /palet/, /plt/, /qty/, /ilosc/], patterns: [/wartosc/, /value/, /kwota/, /amount/, /revenue/, /przychod/, /sprzedaz/, /sales/, /pln/, /eur/, /usd/] },
        { role: "percentage", businessRole: "percentage", priority: 80, types: ["number"], patterns: [/procent/, /percent/, /udzial/, /share/, /rate/, /ratio/, /%/] },
        { role: "duration", businessRole: "duration", priority: 80, types: ["number"], patterns: [/czas/, /duration/, /dni/, /days/, /godzin/, /hours/, /lead time/] },
        { role: "free_text", businessRole: "free_text", priority: 55, patterns: [/opis/, /description/, /uwagi/, /notes/, /comment/, /komentar/, /adres/] }
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
        value: Object.freeze({ version: "1.2.0", semanticRoles, aggregationByRole, quality, charts, insights }),
        enumerable: true,
        configurable: false,
        writable: false
    });
}(typeof window !== "undefined" ? window : self));
