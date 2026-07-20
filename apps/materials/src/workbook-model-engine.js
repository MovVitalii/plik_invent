/* ==========================================================
   Materials Analytics
   src/workbook-model-engine.js
   Multi-sheet workbook data model: usage, stock, receipts,
   open orders and material master data.
========================================================== */
(function initializeWorkbookModelEngine(global) {
    "use strict";

    const PMA = global.PMA || (global.PMA = {});
    if (!PMA.constants || !PMA.state || !PMA.utils || !PMA.dom) {
        throw new Error("PMA core modules must be loaded before workbook-model-engine.js.");
    }

    const { DATA_TYPES, SYSTEM_FIELDS, SYSTEM_FIELD_MAP, STATUS } = PMA.constants;
    const {
        cleanText,
        normalizeComparableText,
        parseNumber,
        parseDate,
        toISODate,
        detectColumnTypes,
        isBlank,
        formatInteger,
        createId,
        normalizeError
    } = PMA.utils;
    const state = PMA.state;
    const dom = PMA.dom;

    const ROLE_LABELS = Object.freeze({
        ignore: "Ignoruj",
        usage: "Zużycie",
        stock: "Zapasy",
        receipts: "Przyjęcia",
        orders: "Otwarte zamówienia",
        master: "Kartoteka materiałów"
    });

    const IDENTITY_FIELDS = Object.freeze(["materialCode", "sku", "material"]);

    const ROLE_FIELDS = Object.freeze({
        usage: Object.freeze([
            field("date", "Data", DATA_TYPES.DATE, true, ["data", "date", "usage date", "data zużycia", "dzień"]),
            field("material", "Materiał", DATA_TYPES.TEXT, false, ["materiał", "material", "material name", "nazwa materiału", "item", "article"]),
            field("quantity", "Zużycie", DATA_TYPES.NUMBER, true, ["zużycie", "zuzycie", "usage", "consumption", "ilość", "ilosc", "quantity", "qty used"]),
            field("unit", "Jednostka", DATA_TYPES.TEXT, false, ["jednostka", "unit", "uom", "unit of measure"]),
            field("materialCode", "Kod materiału", DATA_TYPES.TEXT, false, ["kod materiału", "material code", "article", "article code", "item code"]),
            field("sku", "SKU", DATA_TYPES.TEXT, false, ["sku", "stock keeping unit"]),
            field("brand", "Marka", DATA_TYPES.TEXT, false, ["marka", "brand"]),
            field("category", "Kategoria", DATA_TYPES.TEXT, false, ["kategoria", "category", "group"]),
            field("line", "Linia / stanowisko", DATA_TYPES.TEXT, false, ["linia", "line", "station", "stanowisko"])
        ]),
        stock: Object.freeze([
            field("material", "Materiał", DATA_TYPES.TEXT, false, ["materiał", "material", "material name", "nazwa materiału", "item", "article"]),
            field("stockLevel", "Stan zapasu", DATA_TYPES.NUMBER, true, ["stan zapasu", "stan magazynowy", "zapas", "stock", "stock level", "on hand", "inventory", "balance", "saldo"]),
            field("date", "Data stanu", DATA_TYPES.DATE, false, ["data stanu", "data snapshotu", "snapshot date", "stock date", "data", "date"]),
            field("unit", "Jednostka", DATA_TYPES.TEXT, false, ["jednostka", "unit", "uom"]),
            field("materialCode", "Kod materiału", DATA_TYPES.TEXT, false, ["kod materiału", "material code", "article", "article code", "item code"]),
            field("sku", "SKU", DATA_TYPES.TEXT, false, ["sku"]),
            field("leadTimeDays", "Lead time (dni)", DATA_TYPES.NUMBER, false, ["lead time", "lead time days", "czas dostawy"]),
            field("minimumOrderQuantity", "MOQ", DATA_TYPES.NUMBER, false, ["moq", "minimum order quantity", "minimalna ilość"]),
            field("orderMultiple", "Krotność zamówienia", DATA_TYPES.NUMBER, false, ["order multiple", "krotność", "krotnosc", "pack multiple"]),
            field("safetyStock", "Safety stock", DATA_TYPES.NUMBER, false, ["safety stock", "zapas bezpieczeństwa", "zapas bezpieczenstwa"]),
            field("openOrders", "Otwarte zamówienia", DATA_TYPES.NUMBER, false, ["open orders", "otwarte zamówienia", "w drodze", "on order"]),
            field("supplier", "Dostawca", DATA_TYPES.TEXT, false, ["dostawca", "supplier", "vendor"])
        ]),
        receipts: Object.freeze([
            field("material", "Materiał", DATA_TYPES.TEXT, false, ["materiał", "material", "material name", "article", "item"]),
            field("quantity", "Ilość przyjęta", DATA_TYPES.NUMBER, true, ["ilość przyjęta", "przyjęcie", "receipt quantity", "received quantity", "qty received", "ilość", "quantity", "qty"]),
            field("date", "Data przyjęcia", DATA_TYPES.DATE, true, ["data przyjęcia", "receipt date", "delivery date", "data dostawy", "data", "date"]),
            field("unit", "Jednostka", DATA_TYPES.TEXT, false, ["jednostka", "unit", "uom"]),
            field("materialCode", "Kod materiału", DATA_TYPES.TEXT, false, ["kod materiału", "material code", "article", "item code"]),
            field("sku", "SKU", DATA_TYPES.TEXT, false, ["sku"]),
            field("supplier", "Dostawca", DATA_TYPES.TEXT, false, ["dostawca", "supplier", "vendor"]),
            field("order", "Zamówienie", DATA_TYPES.TEXT, false, ["zamówienie", "order", "order number", "ord/req number"])
        ]),
        orders: Object.freeze([
            field("material", "Materiał", DATA_TYPES.TEXT, false, ["materiał", "material", "material name", "article", "item"]),
            field("openOrders", "Ilość otwarta", DATA_TYPES.NUMBER, true, ["otwarte zamówienia", "open orders", "open quantity", "remaining quantity", "pozostała ilość", "qty ordered", "quantity ordered"]),
            field("date", "Data planowana", DATA_TYPES.DATE, false, ["planowana data", "expected date", "on site date", "delivery date", "data", "date"]),
            field("unit", "Jednostka", DATA_TYPES.TEXT, false, ["jednostka", "unit", "uom"]),
            field("materialCode", "Kod materiału", DATA_TYPES.TEXT, false, ["kod materiału", "material code", "article", "item code"]),
            field("sku", "SKU", DATA_TYPES.TEXT, false, ["sku"]),
            field("supplier", "Dostawca", DATA_TYPES.TEXT, false, ["dostawca", "supplier", "vendor"]),
            field("leadTimeDays", "Lead time (dni)", DATA_TYPES.NUMBER, false, ["lead time", "lead time days", "czas dostawy"]),
            field("minimumOrderQuantity", "MOQ", DATA_TYPES.NUMBER, false, ["moq", "minimum order quantity"]),
            field("orderMultiple", "Krotność zamówienia", DATA_TYPES.NUMBER, false, ["order multiple", "krotność", "krotnosc"]),
            field("safetyStock", "Safety stock", DATA_TYPES.NUMBER, false, ["safety stock", "zapas bezpieczeństwa"])
        ]),
        master: Object.freeze([
            field("material", "Materiał", DATA_TYPES.TEXT, false, ["materiał", "material", "material name", "article", "item"]),
            field("materialCode", "Kod materiału", DATA_TYPES.TEXT, false, ["kod materiału", "material code", "article", "item code"]),
            field("sku", "SKU", DATA_TYPES.TEXT, false, ["sku"]),
            field("unit", "Jednostka", DATA_TYPES.TEXT, false, ["jednostka", "unit", "uom"]),
            field("supplier", "Dostawca", DATA_TYPES.TEXT, false, ["dostawca", "supplier", "vendor"]),
            field("leadTimeDays", "Lead time (dni)", DATA_TYPES.NUMBER, false, ["lead time", "lead time days", "czas dostawy"]),
            field("minimumOrderQuantity", "MOQ", DATA_TYPES.NUMBER, false, ["moq", "minimum order quantity"]),
            field("orderMultiple", "Krotność zamówienia", DATA_TYPES.NUMBER, false, ["order multiple", "krotność", "krotnosc"]),
            field("safetyStock", "Safety stock", DATA_TYPES.NUMBER, false, ["safety stock", "zapas bezpieczeństwa"]),
            field("category", "Kategoria", DATA_TYPES.TEXT, false, ["kategoria", "category", "group"])
        ])
    });

    const handlers = [];
    let initialized = false;
    let sheetCache = new Map();

    function field(id, label, type, required, aliases) {
        return Object.freeze({ id, label, type, required, aliases: Object.freeze(aliases) });
    }

    function el(id) { return document.getElementById(id); }
    function bind(target, eventName, handler) {
        if (!target) return;
        target.addEventListener(eventName, handler);
        handlers.push({ target, eventName, handler });
    }

    function initialize() {
        if (initialized) return api;
        bind(el("workbookModelBody"), "change", handleModelTableChange);
        bind(el("workbookModelMappings"), "change", handleMappingChange);
        bind(el("workbookModelJoinStrategy"), "change", handleJoinStrategyChange);
        bind(el("buildWorkbookModelButton"), "click", () => buildDataModel().catch((error) => handleError(error, "Model danych skoroszytu")));
        bind(el("resetWorkbookModelButton"), "click", () => prepareFromWorkbook({ force: true }));
        initialized = true;
        render();
        return api;
    }

    function destroy() {
        handlers.splice(0).forEach(({ target, eventName, handler }) => target.removeEventListener(eventName, handler));
        sheetCache.clear();
        initialized = false;
    }

    function prepareFromWorkbook(options = {}) {
        const workbook = state.get("import.workbook");
        const sheetNames = state.get("import.sheetNames", []).filter((name) => name !== "Model danych — Zużycie");
        const panel = el("workbookModelPanel");
        if (!workbook || !sheetNames.length || !panel) {
            if (panel) panel.hidden = true;
            return null;
        }

        sheetCache = new Map();
        const intelligence = state.get("import.workbookIntelligence");
        const existing = !options.force ? state.get("import.dataModel.roles", []) : [];
        const existingBySheet = new Map(existing.map((item) => [item.sheetName, item]));
        const analyses = sheetNames.map((sheetName) => analyzeSheetDetached(sheetName));
        const automaticRoles = assignAutomaticRoles(analyses, intelligence);
        const roles = analyses.map((analysis) => {
            const previous = existingBySheet.get(analysis.sheetName);
            const role = previous?.role || automaticRoles.get(analysis.sheetName) || "ignore";
            const mapping = previous?.mapping && Object.keys(previous.mapping).length
                ? sanitizeMapping(previous.mapping, analysis.headers)
                : autoMapRole(role, analysis.headers, analysis.detectedTypes);
            return {
                sheetName: analysis.sheetName,
                role,
                headerRowIndex: Number.isInteger(previous?.headerRowIndex) ? previous.headerRowIndex : analysis.headerRowIndex,
                mapping,
                stockMode: previous?.stockMode || "snapshot",
                rowCount: analysis.dataRows.length,
                columnCount: analysis.headers.length,
                headers: analysis.headers,
                detectedTypes: analysis.detectedTypes
            };
        });

        const model = state.setWorkbookDataModel({
            ...state.get("import.dataModel", {}),
            enabled: true,
            status: "configured",
            joinStrategy: state.get("import.dataModel.joinStrategy", "auto") || "auto",
            roles,
            audit: null
        });
        panel.hidden = false;
        render(model);
        return model;
    }

    function analyzeSheetDetached(sheetName, configuredHeaderRowIndex = null) {
        const cacheKey = `${sheetName}:${configuredHeaderRowIndex ?? "auto"}`;
        if (sheetCache.has(cacheKey)) return sheetCache.get(cacheKey);
        const workbook = state.get("import.workbook");
        const worksheet = workbook?.Sheets?.[sheetName];
        if (!worksheet) throw new Error(`Arkusz „${sheetName}” nie istnieje.`);
        const range = PMA.importEngine.inspectWorksheetRange(worksheet);
        const rawRows = PMA.importEngine.worksheetToRows(worksheet, range);
        if (!rawRows.length) {
            const empty = { sheetName, rawRows: [], headers: [], dataRows: [], detectedTypes: {}, headerRowIndex: 0, sourceRowNumbers: [], rowCount: 0, columnCount: 0 };
            sheetCache.set(cacheKey, empty);
            return empty;
        }
        const headerRowIndex = Number.isInteger(configuredHeaderRowIndex)
            ? configuredHeaderRowIndex
            : PMA.importEngine.detectHeaderRow(rawRows);
        const analysis = PMA.importEngine.buildSheetAnalysis(rawRows, headerRowIndex, range);
        const detectedTypes = detectColumnTypes(analysis.dataRows, analysis.headers, { sampleSize: 1000 });
        const result = { sheetName, rawRows, ...analysis, detectedTypes, headerRowIndex, rowCount: analysis.dataRows.length, columnCount: analysis.headers.length };
        sheetCache.set(cacheKey, result);
        return result;
    }

    function assignAutomaticRoles(analyses, intelligence) {
        const roles = new Map();
        const intelligenceByName = new Map((intelligence?.sheets || []).map((sheet) => [sheet.name, sheet]));
        const scoreRows = analyses.map((analysis) => ({ analysis, scores: scoreRoleCandidates(analysis) }));
        const eligible = ({ analysis }) => {
            const classified = intelligenceByName.get(analysis.sheetName);
            return !classified || !["archive", "summary", "empty"].includes(classified.type);
        };
        const choosePrimary = (role, predicate = () => true) => {
            const candidate = scoreRows
                .filter((item) => eligible(item) && !roles.has(item.analysis.sheetName) && predicate(item.analysis))
                .sort((left, right) => right.scores[role] - left.scores[role])[0];
            if (candidate && candidate.scores[role] >= roleThreshold(role)) roles.set(candidate.analysis.sheetName, role);
        };

        const recommended = intelligence?.recommendedSheet;
        if (recommended) {
            const rec = scoreRows.find(({ analysis }) => analysis.sheetName === recommended);
            if (rec && eligible(rec) && rec.scores.usage >= 4) roles.set(recommended, "usage");
        }
        choosePrimary("usage");
        choosePrimary("stock");
        choosePrimary("receipts", (analysis) => /przyj|receipt|received|dostaw|inbound/i.test(analysis.sheetName));
        choosePrimary("orders", (analysis) => /zam[oó]w|order|planowan|procurement/i.test(analysis.sheetName));
        choosePrimary("master", (analysis) => /kartotek|master|słownik|slownik|indeks|material/i.test(analysis.sheetName));

        // Monthly/departmental sheets with the same structure should be assigned
        // to the same role automatically. A clear score margin prevents a generic
        // table from being guessed as a business role.
        scoreRows.filter(eligible).forEach((item) => {
            if (roles.has(item.analysis.sheetName)) return;
            const ranked = Object.entries(item.scores).sort((left, right) => right[1] - left[1]);
            const [bestRole, bestScore] = ranked[0] || [];
            const secondScore = ranked[1]?.[1] || 0;
            if (bestRole && bestScore >= roleThreshold(bestRole) && bestScore - secondScore >= 1.5) {
                roles.set(item.analysis.sheetName, bestRole);
            }
        });
        return roles;
    }

    function roleThreshold(role) {
        return { usage: 6, stock: 5, receipts: 6, orders: 5, master: 4 }[role] || 99;
    }

    function scoreRoleCandidates(analysis) {
        const mappings = {};
        Object.keys(ROLE_FIELDS).forEach((role) => mappings[role] = autoMapRole(role, analysis.headers, analysis.detectedTypes));
        const has = (role, id) => Boolean(mappings[role]?.[id]);
        const name = normalizeComparableText(analysis.sheetName);
        const hasIdentity = (role) => IDENTITY_FIELDS.some((id) => has(role, id));
        return {
            usage: (has("usage", "date") ? 2 : 0) + (hasIdentity("usage") ? 2 : 0) + (has("usage", "quantity") ? 3 : 0) + (/zuzy|usage|consum|wykorzyst/i.test(name) ? 2 : 0),
            stock: (hasIdentity("stock") ? 2 : 0) + (has("stock", "stockLevel") ? 4 : 0) + (/zapas|stock|inventory|stan/i.test(name) ? 2 : 0),
            receipts: (hasIdentity("receipts") ? 2 : 0) + (has("receipts", "quantity") ? 2 : 0) + (has("receipts", "date") ? 2 : 0) + (/przyj|receipt|received|dostaw|inbound/i.test(name) ? 2 : 0),
            orders: (hasIdentity("orders") ? 2 : 0) + (has("orders", "openOrders") ? 3 : 0) + (/zamow|order|planowan|procurement/i.test(name) ? 2 : 0),
            master: (hasIdentity("master") ? 2 : 0) + (["materialCode", "sku", "unit", "supplier", "leadTimeDays"].filter((id) => has("master", id)).length) + (/kartotek|master|slownik|indeks/i.test(name) ? 2 : 0)
        };
    }

    function autoMapRole(role, headers, detectedTypes = {}) {
        const fields = ROLE_FIELDS[role] || [];
        const candidates = [];
        fields.forEach((definition) => {
            headers.forEach((header) => {
                const score = scoreHeader(header, definition, detectedTypes[header]);
                if (score > 0) candidates.push({ fieldId: definition.id, header, score });
            });
        });
        candidates.sort((left, right) => right.score - left.score);
        const mapping = {};
        const assignedFields = new Set();
        const assignedHeaders = new Set();
        candidates.forEach((candidate) => {
            if (assignedFields.has(candidate.fieldId) || assignedHeaders.has(candidate.header)) return;
            if (candidate.score < 0.55) return;
            mapping[candidate.fieldId] = candidate.header;
            assignedFields.add(candidate.fieldId);
            assignedHeaders.add(candidate.header);
        });
        return mapping;
    }

    function scoreHeader(header, definition, detectedType) {
        const normalized = normalizeComparableText(header);
        if (!normalized) return 0;
        let best = 0;
        definition.aliases.forEach((alias) => {
            const target = normalizeComparableText(alias);
            if (normalized === target) best = Math.max(best, 1);
            else if (normalized.includes(target) || target.includes(normalized)) best = Math.max(best, 0.8);
            else {
                const left = new Set(normalized.split(/\s+/));
                const right = new Set(target.split(/\s+/));
                const overlap = [...left].filter((token) => right.has(token)).length;
                if (overlap) best = Math.max(best, 0.45 + 0.12 * overlap);
            }
        });
        if (definition.type === detectedType) best += 0.08;
        return Math.min(1, best);
    }

    function sanitizeMapping(mapping, headers) {
        const allowed = new Set(headers);
        return Object.fromEntries(Object.entries(mapping || {}).filter(([, header]) => allowed.has(header)));
    }

    function render(model = state.get("import.dataModel")) {
        const panel = el("workbookModelPanel");
        const body = el("workbookModelBody");
        const mappings = el("workbookModelMappings");
        if (!panel || !body || !mappings) return;
        const roles = model?.roles || [];
        panel.hidden = !roles.length;
        if (!roles.length) {
            body.replaceChildren();
            mappings.replaceChildren();
            return;
        }
        if (el("workbookModelJoinStrategy")) el("workbookModelJoinStrategy").value = model.joinStrategy || "auto";
        body.replaceChildren(...roles.map(renderRoleRow));
        mappings.replaceChildren(...roles.filter((item) => item.role !== "ignore").map(renderMappingCard));
        renderAudit(model.audit);
    }

    function renderRoleRow(config) {
        const tr = document.createElement("tr");
        tr.dataset.sheetName = config.sheetName;
        const roleSelect = document.createElement("select");
        roleSelect.dataset.modelRole = config.sheetName;
        Object.entries(ROLE_LABELS).forEach(([value, label]) => {
            const option = document.createElement("option");
            option.value = value; option.textContent = label; option.selected = config.role === value;
            roleSelect.appendChild(option);
        });
        const header = document.createElement("input");
        header.type = "number"; header.min = "1"; header.value = String((config.headerRowIndex ?? 0) + 1);
        header.dataset.modelHeader = config.sheetName;
        const values = [
            config.sheetName,
            roleSelect,
            header,
            formatInteger(config.rowCount || 0),
            formatInteger(config.columnCount || 0),
            summarizeMapping(config)
        ];
        values.forEach((value) => {
            const td = document.createElement("td");
            if (value instanceof global.Node) td.appendChild(value); else td.textContent = String(value);
            tr.appendChild(td);
        });
        return tr;
    }

    function summarizeMapping(config) {
        const fields = ROLE_FIELDS[config.role] || [];
        const required = fields.filter((item) => item.required);
        const mapped = fields.filter((item) => config.mapping?.[item.id]).length;
        const missing = required.filter((item) => !config.mapping?.[item.id]).map((item) => item.label);
        if (config.role !== "ignore" && !IDENTITY_FIELDS.some((id) => config.mapping?.[id])) {
            missing.unshift("identyfikator materiału");
        }
        return missing.length ? `${mapped}/${fields.length}; brak: ${missing.join(", ")}` : `${mapped}/${fields.length}; gotowe`;
    }

    function renderMappingCard(config) {
        const card = document.createElement("article");
        card.className = "workbook-model-mapping-card";
        card.dataset.modelMappingSheet = config.sheetName;
        const heading = document.createElement("div");
        heading.className = "panel-heading compact";
        const wrapper = document.createElement("div");
        const title = document.createElement("h4");
        title.textContent = `${config.sheetName} — ${ROLE_LABELS[config.role]}`;
        const subtitle = document.createElement("p");
        subtitle.textContent = "Każdy arkusz ma własne mapowanie. * pole wymagane; † zmapuj co najmniej jeden identyfikator: kod materiału, SKU lub nazwę.";
        wrapper.append(title, subtitle); heading.appendChild(wrapper); card.appendChild(heading);

        const grid = document.createElement("div");
        grid.className = "control-grid workbook-model-fields";
        (ROLE_FIELDS[config.role] || []).forEach((definition) => {
            const label = document.createElement("label");
            const span = document.createElement("span");
            const marker = definition.required ? " *" : IDENTITY_FIELDS.includes(definition.id) ? " †" : "";
            span.textContent = `${definition.label}${marker}`;
            const select = document.createElement("select");
            select.dataset.modelFieldSheet = config.sheetName;
            select.dataset.modelFieldId = definition.id;
            const blank = document.createElement("option"); blank.value = ""; blank.textContent = "— nie mapuj —"; select.appendChild(blank);
            config.headers.forEach((header) => {
                const option = document.createElement("option"); option.value = header; option.textContent = header; option.selected = config.mapping?.[definition.id] === header; select.appendChild(option);
            });
            label.append(span, select); grid.appendChild(label);
        });
        if (config.role === "stock") {
            const label = document.createElement("label");
            const span = document.createElement("span"); span.textContent = "Znaczenie stanu *";
            const select = document.createElement("select"); select.dataset.modelStockMode = config.sheetName;
            [["snapshot", "Aktualny snapshot — nie odejmuj historycznego zużycia"], ["opening", "Stan początkowy — odejmij zużycie i dodaj przyjęcia od daty"]].forEach(([value, text]) => {
                const option = document.createElement("option"); option.value = value; option.textContent = text; option.selected = config.stockMode === value; select.appendChild(option);
            });
            label.append(span, select); grid.appendChild(label);
        }
        card.appendChild(grid);
        return card;
    }

    function renderAudit(audit) {
        const target = el("workbookModelAudit");
        if (!target) return;
        if (!audit) {
            target.textContent = "Przypisz role arkuszom, sprawdź mapowanie i wybierz „Zbuduj model danych”.";
            target.className = "analysis-tip";
            return;
        }
        target.className = `analysis-tip ${audit.errors?.length ? "is-danger" : audit.warnings?.length ? "is-warning" : "is-success"}`;
        target.textContent = [
            `Model: ${audit.usageRows || 0} wierszy zużycia, ${audit.stockRows || 0} wpisów zapasu, ${audit.receiptRows || 0} przyjęć, ${audit.orderRows || 0} zamówień, ${audit.materialMasterRows || 0} wpisów kartoteki.`,
            `Klucz: ${audit.resolvedJoinField || "material"}; dopasowano ${audit.matchedMaterials || 0}/${audit.usageMaterials || 0} materiałów.`,
            audit.unmatchedUsage?.length ? `Brak zapasu: ${audit.unmatchedUsage.slice(0, 8).join(", ")}${audit.unmatchedUsage.length > 8 ? "…" : ""}.` : "",
            audit.unmatchedStock?.length ? `Zapas bez zużycia: ${audit.unmatchedStock.slice(0, 8).join(", ")}${audit.unmatchedStock.length > 8 ? "…" : ""}.` : "",
            audit.unitMismatches?.length ? `Niezgodne jednostki: ${audit.unitMismatches.length}.` : "",
            audit.duplicateStockSnapshots?.length ? `Powtórzone snapshoty materiał+dzień: ${audit.duplicateStockSnapshots.length}.` : "",
            audit.ambiguousAliases?.length ? `Niejednoznaczne aliasy: ${audit.ambiguousAliases.length}.` : "",
            audit.negativeStockRows?.length ? `Ujemne stany źródłowe: ${audit.negativeStockRows.length}.` : "",
            ...(audit.errors || []), ...(audit.warnings || [])
        ].filter(Boolean).join(" ");
    }

    function handleModelTableChange(event) {
        const roleSheet = event.target.dataset.modelRole;
        const headerSheet = event.target.dataset.modelHeader;
        if (!roleSheet && !headerSheet) return;
        const model = cloneModel();
        const sheetName = roleSheet || headerSheet;
        const config = model.roles.find((item) => item.sheetName === sheetName);
        if (!config) return;
        if (roleSheet) {
            config.role = event.target.value;
            config.mapping = autoMapRole(config.role, config.headers, config.detectedTypes);
        }
        if (headerSheet) {
            const headerRowIndex = Math.max(0, Number(event.target.value || 1) - 1);
            const analysis = analyzeSheetDetached(sheetName, headerRowIndex);
            config.headerRowIndex = headerRowIndex;
            config.headers = analysis.headers;
            config.detectedTypes = analysis.detectedTypes;
            config.rowCount = analysis.dataRows.length;
            config.columnCount = analysis.headers.length;
            config.mapping = autoMapRole(config.role, analysis.headers, analysis.detectedTypes);
        }
        state.setWorkbookDataModel(model);
        render();
    }

    function handleMappingChange(event) {
        const sheetName = event.target.dataset.modelFieldSheet || event.target.dataset.modelStockMode;
        if (!sheetName) return;
        const model = cloneModel();
        const config = model.roles.find((item) => item.sheetName === sheetName);
        if (!config) return;
        if (event.target.dataset.modelFieldId) config.mapping[event.target.dataset.modelFieldId] = event.target.value;
        if (event.target.dataset.modelStockMode) config.stockMode = event.target.value;
        state.setWorkbookDataModel(model);
        render();
    }

    function handleJoinStrategyChange(event) {
        const model = cloneModel(); model.joinStrategy = event.target.value || "auto";
        state.setWorkbookDataModel(model); render();
    }

    function cloneModel() {
        return JSON.parse(JSON.stringify(state.get("import.dataModel") || {}));
    }

    async function buildDataModel() {
        const workbook = state.get("import.workbook");
        if (!workbook) throw new Error("Najpierw wczytaj skoroszyt Excel.");
        const model = cloneModel();
        const assigned = model.roles.filter((item) => item.role !== "ignore");
        const usageConfigs = assigned.filter((item) => item.role === "usage");
        if (!usageConfigs.length) throw new Error("Przypisz co najmniej jeden arkusz do roli „Zużycie”.");
        validateRoleMappings(assigned);

        state.setBusy({ title: "Budowanie modelu danych", message: "Odczytywanie przypisanych arkuszy...", progress: 5 });
        const parsed = { usage: [], stock: [], receipts: [], orders: [], master: [] };
        assigned.forEach((config, index) => {
            parsed[config.role].push(...parseRoleRows(config));
            state.updateBusy({ message: `Przetworzono ${index + 1} z ${assigned.length} arkuszy.`, progress: 10 + Math.round((index + 1) / assigned.length * 40) });
        });

        if (!parsed.usage.length) throw new Error("Arkusze zużycia nie zawierają poprawnych wierszy.");
        const resolvedJoinField = resolveJoinField(model.joinStrategy, parsed.usage, parsed.stock);
        const identityResolver = createIdentityResolver(parsed.usage, resolvedJoinField);
        const consolidated = consolidateAncillary(parsed, resolvedJoinField, identityResolver);
        const audit = createJoinAudit(parsed.usage, consolidated.stockRows, resolvedJoinField, consolidated.warnings, {
            receiptRows: consolidated.receiptRows.length,
            orderRows: consolidated.orderRows.length,
            materialMasterRows: consolidated.materialMasterRows.length,
            ambiguousAliases: identityResolver.ambiguousAliases
        }, identityResolver);

        state.updateBusy({ message: "Tworzenie wspólnej tabeli zużycia...", progress: 58 });
        const generatedUsageSheet = buildUsageWorksheet(parsed.usage);
        model.status = audit.errors.length ? "error" : "ready";
        model.enabled = true;
        model.resolvedJoinField = resolvedJoinField;
        model.generatedUsageSheet = generatedUsageSheet;
        model.audit = audit;
        model.preparedAt = new Date().toISOString();
        state.setWorkbookDataModel(model);

        await PMA.importEngine.selectAndAnalyzeSheet(generatedUsageSheet, { autoDetectHeader: true });
        PMA.mappingEngine.prepareFromImport({
            useSavedProfile: false,
            mode: "workbook-model",
            modeDetails: {
                usageSheets: usageConfigs.length,
                stockSheets: assigned.filter((item) => item.role === "stock").length,
                joinField: resolvedJoinField
            }
        });
        const usageMapping = buildGeneratedUsageMapping();
        state.setMapping(usageMapping, {
            confidence: Object.fromEntries(Object.keys(usageMapping).filter((key) => usageMapping[key]).map((key) => [key, 1])),
            origins: Object.fromEntries(Object.keys(usageMapping).filter((key) => usageMapping[key]).map((key) => [key, "workbook-model"]))
        });
        PMA.mappingEngine.renderMappingFields();
        PMA.mappingEngine.renderSourceColumns();
        PMA.mappingEngine.updateMappingStatus();

        state.setStockDataset(consolidated.stockRows, stockFieldDefinitions());
        state.setAncillaryDatasets({
            receiptRows: consolidated.receiptRows,
            orderRows: consolidated.orderRows,
            materialMasterRows: consolidated.materialMasterRows,
            modelJoinAudit: audit
        });

        dom.unlockSection("mapping");
        dom.setWorkflowStage(2);
        dom.setStatusBadge(el("importStatusBadge"), "Model danych gotowy", STATUS.SUCCESS);
        renderAudit(audit);
        const validation = await PMA.mappingEngine.validateMappedData({ force: true });
        dom.setWorkflowProgress("mapping", `${formatInteger(validation.validRows)} poprawnych wierszy`);
        dom.showSuccess(`Zbudowano model z ${formatInteger(parsed.usage.length)} wierszy zużycia i ${formatInteger(consolidated.stockRows.length)} wpisów zapasu. Mapowanie nie jest powtarzane — wykonano automatyczną kontrolę jakości.`, "Model danych skoroszytu");
        dom.activateSection("mapping");
        return { model, parsed, consolidated, audit };
    }

    function validateRoleMappings(configs) {
        const errors = [];
        configs.forEach((config) => {
            const required = (ROLE_FIELDS[config.role] || []).filter((item) => item.required);
            required.forEach((definition) => {
                if (!config.mapping?.[definition.id]) errors.push(`${config.sheetName}: zmapuj pole „${definition.label}”.`);
            });
            if (!IDENTITY_FIELDS.some((id) => config.mapping?.[id])) {
                errors.push(`${config.sheetName}: zmapuj co najmniej jeden identyfikator materiału — kod, SKU lub nazwę.`);
            }
            const mappedSources = Object.values(config.mapping || {}).filter(Boolean);
            const duplicateSources = [...new Set(mappedSources.filter((source, index) => mappedSources.indexOf(source) !== index))];
            if (duplicateSources.length) {
                errors.push(`${config.sheetName}: jedna kolumna źródłowa nie może zasilać kilku pól (${duplicateSources.join(", ")}).`);
            }
            if (config.role === "stock" && config.stockMode === "opening" && !config.mapping?.date) {
                errors.push(`${config.sheetName}: stan początkowy wymaga pola „Data stanu”.`);
            }
        });
        if (errors.length) throw new Error(errors.join(" "));
    }

    function parseRoleRows(config) {
        const analysis = analyzeSheetDetached(config.sheetName, config.headerRowIndex);
        const indexes = Object.fromEntries(Object.entries(config.mapping || {}).map(([id, header]) => [id, analysis.headers.indexOf(header)]));
        const mappedHeaders = new Set(Object.values(config.mapping || {}).filter(Boolean));
        const fileName = state.get(`import.sheetProvenance.${config.sheetName}.fileName`, state.get("import.fileMeta.name", ""));
        const rows = [];
        analysis.dataRows.forEach((sourceRow, index) => {
            const record = {
                id: createId(`model-${config.role}`),
                sourceFile: fileName,
                sourceSheet: config.sheetName,
                sourceRow: analysis.sourceRowNumbers[index] || index + config.headerRowIndex + 2,
                role: config.role
            };
            Object.entries(indexes).forEach(([fieldId, columnIndex]) => {
                if (columnIndex >= 0) record[fieldId] = sourceRow[columnIndex];
            });
            if (config.role === "usage") {
                record.extraSourceValues = Object.fromEntries(
                    analysis.headers
                        .map((header, columnIndex) => [header, sourceRow[columnIndex]])
                        .filter(([header]) => !mappedHeaders.has(header))
                );
            }
            if (!hasBusinessValue(record, config.role)) return;
            normalizeRoleRecord(record, config);
            rows.push(record);
        });
        return rows;
    }

    function hasBusinessValue(record, role) {
        const required = (ROLE_FIELDS[role] || []).filter((item) => item.required).map((item) => item.id);
        const relevant = [...new Set([...required, ...IDENTITY_FIELDS])];
        return relevant.some((id) => !isBlank(record[id]));
    }

    function normalizeRoleRecord(record, config) {
        ["material", "materialCode", "sku", "unit", "supplier", "brand", "category", "line", "order"].forEach((id) => {
            if (id in record) record[id] = cleanText(record[id]) || null;
        });
        if (!record.material) record.material = record.materialCode || record.sku || null;
        ["quantity", "stockLevel", "openOrders", "leadTimeDays", "minimumOrderQuantity", "orderMultiple", "safetyStock"].forEach((id) => {
            if (id in record) record[id] = parseNumber(record[id]);
        });
        if (record.date !== undefined) {
            const parsed = parseDate(record.date, { allowExcelSerial: true, allowNumericStringExcelSerial: true });
            record.date = parsed ? toISODate(parsed) : null;
        }
        if (config.role === "stock") record.stockMode = config.stockMode || "snapshot";
        return record;
    }

    function buildUsageWorksheet(records) {
        const workbook = state.get("import.workbook");
        const sheetName = "Model danych — Zużycie";
        if (workbook.Sheets[sheetName]) {
            delete workbook.Sheets[sheetName];
            workbook.SheetNames = workbook.SheetNames.filter((name) => name !== sheetName);
        }
        const fieldIds = SYSTEM_FIELDS.map((item) => item.id).filter((id) => records.some((record) => !isBlank(record[id])));
        const canonicalHeaders = fieldIds.map((id) => SYSTEM_FIELD_MAP[id]?.label || id);
        const sourceHeaders = [];
        const seenSourceHeaders = new Set();
        records.forEach((record) => {
            Object.keys(record.extraSourceValues || {}).forEach((header) => {
                if (!seenSourceHeaders.has(header)) {
                    seenSourceHeaders.add(header);
                    sourceHeaders.push(header);
                }
            });
        });
        const usedHeaders = new Set(canonicalHeaders);
        const sourceHeaderLabels = new Map();
        sourceHeaders.forEach((header) => {
            const base = usedHeaders.has(header) ? `Źródło: ${header}` : header;
            let label = base;
            let suffix = 2;
            while (usedHeaders.has(label)) label = `${base} (${suffix++})`;
            usedHeaders.add(label);
            sourceHeaderLabels.set(header, label);
        });
        const headers = [...canonicalHeaders, ...sourceHeaders.map((header) => sourceHeaderLabels.get(header))];
        const aoa = [
            headers,
            ...records.map((record) => [
                ...fieldIds.map((id) => record[id] ?? ""),
                ...sourceHeaders.map((header) => record.extraSourceValues?.[header] ?? "")
            ])
        ];
        workbook.Sheets[sheetName] = global.XLSX.utils.aoa_to_sheet(aoa);
        workbook.SheetNames.push(sheetName);
        const rows = records.map((record) => ({ fileName: record.sourceFile, sheetName: record.sourceSheet, sourceRow: record.sourceRow }));
        const provenance = { ...state.get("import.sheetProvenance", {}), [sheetName]: { fileName: "Model danych", sheetName, rows } };
        state.setWorkbook(workbook, workbook.SheetNames, provenance);
        const model = cloneModel(); model.roles = model.roles.filter((item) => item.sheetName !== sheetName); state.setWorkbookDataModel(model);
        PMA.dom.populateSheetSelector(workbook.SheetNames, sheetName);
        return sheetName;
    }

    function buildGeneratedUsageMapping() {
        const headers = new Set(state.get("import.headers", []));
        return Object.fromEntries(SYSTEM_FIELDS.map((definition) => [definition.id, headers.has(definition.label) ? definition.label : ""]));
    }

    function resolveJoinField(strategy, usageRows, stockRows) {
        const candidates = strategy && strategy !== "auto" ? [strategy] : ["materialCode", "sku", "material"];
        let best = { field: "material", coverage: -1, shared: 0 };
        candidates.forEach((fieldId) => {
            const usage = uniqueKeys(usageRows, fieldId);
            const stock = uniqueKeys(stockRows, fieldId);
            const shared = [...usage].filter((key) => stock.has(key)).length;
            const coverage = usage.size ? shared / usage.size : 0;
            if (coverage > best.coverage || (coverage === best.coverage && shared > best.shared)) best = { field: fieldId, coverage, shared };
        });
        return best.field;
    }

    function uniqueKeys(rows, fieldId) {
        return new Set(rows.map((row) => normalizeKey(row[fieldId], fieldId)).filter(Boolean));
    }

    function normalizeKey(value, fieldId) {
        const text = cleanText(value);
        if (!text) return "";
        return fieldId === "material" ? normalizeComparableText(text) : text.toLocaleUpperCase("pl-PL").replace(/\s+/g, "");
    }

    function identityCandidates(record) {
        if (!record) return [];
        return [
            cleanText(record.modelJoinKey),
            normalizeKey(record.materialCode, "materialCode"),
            normalizeKey(record.sku, "sku"),
            normalizeKey(record.material, "material")
        ].filter(Boolean);
    }

    function getMaterialIdentity(record) {
        const requested = state.get("import.dataModel.resolvedJoinField", "material") || "material";
        const explicitModelKey = cleanText(record?.modelJoinKey);
        if (explicitModelKey) return explicitModelKey;
        const primary = normalizeKey(record?.[requested], requested);
        if (primary) return primary;
        return normalizeKey(record?.materialCode, "materialCode") || normalizeKey(record?.sku, "sku") || normalizeKey(record?.material, "material") || "nieznany-material";
    }

    function createUsageAliasMap(rows) {
        const aliases = new Map();
        (rows || []).forEach((row) => {
            const canonical = getMaterialIdentity(row);
            identityCandidates(row).forEach((candidate) => {
                if (!aliases.has(candidate)) aliases.set(candidate, canonical);
            });
        });
        return aliases;
    }

    function resolveRecordIdentity(record, aliases) {
        for (const candidate of identityCandidates(record)) {
            if (aliases?.has(candidate)) return aliases.get(candidate);
        }
        return getMaterialIdentity(record);
    }

    function createIdentityResolver(usageRows, resolvedJoinField) {
        const aliases = new Map();
        const ambiguous = new Set();
        (usageRows || []).forEach((row) => {
            const canonical = normalizeKey(row?.[resolvedJoinField], resolvedJoinField) || getFallbackKey(row);
            if (!canonical) return;
            const candidates = new Set([canonical, ...identityCandidates(row)]);
            candidates.forEach((candidate) => {
                if (!candidate || ambiguous.has(candidate)) return;
                const existing = aliases.get(candidate);
                if (existing && existing !== canonical) {
                    aliases.delete(candidate);
                    ambiguous.add(candidate);
                } else {
                    aliases.set(candidate, canonical);
                }
            });
        });
        return {
            aliases,
            ambiguousAliases: [...ambiguous],
            resolve(record) {
                const primary = normalizeKey(record?.[resolvedJoinField], resolvedJoinField);
                if (primary && aliases.has(primary)) return aliases.get(primary);
                for (const candidate of identityCandidates(record)) {
                    if (aliases.has(candidate)) return aliases.get(candidate);
                }
                return primary || getFallbackKey(record);
            }
        };
    }

    function consolidateAncillary(parsed, resolvedJoinField, identityResolver) {
        const warnings = [];
        const masterByKey = latestByKey(parsed.master, identityResolver, false);
        const ordersByKey = aggregateOrders(parsed.orders, identityResolver);
        const stockRows = parsed.stock.map((row) => {
            const key = identityResolver.resolve(row);
            const master = masterByKey.get(key) || {};
            const order = ordersByKey.get(key) || {};
            return {
                ...row,
                material: row.material || master.material || order.material,
                materialCode: row.materialCode || master.materialCode || order.materialCode,
                sku: row.sku || master.sku || order.sku,
                unit: row.unit || master.unit || order.unit || null,
                supplier: master.supplier || row.supplier || order.supplier || null,
                leadTimeDays: firstNumber(master.leadTimeDays, row.leadTimeDays, order.leadTimeDays),
                minimumOrderQuantity: firstNumber(master.minimumOrderQuantity, row.minimumOrderQuantity, order.minimumOrderQuantity),
                orderMultiple: firstNumber(master.orderMultiple, row.orderMultiple, order.orderMultiple),
                safetyStock: firstNumber(master.safetyStock, row.safetyStock, order.safetyStock),
                openOrders: firstNumber(order.openOrders, row.openOrders, 0),
                modelJoinKey: key,
                sourceType: "workbook-model"
            };
        }).filter((row) => {
            if (!row.modelJoinKey) { warnings.push(`${row.sourceSheet}: pominięto wiersz ${row.sourceRow} bez identyfikatora materiału.`); return false; }
            if (parseNumber(row.stockLevel) === null) { warnings.push(`${row.sourceSheet}: pominięto wiersz ${row.sourceRow} bez liczbowego stanu.`); return false; }
            if (row.stockMode === "opening" && !row.date) { warnings.push(`${row.sourceSheet}: pominięto stan początkowy z wiersza ${row.sourceRow} bez daty.`); return false; }
            if (!row.date) row.date = toISODate(new Date());
            return true;
        });
        const receiptRows = parsed.receipts.map((row) => ({ ...row, modelJoinKey: identityResolver.resolve(row), sourceType: "workbook-model" })).filter((row) => {
            if (!row.modelJoinKey) { warnings.push(`${row.sourceSheet}: pominięto przyjęcie z wiersza ${row.sourceRow} bez identyfikatora materiału.`); return false; }
            if (row.quantity === null || !row.date) { warnings.push(`${row.sourceSheet}: pominięto niekompletne przyjęcie z wiersza ${row.sourceRow}.`); return false; }
            return true;
        });
        const orderRows = parsed.orders.map((row) => ({ ...row, modelJoinKey: identityResolver.resolve(row), sourceType: "workbook-model" })).filter((row) => {
            if (!row.modelJoinKey) { warnings.push(`${row.sourceSheet}: pominięto zamówienie z wiersza ${row.sourceRow} bez identyfikatora materiału.`); return false; }
            return row.openOrders !== null;
        });
        const materialMasterRows = parsed.master.map((row) => ({ ...row, modelJoinKey: identityResolver.resolve(row), sourceType: "workbook-model" })).filter((row) => {
            if (!row.modelJoinKey) { warnings.push(`${row.sourceSheet}: pominięto wpis kartoteki z wiersza ${row.sourceRow} bez identyfikatora materiału.`); return false; }
            return true;
        });
        if (identityResolver.ambiguousAliases.length) {
            warnings.push(`Niejednoznaczne aliasy materiałów: ${identityResolver.ambiguousAliases.slice(0, 8).join(", ")}${identityResolver.ambiguousAliases.length > 8 ? "…" : ""}. Do łączenia użyto wyłącznie jednoznacznych kodów lub SKU.`);
        }
        return { stockRows, receiptRows, orderRows, materialMasterRows, warnings };
    }

    function latestByKey(rows, identityResolver, requireDate = true) {
        const map = new Map();
        rows.forEach((row, index) => {
            const key = identityResolver.resolve(row);
            if (!key) return;
            const timestamp = row.date ? Date.parse(row.date) : (requireDate ? NaN : index);
            const current = map.get(key);
            if (!current || !Number.isFinite(current.__timestamp) || timestamp >= current.__timestamp) map.set(key, { ...row, __timestamp: timestamp });
        });
        return map;
    }

    function aggregateOrders(rows, identityResolver) {
        const map = new Map();
        rows.forEach((row) => {
            const key = identityResolver.resolve(row);
            if (!key) return;
            const current = map.get(key) || { ...row, openOrders: 0 };
            current.openOrders += Math.max(0, parseNumber(row.openOrders) || 0);
            ["supplier", "unit", "leadTimeDays", "minimumOrderQuantity", "orderMultiple", "safetyStock", "material", "materialCode", "sku"].forEach((id) => {
                if (isBlank(current[id]) && !isBlank(row[id])) current[id] = row[id];
            });
            map.set(key, current);
        });
        return map;
    }

    function firstNumber(...values) {
        for (const value of values) {
            const parsed = parseNumber(value);
            if (parsed !== null) return parsed;
        }
        return null;
    }

    function getFallbackKey(row) {
        return normalizeKey(row.materialCode, "materialCode") || normalizeKey(row.sku, "sku") || normalizeKey(row.material, "material");
    }

    function createJoinAudit(usageRows, stockRows, resolvedJoinField, warnings = [], counts = {}, identityResolver = null) {
        const resolve = (row) => identityResolver?.resolve(row) || normalizeKey(row?.[resolvedJoinField], resolvedJoinField) || getFallbackKey(row);
        const usageMap = new Map();
        usageRows.forEach((row) => {
            const key = resolve(row);
            if (key && !usageMap.has(key)) usageMap.set(key, row);
        });
        const stockMap = new Map();
        const stockDates = new Map();
        const duplicateStockSnapshots = [];
        stockRows.forEach((row) => {
            const key = cleanText(row.modelJoinKey) || resolve(row);
            if (!key) return;
            const dateKey = `${key}|${row.date || "bez-daty"}`;
            if (stockDates.has(dateKey)) duplicateStockSnapshots.push(dateKey);
            stockDates.set(dateKey, row);
            const current = stockMap.get(key);
            const timestamp = Date.parse(String(row.date || ""));
            const currentTimestamp = Date.parse(String(current?.date || ""));
            if (!current || !Number.isFinite(currentTimestamp) || (Number.isFinite(timestamp) && timestamp >= currentTimestamp)) stockMap.set(key, row);
        });
        const matched = [...usageMap.keys()].filter((key) => stockMap.has(key));
        const unmatchedUsage = [...usageMap.entries()].filter(([key]) => !stockMap.has(key)).map(([, row]) => row.material || row.materialCode || row.sku || "Nieznany materiał");
        const unmatchedStock = [...stockMap.entries()].filter(([key]) => !usageMap.has(key)).map(([, row]) => row.material || row.materialCode || row.sku || "Nieznany materiał");
        const unitMismatches = matched.filter((key) => {
            const usageUnit = normalizeComparableText(usageMap.get(key)?.unit || "");
            const stockUnit = normalizeComparableText(stockMap.get(key)?.unit || "");
            return usageUnit && stockUnit && usageUnit !== stockUnit;
        }).map((key) => ({ key, usageUnit: usageMap.get(key)?.unit || null, stockUnit: stockMap.get(key)?.unit || null }));
        const negativeStockRows = stockRows.filter((row) => (parseNumber(row.stockLevel) ?? 0) < 0).map((row) => ({ material: row.material || row.materialCode || row.sku, sourceSheet: row.sourceSheet, sourceRow: row.sourceRow }));
        const errors = [];
        if (!stockRows.length) warnings.push("Nie przypisano arkusza zapasów; analiza pokrycia będzie wymagała danych ręcznych.");
        if (duplicateStockSnapshots.length) warnings.push(`Powtórzone snapshoty tego samego materiału i dnia: ${duplicateStockSnapshots.length}. Użyty zostanie ostatni wiersz źródłowy.`);
        if (negativeStockRows.length) warnings.push(`Ujemny stan źródłowy: ${negativeStockRows.length} wierszy. Wymaga weryfikacji.`);
        return {
            usageRows: usageRows.length,
            stockRows: stockRows.length,
            receiptRows: Number(counts.receiptRows) || 0,
            orderRows: Number(counts.orderRows) || 0,
            materialMasterRows: Number(counts.materialMasterRows) || 0,
            usageMaterials: usageMap.size,
            stockMaterials: stockMap.size,
            matchedMaterials: matched.length,
            unmatchedUsage,
            unmatchedStock,
            duplicateStockSnapshots: [...new Set(duplicateStockSnapshots)],
            ambiguousAliases: Array.isArray(counts.ambiguousAliases) ? counts.ambiguousAliases : [],
            negativeStockRows,
            unitMismatches,
            resolvedJoinField,
            errors,
            warnings: [...new Set(warnings)]
        };
    }

    function getInventoryRows(visibleUsageRows = []) {
        const dedicated = state.get("dataset.stockRows", []);
        if (!dedicated.length) return [];
        const allUsage = state.get("dataset.normalizedRows", []);
        const receipts = state.get("dataset.receiptRows", []);
        const aliases = createUsageAliasMap(allUsage);
        const asOfDate = resolveAsOfDate(allUsage, dedicated, receipts);
        const asOfTimestamp = asOfDate ? Date.parse(asOfDate) : Date.now();
        const visibleKeys = new Set((visibleUsageRows.length ? visibleUsageRows : allUsage).map((row) => resolveRecordIdentity(row, aliases)));
        const explicitAsOf = state.get("filters.dateTo", "");
        const latest = new Map();
        dedicated.forEach((row, index) => {
            const key = resolveRecordIdentity(row, aliases);
            if (visibleKeys.size && !visibleKeys.has(key)) return;
            const parsedTimestamp = row.date ? Date.parse(row.date) : NaN;
            if (!Number.isFinite(parsedTimestamp) && explicitAsOf) return;
            const timestamp = Number.isFinite(parsedTimestamp) ? parsedTimestamp : asOfTimestamp + index / 1000;
            if (timestamp > asOfTimestamp + 1) return;
            const current = latest.get(key);
            if (!current || timestamp >= current.timestamp) latest.set(key, { row, timestamp });
        });
        return [...latest.entries()].map(([key, entry]) => {
            const row = entry.row;
            const baseStock = parseNumber(row.stockLevel);
            if (baseStock === null) return null;
            const stockDateTimestamp = row.date ? Date.parse(row.date) : null;
            let usageSince = 0;
            let receiptsSince = 0;
            if (row.stockMode === "opening" && Number.isFinite(stockDateTimestamp)) {
                usageSince = allUsage.filter((usage) => resolveRecordIdentity(usage, aliases) === key && inClosedRange(usage.date, stockDateTimestamp, asOfTimestamp)).reduce((sum, usage) => sum + (parseNumber(usage.quantity) || 0), 0);
                receiptsSince = receipts.filter((receipt) => resolveRecordIdentity(receipt, aliases) === key && inClosedRange(receipt.date, stockDateTimestamp, asOfTimestamp)).reduce((sum, receipt) => sum + (parseNumber(receipt.quantity) || 0), 0);
            }
            const effectiveStock = row.stockMode === "opening" ? baseStock + receiptsSince - usageSince : baseStock;
            const staleDays = Number.isFinite(stockDateTimestamp) ? Math.max(0, Math.floor((asOfTimestamp - stockDateTimestamp) / 86400000)) : null;
            return {
                materialKey: key,
                material: row.material || row.materialCode || row.sku || "Nieznany materiał",
                stock: effectiveStock,
                originalStock: baseStock,
                stockMode: row.stockMode || "snapshot",
                stockDate: row.date || null,
                asOfDate,
                usageSince,
                receiptsSince,
                staleDays,
                timestamp: entry.timestamp,
                unit: row.unit || null,
                leadTimeDays: parseNumber(row.leadTimeDays),
                minimumOrderQuantity: parseNumber(row.minimumOrderQuantity),
                orderMultiple: parseNumber(row.orderMultiple),
                safetyStock: parseNumber(row.safetyStock),
                openOrders: parseNumber(row.openOrders),
                supplier: row.supplier || null,
                sourceFile: row.sourceFile || null,
                sourceSheet: row.sourceSheet || null,
                sourceRow: row.sourceRow || null
            };
        }).filter(Boolean);
    }

    function inClosedRange(dateValue, startTimestamp, endTimestamp) {
        const timestamp = Date.parse(String(dateValue || ""));
        return Number.isFinite(timestamp) && timestamp >= startTimestamp && timestamp <= endTimestamp;
    }

    function resolveAsOfDate(...rowCollections) {
        const explicit = state.get("filters.dateTo", "");
        if (explicit && Number.isFinite(Date.parse(explicit))) return explicit;
        let latestTimestamp = Number.NEGATIVE_INFINITY;
        rowCollections.flat().forEach((row) => {
            const timestamp = Date.parse(String(row?.date || ""));
            if (Number.isFinite(timestamp) && timestamp > latestTimestamp) latestTimestamp = timestamp;
        });
        return Number.isFinite(latestTimestamp) ? toISODate(new Date(latestTimestamp)) : toISODate(new Date());
    }

    function stockFieldDefinitions() {
        return [
            { id: "material", label: "Materiał", type: DATA_TYPES.TEXT },
            { id: "materialCode", label: "Kod materiału", type: DATA_TYPES.TEXT },
            { id: "sku", label: "SKU", type: DATA_TYPES.TEXT },
            { id: "stockLevel", label: "Stan zapasu", type: DATA_TYPES.NUMBER },
            { id: "stockMode", label: "Znaczenie stanu", type: DATA_TYPES.TEXT },
            { id: "date", label: "Data stanu", type: DATA_TYPES.DATE },
            { id: "unit", label: "Jednostka", type: DATA_TYPES.TEXT },
            { id: "leadTimeDays", label: "Lead time (dni)", type: DATA_TYPES.NUMBER },
            { id: "minimumOrderQuantity", label: "MOQ", type: DATA_TYPES.NUMBER },
            { id: "orderMultiple", label: "Krotność zamówienia", type: DATA_TYPES.NUMBER },
            { id: "safetyStock", label: "Safety stock", type: DATA_TYPES.NUMBER },
            { id: "openOrders", label: "Otwarte zamówienia", type: DATA_TYPES.NUMBER },
            { id: "supplier", label: "Dostawca", type: DATA_TYPES.TEXT }
        ];
    }

    function handleError(error, context) {
        state.clearBusy(STATUS.ERROR);
        dom.showError(normalizeError(error).message, context);
        console.error(`[PMA] ${context}:`, error);
    }

    const api = Object.freeze({
        initialize,
        destroy,
        prepareFromWorkbook,
        analyzeSheetDetached,
        autoMapRole,
        buildDataModel,
        resolveJoinField,
        getMaterialIdentity,
        getInventoryRows,
        stockFieldDefinitions,
        ROLE_FIELDS,
        ROLE_LABELS,
        get initialized() { return initialized; }
    });

    Object.defineProperty(PMA, "workbookModelEngine", {
        value: api,
        writable: false,
        enumerable: true,
        configurable: false
    });
})(window);
