/* ==========================================================
   Pack Materials Analytics
   src/mapping-engine.js
========================================================== */

(function initializeMappingEngine(global) {
    "use strict";

    const PMA = global.PMA || (global.PMA = {});
    if (!PMA.constants || !PMA.state || !PMA.utils || !PMA.dom) {
        throw new Error("PMA core modules must be loaded before src/mapping-engine.js.");
    }

    const {
        STATUS,
        DATA_TYPES,
        SYSTEM_FIELDS,
        SYSTEM_FIELD_MAP,
        MAPPING_CONFIDENCE,
        NORMALIZATION,
        VALIDATION_CODES,
        VALIDATION_MESSAGES,
        PROCESSING_LIMITS
    } = PMA.constants;
    const {
        cleanText,
        scoreFieldMatch,
        formatInteger,
        parseDate,
        parseNumber,
        toISODate,
        createCompositeKey,
        yieldToBrowser,
        clonePlain,
        normalizeError
    } = PMA.utils;
    const state = PMA.state;
    const dom = PMA.dom;
    const elements = dom.elements;

    const handlers = [];
    let initialized = false;
    let validationToken = 0;
    let lastValidationSignature = "";

    function initialize() {
        if (initialized) return api;
        bind(elements.autoMapButton, "click", handleAutoMap);
        bind(elements.validateMappingButton, "click", handleValidate);
        bind(elements.processDataButton, "click", handleProcessData);
        bind(elements.backToImportButton, "click", () => dom.activateSection("import"));
        bind(elements.mappingFieldsContainer, "change", handleFieldChange);
        initialized = true;
        return api;
    }

    function destroy() {
        handlers.forEach(({ element, eventName, handler }) => element.removeEventListener(eventName, handler));
        handlers.length = 0;
        validationToken += 1;
        lastValidationSignature = "";
        initialized = false;
    }

    function bind(element, eventName, handler) {
        element.addEventListener(eventName, handler);
        handlers.push({ element, eventName, handler });
    }

    function prepareFromImport(options = {}) {
        const headers = state.get("import.headers", []);
        if (!headers.length || !state.get("import.dataRows.length", 0)) {
            throw new Error("Brak przeanalizowanych danych źródłowych.");
        }

        validationToken += 1;
        lastValidationSignature = "";
        state.clearValidationResult();
        dom.unlockSection("mapping");
        dom.setDisabled(elements.autoMapButton, false);
        dom.setDisabled(elements.validateMappingButton, false);
        dom.setDisabled(elements.processDataButton, true);
        renderSourceColumns();

        const profile = options.useSavedProfile !== false && state.getPreference("rememberMapping", true)
            ? state.findMappingProfile(headers)
            : null;

        if (profile) {
            applyMappingProfile(profile);
        } else if (state.getPreference("autoMapColumns", true)) {
            autoMapColumns({ render: false });
        } else {
            state.initializeMapping({});
        }

        renderMappingFields();
        renderSourceColumns();
        resetValidationUI();
        updateMappingStatus();
        PMA.valueNormalizationEngine?.prepareFromMapping?.();
        dom.setWorkflowStage(2);
        return clonePlain(state.get("mapping"));
    }

    function applyMappingProfile(profile) {
        const headers = new Set(state.get("import.headers", []));
        const mapping = {};
        const confidence = {};
        const origins = {};
        SYSTEM_FIELDS.forEach((field) => {
            const sourceColumn = cleanText(profile.mapping?.[field.id]);
            mapping[field.id] = sourceColumn && headers.has(sourceColumn) ? sourceColumn : "";
            if (mapping[field.id]) {
                confidence[field.id] = 1;
                origins[field.id] = "profile";
            }
        });
        state.setMapping(mapping, { confidence, origins, profileId: profile.id });
        dom.showInfo(`Zastosowano zapisany profil „${profile.name}”.`, "Mapowanie");
    }

    function handleAutoMap() {
        try {
            autoMapColumns();
        } catch (error) {
            handleError(error, "Automatyczne mapowanie");
        }
    }

    function autoMapColumns(options = {}) {
        const headers = state.get("import.headers", []);
        const detectedTypes = state.get("import.detectedTypes", {});
        const assignment = calculateAutomaticMapping(headers, detectedTypes);
        state.setMapping(assignment.mapping, {
            confidence: assignment.confidence,
            origins: assignment.origins,
            profileId: null
        });
        invalidateValidation();
        if (options.render !== false) {
            renderMappingFields();
            renderSourceColumns();
            updateMappingStatus();
            PMA.valueNormalizationEngine?.prepareFromMapping?.();
            const count = Object.values(assignment.mapping).filter(Boolean).length;
            dom.showSuccess(`Automatycznie przypisano ${formatInteger(count)} pól.`, "Mapowanie zakończone");
        }
        return assignment;
    }
function calculateAutomaticMapping(headers, detectedTypes) {
    const mapping = Object.fromEntries(SYSTEM_FIELDS.map((field) => [field.id, ""]));
    const confidence = {};
    const origins = {};
    const assignedHeaders = new Set();
    const assignedFields = new Set();

    const candidates = [];
    SYSTEM_FIELDS.forEach((field) => {
        headers.forEach((header) => {
            const score = scoreFieldMatch(header, field, detectedTypes[header]);
            if (score >= MAPPING_CONFIDENCE.autoSelectThreshold) {
                candidates.push({ field, header, score });
            }
        });
    });

    // Global best-match-first assignment instead of per-field-in-array-order greediness:
    // a lower-scoring field earlier in SYSTEM_FIELDS must not steal a column that another
    // field would match exactly (e.g. "Zmiana" must go to "shift", score 1.0, not "unit").
    candidates.sort((left, right) => right.score - left.score);

    candidates.forEach(({ field, header, score }) => {
        if (assignedFields.has(field.id) || assignedHeaders.has(header)) return;
        mapping[field.id] = header;
        confidence[field.id] = score;
        origins[field.id] = "auto";
        assignedFields.add(field.id);
        assignedHeaders.add(header);
    });

    return { mapping, confidence, origins };
}
   

    function renderSourceColumns() {
        const headers = state.get("import.headers", []);
        const detectedTypes = state.get("import.detectedTypes", {});
        const mapping = state.get("mapping.values", {});
        const mapped = new Map();
        Object.entries(mapping).forEach(([fieldId, sourceColumn]) => {
            if (!sourceColumn) return;
            if (!mapped.has(sourceColumn)) mapped.set(sourceColumn, []);
            mapped.get(sourceColumn).push(fieldId);
        });

        dom.clear(elements.sourceColumnsList);
        dom.setText(elements.sourceColumnsCount, formatInteger(headers.length, "0"));
        const fragment = document.createDocumentFragment();
        headers.forEach((header) => {
            const item = dom.createElement("article", { className: "source-column-item", attributes: { title: header } });
            if (mapped.has(header)) item.classList.add("is-mapped");
            item.appendChild(dom.createElement("strong", { text: header }));
            const labels = (mapped.get(header) || []).map((fieldId) => SYSTEM_FIELD_MAP[fieldId]?.label || fieldId);
            item.appendChild(dom.createElement("small", {
                text: [getDataTypeLabel(detectedTypes[header]), ...labels].filter(Boolean).join(" · ")
            }));
            fragment.appendChild(item);
        });
        elements.sourceColumnsList.appendChild(fragment);
    }

    function getDataTypeLabel(type) {
        return ({
            [DATA_TYPES.NUMBER]: "Liczba",
            [DATA_TYPES.DATE]: "Data",
            [DATA_TYPES.BOOLEAN]: "Tak / Nie",
            [DATA_TYPES.MIXED]: "Typ mieszany",
            [DATA_TYPES.EMPTY]: "Brak danych",
            [DATA_TYPES.TEXT]: "Tekst"
        })[type] || "Tekst";
    }

    function renderMappingFields() {
        const headers = state.get("import.headers", []);
        const detectedTypes = state.get("import.detectedTypes", {});
        const mapping = state.get("mapping.values", {});
        const confidence = state.get("mapping.confidence", {});
        const origins = state.get("mapping.origins", {});
        dom.clear(elements.mappingFieldsContainer);
        const fragment = document.createDocumentFragment();

        SYSTEM_FIELDS.forEach((field) => {
            const row = dom.createElement("div", { className: "mapping-field-row", dataset: { fieldId: field.id } });
            const label = dom.createElement("label", {
                className: "mapping-field-label",
                attributes: { for: `mapping-field-${field.id}` }
            });
            const title = dom.createElement("span", { text: field.label });
            if (field.required) title.appendChild(dom.createElement("span", { className: "required-marker", text: " *", attributes: { "aria-hidden": "true" } }));
            label.append(title, dom.createElement("small", { text: field.description || "" }));

            const select = dom.createElement("select", {
                id: `mapping-field-${field.id}`,
                dataset: { mappingField: field.id },
                attributes: { "aria-label": `Kolumna dla pola ${field.label}` }
            });
            select.appendChild(dom.createElement("option", {
                text: field.required ? "— wybierz kolumnę —" : "— nie mapuj —",
                properties: { value: "" }
            }));
            headers.forEach((header) => {
                select.appendChild(dom.createElement("option", {
                    text: `${header} (${getDataTypeLabel(detectedTypes[header])})`,
                    properties: { value: header, selected: mapping[field.id] === header }
                }));
            });
            select.value = mapping[field.id] || "";
            row.append(label, select, createConfidenceBadge(confidence[field.id], origins[field.id], Boolean(mapping[field.id])));
            fragment.appendChild(row);
        });

        elements.mappingFieldsContainer.appendChild(fragment);
        markInvalidRows();
    }

    function createConfidenceBadge(score, origin, mapped) {
        const badge = dom.createElement("span", { className: "mapping-confidence" });
        if (!mapped) {
            badge.textContent = "Brak";
            return badge;
        }
        if (origin === "manual" || origin === "profile") {
            badge.textContent = origin === "manual" ? "Ręcznie" : "Profil";
            badge.classList.add("confidence-high");
            return badge;
        }
        const value = Number.isFinite(score) ? Math.max(0, Math.min(1, score)) : 0;
        badge.textContent = `${Math.round(value * 100)}%`;
        badge.classList.add(value >= MAPPING_CONFIDENCE.highThreshold
            ? "confidence-high"
            : value >= MAPPING_CONFIDENCE.mediumThreshold
                ? "confidence-medium"
                : "confidence-low");
        return badge;
    }

    function handleFieldChange(event) {
        const select = event.target.closest("select[data-mapping-field]");
        if (!select) return;
        try {
            state.setMappingField(select.dataset.mappingField, cleanText(select.value), {
                origin: "manual",
                confidence: select.value ? 1 : null
            });
            invalidateValidation();
            renderMappingFields();
            renderSourceColumns();
            updateMappingStatus();
            PMA.valueNormalizationEngine?.prepareFromMapping?.();
        } catch (error) {
            handleError(error, "Zmiana mapowania");
        }
    }

    function markInvalidRows() {
        const mapping = state.get("mapping");
        const duplicates = new Set(mapping.duplicateSourceColumns);
        const missing = new Set(mapping.missingRequiredFields);
        elements.mappingFieldsContainer.querySelectorAll(".mapping-field-row").forEach((row) => {
            const fieldId = row.dataset.fieldId;
            const sourceColumn = mapping.values[fieldId];
            row.classList.toggle("has-error", missing.has(fieldId) || (sourceColumn && duplicates.has(sourceColumn)));
        });
    }

    function updateMappingStatus() {
        const mapping = state.get("mapping");
        const mappedCount = Object.values(mapping.values).filter(Boolean).length;
        if (mapping.isValid) {
            dom.setStatusBadge(elements.mappingStatusBadge, "Mapowanie kompletne", STATUS.SUCCESS);
            dom.setWorkflowProgress("mapping", `${formatInteger(mappedCount)} pól przypisanych`);
            dom.setDisabled(elements.validateMappingButton, false);
            dom.setDisabled(elements.processDataButton,
                !state.get("validation.completed", false) || state.get("validation.validRows", 0) === 0
            );
            return;
        }
        const conflict = mapping.duplicateSourceColumns.length || mapping.unavailableSourceColumns.length;
        dom.setStatusBadge(elements.mappingStatusBadge, conflict ? "Mapowanie nieprawidłowe" : "Mapowanie niekompletne", conflict ? STATUS.ERROR : STATUS.WARNING);
        dom.setWorkflowProgress("mapping", conflict ? "Usuń konflikty mapowania" : `${formatInteger(mappedCount)} pól przypisanych`);
        dom.setDisabled(elements.processDataButton, true);
    }

    function invalidateValidation() {
        validationToken += 1;
        lastValidationSignature = "";
        const hadProcessedData = state.get("dataset.normalizedRows.length", 0) > 0 || state.get("pivot.ready", false);
        state.clearValidationResult();
        state.clearProcessedData();
        resetValidationUI();
        if (hadProcessedData) {
            dom.lockSection("analysis", "Zmieniono mapowanie lub reguły normalizacji. Sprawdź i przetwórz dane ponownie.");
            dom.setStatusBadge(elements.analysisStatusBadge, "Wymaga ponownego przetworzenia", STATUS.WARNING);
            dom.setWorkflowProgress("analysis", "Dane nieaktualne");
            dom.setExportAvailability({ analysis: false, cleanData: false, errors: false });
        }
    }

    function resetValidationUI() {
        dom.updateValidationSummary({});
        dom.renderValidationMessages([]);
        dom.setDisabled(elements.processDataButton, true);
    }

    async function handleValidate() {
        try {
            if (PMA.valueNormalizationEngine?.hasUnsavedChanges?.()) {
                throw new Error("Dokończ aktywną operację przygotowania danych przed zmianą mapowania.");
            }
            await validateMappedData();
        } catch (error) {
            if (error?.code !== "VALIDATION_CANCELLED") handleError(error, "Kontrola jakości danych");
        }
    }

    async function validateMappedData(options = {}) {
        const token = ++validationToken;
        const mappingResult = state.validateMapping();
        renderMappingFields();
        renderSourceColumns();
        updateMappingStatus();

        if (!mappingResult.isValid) {
            dom.renderValidationMessages(createMappingErrorMessages(mappingResult));
            throw new Error("Mapowanie zawiera brakujące pola lub konflikty.");
        }

        const signature = createValidationSignature();
        if (options.force !== true && signature === lastValidationSignature && state.get("validation.completed", false)) {
            const cached = state.get("validation");
            renderValidationResult(cached);
            return cached;
        }

        const rows = state.get("import.dataRows", []);
        const headers = state.get("import.headers", []);
        const mapping = state.get("mapping.values", {});
        const indexes = buildColumnIndexMap(headers, mapping);
        const invalidRecords = [];
        const duplicateRecords = [];
        const duplicateKeys = new Map();
        const errorsByCode = {};
        const warningsByCode = {};
        let warningRows = 0;

        state.setBusy({ title: "Kontrola jakości danych", message: "Sprawdzanie poprawności wierszy...", progress: 0 });
        dom.setStatusBadge(elements.mappingStatusBadge, "Sprawdzanie danych...", STATUS.PROCESSING);
        dom.setDisabled(elements.validateMappingButton, true);
        dom.setDisabled(elements.processDataButton, true);

        const batchSize = Math.max(250, PROCESSING_LIMITS.batchSize);
        for (let start = 0; start < rows.length; start += batchSize) {
            ensureValidationToken(token);
            const end = Math.min(start + batchSize, rows.length);
            for (let index = start; index < end; index += 1) {
                const record = mapSourceRow(rows[index], indexes);
                const validation = validateRecord(record);
                if (validation.warnings.length) {
                    warningRows += 1;
                    validation.warnings.forEach((code) => increment(errorsByCode, code, warningsByCode));
                }
                const duplicateKey = validation.errors.length ? "" : createDuplicateKey(record, rows[index]);
                let isDuplicate = false;
                if (duplicateKey) {
                    if (duplicateKeys.has(duplicateKey)) {
                        isDuplicate = true;
                        errorsByCode[VALIDATION_CODES.DUPLICATE_RECORD] = (errorsByCode[VALIDATION_CODES.DUPLICATE_RECORD] || 0) + 1;
                        duplicateRecords.push({
                            sourceRow: getSourceRowNumber(index),
                            duplicateOf: duplicateKeys.get(duplicateKey),
                            values: clonePlain(record),
                            sourceValues: Object.fromEntries(headers.map((header, columnIndex) => [header, rows[index][columnIndex]])),
                            errors: [VALIDATION_CODES.DUPLICATE_RECORD],
                            warnings: [...validation.warnings]
                        });
                    } else {
                        duplicateKeys.set(duplicateKey, getSourceRowNumber(index));
                    }
                }
                if (validation.errors.length && !isDuplicate) {
                    validation.errors.forEach((code) => { errorsByCode[code] = (errorsByCode[code] || 0) + 1; });
                    invalidRecords.push({
                        sourceRow: getSourceRowNumber(index),
                        values: clonePlain(record),
                        sourceValues: Object.fromEntries(headers.map((header, columnIndex) => [header, rows[index][columnIndex]])),
                        errors: [...new Set(validation.errors)],
                        warnings: [...new Set(validation.warnings)]
                    });
                }
            }
            state.updateBusy({
                message: `Sprawdzono ${formatInteger(end)} z ${formatInteger(rows.length)} wierszy.`,
                progress: Math.round(end / Math.max(1, rows.length) * 100)
            });
            if (end < rows.length) await yieldToBrowser();
        }

        ensureValidationToken(token);
        const result = {
            completed: true,
            totalRows: rows.length,
            validRows: Math.max(0, rows.length - invalidRecords.length - duplicateRecords.length),
            invalidRows: invalidRecords.length,
            duplicateRows: duplicateRecords.length,
            warningRows,
            errorsByCode,
            warningsByCode,
            invalidRecords,
            duplicateRecords,
            completedAt: new Date().toISOString()
        };
        result.messages = createValidationMessages(result);
        state.setValidationResult(result);
        lastValidationSignature = signature;
        state.clearBusy(result.validRows > 0 ? STATUS.SUCCESS : STATUS.WARNING);
        dom.setDisabled(elements.validateMappingButton, false);
        renderValidationResult(result);
        return result;
    }

    function increment(_errors, code, warnings) {
        warnings[code] = (warnings[code] || 0) + 1;
    }

    function buildColumnIndexMap(headers, mapping) {
        const indexes = {};
        SYSTEM_FIELDS.forEach((field) => {
            indexes[field.id] = mapping[field.id] ? headers.indexOf(mapping[field.id]) : -1;
            if (mapping[field.id] && indexes[field.id] < 0) throw new Error(`Kolumna „${mapping[field.id]}” nie istnieje.`);
        });
        return indexes;
    }

    function mapSourceRow(sourceRow, indexes) {
        return Object.fromEntries(SYSTEM_FIELDS.map((field) => [
            field.id,
            indexes[field.id] >= 0 && Array.isArray(sourceRow) ? sourceRow[indexes[field.id]] : null
        ]));
    }

    // Single source of truth lives in PMA.utils — previously this was a separate,
    // independently-maintained copy of the same logic also found in normalization-engine.js.
    function validateRecord(record) {
        return PMA.utils.validateRecord(record);
    }

    function createDuplicateKey(record, sourceRow = []) {
        return PMA.utils.createDuplicateKey(record, sourceRow);
    }

    function getSourceRowNumber(index) {
        return (state.get("import.headerRowIndex", 0) || 0) + index + 2;
    }

    function createValidationSignature() {
        return JSON.stringify({
            sheet: state.get("import.selectedSheet", ""),
            rowCount: state.get("import.dataRows.length", 0),
            mapping: state.get("mapping.values", {}),
            normalizationRules: state.getNormalizationRules()
        });
    }

    function ensureValidationToken(token) {
        if (token !== validationToken) {
            const error = new Error("Kontrola jakości została anulowana.");
            error.code = "VALIDATION_CANCELLED";
            throw error;
        }
    }

    function renderValidationResult(result) {
        dom.updateValidationSummary(result);
        dom.renderValidationMessages(result.messages || createValidationMessages(result));
        if (result.validRows > 0) {
            const rejectedRows = result.invalidRows + result.duplicateRows;
            dom.setStatusBadge(elements.mappingStatusBadge,
                rejectedRows ? "Dane z ostrzeżeniami" : "Dane poprawne",
                rejectedRows ? STATUS.WARNING : STATUS.SUCCESS
            );
            dom.setWorkflowProgress("mapping", `${formatInteger(result.validRows)} poprawnych wierszy`);
            dom.setDisabled(elements.processDataButton, false);
        } else {
            dom.setStatusBadge(elements.mappingStatusBadge, "Brak poprawnych danych", STATUS.ERROR);
            dom.setWorkflowProgress("mapping", "Popraw dane źródłowe");
            dom.setDisabled(elements.processDataButton, true);
        }
    }

    function createMappingErrorMessages(result) {
        const messages = [];
        if (result.missingRequiredFields.length) messages.push({ status: "error", text: `Brak wymaganych pól: ${result.missingRequiredFields.map((id) => SYSTEM_FIELD_MAP[id]?.label || id).join(", ")}.` });
        if (result.duplicateSourceColumns.length) messages.push({ status: "error", text: `Te same kolumny przypisano więcej niż raz: ${result.duplicateSourceColumns.join(", ")}.` });
        if (result.unavailableSourceColumns.length) messages.push({ status: "error", text: `Nie znaleziono kolumn: ${result.unavailableSourceColumns.join(", ")}.` });
        return messages;
    }

    function createValidationMessages(result) {
        const messages = [];
        if (!result.totalRows) return [{ status: "error", text: "Brak wierszy danych do sprawdzenia." }];
        const rejectedRows = result.invalidRows + result.duplicateRows;
        messages.push({
            status: rejectedRows ? "warning" : "success",
            text: rejectedRows
                ? `${formatInteger(rejectedRows)} z ${formatInteger(result.totalRows)} wierszy zostanie pominiętych: błędne ${formatInteger(result.invalidRows)}, duplikaty ${formatInteger(result.duplicateRows)}.`
                : `Wszystkie ${formatInteger(result.validRows)} wierszy przeszły kontrolę jakości.`
        });
        Object.entries(result.errorsByCode || {}).sort((a, b) => b[1] - a[1]).forEach(([code, count]) => messages.push({ status: "error", text: `${VALIDATION_MESSAGES[code] || code} Liczba wierszy: ${formatInteger(count)}.` }));
        Object.entries(result.warningsByCode || {}).sort((a, b) => b[1] - a[1]).forEach(([code, count]) => messages.push({ status: "warning", text: `${VALIDATION_MESSAGES[code] || code} Liczba wierszy: ${formatInteger(count)}.` }));
        return messages;
    }

    async function handleProcessData() {
        try {
            if (PMA.valueNormalizationEngine?.hasUnsavedChanges?.()) {
                throw new Error("Dokończ aktywną operację przygotowania danych przed zmianą mapowania.");
            }
            let validation = state.get("validation");
            if (!validation.completed || createValidationSignature() !== lastValidationSignature) {
                validation = await validateMappedData({ force: true });
            }
            if (!validation || validation.validRows <= 0) throw new Error("Brak poprawnych wierszy do przetworzenia.");
            if (state.getPreference("rememberMapping", true)) saveCurrentMappingProfile();
            await PMA.normalizationEngine.processDataset();
        } catch (error) {
            if (error?.code !== "VALIDATION_CANCELLED") handleError(error, "Przetwarzanie danych");
        }
    }

    function saveCurrentMappingProfile() {
        if (!state.get("mapping.isValid", false)) return null;
        return state.saveMappingProfile({
            name: `Mapowanie — ${state.get("import.selectedSheet", "arkusz")}`,
            headers: state.get("import.headers", []),
            mapping: state.get("mapping.values", {})
        });
    }

    function handleError(error, context) {
        state.clearBusy(STATUS.ERROR);
        dom.setDisabled(elements.validateMappingButton, false);
        updateMappingStatus();
        dom.showError(normalizeError(error).message, context);
        console.error(`[PMA] ${context}:`, error);
    }

    const api = Object.freeze({
        initialize,
        destroy,
        prepareFromImport,
        autoMapColumns,
        calculateAutomaticMapping,
        applyMappingProfile,
        renderSourceColumns,
        renderMappingFields,
        updateMappingStatus,
        invalidateValidation,
        validateMappedData,
        validateRecord,
        mapSourceRow,
        createDuplicateKey,
        saveCurrentMappingProfile,
        isInitialized: () => initialized
    });

    Object.defineProperty(PMA, "mappingEngine", {
        value: api,
        writable: false,
        enumerable: true,
        configurable: false
    });
})(window);
