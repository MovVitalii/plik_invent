/* ==========================================================
   Pack Materials Analytics
   src/normalization-engine.js
========================================================== */

(function initializeNormalizationEngine(global) {
    "use strict";

    const PMA = global.PMA || (global.PMA = {});
    if (!PMA.constants || !PMA.state || !PMA.utils || !PMA.dom || !PMA.valueNormalizationEngine) {
        throw new Error("PMA core modules and value normalization must be loaded before src/normalization-engine.js.");
    }

    const {
        STATUS,
        SYSTEM_FIELDS,
        SYSTEM_FIELD_MAP,
        REQUIRED_FIELDS,
        NORMALIZABLE_FIELDS,
        DERIVED_FIELDS,
        INTERNAL_FIELDS,
        VALIDATION_CODES,
        VALIDATION_MESSAGES,
        NORMALIZATION,
        PROCESSING_LIMITS,
        DATA_TYPES,
        UI_TEXT
    } = PMA.constants;
    const {
        isBlank,
        cleanText,
        normalizeComparableText,
        parseNumber,
        parseDate,
        deriveDateFields,
        createCompositeKey,
        createId,
        clonePlain,
        formatInteger,
        yieldToBrowser,
        normalizeError
    } = PMA.utils;
    const state = PMA.state;
    const dom = PMA.dom;
    const elements = dom.elements;

    let initialized = false;
    let processingToken = 0;
    let unsubscribeState = null;

    const canonicalFields = new Set([
        "material", "brand", "line", "unit", "shift", "operator", "packagingType", "category"
    ]);

    function initialize() {
        if (initialized) return api;
        unsubscribeState = state.subscribe((payload) => {
            if ([
                PMA.constants.EVENTS.WORKSPACE_RESET,
                PMA.constants.EVENTS.SHEET_SELECTED,
                PMA.constants.EVENTS.MAPPING_CHANGED
            ].includes(payload.eventName)) {
                processingToken += 1;
            }
        });
        initialized = true;
        return api;
    }

    function destroy() {
        processingToken += 1;
        unsubscribeState?.();
        unsubscribeState = null;
        initialized = false;
    }

    async function processDataset(options = {}) {
        const token = ++processingToken;
        const rows = state.get("import.dataRows", []);
        const headers = state.get("import.headers", []);
        const mapping = state.get("mapping.values", {});
        const mappingValidation = state.validateMapping();

        if (!mappingValidation.isValid) throw createMappingError(mappingValidation);
        if (!rows.length) throw new Error("Brak wierszy źródłowych do przetworzenia.");

        const indexes = buildColumnIndexMap(headers, mapping);
        const canonicalMaps = createCanonicalMaps();
        const valueResolver = PMA.valueNormalizationEngine.createResolver(rows, headers, mapping);
        const duplicateRegistry = new Map();
        const normalizedRows = [];
        const invalidRows = [];
        const duplicateRows = [];
        const errorsByCode = {};
        const warningsByCode = {};
        const importedAt = new Date().toISOString();
        const defaultSourceFile = state.get("import.fileMeta.name", "");
        const defaultSourceSheet = state.get("import.selectedSheet", "");
        const rowProvenance = state.get("import.rowProvenance", []);
        let warningRows = 0;
        let totalQuantity = 0;
        let minimumQuantity = null;
        let maximumQuantity = null;
        let minimumDate = null;
        let maximumDate = null;

        const batchSize = Math.max(250, Number(options.batchSize || PROCESSING_LIMITS.batchSize) || 250);
        state.setBusy({ title: UI_TEXT.processingData, message: "Przygotowywanie danych...", progress: 0 });
        dom.setStatusBadge(elements.mappingStatusBadge, "Przetwarzanie danych...", STATUS.PROCESSING);
        dom.setWorkflowProgress("mapping", "Normalizacja danych");
        dom.setDisabled(elements.processDataButton, true);
        await yieldToBrowser();

        try {
            for (let start = 0; start < rows.length; start += batchSize) {
                ensureToken(token);
                const end = Math.min(start + batchSize, rows.length);
                for (let index = start; index < end; index += 1) {
                    const mapped = mapSourceRow(rows[index], indexes);
                    const validation = validateRawRecord(mapped);
                    const provenance = rowProvenance[index] || {};
                    const sourceRowNumber = Number(provenance.sourceRow) || getSourceRowNumber(index);
                    const sourceFile = provenance.fileName || defaultSourceFile;
                    const sourceSheet = provenance.sheetName || defaultSourceSheet;
                    const sourceValues = Object.fromEntries(headers.map((header, columnIndex) => [header, rows[index][columnIndex]]));

                    if (validation.warnings.length) {
                        warningRows += 1;
                        validation.warnings.forEach((code) => warningsByCode[code] = (warningsByCode[code] || 0) + 1);
                    }

                    if (validation.errors.length) {
                        validation.errors.forEach((code) => errorsByCode[code] = (errorsByCode[code] || 0) + 1);
                        invalidRows.push(createInvalidRecord({
                            sourceRowNumber,
                            sourceFile,
                            sourceSheet,
                            sourceValues,
                            mappedValues: mapped,
                            errors: validation.errors,
                            warnings: validation.warnings
                        }));
                        continue;
                    }

                    const record = normalizeRecord({
                        mappedRecord: mapped,
                        sourceRowNumber,
                        sourceFile,
                        sourceSheet,
                        importedAt,
                        canonicalMaps,
                        valueResolver,
                        warnings: validation.warnings,
                        sourceValues,
                        headers
                    });
                    const duplicateKey = createDuplicateKey(record, rows[index]);
                    record.duplicateKey = duplicateKey;

                    if (NORMALIZATION.duplicateDetectionEnabled && duplicateKey && duplicateRegistry.has(duplicateKey)) {
                        errorsByCode[VALIDATION_CODES.DUPLICATE_RECORD] = (errorsByCode[VALIDATION_CODES.DUPLICATE_RECORD] || 0) + 1;
                        const invalid = createInvalidRecord({
                            sourceRowNumber,
                            sourceFile,
                            sourceSheet,
                            sourceValues,
                            mappedValues: mapped,
                            normalizedValues: record,
                            errors: [VALIDATION_CODES.DUPLICATE_RECORD],
                            warnings: validation.warnings,
                            duplicateOf: duplicateRegistry.get(duplicateKey)
                        });
                        duplicateRows.push(invalid);
                        continue;
                    }

                    if (duplicateKey) duplicateRegistry.set(duplicateKey, sourceRowNumber);
                    normalizedRows.push(record);
                    totalQuantity += record.quantity;
                    if (minimumQuantity === null || record.quantity < minimumQuantity) minimumQuantity = record.quantity;
                    if (maximumQuantity === null || record.quantity > maximumQuantity) maximumQuantity = record.quantity;
                    if (!minimumDate || record.date < minimumDate) minimumDate = record.date;
                    if (!maximumDate || record.date > maximumDate) maximumDate = record.date;
                }

                state.updateBusy({
                    message: `Przetworzono ${formatInteger(end)} z ${formatInteger(rows.length)} wierszy.`,
                    progress: Math.round(end / rows.length * 88)
                });
                if (end < rows.length) await yieldToBrowser();
            }

            ensureToken(token);
            const validationResult = createValidationResult({
                totalRows: rows.length,
                normalizedRows,
                invalidRows,
                duplicateRows,
                warningRows,
                errorsByCode,
                warningsByCode
            });
            state.setValidationResult(validationResult);

            if (!normalizedRows.length) {
                dom.updateValidationSummary(validationResult);
                dom.renderValidationMessages(validationResult.messages);
                throw new Error("Nie znaleziono żadnych poprawnych wierszy do analizy.");
            }

            state.updateBusy({ message: "Tworzenie struktury analitycznej...", progress: 92 });
            await yieldToBrowser();
            const fields = buildDatasetFields(mapping, headers);
            state.setNormalizedDataset({
                normalizedRows,
                invalidRows,
                duplicateRows,
                fields,
                statistics: {
                    totalSourceRows: rows.length,
                    normalizedRows: normalizedRows.length,
                    filteredRows: normalizedRows.length,
                    invalidRows: invalidRows.length,
                    duplicateRows: duplicateRows.length,
                    totalQuantity,
                    averageQuantity: normalizedRows.length ? totalQuantity / normalizedRows.length : 0,
                    minimumQuantity,
                    maximumQuantity,
                    minimumDate,
                    maximumDate
                }
            });
            state.resetAnalysis();
            prepareAnalysisInterface({
                normalizedRows,
                invalidRows,
                minimumDate,
                maximumDate,
                totalQuantity,
                minimumQuantity,
                maximumQuantity
            });

            if (PMA.pivotEngine?.prepareAnalysis) {
                await PMA.pivotEngine.prepareAnalysis({ buildDefault: true });
            }

            ensureToken(token);
            state.clearBusy(STATUS.SUCCESS);
            const rejectedRows = invalidRows.length + duplicateRows.length;
            dom.setStatusBadge(elements.mappingStatusBadge,
                rejectedRows ? "Dane przetworzone z ostrzeżeniami" : "Dane przetworzone",
                rejectedRows ? STATUS.WARNING : STATUS.SUCCESS
            );
            dom.setWorkflowProgress("mapping", `${formatInteger(normalizedRows.length)} poprawnych wierszy`);
            dom.setStatusBadge(elements.analysisStatusBadge, "Analiza gotowa", STATUS.SUCCESS);
            dom.setWorkflowProgress("analysis", `${formatInteger(normalizedRows.length)} wierszy`);
            dom.setDisabled(elements.processDataButton, false);
            dom.showSuccess(
                rejectedRows
                    ? `Przygotowano ${formatInteger(normalizedRows.length)} wierszy. Pominięto: błędne ${formatInteger(invalidRows.length)}, duplikaty ${formatInteger(duplicateRows.length)}.`
                    : `Przygotowano ${formatInteger(normalizedRows.length)} poprawnych wierszy.`,
                "Dane przygotowane"
            );
            dom.activateSection("analysis");

            return { normalizedRows, invalidRows, duplicateRows, fields, validation: validationResult };
        } catch (error) {
            if (error?.code === "NORMALIZATION_CANCELLED") return null;
            state.clearBusy(STATUS.ERROR);
            dom.setDisabled(elements.processDataButton, false);
            throw error;
        }
    }

    function buildColumnIndexMap(headers, mapping) {
        const indexes = {};
        SYSTEM_FIELDS.forEach((field) => {
            indexes[field.id] = mapping[field.id] ? headers.indexOf(mapping[field.id]) : -1;
        });
        REQUIRED_FIELDS.forEach((fieldId) => {
            if (indexes[fieldId] < 0) throw new Error(`Brak mapowania pola „${SYSTEM_FIELD_MAP[fieldId]?.label || fieldId}”.`);
        });
        return indexes;
    }

    function mapSourceRow(row, indexes) {
        return Object.fromEntries(SYSTEM_FIELDS.map((field) => [
            field.id,
            indexes[field.id] >= 0 ? row[indexes[field.id]] : null
        ]));
    }

    // Single source of truth lives in PMA.utils — previously this was a separate,
    // independently-maintained copy of the same logic also found in mapping-engine.js.
    function validateRawRecord(record) {
        return PMA.utils.validateRecord(record);
    }

    function normalizeRecord(options) {
        const {
            mappedRecord,
            sourceRowNumber,
            sourceFile,
            sourceSheet,
            importedAt,
            canonicalMaps,
            valueResolver,
            warnings,
            sourceValues = {},
            headers = []
        } = options;
        const dateFields = deriveDateFields(parseDate(mappedRecord.date, { allowExcelSerial: true, allowNumericStringExcelSerial: true }));
        const record = {
            id: createId("record"),
            sourceRow: sourceRowNumber,
            sourceSheet: sourceSheet || null,
            sourceFile: sourceFile || null,
            importedAt,
            validationStatus: warnings.length ? "warning" : "valid",
            validationErrors: [],
            duplicateKey: "",
            originalValues: {}
        };

        SYSTEM_FIELDS.forEach((field) => {
            if (field.id === "date") {
                record.date = dateFields.date;
                return;
            }
            if (field.id === "quantity") {
                record.quantity = parseNumber(mappedRecord.quantity);
                return;
            }
            if (field.id === "stockLevel") {
                record.stockLevel = parseNumber(mappedRecord.stockLevel);
                return;
            }
            const original = cleanText(mappedRecord[field.id]);
            const normalized = normalizeFieldValue(field.id, mappedRecord[field.id], canonicalMaps, valueResolver);
            record[field.id] = normalized;
            if (NORMALIZABLE_FIELDS.includes(field.id) && original && normalized && original !== normalized) {
                record.originalValues[field.id] = original;
            }
        });
        Object.assign(record, dateFields);
        record.date = dateFields.date;
        record.quantity = parseNumber(mappedRecord.quantity);
        const sourceHeaderList = Array.isArray(headers) && headers.length ? headers : Object.keys(sourceValues || {});
        sourceHeaderList.forEach((header, index) => {
            record[sourceFieldId(index)] = sourceValues?.[header] ?? null;
        });
        return record;
    }

    function normalizeFieldValue(fieldId, value, canonicalMaps, valueResolver = null) {
        const text = cleanText(value);
        if (!text) return null;
        if (["materialCode", "sku"].includes(fieldId)) return text.toLocaleUpperCase("pl-PL");
        if (NORMALIZABLE_FIELDS.includes(fieldId)) {
            return PMA.valueNormalizationEngine.resolveValue(fieldId, text, valueResolver);
        }
        if (canonicalFields.has(fieldId)) return canonicalize(fieldId, text, canonicalMaps);
        return text;
    }

    function normalizeUnit(value) {
        return PMA.valueNormalizationEngine.resolveValue("unit", value);
    }

    function normalizeShift(value) {
        return PMA.valueNormalizationEngine.resolveValue("shift", value);
    }

    function canonicalize(fieldId, value, maps) {
        const key = normalizeComparableText(value);
        const map = maps.get(fieldId);
        if (!map) return value;
        if (map.has(key)) return map.get(key);
        map.set(key, value);
        return value;
    }

    function createCanonicalMaps() {
        return new Map([...canonicalFields].map((fieldId) => [fieldId, new Map()]));
    }

    // Single source of truth lives in PMA.utils — see utils.js.
    function createDuplicateKey(record, sourceRow = []) {
        return PMA.utils.createDuplicateKey(record, sourceRow);
    }

    function createInvalidRecord(options) {
        return {
            id: createId("invalid"),
            sourceRow: options.sourceRowNumber,
            sourceFile: options.sourceFile || null,
            sourceSheet: options.sourceSheet || null,
            errors: [...new Set(options.errors || [])],
            errorMessages: [...new Set(options.errors || [])].map((code) => VALIDATION_MESSAGES[code] || code),
            warnings: [...new Set(options.warnings || [])],
            warningMessages: [...new Set(options.warnings || [])].map((code) => VALIDATION_MESSAGES[code] || code),
            duplicateOf: options.duplicateOf || null,
            sourceValues: clonePlain(options.sourceValues || {}),
            mappedValues: clonePlain(options.mappedValues || {}),
            normalizedValues: options.normalizedValues ? clonePlain(options.normalizedValues) : null
        };
    }

    function createValidationResult(payload) {
        const result = {
            completed: true,
            totalRows: payload.totalRows,
            validRows: payload.normalizedRows.length,
            invalidRows: payload.invalidRows.length,
            duplicateRows: payload.duplicateRows.length,
            warningRows: payload.warningRows,
            errorsByCode: { ...payload.errorsByCode },
            warningsByCode: { ...payload.warningsByCode },
            invalidRecords: payload.invalidRows,
            duplicateRecords: payload.duplicateRows,
            completedAt: new Date().toISOString()
        };
        result.messages = createValidationMessages(result);
        return result;
    }

    function createValidationMessages(result) {
        const rejectedRows = result.invalidRows + result.duplicateRows;
        const messages = [{
            status: rejectedRows ? "warning" : "success",
            text: rejectedRows
                ? `${formatInteger(result.validRows)} z ${formatInteger(result.totalRows)} wierszy przyjęto do analizy. Pominięto: błędne ${formatInteger(result.invalidRows)}, duplikaty ${formatInteger(result.duplicateRows)}.`
                : `Wszystkie ${formatInteger(result.validRows)} wiersze przetworzono poprawnie.`
        }];
        Object.entries(result.errorsByCode).sort((a, b) => b[1] - a[1]).forEach(([code, count]) => messages.push({ status: "error", text: `${VALIDATION_MESSAGES[code] || code} Liczba wierszy: ${formatInteger(count)}.` }));
        Object.entries(result.warningsByCode).sort((a, b) => b[1] - a[1]).forEach(([code, count]) => messages.push({ status: "warning", text: `${VALIDATION_MESSAGES[code] || code} Liczba wierszy: ${formatInteger(count)}.` }));
        return messages;
    }

    function sourceFieldId(index) {
        return `source__${index}`;
    }

    function buildDatasetFields(mapping, headers = state.get("import.headers", [])) {
        const detectedTypes = state.get("import.detectedTypes", {});
        const mapped = SYSTEM_FIELDS
            .filter((field) => Boolean(mapping[field.id]))
            .map((field) => ({
                id: field.id,
                label: field.label,
                description: field.description,
                type: field.type,
                required: field.required,
                source: "mapped",
                sourceColumn: mapping[field.id],
                filterable: field.id !== "description",
                groupable: field.type !== DATA_TYPES.NUMBER,
                aggregatable: field.type === DATA_TYPES.NUMBER,
                hidden: false
            }));
        const sourceFields = (Array.isArray(headers) ? headers : []).map((header, index) => ({
            id: sourceFieldId(index),
            label: header,
            description: `Oryginalna kolumna źródłowa „${header}”.`,
            type: detectedTypes[header] || DATA_TYPES.TEXT,
            source: "source",
            sourceColumn: header,
            sourceIndex: index,
            mappedTo: Object.entries(mapping || {}).filter(([, source]) => source === header).map(([fieldId]) => fieldId),
            filterable: true,
            groupable: true,
            aggregatable: (detectedTypes[header] || DATA_TYPES.TEXT) === DATA_TYPES.NUMBER,
            hidden: false
        }));
        const derived = DERIVED_FIELDS.map((field) => ({
            ...field,
            description: field.description || "Pole utworzone automatycznie z daty.",
            source: "derived",
            sourceColumn: null,
            filterable: field.filterable !== false,
            groupable: field.groupable !== false,
            aggregatable: false,
            hidden: field.hidden === true
        }));
        const internal = INTERNAL_FIELDS.map((id) => ({
            id,
            label: id,
            description: "Wewnętrzne pole systemowe.",
            type: DATA_TYPES.TEXT,
            source: "internal",
            filterable: false,
            groupable: false,
            aggregatable: false,
            hidden: true
        }));
        return [...sourceFields, ...mapped, ...derived, ...internal];
    }

    function prepareAnalysisInterface(payload) {
        dom.unlockSection("analysis");
        dom.setWorkflowStage(3);
        dom.setStatusBadge(elements.analysisStatusBadge, "Dane gotowe", STATUS.SUCCESS);
        dom.setWorkflowProgress("analysis", `${formatInteger(payload.normalizedRows.length)} wierszy`);
        dom.updateAnalysisSummary({
            filteredRows: payload.normalizedRows.length,
            total: payload.totalQuantity,
            groupCount: 0,
            average: payload.normalizedRows.length ? payload.totalQuantity / payload.normalizedRows.length : 0,
            minimum: payload.minimumQuantity ?? 0,
            maximum: payload.maximumQuantity ?? 0
        });
        dom.setAnalysisTip(`Dane obejmują okres ${payload.minimumDate || "—"} – ${payload.maximumDate || "—"}.`, "success");
        elements.dateFromFilter.min = payload.minimumDate || "";
        elements.dateFromFilter.max = payload.maximumDate || "";
        elements.dateToFilter.min = payload.minimumDate || "";
        elements.dateToFilter.max = payload.maximumDate || "";
        elements.dateFromFilter.value = "";
        elements.dateToFilter.value = "";
        dom.setExportAvailability({
            analysis: false,
            cleanData: payload.normalizedRows.length > 0,
            errors: payload.invalidRows.length + state.get("dataset.duplicateRows.length", 0) > 0
        });
        dom.updateValidationSummary(state.get("validation"));
        dom.renderValidationMessages(state.get("validation.messages", []));
    }

    function getSourceRowNumber(index) {
        const sourceRows = state.get("import.sourceRowNumbers", []);
        const exact = Number(sourceRows[index]);
        return Number.isInteger(exact) && exact > 0
            ? exact
            : (state.get("import.headerRowIndex", 0) || 0) + index + 2;
    }

    function ensureToken(token) {
        if (token !== processingToken) {
            const error = new Error("Przetwarzanie danych zostało anulowane.");
            error.code = "NORMALIZATION_CANCELLED";
            throw error;
        }
    }

    function createMappingError(validation) {
        const details = [];
        if (validation.missingRequiredFields.length) details.push(`brak pól: ${validation.missingRequiredFields.join(", ")}`);
        if (validation.duplicateSourceColumns.length) details.push(`powielone kolumny: ${validation.duplicateSourceColumns.join(", ")}`);
        if (validation.unavailableSourceColumns.length) details.push(`brakujące kolumny: ${validation.unavailableSourceColumns.join(", ")}`);
        return new Error(`Mapowanie jest nieprawidłowe${details.length ? ` — ${details.join("; ")}` : ""}.`);
    }

    function normalizeSingleRecord(mappedRecord, options = {}) {
        const validation = validateRawRecord(mappedRecord);
        if (validation.errors.length) return { valid: false, errors: validation.errors, warnings: validation.warnings, record: null };
        const record = normalizeRecord({
            mappedRecord,
            sourceRowNumber: options.sourceRowNumber || 1,
            sourceFile: options.sourceFile || null,
            sourceSheet: options.sourceSheet || null,
            importedAt: options.importedAt || new Date().toISOString(),
            canonicalMaps: options.canonicalMaps || createCanonicalMaps(),
            valueResolver: options.valueResolver || null,
            warnings: validation.warnings,
            sourceValues: options.sourceValues || {},
            headers: options.headers || Object.keys(options.sourceValues || {})
        });
        record.duplicateKey = createDuplicateKey(record, options.sourceRow || []);
        return { valid: true, errors: [], warnings: validation.warnings, record };
    }

    function handleError(error, context = "Normalizacja danych") {
        state.setError(error, context);
        dom.hideLoading();
        dom.setStatusBadge(elements.mappingStatusBadge, "Błąd przetwarzania", STATUS.ERROR);
        dom.showError(normalizeError(error).message, context);
    }

    const api = Object.freeze({
        initialize,
        destroy,
        processDataset,
        buildColumnIndexMap,
        mapSourceRow,
        validateRawRecord,
        normalizeRecord,
        normalizeSingleRecord,
        normalizeFieldValue,
        normalizeUnit,
        normalizeShift,
        createDuplicateKey,
        buildDatasetFields,
        createValidationResult,
        createValidationMessages,
        handleError,
        isInitialized: () => initialized
    });

    Object.defineProperty(PMA, "normalizationEngine", {
        value: api,
        writable: false,
        enumerable: true,
        configurable: false
    });
})(window);
