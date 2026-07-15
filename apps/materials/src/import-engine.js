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
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file) await importFile(file);
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
            state.setWorkbook(workbook, workbook.SheetNames);

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

            state.updateBusy({ message: "Analizowanie pierwszego arkusza...", progress: 50 });
            await selectAndAnalyzeSheet(workbook.SheetNames[0], { token });
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
            await selectAndAnalyzeSheet(sheetName);
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

        state.updateBusy({ message: "Odczytywanie nazw kolumn z pierwszego wiersza...", progress: 68 });
        await yieldToBrowser();
        const headerRowIndex = 0;
        if (!rowHasValues(rawRows[headerRowIndex])) {
            throw new Error("Pierwszy wiersz arkusza nie zawiera nazw kolumn.");
        }

        const analysis = buildSheetAnalysis(rawRows, headerRowIndex);
        if (!analysis.headers.length) throw new Error("Nie wykryto kolumn danych.");
        if (!analysis.dataRows.length) throw new Error("Arkusz nie zawiera danych poniżej nagłówków.");

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
            emptyRowCount: analysis.emptyRowCount
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

        state.updateBusy({ message: "Arkusz gotowy do mapowania.", progress: 92 });
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


    function buildSheetAnalysis(rawRows, headerRowIndex) {
        const headerRow = rawRows[headerRowIndex] || [];
        let lastColumn = -1;
        // Scan every row (not just a small head sample) to find the last populated column.
        // A column that only starts being filled far down the sheet (e.g. a sparse "notes"
        // field) must not be silently dropped along with its header.
        for (let rowIndex = headerRowIndex; rowIndex < rawRows.length; rowIndex += 1) {
            const row = rawRows[rowIndex];
            if (!row) continue;
            for (let index = row.length - 1; index >= 0; index -= 1) {
                if (!isBlank(row[index])) {
                    if (index > lastColumn) lastColumn = index;
                    break;
                }
            }
        }
        const columnCount = Math.min(lastColumn + 1, IMPORT_LIMITS.maximumColumns);
        if (columnCount <= 0) return { headers: [], sourceHeaders: [], dataRows: [], emptyRowCount: 0 };
        const sourceHeaders = headerRow.slice(0, columnCount).map(cleanText);
        const headers = createUniqueHeaders(sourceHeaders);
        const candidateRows = rawRows.slice(headerRowIndex + 1).map((row) => {
            const normalized = Array.isArray(row) ? row.slice(0, columnCount) : [];
            while (normalized.length < columnCount) normalized.push("");
            return normalized;
        });
        return {
            headers,
            sourceHeaders,
            dataRows: candidateRows.filter(rowHasValues),
            emptyRowCount: countEmptyRows(candidateRows)
        };
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


    async function handleReanalyze() {
        try {
            await analyzeSelectedSheet();
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
        analyzeSelectedSheet,
        analyzeSheet,
        selectAndAnalyzeSheet,
        buildSheetAnalysis,
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
