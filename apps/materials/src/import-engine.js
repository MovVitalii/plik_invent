/* ==========================================================
   Pack Materials Analytics
   src/import-engine.js
========================================================== */

(function initializeImportEngine(global) {
    "use strict";

    const PMA = global.PMA || (global.PMA = {});
    if (!PMA.constants || !PMA.state || !PMA.utils || !PMA.dom) {
        throw new Error("PMA core modules must be loaded before src/import-engine.js.");
    }

    const { STATUS, IMPORT_LIMITS, DATA_TYPES, UI_TEXT } = PMA.constants;
    const {
        cleanText,
        isBlank,
        rowHasValues,
        countEmptyRows,
        createUniqueHeaders,
        detectColumnTypes,
        validateExcelFile,
        formatInteger,
        yieldToBrowser,
        normalizeError
    } = PMA.utils;
    const state = PMA.state;
    const dom = PMA.dom;
    const elements = dom.elements;

    const handlers = [];
    let initialized = false;
    let importToken = 0;
    let currentRawRows = [];
    let currentRange = null;

    function initialize() {
        if (initialized) return api;
        assertSheetJs();
        bind(elements.excelFileInput, "change", handleFileInputChange);
        bind(elements.sheetSelector, "change", handleSheetChange);
        bind(elements.reanalyzeSheetButton, "click", handleReanalyze);
        bind(elements.continueToMappingButton, "click", handleContinue);
        bind(document.getElementById("headerRowNumber"), "change", handleReanalyze);
        bind(document.getElementById("detectHeaderRowButton"), "click", handleDetectHeaderRow);
        bind(document.getElementById("combineSheetsButton"), "click", combineAllSheets);
        bind(document.getElementById("selectRecommendedSheetButton"), "click", handleSelectRecommendedSheet);
        initialized = true;
        return api;
    }

    function destroy() {
        handlers.forEach(({ element, eventName, handler }) => element.removeEventListener(eventName, handler));
        handlers.length = 0;
        importToken += 1;
        currentRawRows = [];
        currentRange = null;
        initialized = false;
    }

    function bind(element, eventName, handler) {
        element.addEventListener(eventName, handler);
        handlers.push({ element, eventName, handler });
    }

    async function handleFileInputChange(event) {
        const files = [...(event.target.files || [])];
        event.target.value = "";
        if (!files.length) return;
        try {
            if (files.length === 1) await importFile(files[0]);
            else await importFiles(files);
        } catch (error) {
            handleError(error, files.length > 1 ? "Import wielu plików" : "Import pliku");
        }
    }

    async function importFiles(files) {
        const list = [...(files || [])].filter(Boolean);
        if (!list.length) return null;
        const token = ++importToken;
        try {
            assertSheetJs();
            for (const file of list) {
                const validation = validateExcelFile(file);
                if (!validation.valid) throw new Error(`${file.name}: ${validation.errors.map((item) => item.message).join(" ")}`);
            }
            state.setSelectedFile(list[0]);
            state.clearError();
            state.setBusy({ title: UI_TEXT.loadingFile, message: `Odczytywanie ${list.length} plików...`, progress: 5 });
            const combined = global.XLSX.utils.book_new();
            const sheetProvenance = {};
            let sheetCounter = 0;
            for (let fileIndex = 0; fileIndex < list.length; fileIndex += 1) {
                const file = list[fileIndex];
                const buffer = await file.arrayBuffer();
                ensureToken(token);
                const workbook = global.XLSX.read(buffer, { type: "array", cellDates: true, raw: true, dense: false, WTF: false });
                validateWorkbook(workbook);
                workbook.SheetNames.forEach((sheetName) => {
                    const base = `${file.name.replace(/\.[^.]+$/, "").slice(0, 20)}-${sheetName}`.slice(0, 28) || `Arkusz-${sheetCounter + 1}`;
                    let unique = base;
                    let suffix = 2;
                    while (combined.SheetNames.includes(unique)) unique = `${base.slice(0, 25)}-${suffix++}`;
                    global.XLSX.utils.book_append_sheet(combined, workbook.Sheets[sheetName], unique);
                    sheetProvenance[unique] = { fileName: file.name, sheetName };
                    sheetCounter += 1;
                });
                state.updateBusy({ message: `Wczytano ${fileIndex + 1} z ${list.length} plików.`, progress: 10 + Math.round((fileIndex + 1) / list.length * 45) });
                await yieldToBrowser();
            }
            state.setWorkbook(combined, combined.SheetNames, sheetProvenance);
            const workbookIntelligence = analyzeWorkbookStructure(combined);
            PMA.workbookModelEngine?.prepareFromWorkbook?.({ force: true });
            dom.setImportMode(true);
            dom.updateWorkbookMetadata({ name: `${list.length} połączone pliki`, size: list.reduce((sum, file) => sum + file.size, 0), sheetCount: combined.SheetNames.length, rowCount: 0, columnCount: 0 });
            dom.populateSheetSelector(combined.SheetNames, combined.SheetNames[0]);
            document.getElementById("combineSheetsButton")?.removeAttribute("disabled");
            await selectAndAnalyzeSheet(workbookIntelligence?.recommendedSheet || combined.SheetNames[0], { token, autoDetectHeader: true });
            state.clearBusy(STATUS.SUCCESS);
            dom.showSuccess(`Wczytano ${list.length} plików i ${sheetCounter} arkuszy. Możesz wybrać arkusz albo użyć „Połącz arkusze”.`, "Import wielu plików");
            return combined;
        } catch (error) {
            if (error?.code === "IMPORT_CANCELLED") return null;
            handleError(error, "Import wielu plików");
            return null;
        }
    }

    async function importFile(file) {
        const token = ++importToken;
        const validation = validateExcelFile(file);
        if (!validation.valid) {
            dom.showError(validation.errors.map((item) => item.message).join(" "), "Walidacja pliku");
            return null;
        }

        try {
            assertSheetJs();
            state.setSelectedFile(file);
            state.clearError();
            state.setBusy({ title: UI_TEXT.loadingFile, message: "Odczytywanie zawartości pliku...", progress: 5 });
            dom.setStatusBadge(elements.importStatusBadge, "Wczytywanie...", STATUS.LOADING);
            dom.setWorkflowProgress("import", "Wczytywanie pliku");

            const buffer = await file.arrayBuffer();
            ensureToken(token);
            state.updateBusy({ message: "Analizowanie struktury skoroszytu...", progress: 30 });
            await yieldToBrowser();

            const workbook = global.XLSX.read(buffer, {
                type: "array",
                cellDates: true,
                raw: true,
                dense: false,
                WTF: false
            });
            ensureToken(token);
            validateWorkbook(workbook);
            const sheetProvenance = Object.fromEntries(workbook.SheetNames.map((name) => [name, { fileName: file.name, sheetName: name }]));
            state.setWorkbook(workbook, workbook.SheetNames, sheetProvenance);
            const workbookIntelligence = analyzeWorkbookStructure(workbook);
            PMA.workbookModelEngine?.prepareFromWorkbook?.({ force: true });

            dom.setImportMode(true);
            dom.updateWorkbookMetadata({
                name: file.name,
                size: file.size,
                sheetCount: workbook.SheetNames.length,
                rowCount: 0,
                columnCount: 0
            });
            dom.populateSheetSelector(workbook.SheetNames, workbook.SheetNames[0]);
            dom.setDisabled(elements.reanalyzeSheetButton, false);
            const combineButton = document.getElementById("combineSheetsButton");
            if (combineButton) combineButton.disabled = workbook.SheetNames.length < 2;

            state.updateBusy({ message: "Analizowanie pierwszego arkusza...", progress: 50 });
            await selectAndAnalyzeSheet(workbookIntelligence?.recommendedSheet || workbook.SheetNames[0], { token, autoDetectHeader: true });
            ensureToken(token);

            state.clearBusy(STATUS.SUCCESS);
            dom.setStatusBadge(elements.importStatusBadge, "Plik gotowy", STATUS.SUCCESS);
            dom.setWorkflowProgress("import", "Plik przeanalizowany");
            dom.showSuccess(`Wczytano plik „${file.name}”.`, "Import zakończony");
            return workbook;
        } catch (error) {
            if (error?.code === "IMPORT_CANCELLED") return null;
            handleError(error, "Import pliku Excel");
            return null;
        }
    }

    function validateWorkbook(workbook) {
        if (!workbook || !Array.isArray(workbook.SheetNames) || !workbook.Sheets) {
            throw new Error("Plik nie zawiera prawidłowego skoroszytu Excel.");
        }
        if (!workbook.SheetNames.length) throw new Error("Skoroszyt nie zawiera arkuszy.");
        if (workbook.SheetNames.length > IMPORT_LIMITS.maximumSheets) {
            throw new Error(`Skoroszyt zawiera zbyt wiele arkuszy. Limit: ${IMPORT_LIMITS.maximumSheets}.`);
        }
    }

    async function handleSheetChange(event) {
        const sheetName = cleanText(event.target.value);
        if (!sheetName) return;
        try {
            await selectAndAnalyzeSheet(sheetName, { autoDetectHeader: true });
            state.clearBusy(STATUS.SUCCESS);
        } catch (error) {
            handleError(error, "Analiza arkusza");
        }
    }

    async function selectAndAnalyzeSheet(sheetName, options = {}) {
        const workbook = state.get("import.workbook");
        if (!workbook?.Sheets?.[sheetName]) throw new Error(`Arkusz „${sheetName}” nie istnieje.`);
        state.setSelectedSheet(sheetName);
        elements.sheetSelector.value = sheetName;
        return analyzeSheet(sheetName, options);
    }

    async function analyzeSelectedSheet(options = {}) {
        const sheetName = cleanText(elements.sheetSelector.value || state.get("import.selectedSheet"));
        if (!sheetName) throw new Error("Wybierz arkusz do analizy.");
        return analyzeSheet(sheetName, options);
    }

    async function analyzeSheet(sheetName, options = {}) {
        const workbook = state.get("import.workbook");
        const worksheet = workbook?.Sheets?.[sheetName];
        if (!worksheet) throw new Error(`Nie można odczytać arkusza „${sheetName}”.`);

        const token = options.token ?? importToken;
        state.setBusy({ title: UI_TEXT.analyzingSheet, message: `Odczytywanie arkusza „${sheetName}”...`, progress: 55 });
        dom.setStatusBadge(elements.importStatusBadge, "Analizowanie arkusza...", STATUS.PROCESSING);
        dom.setDisabled(elements.continueToMappingButton, true);
        await yieldToBrowser();

        const range = inspectWorksheetRange(worksheet);
        validateRange(range, sheetName);
        currentRange = range;
        const rawRows = worksheetToRows(worksheet, range);
        ensureToken(token, options.token !== undefined);
        currentRawRows = rawRows;
        if (!rawRows.length) throw new Error(`Arkusz „${sheetName}” jest pusty.`);

        state.updateBusy({ message: "Wykrywanie wiersza nagłówków i zakresu danych...", progress: 68 });
        await yieldToBrowser();
        const headerInput = document.getElementById("headerRowNumber");
        const useAutomaticHeader = options.autoDetectHeader === true || !headerInput?.dataset.userSelected;
        const configuredHeaderRow = Math.max(1, Number(headerInput?.value || 1));
        const headerRowIndex = useAutomaticHeader ? detectHeaderRow(rawRows) : configuredHeaderRow - 1;
        if (headerRowIndex >= rawRows.length || !rowHasValues(rawRows[headerRowIndex])) {
            throw new Error(`Wiersz nagłówków ${headerRowIndex + 1} nie zawiera nazw kolumn.`);
        }
        if (headerInput) {
            headerInput.value = String(headerRowIndex + 1);
            if (useAutomaticHeader) delete headerInput.dataset.userSelected;
        }

        const analysis = buildSheetAnalysis(rawRows, headerRowIndex, range);
        if (!analysis.headers.length) throw new Error("Nie wykryto kolumn danych.");
        if (!analysis.dataRows.length) throw new Error("Arkusz nie zawiera danych poniżej nagłówków.");
        const provenanceMap = state.get("import.sheetProvenance", {}) || {};
        const sheetOrigin = provenanceMap[sheetName] || {};
        const rowProvenanceOverride = sheetOrigin.rows || null;
        const rowProvenance = Array.isArray(rowProvenanceOverride) && rowProvenanceOverride.length === analysis.dataRows.length
            ? rowProvenanceOverride.map((item, index) => ({
                fileName: item?.fileName || sheetOrigin.fileName || state.get("import.fileMeta.name", ""),
                sheetName: item?.sheetName || sheetOrigin.sheetName || sheetName,
                sourceRow: Number(item?.sourceRow) || analysis.sourceRowNumbers[index]
            }))
            : analysis.sourceRowNumbers.map((sourceRow) => ({
                fileName: sheetOrigin.fileName || state.get("import.fileMeta.name", ""),
                sheetName: sheetOrigin.sheetName || sheetName,
                sourceRow
            }));

        state.updateBusy({ message: "Rozpoznawanie typów danych...", progress: 80 });
        await yieldToBrowser();
        const detectedTypes = detectColumnTypes(analysis.dataRows, analysis.headers, {
            sampleSize: IMPORT_LIMITS.typeDetectionSampleSize
        });
        const previewRows = analysis.dataRows.slice(0, IMPORT_LIMITS.previewRowLimit);

        state.setSheetAnalysis({
            rawRows,
            headerRowIndex,
            headers: analysis.headers,
            sourceHeaders: analysis.sourceHeaders,
            dataRows: analysis.dataRows,
            previewRows,
            detectedTypes,
            emptyRowCount: analysis.emptyRowCount,
            sourceRowNumbers: analysis.sourceRowNumbers,
            rowProvenance
        });

        renderAnalysis({
            sheetName,
            headerRowIndex,
            headers: analysis.headers,
            dataRows: analysis.dataRows,
            previewRows,
            detectedTypes,
            emptyRowCount: analysis.emptyRowCount
        });

        // Edytor i Smart Analytics są dostępne od razu po imporcie, nawet bez mapowania
        // schematu materiałowego. Mapowanie może później zastąpić ten ogólny arkusz
        // normalizowanym zbiorem analitycznym.
        if (PMA.spreadsheetEngine?.prepareRawWorkspace) {
            await PMA.spreadsheetEngine.prepareRawWorkspace({ activate: false, silent: true });
        }

        state.updateBusy({ message: "Arkusz gotowy do mapowania i edycji.", progress: 92 });
        dom.setStatusBadge(elements.importStatusBadge, "Arkusz gotowy", STATUS.SUCCESS);
        dom.setWorkflowProgress("import", `${formatInteger(analysis.dataRows.length, "0")} wierszy danych`);
        dom.setDisabled(elements.continueToMappingButton, false);
        return { ...analysis, previewRows, detectedTypes, headerRowIndex, range };
    }

    function inspectWorksheetRange(worksheet) {
        if (!worksheet["!ref"]) return { startRow: 0, endRow: -1, startColumn: 0, endColumn: -1, rowCount: 0, columnCount: 0 };
        const decoded = global.XLSX.utils.decode_range(worksheet["!ref"]);
        return {
            startRow: decoded.s.r,
            endRow: decoded.e.r,
            startColumn: decoded.s.c,
            endColumn: decoded.e.c,
            rowCount: decoded.e.r - decoded.s.r + 1,
            columnCount: decoded.e.c - decoded.s.c + 1
        };
    }

    function validateRange(range, sheetName) {
        if (!range.rowCount || !range.columnCount) throw new Error(`Arkusz „${sheetName}” jest pusty.`);
        if (range.rowCount > IMPORT_LIMITS.maximumRows) {
            throw new Error(`Arkusz zawiera ${formatInteger(range.rowCount)} wierszy. Limit: ${formatInteger(IMPORT_LIMITS.maximumRows)}.`);
        }
        if (range.columnCount > IMPORT_LIMITS.maximumColumns) {
            throw new Error(`Arkusz zawiera ${formatInteger(range.columnCount)} kolumn. Limit: ${formatInteger(IMPORT_LIMITS.maximumColumns)}.`);
        }
    }

    function worksheetToRows(worksheet, range) {
        return global.XLSX.utils.sheet_to_json(worksheet, {
            header: 1,
            range: {
                s: { r: range.startRow, c: range.startColumn },
                e: { r: range.endRow, c: range.endColumn }
            },
            raw: true,
            defval: "",
            blankrows: true
        }).map((row) => {
            const normalized = Array.isArray(row) ? row.slice(0, range.columnCount) : [];
            while (normalized.length < range.columnCount) normalized.push("");
            return normalized;
        });
    }


    function detectHeaderRow(rawRows, options = {}) {
        const maximumCandidates = Math.min(rawRows.length, Math.max(1, Number(options.maximumCandidates) || 25));
        let bestIndex = 0;
        let bestScore = -Infinity;
        const headerTerms = /\b(article|artykul|material|product|brand|marka|qty|quantity|ilosc|amount|data|date|order|ord|supplier|dostawc|category|kategor|status|numer|number|paleta|pallet|wz|transport|recipient)\b/i;
        const totalTerms = /\b(suma|sum of|grand total|suma koncowa|razem|total)\b/i;

        for (let rowIndex = 0; rowIndex < maximumCandidates; rowIndex += 1) {
            const row = Array.isArray(rawRows[rowIndex]) ? rawRows[rowIndex] : [];
            const nonBlankCells = row.map((value, index) => ({ value, index })).filter((item) => !isBlank(item.value));
            if (nonBlankCells.length < 2) continue;
            const normalized = nonBlankCells.map((item) => cleanText(item.value));
            const textCount = nonBlankCells.filter((item) => typeof item.value === "string" && cleanText(item.value)).length;
            const uniqueCount = new Set(normalized.map((value) => value.toLocaleLowerCase("pl-PL"))).size;
            const keywordCount = normalized.filter((value) => headerTerms.test(value)).length;
            const totalCount = normalized.filter((value) => totalTerms.test(value)).length;
            const candidateColumns = nonBlankCells.map((item) => item.index);
            const following = rawRows.slice(rowIndex + 1, Math.min(rawRows.length, rowIndex + 6));
            let followingFilled = 0;
            let followingCells = 0;
            let followingNumericOrDate = 0;
            following.forEach((nextRow) => {
                candidateColumns.forEach((columnIndex) => {
                    const value = nextRow?.[columnIndex];
                    followingCells += 1;
                    if (!isBlank(value)) {
                        followingFilled += 1;
                        if (typeof value === "number" || value instanceof Date || /^\s*[-+]?\d[\d\s.,]*\s*$/.test(String(value))) followingNumericOrDate += 1;
                    }
                });
            });
            const textRatio = textCount / nonBlankCells.length;
            const uniqueRatio = uniqueCount / nonBlankCells.length;
            const followingDensity = followingCells ? followingFilled / followingCells : 0;
            const typeContrast = followingFilled ? followingNumericOrDate / followingFilled : 0;
            const widthBonus = Math.min(12, nonBlankCells.length) * 0.8;
            const score = widthBonus
                + textRatio * 5
                + uniqueRatio * 3
                + keywordCount * 1.8
                + followingDensity * 4
                + typeContrast * 2.5
                - totalCount * 4
                - rowIndex * 0.08;
            if (score > bestScore) {
                bestScore = score;
                bestIndex = rowIndex;
            }
        }
        return bestIndex;
    }

    function determineEffectiveColumns(rawRows, headerRowIndex) {
        const maximumWidth = Math.max(0, ...rawRows.map((row) => Array.isArray(row) ? row.length : 0));
        const dataRowCount = Math.max(1, rawRows.length - headerRowIndex - 1);
        const headerRow = rawRows[headerRowIndex] || [];
        const indexes = [];
        for (let columnIndex = 0; columnIndex < maximumWidth; columnIndex += 1) {
            const headerPresent = !isBlank(headerRow[columnIndex]);
            let nonBlankCount = 0;
            for (let rowIndex = headerRowIndex + 1; rowIndex < rawRows.length; rowIndex += 1) {
                if (!isBlank(rawRows[rowIndex]?.[columnIndex])) nonBlankCount += 1;
            }
            const density = nonBlankCount / dataRowCount;
            const meaningfulUnnamedColumn = nonBlankCount >= 2 || density >= 0.1;
            if (headerPresent || meaningfulUnnamedColumn) indexes.push(columnIndex);
        }
        return indexes.slice(0, IMPORT_LIMITS.maximumColumns);
    }

    function buildSheetAnalysis(rawRows, headerRowIndex, range = null) {
        const headerRow = rawRows[headerRowIndex] || [];
        const columnIndexes = determineEffectiveColumns(rawRows, headerRowIndex);
        if (!columnIndexes.length) return { headers: [], sourceHeaders: [], dataRows: [], sourceRowNumbers: [], emptyRowCount: 0, columnIndexes: [] };
        const sourceHeaders = columnIndexes.map((columnIndex) => cleanText(headerRow[columnIndex]));
        const headers = createUniqueHeaders(sourceHeaders);
        const dataRows = [];
        const sourceRowNumbers = [];
        let emptyRowCount = 0;
        const sourceStartRow = Number(range?.startRow) || 0;
        for (let rowIndex = headerRowIndex + 1; rowIndex < rawRows.length; rowIndex += 1) {
            const sourceRow = Array.isArray(rawRows[rowIndex]) ? rawRows[rowIndex] : [];
            const row = columnIndexes.map((columnIndex) => sourceRow[columnIndex] ?? "");
            if (!rowHasValues(row)) {
                emptyRowCount += 1;
                continue;
            }
            dataRows.push(row);
            sourceRowNumbers.push(sourceStartRow + rowIndex + 1);
        }
        return { headers, sourceHeaders, dataRows, sourceRowNumbers, emptyRowCount, columnIndexes };
    }



    async function combineAllSheets() {
        const workbook = state.get("import.workbook");
        if (!workbook?.SheetNames?.length) throw new Error("Brak arkuszy do połączenia.");
        const headerRowIndex = Math.max(0, Number(document.getElementById("headerRowNumber")?.value || 1) - 1);
        let canonicalHeaders = null;
        const combinedRows = [];
        const combinedProvenance = [];
        const sourceNames = [];
        const sheetProvenance = state.get("import.sheetProvenance", {}) || {};
        for (const sheetName of workbook.SheetNames.filter((name) => name !== "Połączone dane")) {
            const worksheet = workbook.Sheets[sheetName];
            const range = inspectWorksheetRange(worksheet);
            if (!range.rowCount) continue;
            validateRange(range, sheetName);
            const rawRows = worksheetToRows(worksheet, range);
            const analysis = buildSheetAnalysis(rawRows, headerRowIndex, range);
            if (!analysis.headers.length || !analysis.dataRows.length) continue;
            if (!canonicalHeaders) canonicalHeaders = analysis.headers;
            if (canonicalHeaders.length !== analysis.headers.length || canonicalHeaders.some((header, index) => header !== analysis.headers[index])) {
                throw new Error(`Arkusz „${sheetName}” ma inną strukturę kolumn. Ujednolić nagłówki przed łączeniem.`);
            }
            const origin = sheetProvenance[sheetName] || { fileName: state.get("import.fileMeta.name", ""), sheetName };
            combinedRows.push(...analysis.dataRows);
            analysis.sourceRowNumbers.forEach((sourceRow) => combinedProvenance.push({
                fileName: origin.fileName || state.get("import.fileMeta.name", ""),
                sheetName: origin.sheetName || sheetName,
                sourceRow
            }));
            sourceNames.push(sheetName);
        }
        if (!canonicalHeaders || !combinedRows.length) throw new Error("Nie znaleziono zgodnych arkuszy z danymi.");
        const aoa = [];
        for (let index = 0; index < headerRowIndex; index += 1) aoa.push([]);
        aoa.push(canonicalHeaders, ...combinedRows);
        workbook.Sheets["Połączone dane"] = global.XLSX.utils.aoa_to_sheet(aoa);
        if (!workbook.SheetNames.includes("Połączone dane")) workbook.SheetNames.push("Połączone dane");
        const nextProvenance = { ...sheetProvenance, "Połączone dane": { fileName: "Wiele źródeł", sheetName: "Połączone dane", rows: combinedProvenance } };
        state.setWorkbook(workbook, workbook.SheetNames, nextProvenance);
        PMA.workbookModelEngine?.prepareFromWorkbook?.({ force: true });
        dom.populateSheetSelector(workbook.SheetNames, "Połączone dane");
        await selectAndAnalyzeSheet("Połączone dane");
        state.clearBusy(STATUS.SUCCESS);
        dom.showSuccess(`Połączono ${sourceNames.length} arkuszy: ${formatInteger(combinedRows.length)} wierszy. Zachowano źródłowy plik, arkusz i numer wiersza.`, "Łączenie arkuszy");
    }


    function analyzeWorkbookStructure(workbook) {
        try {
            const result = PMA.workbookIntelligenceEngine?.analyzeWorkbook?.(workbook, api, { maximumRowsPerSheet: 3000 }) || null;
            state.setWorkbookIntelligence?.(result);
            renderWorkbookIntelligence(result);
            return result;
        } catch (error) {
            console.warn("[PMA] Nie udało się przeanalizować struktury skoroszytu:", error);
            renderWorkbookIntelligence(null);
            return null;
        }
    }

    function renderWorkbookIntelligence(result) {
        const panel = document.getElementById("workbookIntelligencePanel");
        const body = document.getElementById("workbookIntelligenceBody");
        const summary = document.getElementById("workbookIntelligenceSummary");
        const relations = document.getElementById("workbookRelationsSummary");
        const button = document.getElementById("selectRecommendedSheetButton");
        if (!panel || !body || !summary || !relations || !button) return;
        if (!result?.sheets?.length) {
            panel.hidden = true;
            body.replaceChildren();
            return;
        }
        panel.hidden = false;
        summary.textContent = result.recommendedSheet
            ? `Rekomendowany arkusz: „${result.recommendedSheet}”. ${result.recommendedReason}`
            : "Nie udało się jednoznacznie wskazać głównej tabeli.";
        button.disabled = !result.recommendedSheet;
        body.replaceChildren(...result.sheets.map((sheet) => {
            const tr = document.createElement("tr");
            if (sheet.name === result.recommendedSheet) tr.classList.add("is-recommended");
            if (sheet.warnings?.length || sheet.duplicateOf) tr.classList.add("is-warning");
            const values = [
                sheet.name + (sheet.name === result.recommendedSheet ? " — rekomendowany" : ""),
                sheet.typeLabel || sheet.type,
                formatInteger(sheet.rowCount || 0),
                formatInteger(sheet.columnCount || 0),
                sheet.headerRow ? `wiersz ${sheet.headerRow}` : "—",
                (sheet.warnings || []).join(" ") || "—"
            ];
            values.forEach((value) => { const td = document.createElement("td"); td.textContent = String(value); tr.appendChild(td); });
            tr.addEventListener("dblclick", () => selectAndAnalyzeSheet(sheet.name, { autoDetectHeader: true }).catch((error) => handleError(error, "Wybór arkusza")));
            return tr;
        }));
        relations.textContent = result.relations?.length
            ? `Wykryto ${result.relations.length} wiarygodnych relacji. ${result.relations.slice(0, 3).map((item) => `${item.leftSheet} ↔ ${item.rightSheet}: ${item.commonValues} wspólnych wartości, pokrycie ${Math.round((item.coverage || 0) * 100)}%`).join("; ")}.`
            : "Nie wykryto wiarygodnych kluczy łączenia między arkuszami.";
    }

    async function handleSelectRecommendedSheet() {
        const result = state.get("import.workbookIntelligence");
        if (!result?.recommendedSheet) return;
        try {
            await selectAndAnalyzeSheet(result.recommendedSheet, { autoDetectHeader: true });
            state.clearBusy(STATUS.SUCCESS);
            dom.showSuccess(`Otworzono rekomendowany arkusz „${result.recommendedSheet}”.`, "Rozpoznanie skoroszytu");
        } catch (error) {
            handleError(error, "Wybór rekomendowanego arkusza");
        }
    }

    function renderAnalysis(result) {
        const fileMeta = state.get("import.fileMeta", {});
        dom.setImportMode(true);
        dom.updateWorkbookMetadata({
            name: fileMeta.name,
            size: fileMeta.size,
            sheetCount: state.get("import.sheetNames.length", 0),
            rowCount: result.dataRows.length,
            columnCount: result.headers.length
        });
        dom.renderPreviewTable(result.headers, result.previewRows, result.detectedTypes);
        dom.setText(elements.previewDescription,
            result.previewRows.length < result.dataRows.length
                ? `Wyświetlono ${formatInteger(result.previewRows.length)} z ${formatInteger(result.dataRows.length)} wierszy danych.`
                : `Wyświetlono ${formatInteger(result.dataRows.length)} wierszy danych.`
        );
        dom.setDisabled(elements.reanalyzeSheetButton, false);
        dom.setDisabled(elements.continueToMappingButton, false);
        if (result.emptyRowCount > 0) {
            dom.showInfo(`Pominięto ${formatInteger(result.emptyRowCount)} pustych wierszy.`, "Analiza arkusza");
        }
    }


    async function handleDetectHeaderRow() {
        try {
            const input = document.getElementById("headerRowNumber");
            if (input) delete input.dataset.userSelected;
            await analyzeSelectedSheet({ autoDetectHeader: true });
            state.clearBusy(STATUS.SUCCESS);
            dom.showSuccess(`Wykryto wiersz nagłówków: ${input?.value || 1}.`, "Wykrywanie nagłówków");
        } catch (error) {
            handleError(error, "Wykrywanie nagłówków");
        }
    }

    async function handleReanalyze() {
        try {
            const input = document.getElementById("headerRowNumber");
            if (input) input.dataset.userSelected = "true";
            await analyzeSelectedSheet({ autoDetectHeader: false });
            state.clearBusy(STATUS.SUCCESS);
            dom.showSuccess("Arkusz został ponownie przeanalizowany.", "Analiza arkusza");
        } catch (error) {
            handleError(error, "Analiza arkusza");
        }
    }

    function handleContinue() {
        if (!state.get("import.headers.length", 0) || !state.get("import.dataRows.length", 0)) {
            dom.showWarning("Najpierw przeanalizuj arkusz zawierający dane.", "Mapowanie niedostępne");
            return;
        }
        dom.unlockSection("mapping");
        dom.setStatusBadge(elements.mappingStatusBadge, "Oczekiwanie na mapowanie", STATUS.READY);
        dom.setWorkflowProgress("mapping", "Gotowe do konfiguracji");
        dom.setWorkflowStage(2);
        PMA.mappingEngine?.prepareFromImport?.();
        dom.activateSection("mapping");
    }


    function ensureToken(token, enforce = true) {
        if (enforce && token !== importToken) {
            const error = new Error("Import został zastąpiony nowszą operacją.");
            error.code = "IMPORT_CANCELLED";
            throw error;
        }
    }

    function assertSheetJs() {
        if (!global.XLSX?.read || !global.XLSX?.utils) throw new Error("Biblioteka SheetJS nie została załadowana.");
    }

    function handleError(error, context) {
        state.setError(error, context);
        state.clearBusy(STATUS.ERROR);
        dom.setStatusBadge(elements.importStatusBadge, "Błąd importu", STATUS.ERROR);
        dom.setWorkflowProgress("import", "Import nieudany");
        dom.setDisabled(elements.continueToMappingButton, true);
        dom.showError(normalizeError(error).message, context);
        console.error(`[PMA] ${context}:`, error);
    }

    const api = Object.freeze({
        initialize,
        destroy,
        importFile,
        importFiles,
        combineAllSheets,
        analyzeSelectedSheet,
        analyzeSheet,
        selectAndAnalyzeSheet,
        detectHeaderRow,
        determineEffectiveColumns,
        buildSheetAnalysis,
        analyzeWorkbookStructure,
        renderWorkbookIntelligence,
        inspectWorksheetRange,
        worksheetToRows,
        getCurrentRawRows: () => currentRawRows,
        getCurrentSheetRange: () => currentRange ? { ...currentRange } : null,
        isInitialized: () => initialized
    });

    Object.defineProperty(PMA, "importEngine", {
        value: api,
        writable: false,
        enumerable: true,
        configurable: false
    });
})(window);
