/* ==========================================================
   Materials Analytics — deterministic workbook intelligence.
   Profiles every worksheet before the user chooses a table.
========================================================== */
(function initializeWorkbookIntelligenceEngine(global) {
    "use strict";
    const PMA = global.PMA || (global.PMA = {});
    if (!PMA.analyticsCore) throw new Error("analytics-core.js must be loaded before workbook-intelligence-engine.js.");
    const core = PMA.analyticsCore;

    function normalizedHeaders(headers = []) {
        return headers.map((header) => core.normalizeLabel(header)).filter(Boolean);
    }

    function hasAny(headers, patterns) {
        return headers.some((header) => patterns.some((pattern) => pattern.test(header)));
    }

    function countAny(headers, patterns) {
        return patterns.reduce((count, pattern) => count + (headers.some((header) => pattern.test(header)) ? 1 : 0), 0);
    }

    function jaccard(left = [], right = []) {
        const a = new Set(left);
        const b = new Set(right);
        if (!a.size && !b.size) return 1;
        const intersection = [...a].filter((item) => b.has(item)).length;
        return intersection / Math.max(1, new Set([...a, ...b]).size);
    }

    function classifySheet({ name, headers, rows, headerRowIndex }) {
        const normalized = normalizedHeaders(headers);
        const nameLabel = core.normalizeLabel(name);
        const rowCount = rows.length;
        const hasDate = hasAny(normalized, [/delivery date/, /transport date/, /on site date/, /data dostaw/, /data rozlad/]);
        const hasOrder = hasAny(normalized, [/ord req/, /order number/, /numer zamow/, /planning category/]);
        const hasProduct = hasAny(normalized, [/article/, /artykul/, /material/, /product name/, /product number/]);
        const hasOrderedQty = hasAny(normalized, [/qty ordered/, /ord qty/, /ordered qty/, /zamowion/]);
        const hasDelivered = hasAny(normalized, [/rozladowan/, /^qty$/, /delivered/]);
        const hasRemaining = hasAny(normalized, [/pozostal/, /remaining/]);
        const hasSupplier = hasAny(normalized, [/supplier/, /dostawc/, /vendor/]);
        const hasCarrier = hasAny(normalized, [/przewoz/, /carrier/]);
        const hasPlanDates = countAny(normalized, [/transport date/, /on site date/]) >= 2;
        const hasSummaryWords = hasAny(normalized, [/sum of/, /row labels/, /column labels/, /grand total/, /suma/, /razem/]);
        const archiveName = /(^|\s)(old|archive|archiw|kopia)(\s|$)/.test(nameLabel) || /^old/.test(nameLabel);
        const helperName = /sheet\d*|arkusz\d*/.test(nameLabel) && rowCount < 30;
        const titleOffset = headerRowIndex > 0;
        const score = {
            delivery_tracking: (hasProduct ? 2 : 0) + (hasOrderedQty ? 2 : 0) + (hasDate ? 1.5 : 0) + (hasOrder ? 1.5 : 0) + (hasDelivered ? 2 : 0) + (hasRemaining ? 1.5 : 0) + (hasSupplier ? 0.5 : 0),
            procurement_plan: (hasProduct ? 2 : 0) + (hasOrderedQty ? 2 : 0) + (hasOrder ? 1 : 0) + (hasSupplier ? 1 : 0) + (hasPlanDates ? 3 : 0),
            unloading_events: (hasOrder ? 1.5 : 0) + (hasCarrier ? 2 : 0) + (hasDate ? 2 : 0) + (hasDelivered ? 1 : 0),
            summary: (hasSummaryWords ? 4 : 0) + (titleOffset ? 1 : 0) + (rowCount <= 20 ? 1 : 0),
            generic_table: rowCount > 0 ? 1 : 0
        };
        let type = Object.entries(score).sort((a, b) => b[1] - a[1])[0][0];
        if (archiveName) type = "archive";
        else if (helperName && score.summary >= 2) type = "summary";
        else if (hasProduct && hasOrderedQty && hasDate && rows.filter((row) => core.isBlank(row?.[0])).length / Math.max(1, rowCount) > 0.5 && hasAny(normalized, [/wz/])) type = "hierarchical_delivery_plan";
        else if (score.procurement_plan >= score.delivery_tracking && score.procurement_plan >= 6) type = "procurement_plan";
        else if (score.delivery_tracking >= 7) type = "delivery_tracking";
        else if (score.unloading_events >= 4.5) type = "unloading_events";
        else if (score.summary >= 4) type = "summary";

        const labels = {
            delivery_tracking: "Ewidencja dostaw",
            procurement_plan: "Plan zakupów / dostaw",
            unloading_events: "Rozładunki",
            hierarchical_delivery_plan: "Plan hierarchiczny dostaw",
            summary: "Podsumowanie / tabela przestawna",
            archive: "Archiwum / kopia",
            generic_table: "Tabela ogólna"
        };
        const warnings = [];
        if (archiveName) warnings.push("Nazwa arkusza wskazuje wersję archiwalną lub kopię.");
        if (headerRowIndex > 0) warnings.push(`Nagłówki wykryto w wierszu ${headerRowIndex + 1}.`);
        if (rowCount === 0) warnings.push("Brak wierszy danych.");
        return { type, typeLabel: labels[type] || type, scores: score, warnings };
    }

    function rowSignature(row, headers) {
        const values = headers.slice(0, 12).map((_, index) => core.cleanText(row?.[index])).filter(Boolean);
        return values.length ? values.join("\u241f") : "";
    }

    function detectRelations(sheets) {
        const candidates = [];
        const fieldValues = (sheet, field) => {
            const index = sheet.headers.indexOf(field);
            if (index < 0) return new Set();
            return new Set((sheet.rows || []).map((row) => core.normalizeLabel(row?.[index])).filter(Boolean));
        };
        for (let i = 0; i < sheets.length; i += 1) {
            for (let j = i + 1; j < sheets.length; j += 1) {
                const left = sheets[i];
                const right = sheets[j];
                const pairs = [];
                left.headers.forEach((leftHeader) => {
                    const l = core.normalizeLabel(leftHeader);
                    right.headers.forEach((rightHeader) => {
                        const r = core.normalizeLabel(rightHeader);
                        const orderHeader = (value) => /(?:^| )(?:order number|ord req number|numer zamowienia|nr zamowienia)(?: |$)/.test(value);
                        const productHeader = (value) => /(?:^| )(?:article|artykul|material|product name|product number)(?: |$)/.test(value);
                        const orderMatch = orderHeader(l) && orderHeader(r);
                        const productMatch = productHeader(l) && productHeader(r);
                        if (!orderMatch && !productMatch) return;
                        const leftValues = fieldValues(left, leftHeader);
                        const rightValues = fieldValues(right, rightHeader);
                        const common = [...leftValues].filter((value) => rightValues.has(value));
                        const denominator = Math.max(1, Math.min(leftValues.size, rightValues.size));
                        const coverage = common.length / denominator;
                        pairs.push({ leftField: leftHeader, rightField: rightHeader, type: orderMatch ? "order" : "product", commonValues: common.length, coverage, examples: common.slice(0, 5) });
                    });
                });
                const usefulPairs = pairs.filter((pair) => pair.commonValues > 0).sort((a, b) => b.coverage - a.coverage || b.commonValues - a.commonValues);
                if (usefulPairs.length) {
                    const best = usefulPairs[0];
                    const plannedVsActual = new Set([left.type, right.type]).has("procurement_plan") && new Set([left.type, right.type]).has("delivery_tracking");
                    candidates.push({
                        leftSheet: left.name, rightSheet: right.name, fields: usefulPairs.slice(0, 4),
                        relationType: plannedVsActual ? "planned_vs_actual" : "candidate_join",
                        coverage: best.coverage, commonValues: best.commonValues,
                        confidence: Math.min(0.98, 0.65 + best.coverage * 0.25 + Math.min(0.08, best.commonValues / 100))
                    });
                }
            }
        }
        return candidates.sort((a, b) => b.confidence - a.confidence);
    }

    function analyzeWorkbook(workbook, importEngine, options = {}) {
        if (!workbook?.SheetNames?.length || !importEngine) return { sheets: [], recommendedSheet: null, relations: [], generatedAt: new Date().toISOString() };
        const maximumRows = Math.max(50, Number(options.maximumRowsPerSheet) || 3000);
        const sheets = workbook.SheetNames.map((name, index) => {
            const worksheet = workbook.Sheets[name];
            const range = importEngine.inspectWorksheetRange(worksheet);
            if (!range.rowCount || !range.columnCount) return { name, index, type: "empty", typeLabel: "Pusty arkusz", rowCount: 0, columnCount: 0, headerRow: null, score: -100, warnings: ["Arkusz jest pusty."], headers: [], rows: [] };
            const rawRows = importEngine.worksheetToRows(worksheet, range).slice(0, maximumRows + 30);
            const headerRowIndex = importEngine.detectHeaderRow(rawRows);
            const analysis = importEngine.buildSheetAnalysis(rawRows, headerRowIndex, range);
            const classification = classifySheet({ name, headers: analysis.headers, rows: analysis.dataRows, headerRowIndex });
            const density = analysis.headers.length ? analysis.dataRows.reduce((total, row) => total + row.filter((value) => !core.isBlank(value)).length, 0) / Math.max(1, analysis.dataRows.length * analysis.headers.length) : 0;
            let primaryScore = Math.log10(Math.max(1, analysis.dataRows.length) + 1) * 8 + analysis.headers.length * 0.35 + density * 8;
            if (classification.type === "delivery_tracking") primaryScore += 34;
            if (classification.type === "procurement_plan") primaryScore += 18;
            if (classification.type === "unloading_events") primaryScore += 10;
            if (["summary", "archive", "empty"].includes(classification.type)) primaryScore -= classification.type === "archive" ? 35 : 22;
            if (/na potrzeby|pomoc|helper|roboczy/.test(core.normalizeLabel(name))) primaryScore -= 20;
            if (index === 0 && classification.type === "delivery_tracking") primaryScore += 4;
            return {
                name, index, type: classification.type, typeLabel: classification.typeLabel,
                rowCount: analysis.dataRows.length, columnCount: analysis.headers.length,
                headerRow: headerRowIndex + range.startRow + 1, density, score: primaryScore,
                warnings: classification.warnings, headers: analysis.headers,
                rows: analysis.dataRows.slice(0, 1000), range
            };
        });

        for (let i = 0; i < sheets.length; i += 1) {
            for (let j = i + 1; j < sheets.length; j += 1) {
                const left = sheets[i]; const right = sheets[j];
                if (!left.headers?.length || !right.headers?.length) continue;
                const headerSimilarity = jaccard(normalizedHeaders(left.headers), normalizedHeaders(right.headers));
                const leftSignatures = new Set((left.rows || []).map((row) => rowSignature(row, left.headers)).filter(Boolean));
                const rightSignatures = new Set((right.rows || []).map((row) => rowSignature(row, right.headers)).filter(Boolean));
                const overlap = leftSignatures.size && rightSignatures.size
                    ? [...leftSignatures].filter((signature) => rightSignatures.has(signature)).length / Math.max(1, Math.min(leftSignatures.size, rightSignatures.size)) : 0;
                if (headerSimilarity >= 0.72 || overlap >= 0.55) {
                    const older = /old|archive|archiw|kopia/.test(core.normalizeLabel(left.name)) ? left
                        : /old|archive|archiw|kopia/.test(core.normalizeLabel(right.name)) ? right
                            : (left.rowCount <= right.rowCount ? left : right);
                    older.duplicateOf = older === left ? right.name : left.name;
                    older.similarity = Math.max(headerSimilarity, overlap);
                    older.warnings.push(`Arkusz jest podobny do „${older.duplicateOf}” (${Math.round(older.similarity * 100)}%). Nie należy sumować obu bez weryfikacji.`);
                    if (older.type !== "archive" && older.similarity >= 0.8) older.typeLabel += " — możliwa kopia";
                    older.score -= 16;
                }
            }
        }

        const eligible = sheets.filter((sheet) => sheet.rowCount > 0 && !["summary", "archive", "empty"].includes(sheet.type));
        const recommended = eligible.sort((a, b) => b.score - a.score)[0] || sheets.filter((sheet) => sheet.rowCount > 0).sort((a, b) => b.score - a.score)[0] || null;
        const relations = detectRelations(sheets.filter((sheet) => sheet.rowCount > 0 && !["summary", "archive"].includes(sheet.type)));
        const publicSheets = sheets.map(({ rows, ...sheet }) => sheet);
        return {
            schemaVersion: 1,
            generatedAt: new Date().toISOString(),
            sheetCount: sheets.length,
            recommendedSheet: recommended?.name || null,
            recommendedReason: recommended ? `Najwyższy wynik użyteczności (${Math.round(recommended.score)}): ${recommended.typeLabel}, ${recommended.rowCount} wierszy i ${recommended.columnCount} kolumn.` : "Nie znaleziono tabeli danych.",
            sheets: publicSheets,
            relations
        };
    }

    Object.defineProperty(PMA, "workbookIntelligenceEngine", {
        value: Object.freeze({ analyzeWorkbook, classifySheet, detectRelations, jaccard }),
        enumerable: true, configurable: false, writable: false
    });
}(typeof window !== "undefined" ? window : self));
