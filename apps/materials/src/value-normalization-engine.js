/* ==========================================================
   Pack Materials Analytics
   src/value-normalization-engine.js
========================================================== */

(function initializeValueNormalizationEngine(global) {
    "use strict";

    const PMA = global.PMA || (global.PMA = {});
    if (!PMA.constants || !PMA.state || !PMA.utils || !PMA.dom) {
        throw new Error("PMA core modules must be loaded before src/value-normalization-engine.js.");
    }

    const {
        STATUS,
        EVENTS,
        NORMALIZABLE_FIELDS,
        SYSTEM_FIELD_MAP,
        PROCESSING_LIMITS
    } = PMA.constants;
    const {
        cleanText,
        normalizeComparableText,
        formatInteger,
        createId,
        normalizeError
    } = PMA.utils;
    const state = PMA.state;
    const dom = PMA.dom;
    const elements = dom.elements;

    const handlers = [];
    let initialized = false;
    let currentScan = null;
    let dirty = false;

    const unitAliases = new Map([
        ["szt", "szt."], ["szt.", "szt."], ["pcs", "szt."], ["pc", "szt."],
        ["piece", "szt."], ["pieces", "szt."], ["kg", "kg"], ["kilogram", "kg"],
        ["kilograms", "kg"], ["g", "g"], ["gram", "g"], ["grams", "g"],
        ["m", "m"], ["metr", "m"], ["meter", "m"], ["metre", "m"],
        ["cm", "cm"], ["mm", "mm"], ["l", "l"], ["ltr", "l"], ["liter", "l"],
        ["litre", "l"], ["ml", "ml"], ["rolka", "rolka"], ["roll", "rolka"],
        ["opakowanie", "opak."], ["opak", "opak."], ["opak.", "opak."],
        ["karton", "karton"], ["box", "karton"], ["paleta", "paleta"], ["pallet", "paleta"]
    ]);

    const shiftAliases = new Map([
        ["1", "Zmiana 1"], ["01", "Zmiana 1"], ["zmiana 1", "Zmiana 1"], ["shift 1", "Zmiana 1"],
        ["2", "Zmiana 2"], ["02", "Zmiana 2"], ["zmiana 2", "Zmiana 2"], ["shift 2", "Zmiana 2"],
        ["3", "Zmiana 3"], ["03", "Zmiana 3"], ["zmiana 3", "Zmiana 3"], ["shift 3", "Zmiana 3"],
        ["rano", "Rano"], ["morning", "Rano"], ["popoludnie", "Popołudnie"],
        ["afternoon", "Popołudnie"], ["noc", "Noc"], ["night", "Noc"]
    ]);

    function initialize() {
        if (initialized) return api;
        bind(elements.normalizationFieldSelector, "change", handleFieldChange);
        bind(elements.refreshNormalizationButton, "click", handleRefresh);
        bind(elements.saveNormalizationRulesButton, "click", handleSaveRules);
        bind(elements.clearNormalizationRulesButton, "click", handleClearRules);
        bind(elements.normalizationTableBody, "input", handleTargetInput);
        initialized = true;
        prepareFromMapping();
        return api;
    }

    function destroy() {
        handlers.forEach(({ element, eventName, handler }) => element.removeEventListener(eventName, handler));
        handlers.length = 0;
        currentScan = null;
        dirty = false;
        initialized = false;
    }

    function bind(element, eventName, handler) {
        element.addEventListener(eventName, handler);
        handlers.push({ element, eventName, handler });
    }

    function prepareFromMapping(options = {}) {
        const availableFields = getAvailableFields();
        const previous = state.get("ui.normalizationField", "material");
        const selected = availableFields.some((field) => field.id === previous)
            ? previous
            : availableFields[0]?.id || "";

        dom.populateSelect(elements.normalizationFieldSelector, availableFields.map((field) => ({
            value: field.id,
            label: field.label
        })), selected, { disabled: !availableFields.length });
        state.setNormalizationField(selected || "material");
        dom.setDisabled(elements.refreshNormalizationButton, !availableFields.length);

        if (!availableFields.length) {
            currentScan = null;
            dirty = false;
            renderEmpty("Najpierw przypisz co najmniej jedno pole tekstowe, np. Materiał lub Marka.");
            return null;
        }

        return scanField(selected, { render: options.render !== false });
    }

    function getAvailableFields() {
        const mapping = state.get("mapping.values", {});
        return NORMALIZABLE_FIELDS
            .filter((fieldId) => Boolean(mapping[fieldId]))
            .map((fieldId) => SYSTEM_FIELD_MAP[fieldId])
            .filter(Boolean);
    }

    function handleFieldChange() {
        const fieldId = elements.normalizationFieldSelector.value;
        if (!confirmDiscardUnsavedChanges()) {
            elements.normalizationFieldSelector.value = currentScan?.fieldId || state.get("ui.normalizationField", "material");
            return;
        }
        state.setNormalizationField(fieldId);
        scanField(fieldId, { render: true });
    }

    function handleRefresh() {
        if (!confirmDiscardUnsavedChanges()) return;
        scanSelectedField({ render: true });
    }

    function confirmDiscardUnsavedChanges() {
        if (!dirty) return true;
        return global.confirm("Masz niezapisane zmiany normalizacji. Czy je odrzucić?");
    }

    function scanSelectedField(options = {}) {
        const fieldId = elements.normalizationFieldSelector.value || state.get("ui.normalizationField", "material");
        return scanField(fieldId, options);
    }

    function scanField(fieldId, options = {}) {
        try {
            const mapping = state.get("mapping.values", {});
            const sourceColumn = mapping[fieldId];
            const headers = state.get("import.headers", []);
            const rows = state.get("import.dataRows", []);
            const columnIndex = sourceColumn ? headers.indexOf(sourceColumn) : -1;

            if (!NORMALIZABLE_FIELDS.includes(fieldId) || columnIndex < 0) {
                currentScan = null;
                dirty = false;
                if (options.render !== false) renderEmpty("To pole nie jest obecnie połączone z kolumną źródłową.");
                return null;
            }

            const groups = buildGroups(fieldId, rows, columnIndex);
            const existingRules = state.getNormalizationRules(fieldId);
            const rulesByKey = new Map(existingRules.map((rule) => [rule.sourceKey, rule]));

            groups.forEach((group) => {
                const rule = rulesByKey.get(group.sourceKey) || null;
                group.savedRule = rule;
                group.target = cleanText(rule?.target) || group.automaticTarget;
                group.initialTarget = group.target;
                group.status = determineStatus(group);
                group.affectedRows = countAffectedRows(group, group.target);
            });

            const result = summarizeScan({ fieldId, sourceColumn, groups, existingRules });
            currentScan = result;
            dirty = false;
            if (options.render !== false) renderScan(result);
            return result;
        } catch (error) {
            currentScan = null;
            dirty = false;
            renderEmpty(normalizeError(error).message, "danger");
            return null;
        }
    }

    function buildGroups(fieldId, rows, columnIndex) {
        const map = new Map();
        rows.forEach((row) => {
            const raw = cleanText(Array.isArray(row) ? row[columnIndex] : null);
            if (!raw) return;
            const sourceKey = normalizeComparableText(raw);
            if (!sourceKey) return;
            if (!map.has(sourceKey)) {
                map.set(sourceKey, {
                    fieldId,
                    sourceKey,
                    totalCount: 0,
                    variants: new Map(),
                    automaticTarget: "",
                    target: "",
                    initialTarget: "",
                    savedRule: null,
                    status: "unchanged",
                    affectedRows: 0
                });
            }
            const group = map.get(sourceKey);
            group.totalCount += 1;
            group.variants.set(raw, (group.variants.get(raw) || 0) + 1);
        });

        return [...map.values()]
            .map((group) => {
                group.variantList = [...group.variants.entries()]
                    .map(([value, count]) => ({ value, count }))
                    .sort(compareVariants);
                group.automaticTarget = determineAutomaticTarget(fieldId, group.sourceKey, group.variantList);
                return group;
            })
            .sort((left, right) => right.totalCount - left.totalCount || left.automaticTarget.localeCompare(right.automaticTarget, "pl"));
    }

    function compareVariants(left, right) {
        const countDifference = right.count - left.count;
        if (countDifference) return countDifference;
        const symbolDifference = countPreferredSymbols(right.value) - countPreferredSymbols(left.value);
        if (symbolDifference) return symbolDifference;
        const lengthDifference = left.value.length - right.value.length;
        if (lengthDifference) return lengthDifference;
        const uppercaseDifference = countUppercaseLetters(right.value) - countUppercaseLetters(left.value);
        if (uppercaseDifference) return uppercaseDifference;
        return left.value.localeCompare(right.value, "pl");
    }

    function countPreferredSymbols(value) {
        return [...String(value || "")].filter((character) => /[&+@]/.test(character)).length;
    }

    function countUppercaseLetters(value) {
        return [...String(value || "")].filter((character) => /[A-ZĄĆĘŁŃÓŚŹŻ]/.test(character)).length;
    }

    function determineAutomaticTarget(fieldId, sourceKey, variants) {
        const builtIn = getBuiltInTarget(fieldId, sourceKey);
        if (builtIn) return builtIn;
        return cleanText(variants[0]?.value) || "";
    }

    function getBuiltInTarget(fieldId, sourceKey) {
        if (fieldId === "unit") return unitAliases.get(sourceKey) || "";
        if (fieldId === "shift") return shiftAliases.get(sourceKey) || "";
        return "";
    }

    function determineStatus(group) {
        if (group.savedRule && cleanText(group.savedRule.target) !== group.automaticTarget) return "rule";
        const automaticChange = group.variantList.length > 1 || group.variantList.some((item) => item.value !== group.automaticTarget);
        return automaticChange ? "automatic" : "unchanged";
    }

    function countAffectedRows(group, target) {
        const normalizedTarget = cleanText(target);
        return group.variantList.reduce((sum, item) => sum + (item.value === normalizedTarget ? 0 : item.count), 0);
    }

    function summarizeScan(payload) {
        const targetKeys = new Set(payload.groups.map((group) => normalizeComparableText(group.target)).filter(Boolean));
        return {
            fieldId: payload.fieldId,
            fieldLabel: SYSTEM_FIELD_MAP[payload.fieldId]?.label || payload.fieldId,
            sourceColumn: payload.sourceColumn,
            groups: payload.groups,
            groupMap: new Map(payload.groups.map((group) => [group.sourceKey, group])),
            sourceVariants: payload.groups.reduce((sum, group) => sum + group.variantList.length, 0),
            targetValues: targetKeys.size,
            activeRules: payload.existingRules.length,
            affectedRows: payload.groups.reduce((sum, group) => sum + group.affectedRows, 0),
            automaticGroups: payload.groups.filter((group) => group.status === "automatic").length,
            ruleGroups: payload.groups.filter((group) => group.status === "rule").length,
            scannedAt: new Date().toISOString()
        };
    }

    function renderScan(scan) {
        dom.setText(elements.normalizationSourceVariants, formatInteger(scan.sourceVariants));
        dom.setText(elements.normalizationTargetValues, formatInteger(scan.targetValues));
        dom.setText(elements.normalizationActiveRules, formatInteger(scan.activeRules));
        dom.setText(elements.normalizationAffectedRows, formatInteger(scan.affectedRows));
        dom.setStatusBadge(elements.normalizationStatusBadge,
            scan.activeRules ? `${formatInteger(scan.activeRules)} reguł` : "Sprawdzone",
            scan.activeRules || scan.automaticGroups ? STATUS.SUCCESS : STATUS.INFO
        );
        dom.setDisabled(elements.saveNormalizationRulesButton, true);
        dom.setDisabled(elements.clearNormalizationRulesButton, scan.activeRules === 0);

        const limit = Math.max(20, Number(PROCESSING_LIMITS.maximumRenderedNormalizationGroups) || 300);
        const visibleGroups = scan.groups.slice(0, limit);
        dom.clear(elements.normalizationTableBody);
        const fragment = document.createDocumentFragment();
        visibleGroups.forEach((group) => fragment.appendChild(createGroupRow(group)));
        if (!visibleGroups.length) {
            dom.renderEmptyTableRow(elements.normalizationTableBody, 4, "Brak niepustych wartości w wybranej kolumnie.");
        } else {
            elements.normalizationTableBody.appendChild(fragment);
        }

        renderSuggestions(scan);
        const hiddenCount = Math.max(0, scan.groups.length - visibleGroups.length);
        const messages = [
            `Znaleziono ${formatInteger(scan.sourceVariants)} wariantów, które po normalizacji tworzą ${formatInteger(scan.targetValues)} wartości.`
        ];
        if (scan.automaticGroups) messages.push(`${formatInteger(scan.automaticGroups)} grup połączono automatycznie na podstawie zapisu technicznego.`);
        if (scan.ruleGroups) messages.push(`${formatInteger(scan.ruleGroups)} grup korzysta z zapisanych reguł użytkownika.`);
        if (hiddenCount) messages.push(`Tabela pokazuje pierwsze ${formatInteger(limit)} grup; pominięto ${formatInteger(hiddenCount)} najmniej częstych.`);
        dom.setText(elements.normalizationNotice, messages.join(" "));
        elements.normalizationNotice.className = "normalization-notice";
    }

    function createGroupRow(group) {
        const row = dom.createElement("tr", {
            dataset: {
                normalizationKey: group.sourceKey,
                automaticTarget: group.automaticTarget
            }
        });

        const sourceCell = dom.createElement("td", { className: "normalization-source-cell" });
        const variantsText = group.variantList.slice(0, 4).map((item) => `${item.value} (${formatInteger(item.count)})`).join(" · ");
        sourceCell.appendChild(dom.createElement("strong", { text: variantsText || "—" }));
        if (group.variantList.length > 4) {
            sourceCell.appendChild(dom.createElement("small", { text: `+ ${formatInteger(group.variantList.length - 4)} kolejnych wariantów` }));
        }

        const countCell = dom.createElement("td", { className: "is-number", text: formatInteger(group.totalCount) });
        const targetCell = dom.createElement("td");
        const input = dom.createElement("input", {
            properties: { value: group.target },
            attributes: {
                type: "text",
                list: "normalizationTargetSuggestions",
                "aria-label": `Wartość docelowa dla ${group.variantList[0]?.value || group.sourceKey}`
            },
            dataset: { normalizationTarget: group.sourceKey }
        });
        targetCell.appendChild(input);

        const statusCell = dom.createElement("td");
        statusCell.appendChild(createStatusBadge(group.status));
        row.append(sourceCell, countCell, targetCell, statusCell);
        return row;
    }

    function createStatusBadge(status) {
        const configuration = {
            rule: ["Reguła użytkownika", "normalization-state-rule"],
            automatic: ["Automatycznie", "normalization-state-auto"],
            pending: ["Do zapisania", "normalization-state-pending"],
            unchanged: ["Bez zmian", "normalization-state-neutral"]
        }[status] || ["Bez zmian", "normalization-state-neutral"];
        return dom.createElement("span", { className: `normalization-state ${configuration[1]}`, text: configuration[0] });
    }

    function renderSuggestions(scan) {
        dom.clear(elements.normalizationTargetSuggestions);
        const values = [...new Set(scan.groups.map((group) => group.target).filter(Boolean))]
            .sort((left, right) => left.localeCompare(right, "pl"));
        const fragment = document.createDocumentFragment();
        values.slice(0, 1000).forEach((value) => fragment.appendChild(dom.createElement("option", { properties: { value } })));
        elements.normalizationTargetSuggestions.appendChild(fragment);
    }

    function renderEmpty(message, status = "neutral") {
        dom.setText(elements.normalizationSourceVariants, "0");
        dom.setText(elements.normalizationTargetValues, "0");
        dom.setText(elements.normalizationActiveRules, "0");
        dom.setText(elements.normalizationAffectedRows, "0");
        dom.clear(elements.normalizationTableBody);
        dom.renderEmptyTableRow(elements.normalizationTableBody, 4, message || "Brak danych do normalizacji.");
        dom.setText(elements.normalizationNotice, message || "Brak danych do normalizacji.");
        elements.normalizationNotice.className = status === "danger" ? "normalization-notice is-error" : "normalization-notice";
        dom.setStatusBadge(elements.normalizationStatusBadge, status === "danger" ? "Błąd" : "Niedostępne", status);
        dom.setDisabled(elements.saveNormalizationRulesButton, true);
        dom.setDisabled(elements.clearNormalizationRulesButton, true);
    }

    function handleTargetInput(event) {
        const input = event.target.closest("input[data-normalization-target]");
        if (!input || !currentScan) return;
        const group = currentScan.groupMap.get(input.dataset.normalizationTarget);
        if (!group) return;
        group.target = cleanText(input.value);
        group.affectedRows = countAffectedRows(group, group.target || group.automaticTarget);
        dirty = currentScan.groups.some((item) => cleanText(item.target) !== cleanText(item.initialTarget));
        updateDraftSummary();
        dom.setDisabled(elements.saveNormalizationRulesButton, !dirty);
        const row = input.closest("tr");
        const statusCell = row?.lastElementChild;
        if (statusCell) statusCell.replaceChildren(createStatusBadge(cleanText(group.target) !== cleanText(group.initialTarget) ? "pending" : group.status));
        dom.setStatusBadge(elements.normalizationStatusBadge, dirty ? "Niezapisane zmiany" : "Sprawdzone", dirty ? STATUS.WARNING : STATUS.SUCCESS);
    }


    function updateDraftSummary() {
        if (!currentScan) return;
        const targetKeys = new Set(
            currentScan.groups
                .map((group) => normalizeComparableText(cleanText(group.target)))
                .filter(Boolean)
        );
        const affectedRows = currentScan.groups.reduce((sum, group) => {
            const target = cleanText(group.target) || group.automaticTarget;
            group.affectedRows = countAffectedRows(group, target);
            return sum + group.affectedRows;
        }, 0);
        dom.setText(elements.normalizationTargetValues, formatInteger(targetKeys.size));
        dom.setText(elements.normalizationAffectedRows, formatInteger(affectedRows));
    }

    function handleSaveRules() {
        if (!currentScan) return;
        try {
            const fieldId = currentScan.fieldId;
            const existingOutsideDataset = state.getNormalizationRules(fieldId)
                .filter((rule) => !currentScan.groupMap.has(rule.sourceKey));
            const now = new Date().toISOString();
            const rules = [...existingOutsideDataset];

            currentScan.groups.forEach((group) => {
                const target = cleanText(group.target);
                if (!target) {
                    throw new Error(`Wartość docelowa dla „${group.variantList[0]?.value || group.sourceKey}” nie może być pusta.`);
                }
                if (target !== cleanText(group.automaticTarget)) {
                    rules.push({
                        id: group.savedRule?.id || createId("normalization-rule"),
                        fieldId,
                        sourceKey: group.sourceKey,
                        sourceExample: group.variantList[0]?.value || "",
                        target,
                        updatedAt: now
                    });
                }
            });

            state.replaceNormalizationRules(fieldId, rules);
            invalidateProcessedResults();
            const savedCount = state.getNormalizationRules(fieldId).length;
            dom.showSuccess(`Zapisano ${formatInteger(savedCount)} reguł dla pola „${currentScan.fieldLabel}”.`, "Normalizacja wartości");
            scanField(fieldId, { render: true });
        } catch (error) {
            dom.showError(normalizeError(error).message, "Zapisywanie reguł");
        }
    }

    function handleClearRules() {
        if (!currentScan) return;
        const fieldLabel = currentScan.fieldLabel;
        if (!global.confirm(`Usunąć wszystkie własne reguły normalizacji dla pola „${fieldLabel}”?`)) return;
        state.clearNormalizationRules(currentScan.fieldId);
        invalidateProcessedResults();
        dom.showInfo(`Usunięto własne reguły dla pola „${fieldLabel}”.`, "Normalizacja wartości");
        scanField(currentScan.fieldId, { render: true });
    }

    function invalidateProcessedResults() {
        PMA.mappingEngine?.invalidateValidation?.();
        if (!PMA.mappingEngine?.invalidateValidation) {
            state.clearValidationResult();
            state.clearProcessedData();
            dom.lockSection("analysis", "Zmieniono reguły normalizacji. Sprawdź i przetwórz dane ponownie.");
        }
    }

    function createResolver(rows = state.get("import.dataRows", []), headers = state.get("import.headers", []), mapping = state.get("mapping.values", {})) {
        const resolver = new Map();
        NORMALIZABLE_FIELDS.forEach((fieldId) => {
            const sourceColumn = mapping[fieldId];
            const columnIndex = sourceColumn ? headers.indexOf(sourceColumn) : -1;
            if (columnIndex < 0) return;
            const groups = buildGroups(fieldId, rows, columnIndex);
            const rulesByKey = new Map(state.getNormalizationRules(fieldId).map((rule) => [rule.sourceKey, rule.target]));
            const fieldMap = new Map();
            groups.forEach((group) => {
                fieldMap.set(group.sourceKey, cleanText(rulesByKey.get(group.sourceKey)) || group.automaticTarget);
            });
            resolver.set(fieldId, fieldMap);
        });
        return resolver;
    }

    function resolveValue(fieldId, value, resolver = null) {
        const text = cleanText(value);
        if (!text) return null;
        const sourceKey = normalizeComparableText(text);
        const resolved = resolver?.get(fieldId)?.get(sourceKey);
        if (resolved) return resolved;
        const saved = state.getNormalizationRules(fieldId).find((rule) => rule.sourceKey === sourceKey)?.target;
        return cleanText(saved) || getBuiltInTarget(fieldId, sourceKey) || text;
    }

    function getRuleAudit(fieldId, value, resolver = null) {
        const original = cleanText(value);
        const normalized = resolveValue(fieldId, value, resolver);
        return {
            original,
            normalized,
            changed: Boolean(original && normalized && original !== normalized)
        };
    }

    const api = Object.freeze({
        initialize,
        destroy,
        prepareFromMapping,
        scanField,
        scanSelectedField,
        createResolver,
        resolveValue,
        getRuleAudit,
        getBuiltInTarget,
        hasUnsavedChanges: () => dirty,
        isInitialized: () => initialized
    });

    Object.defineProperty(PMA, "valueNormalizationEngine", {
        value: api,
        writable: false,
        enumerable: true,
        configurable: false
    });
})(window);
