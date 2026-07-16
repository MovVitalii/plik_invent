/* ==========================================================
   Pack Materials Analytics
   src/export-engine.js
========================================================== */

(function initializeExportEngine(global) {
    "use strict";

    const PMA = global.PMA || (global.PMA = {});
    if (!PMA.constants || !PMA.state || !PMA.utils || !PMA.dom) {
        throw new Error("PMA core modules must be loaded before src/export-engine.js.");
    }

    const {
        APP,
        STATUS,
        EVENTS,
        DATA_TYPES,
        SYSTEM_FIELDS,
        SYSTEM_FIELD_MAP,
        AGGREGATIONS,
        ANALYSIS_TEMPLATES,
        CHART_TYPES,
        EXPORT,
        PROCESSING_LIMITS
    } = PMA.constants;
    const {
        cleanText,
        isBlank,
        parseNumber,
        toISODate,
        toISODateTime,
        formatInteger,
        createExportFileName,
        downloadBlob,
        rowsToCsv,
        clonePlain,
        yieldToBrowser,
        normalizeError
    } = PMA.utils;
    const state = PMA.state;
    const dom = PMA.dom;
    const elements = dom.elements;

    const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    const CSV_MIME = "text/csv;charset=utf-8";
    const EXCEL_MAX_DATA_ROWS = 1048574;
    const EXCEL_MAX_COLUMNS = 16384;
    const handlers = [];
    let initialized = false;
    let exporting = false;
    let exportToken = 0;
    let lastExport = null;

    function initialize() {
        if (initialized) return api;
        assertSheetJs();
        bind(elements.exportXlsxButton, "click", exportAnalysisXlsx);
        bind(elements.exportCsvButton, "click", exportAnalysisCsv);
        bind(elements.exportCleanDataButton, "click", exportCleanDataXlsx);
        bind(elements.exportErrorsButton, "click", exportErrorsXlsx);
        refreshAvailability();
        initialized = true;
        return api;
    }

    function destroy() {
        exportToken += 1;
        handlers.forEach(({ element, eventName, handler }) => element.removeEventListener(eventName, handler));
        handlers.length = 0;
        exporting = false;
        initialized = false;
    }

    function bind(element, eventName, handler) {
        element.addEventListener(eventName, handler);
        handlers.push({ element, eventName, handler });
    }

    async function exportAnalysisXlsx() {
        return executeExport({ type: "analysis-xlsx", title: "Eksport analizy", message: "Przygotowywanie tabeli analitycznej..." }, async (update) => {
            const table = getAnalysisTable();
            const workbook = createWorkbook("Analiza materiałów opakowaniowych", "Wynik analizy tabeli przestawnej");
            await appendRowsAsSheets(workbook, {
                baseName: "Analiza",
                headers: table.columns.map((column) => column.label),
                totalRows: table.rows.length,
                getRow(index) {
                    return table.columns.map((column) => formatExportValue(table.rows[index][column.key], column));
                },
                footerRow: table.footer ? table.columns.map((column) => formatExportValue(table.footer[column.key], column)) : null,
                columnDefinitions: table.columns,
                update
            });
            appendMetadataSheet(workbook, createAnalysisMetadata());
            update(88, "Generowanie pliku Excel...");
            const blob = workbookToBlob(workbook);
            const fileName = createExportFileName("analiza", "xlsx");
            update(97, "Zapisywanie pliku...");
            downloadBlob(blob, fileName, XLSX_MIME);
            return { fileName, format: "xlsx", rowCount: table.rows.length, columnCount: table.columns.length, sheetCount: workbook.SheetNames.length };
        });
    }

    async function exportAnalysisCsv() {
        return executeExport({ type: "analysis-csv", title: "Eksport analizy CSV", message: "Przygotowywanie danych CSV..." }, async (update) => {
            const table = getAnalysisTable();
            const matrix = [table.columns.map((column) => sanitizeCsvCell(column.label))];
            const batchSize = Math.max(1000, PROCESSING_LIMITS.batchSize);
            for (let start = 0; start < table.rows.length; start += batchSize) {
                ensureToken();
                const end = Math.min(start + batchSize, table.rows.length);
                for (let index = start; index < end; index += 1) {
                    matrix.push(table.columns.map((column) => sanitizeCsvCell(formatExportValue(table.rows[index][column.key], column))));
                }
                update(10 + Math.round(end / Math.max(1, table.rows.length) * 65), `Przygotowano ${formatInteger(end)} z ${formatInteger(table.rows.length)} wierszy.`);
                if (end < table.rows.length) await yieldToBrowser();
            }
            if (table.footer) matrix.push(table.columns.map((column) => sanitizeCsvCell(formatExportValue(table.footer[column.key], column))));
            const content = rowsToCsv(matrix, {
                delimiter: EXPORT.csvDelimiter,
                lineEnding: EXPORT.csvLineEnding,
                includeBom: EXPORT.csvIncludeBom
            });
            const fileName = createExportFileName("analiza", "csv");
            update(97, "Zapisywanie pliku...");
            downloadBlob(new Blob([content], { type: CSV_MIME }), fileName, CSV_MIME);
            return { fileName, format: "csv", rowCount: table.rows.length, columnCount: table.columns.length };
        });
    }

    async function exportCleanDataXlsx() {
        return executeExport({ type: "clean-data-xlsx", title: "Eksport czystych danych", message: "Przygotowywanie znormalizowanych danych..." }, async (update) => {
            const rows = state.get("dataset.normalizedRows", []);
            if (!rows.length) throw new Error("Brak czystych danych do eksportu.");
            const fields = getCleanDataFields(rows);
            const workbook = createWorkbook("Czyste dane materiałów opakowaniowych", "Znormalizowany zbiór danych");
            await appendRowsAsSheets(workbook, {
                baseName: "Dane czyste",
                headers: fields.map((field) => field.label),
                totalRows: rows.length,
                getRow(index) {
                    return fields.map((field) => formatExportValue(rows[index][field.id], field));
                },
                columnDefinitions: fields,
                update
            });
            appendMetadataSheet(workbook, createDatasetMetadata());
            update(88, "Generowanie pliku Excel...");
            const fileName = createExportFileName("dane-czyste", "xlsx");
            downloadBlob(workbookToBlob(workbook), fileName, XLSX_MIME);
            return { fileName, format: "xlsx", rowCount: rows.length, columnCount: fields.length, sheetCount: workbook.SheetNames.length };
        });
    }

    async function exportErrorsXlsx() {
        return executeExport({ type: "errors-xlsx", title: "Eksport błędów", message: "Przygotowywanie raportu błędów..." }, async (update) => {
            const rows = getInvalidRows();
            if (!rows.length) throw new Error("Brak błędnych wierszy do eksportu.");
            const columns = createErrorColumns();
            const workbook = createWorkbook("Raport błędów danych", "Wiersze odrzucone podczas walidacji");
            await appendRowsAsSheets(workbook, {
                baseName: "Błędy",
                headers: columns.map((column) => column.label),
                totalRows: rows.length,
                getRow(index) { return createErrorRow(rows[index], columns); },
                columnDefinitions: columns,
                update
            });
            appendMetadataSheet(workbook, createErrorsMetadata(rows));
            update(88, "Generowanie pliku Excel...");
            const fileName = createExportFileName("bledy", "xlsx");
            downloadBlob(workbookToBlob(workbook), fileName, XLSX_MIME);
            return { fileName, format: "xlsx", rowCount: rows.length, columnCount: columns.length, sheetCount: workbook.SheetNames.length };
        });
    }

    async function executeExport(configuration, task) {
        if (exporting) {
            dom.showWarning("Inny eksport jest już wykonywany.", "Eksport");
            return null;
        }
        const token = ++exportToken;
        exporting = true;
        dom.closeExportMenu();
        setButtonsBusy(true);
        state.setBusy({ title: configuration.title, message: configuration.message, progress: 0 });
        dispatch(EVENTS.EXPORT_STARTED, { type: configuration.type, startedAt: new Date().toISOString() });
        try {
            const result = await task((progress, message) => {
                ensureToken(token);
                state.updateBusy({ progress, message });
            });
            ensureToken(token);
            lastExport = { ...result, type: configuration.type, completedAt: new Date().toISOString() };
            state.clearBusy(STATUS.SUCCESS);
            dom.showSuccess(`Utworzono plik „${result.fileName}”.`, "Eksport zakończony");
            dispatch(EVENTS.EXPORT_COMPLETED, clonePlain(lastExport));
            return result;
        } catch (error) {
            if (error?.code === "EXPORT_CANCELLED") return null;
            state.clearBusy(STATUS.ERROR);
            const normalized = normalizeError(error);
            dom.showError(normalized.message, configuration.title);
            dispatch(EVENTS.EXPORT_FAILED, { type: configuration.type, error: normalized });
            console.error(`[PMA] ${configuration.title}:`, error);
            return null;
        } finally {
            exporting = false;
            refreshAvailability();
        }
    }

    function getAnalysisTable() {
        const pivot = state.get("pivot");
        if (!pivot?.ready || !pivot.result) throw new Error("Brak gotowego wyniku analizy do eksportu.");
        const columns = pivot.result.tableColumns;
        const rows = pivot.result.tableRows;
        if (!Array.isArray(columns) || !columns.length) throw new Error("Wynik analizy nie zawiera kolumn.");
        if (columns.length > EXCEL_MAX_COLUMNS) throw new Error(`Wynik zawiera zbyt wiele kolumn. Limit: ${EXCEL_MAX_COLUMNS}.`);
        return {
            columns,
            rows: Array.isArray(rows) ? rows : [],
            footer: pivot.result.tableFooter || null
        };
    }

    function getCleanDataFields(rows) {
        const fields = state.get("dataset.fields", [])
            .filter((field) => field?.id && !field.hidden && field.source !== "internal")
            .filter((field, index, all) => all.findIndex((item) => item.id === field.id) === index)
            .map((field) => ({
                id: field.id,
                key: field.id,
                label: field.label || getFieldLabel(field.id),
                type: field.type || inferType(rows, field.id),
                role: field.type === DATA_TYPES.NUMBER ? "measure" : "dimension"
            }));
        return fields;
    }

    function inferType(rows, fieldId) {
        for (const row of rows.slice(0, 100)) {
            const value = row[fieldId];
            if (isBlank(value)) continue;
            if (typeof value === "number") return DATA_TYPES.NUMBER;
            if (typeof value === "boolean") return DATA_TYPES.BOOLEAN;
            if (value instanceof Date || /^\d{4}-\d{2}-\d{2}/.test(String(value))) return DATA_TYPES.DATE;
            return DATA_TYPES.TEXT;
        }
        return DATA_TYPES.TEXT;
    }

    function getInvalidRows() {
        const datasetInvalid = state.get("dataset.invalidRows", []);
        const datasetDuplicates = state.get("dataset.duplicateRows", []);
        if (datasetInvalid.length || datasetDuplicates.length) return [...datasetInvalid, ...datasetDuplicates];
        return [
            ...state.get("validation.invalidRecords", []),
            ...state.get("validation.duplicateRecords", [])
        ];
    }

    function createErrorColumns() {
        const columns = [
            { key: "sourceRow", label: "Wiersz źródłowy", type: DATA_TYPES.NUMBER },
            { key: "sourceFile", label: "Plik źródłowy", type: DATA_TYPES.TEXT },
            { key: "sourceSheet", label: "Arkusz źródłowy", type: DATA_TYPES.TEXT },
            { key: "errors", label: "Błędy", type: DATA_TYPES.TEXT },
            { key: "warnings", label: "Ostrzeżenia", type: DATA_TYPES.TEXT },
            { key: "duplicateOf", label: "Duplikat wiersza", type: DATA_TYPES.NUMBER }
        ];
        SYSTEM_FIELDS.filter((field) => state.get(`mapping.values.${field.id}`, "")).forEach((field) => columns.push({
            key: `mapped:${field.id}`,
            fieldId: field.id,
            label: `Pole: ${field.label}`,
            type: field.type,
            source: "mapped"
        }));
        state.get("import.headers", []).forEach((header) => columns.push({
            key: `source:${header}`,
            sourceHeader: header,
            label: `Źródło: ${header}`,
            type: DATA_TYPES.TEXT,
            source: "source"
        }));
        if (columns.length > EXCEL_MAX_COLUMNS) throw new Error("Raport błędów zawiera zbyt wiele kolumn.");
        return columns;
    }

    function createErrorRow(record, columns) {
        const mapped = record.mappedValues || record.values || {};
        const source = record.sourceValues || {};
        return columns.map((column) => {
            if (column.key === "sourceRow") return record.sourceRow ?? "";
            if (column.key === "sourceFile") return record.sourceFile ?? state.get("import.fileMeta.name", "");
            if (column.key === "sourceSheet") return record.sourceSheet ?? state.get("import.selectedSheet", "");
            if (column.key === "errors") return (record.errorMessages || record.errors || []).join("; ");
            if (column.key === "warnings") return (record.warningMessages || record.warnings || []).join("; ");
            if (column.key === "duplicateOf") return record.duplicateOf ?? "";
            if (column.source === "mapped") return formatExportValue(mapped[column.fieldId], column);
            if (column.source === "source") return formatExportValue(source[column.sourceHeader], column);
            return "";
        });
    }

    function createWorkbook(title, subject) {
        assertSheetJs();
        const workbook = global.XLSX.utils.book_new();
        workbook.Props = {
            Title: title,
            Subject: subject,
            Author: APP.name,
            Company: APP.company || "",
            CreatedDate: new Date()
        };
        return workbook;
    }

    async function appendRowsAsSheets(workbook, configuration) {
        const { baseName, headers, totalRows, getRow, footerRow = null, columnDefinitions = [], update = () => {} } = configuration;
        if (!headers.length) throw new Error("Eksport nie zawiera kolumn.");
        if (headers.length > EXCEL_MAX_COLUMNS) throw new Error("Eksport zawiera zbyt wiele kolumn.");
        const sheetCount = Math.max(1, Math.ceil(totalRows / EXCEL_MAX_DATA_ROWS));
        for (let sheetIndex = 0; sheetIndex < sheetCount; sheetIndex += 1) {
            ensureToken();
            const start = sheetIndex * EXCEL_MAX_DATA_ROWS;
            const end = Math.min(start + EXCEL_MAX_DATA_ROWS, totalRows);
            const matrix = [[...headers]];
            for (let index = start; index < end; index += 1) matrix.push(normalizeRow(getRow(index), headers.length));
            if (sheetIndex === sheetCount - 1 && Array.isArray(footerRow)) matrix.push(normalizeRow(footerRow, headers.length));
            const worksheet = global.XLSX.utils.aoa_to_sheet(matrix, { cellDates: true, dateNF: "yyyy-mm-dd" });
            worksheet["!cols"] = calculateColumnWidths(matrix);
            if (matrix.length > 1) worksheet["!autofilter"] = { ref: `A1:${global.XLSX.utils.encode_col(headers.length - 1)}${matrix.length}` };
            applyColumnFormats(worksheet, matrix.length, columnDefinitions);
            global.XLSX.utils.book_append_sheet(workbook, worksheet, uniqueSheetName(workbook, sheetCount > 1 ? `${baseName} ${sheetIndex + 1}` : baseName));
            update(10 + Math.round(end / Math.max(1, totalRows) * 68), `Przygotowano ${formatInteger(end)} z ${formatInteger(totalRows)} wierszy.`);
            if (sheetIndex < sheetCount - 1) await yieldToBrowser();
        }
    }

    function appendMetadataSheet(workbook, rows) {
        const worksheet = global.XLSX.utils.aoa_to_sheet([["Parametr", "Wartość"], ...rows]);
        worksheet["!cols"] = [{ wch: 32 }, { wch: 72 }];
        global.XLSX.utils.book_append_sheet(workbook, worksheet, uniqueSheetName(workbook, "Informacje"));
    }

    function workbookToBlob(workbook) {
        const array = global.XLSX.write(workbook, { bookType: "xlsx", type: "array", compression: true, cellDates: true });
        return new Blob([array], { type: XLSX_MIME });
    }

    function normalizeRow(row, count) {
        const result = (Array.isArray(row) ? row : []).slice(0, count);
        while (result.length < count) result.push("");
        return result;
    }

    function calculateColumnWidths(matrix) {
        const widths = new Array(matrix[0]?.length || 0).fill(10);
        matrix.slice(0, 1000).forEach((row) => row.forEach((value, index) => {
            const length = value instanceof Date ? 19 : String(value ?? "").length;
            widths[index] = Math.max(widths[index], Math.min(60, length + 2));
        }));
        return widths.map((wch) => ({ wch }));
    }

    function applyColumnFormats(worksheet, rowCount, definitions) {
        definitions.forEach((definition, columnIndex) => {
            for (let rowIndex = 1; rowIndex < rowCount; rowIndex += 1) {
                const cell = worksheet[global.XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex })];
                if (!cell) continue;
                if ((definition.type === DATA_TYPES.NUMBER || definition.role === "measure") && cell.t === "n") cell.z = "#,##0.00";
                if (definition.type === DATA_TYPES.DATE && cell.t === "d") cell.z = "yyyy-mm-dd";
            }
        });
    }

    function uniqueSheetName(workbook, requested) {
        const base = cleanText(requested).replace(/[\[\]*?/\\:]/g, "-").slice(0, 31) || "Arkusz";
        if (!workbook.SheetNames.includes(base)) return base;
        let index = 2;
        while (index < 10000) {
            const suffix = ` ${index}`;
            const candidate = `${base.slice(0, 31 - suffix.length)}${suffix}`;
            if (!workbook.SheetNames.includes(candidate)) return candidate;
            index += 1;
        }
        throw new Error("Nie można utworzyć unikalnej nazwy arkusza.");
    }

    function createAnalysisMetadata() {
        const analysis = state.get("analysis");
        const pivot = state.get("pivot");
        return [
            ["Aplikacja", APP.name],
            ["Wersja", APP.version],
            ["Wygenerowano", new Date().toISOString()],
            ["Plik źródłowy", state.get("import.fileMeta.name", "")],
            ["Arkusz źródłowy", state.get("import.selectedSheet", "")],
            ["Wiersze po filtrowaniu", pivot.statistics.sourceRows],
            ["Liczba grup", pivot.statistics.groupCount],
            ["Wiersze", analysis.rows.map(getFieldLabel).join(", ")],
            ["Kolumny", analysis.columns.map(getFieldLabel).join(", ")],
            ["Wartości", analysis.values.map(getFieldLabel).join(", ")],
            ["Agregacja", AGGREGATIONS.find((item) => item.id === analysis.aggregation)?.label || analysis.aggregation],
            ["Typ wykresu", CHART_TYPES.find((item) => item.id === analysis.chartType)?.label || analysis.chartType],
            ["Szablon", ANALYSIS_TEMPLATES[analysis.activeTemplate]?.label || ""],
            ["Filtr daty od", state.get("filters.dateFrom", "")],
            ["Filtr daty do", state.get("filters.dateTo", "")]
        ];
    }

    function createDatasetMetadata() {
        const statistics = state.get("dataset.statistics");
        return [
            ["Aplikacja", APP.name],
            ["Wersja", APP.version],
            ["Wygenerowano", new Date().toISOString()],
            ["Plik źródłowy", state.get("import.fileMeta.name", "")],
            ["Arkusz źródłowy", state.get("import.selectedSheet", "")],
            ["Wiersze źródłowe", statistics.totalSourceRows],
            ["Wiersze czyste", statistics.normalizedRows],
            ["Wiersze błędne", statistics.invalidRows],
            ["Duplikaty", statistics.duplicateRows],
            ["Wiersze odrzucone łącznie", statistics.invalidRows + statistics.duplicateRows],
            ["Suma ilości", statistics.totalQuantity],
            ["Średnia ilość", statistics.averageQuantity],
            ["Minimalna ilość", statistics.minimumQuantity ?? ""],
            ["Maksymalna ilość", statistics.maximumQuantity ?? ""],
            ["Najwcześniejsza data", statistics.minimumDate || ""],
            ["Najpóźniejsza data", statistics.maximumDate || ""]
        ];
    }

    function createErrorsMetadata(rows) {
        const validation = state.get("validation");
        return [
            ["Aplikacja", APP.name],
            ["Wygenerowano", new Date().toISOString()],
            ["Plik źródłowy", state.get("import.fileMeta.name", "")],
            ["Arkusz źródłowy", state.get("import.selectedSheet", "")],
            ["Liczba odrzuconych wierszy łącznie", rows.length],
            ["Liczba duplikatów", validation.duplicateRows],
            ["Wiersze z ostrzeżeniami", validation.warningRows]
        ];
    }

    function getFieldLabel(fieldId) {
        return state.get("dataset.fields", []).find((field) => field.id === fieldId)?.label || SYSTEM_FIELD_MAP[fieldId]?.label || fieldId;
    }

    function formatExportValue(value, definition = {}) {
        if (value === null || value === undefined) return "";
        if (value instanceof Date) return toISODateTime(value) || toISODate(value);
        if (definition.type === DATA_TYPES.NUMBER || definition.role === "measure") {
            const number = typeof value === "number" ? value : parseNumber(value);
            return number !== null && Number.isFinite(number) ? number : String(value);
        }
        if (definition.type === DATA_TYPES.DATE) return toISODateTime(value) || toISODate(value) || String(value);
        if (definition.type === DATA_TYPES.BOOLEAN || typeof value === "boolean") return value === true ? "Tak" : value === false ? "Nie" : String(value);
        if (Array.isArray(value)) return value.join("; ");
        if (typeof value === "object") return JSON.stringify(value);
        return String(value);
    }

    function sanitizeCsvCell(value) {
        if (typeof value !== "string") return value;
        return /^[=+@]/.test(value) || /^-(?!\d+(?:[.,]\d+)?$)/.test(value) || /^[\t\r]/.test(value) ? `'${value}` : value;
    }

    function setButtonsBusy(disabled) {
        [elements.exportButton, elements.exportXlsxButton, elements.exportCsvButton, elements.exportCleanDataButton, elements.exportErrorsButton]
            .forEach((button) => dom.setDisabled(button, disabled));
    }

    function refreshAvailability() {
        if (exporting) return setButtonsBusy(true);
        dom.setExportAvailability({
            analysis: state.get("pivot.ready", false),
            cleanData: state.get("dataset.normalizedRows.length", 0) > 0,
            errors: getInvalidRows().length > 0
        });
    }

    function ensureToken(token = exportToken) {
        if (token !== exportToken) {
            const error = new Error("Eksport został anulowany.");
            error.code = "EXPORT_CANCELLED";
            throw error;
        }
    }

    function dispatch(eventName, detail) {
        if (typeof CustomEvent === "function") document.dispatchEvent(new CustomEvent(eventName, { detail }));
    }

    function assertSheetJs() {
        if (!global.XLSX?.utils || typeof global.XLSX.write !== "function") throw new Error("Biblioteka SheetJS nie została załadowana.");
    }

    const api = Object.freeze({
        initialize,
        destroy,
        exportAnalysisXlsx,
        exportAnalysisCsv,
        exportCleanDataXlsx,
        exportErrorsXlsx,
        getAnalysisTable,
        getCleanDataFields,
        getInvalidRows,
        createWorkbook,
        appendRowsAsSheets,
        appendMetadataSheet,
        workbookToBlob,
        createAnalysisMetadata,
        createDatasetMetadata,
        createErrorsMetadata,
        refreshAvailability,
        getLastExport: () => lastExport ? clonePlain(lastExport) : null,
        isExporting: () => exporting,
        isInitialized: () => initialized
    });

    Object.defineProperty(PMA, "exportEngine", {
        value: api,
        writable: false,
        enumerable: true,
        configurable: false
    });
})(window);
