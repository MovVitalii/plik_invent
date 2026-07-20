/* ==========================================================
   Pack Materials Analytics
   src/decision-engine.js

   Decision-support layer ported from the standalone Material
   Intelligence Center: Pareto, ABC classification, stock
   coverage / shortage risk and a seasonal order forecast.

   Design notes:
   - Reuses PMA.state's "dataset.filteredRows" — the same
     filtered dataset the Pivot/Analysis tab renders — instead
     of a second, independent filter panel. One filtered view
     for the whole app.
   - Reuses each record's already-derived ".season" field
     (see utils.deriveDateFields) instead of a second season
     calculation, so seasonal grouping cannot drift out of
     sync with the rest of the app.
   - "quantity" doubles as "usage" here, consistent with its
     SYSTEM_FIELDS description ("Zużyta lub zarejestrowana
     ilość materiału").
========================================================== */

(function initializeDecisionEngine(global) {
    "use strict";

    const PMA = global.PMA || (global.PMA = {});
    if (!PMA.constants || !PMA.state || !PMA.utils || !PMA.dom) {
        throw new Error("PMA core modules must be loaded before src/decision-engine.js.");
    }

    const { STATUS, DECISION, EVENTS, UI_TEXT, PROCESSING_LIMITS } = PMA.constants;
    const {
        parseNumber,
        formatNumber,
        formatInteger,
        formatPercent,
        sum,
        truncate,
        normalizeComparableText,
        normalizeError
    } = PMA.utils;

    const state = PMA.state;
    const dom = PMA.dom;
    const elements = dom.elements;

    const UNKNOWN_MATERIAL = "Nieznany materiał";
    const SEASON_CYCLE = ["Zima", "Wiosna", "Lato", "Jesień"];
    const RENDER_ROW_LIMIT = PROCESSING_LIMITS.maximumRenderedPivotRows;

    const handlers = [];
    let initialized = false;
    let activeTab = "dashboard";
    let paretoChart = null;
    let forecastSeason = "auto";
    let forecastDays = DECISION.forecastDefaultDays;
    let forecastBuffer = DECISION.forecastDefaultBuffer;

    function initialize() {
        if (initialized) return api;
        bindTabs();
        bindForecastControls();
        bind(elements.exportForecastCsvButton, "click", exportForecastCsv);
        bind(elements.printDecisionReportButton, "click", printDecisionReport);
        initialized = true;
        return api;
    }

    function destroy() {
        handlers.forEach(({ element, eventName, handler }) => element.removeEventListener(eventName, handler));
        handlers.length = 0;
        destroyParetoChart();
        initialized = false;
    }

    function bind(element, eventName, handler) {
        if (!element) return;
        element.addEventListener(eventName, handler);
        handlers.push({ element, eventName, handler });
    }

    function bindTabs() {
        elements.decisionTabButtons.forEach((button) => {
            bind(button, "click", () => switchTab(button.dataset.decisionTab));
        });
    }

    function bindForecastControls() {
        bind(elements.forecastSeasonSelect, "change", () => {
            forecastSeason = elements.forecastSeasonSelect.value;
            renderForecast();
        });
        bind(elements.forecastDaysInput, "change", () => {
            const value = Math.trunc(parseNumber(elements.forecastDaysInput.value));
            forecastDays = Number.isFinite(value) ? clamp(value, 1, DECISION.forecastMaxDays) : DECISION.forecastDefaultDays;
            elements.forecastDaysInput.value = String(forecastDays);
            renderForecast();
        });
        bind(elements.forecastBufferInput, "change", () => {
            const value = parseNumber(elements.forecastBufferInput.value);
            const percent = Number.isFinite(value) ? clamp(value, 0, DECISION.forecastMaxBuffer * 100) : DECISION.forecastDefaultBuffer * 100;
            forecastBuffer = percent / 100;
            elements.forecastBufferInput.value = String(percent);
            renderForecast();
        });
    }

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function switchTab(tabName) {
        if (!tabName || tabName === activeTab) {
            if (tabName) activeTab = tabName;
        } else {
            activeTab = tabName;
        }
        elements.decisionTabButtons.forEach((button) => {
            const isActive = button.dataset.decisionTab === activeTab;
            button.classList.toggle("is-active", isActive);
            button.setAttribute("aria-pressed", String(isActive));
        });
        elements.decisionViews.forEach((view) => {
            view.hidden = view.dataset.decisionView !== activeTab;
        });
    }

    // ---- data access -------------------------------------------------

    function hasStockMapping() {
        if (state.get("dataset.stockRows.length", 0) > 0) return true;
        if (state.get("mapping.values.stockLevel", "")) return true;
        return state.get("dataset.fields", []).some((field) => field?.id === "stockLevel" && field.source !== "internal");
    }

    function getRows() {
        return state.get("dataset.filteredRows", []);
    }

    function materialLabel(record) {
        return String(record?.material || UNKNOWN_MATERIAL).trim() || UNKNOWN_MATERIAL;
    }

    function materialIdentity(recordOrLabel) {
        if (typeof recordOrLabel !== "string" && PMA.workbookModelEngine?.getMaterialIdentity) {
            return PMA.workbookModelEngine.getMaterialIdentity(recordOrLabel);
        }
        const label = typeof recordOrLabel === "string" ? recordOrLabel : materialLabel(recordOrLabel);
        return normalizeComparableText(label) || normalizeComparableText(UNKNOWN_MATERIAL);
    }

    function normalizedUnit(value) {
        return normalizeComparableText(value || "");
    }

    // ---- shared aggregates ---------------------------------------------

    function groupUsageByMaterial(rows) {
        const totals = new Map();
        rows.forEach((record) => {
            const key = materialIdentity(record);
            const current = totals.get(key) || { material: materialLabel(record), value: 0 };
            current.value += parseNumber(record.quantity) || 0;
            totals.set(key, current);
        });
        return [...totals.values()].sort((left, right) => right.value - left.value);
    }

    function getDailyUsage(rows) {
        const totals = new Map();
        rows.forEach((record) => {
            if (!record.date) return;
            totals.set(record.date, (totals.get(record.date) || 0) + (parseNumber(record.quantity) || 0));
        });
        const labels = [...totals.keys()].sort();
        return { labels, values: labels.map((label) => totals.get(label)) };
    }

    function getTrend(rows) {
        const daily = getDailyUsage(rows);
        if (daily.values.length < 2) return null;
        const midpoint = Math.max(1, Math.floor(daily.values.length / 2));
        const firstHalf = daily.values.slice(0, midpoint);
        const secondHalf = daily.values.slice(midpoint);
        const firstAverage = sum(firstHalf) / firstHalf.length;
        const secondAverage = sum(secondHalf) / secondHalf.length;
        if (!firstAverage) return null;
        const change = ((secondAverage - firstAverage) / firstAverage) * 100;
        const label = change > 10 ? "rosnący" : change < -10 ? "malejący" : "stabilny";
        return { change, label };
    }

    // record.date is the ISO "YYYY-MM-DD" string utils.deriveDateFields produces
    // (not a Date instance) — date-only ISO strings parse as UTC midnight per spec,
    // so this is a reliable, timezone-safe way to get a comparable day timestamp.
    function dayTimestamp(isoDate) {
        const timestamp = Date.parse(String(isoDate || ""));
        return Number.isFinite(timestamp) ? timestamp : null;
    }

    function getLatestStockByMaterial(rows) {
        if (state.get("import.dataModel.enabled", false) && PMA.workbookModelEngine?.getInventoryRows) {
            const modeled = PMA.workbookModelEngine.getInventoryRows(rows);
            if (modeled.length || state.get("dataset.stockRows.length", 0)) return modeled;
        }
        const latest = new Map();
        const allowedKeys = new Set(rows.map(materialIdentity));
        const dedicatedStockRows = state.get("dataset.stockRows", []);
        const sourceRows = dedicatedStockRows.length ? dedicatedStockRows : rows;
        sourceRows.forEach((record) => {
            const stock = parseNumber(record.stockLevel);
            const timestamp = dayTimestamp(record.date);
            const key = materialIdentity(record);
            if (stock === null || stock < 0 || timestamp === null || (dedicatedStockRows.length && !allowedKeys.has(key))) return;
            const current = latest.get(key);
            if (!current || timestamp >= current.timestamp) {
                latest.set(key, {
                    materialKey: key,
                    material: materialLabel(record),
                    stock,
                    timestamp,
                    unit: record.unit || null,
                    leadTimeDays: parseNumber(record.leadTimeDays),
                    minimumOrderQuantity: parseNumber(record.minimumOrderQuantity),
                    orderMultiple: parseNumber(record.orderMultiple),
                    safetyStock: parseNumber(record.safetyStock),
                    openOrders: parseNumber(record.openOrders),
                    supplier: record.supplier || null
                });
            }
        });
        return [...latest.values()];
    }

    function getReliability(observedDays, calendarDays) {
        const density = calendarDays > 0 ? observedDays / calendarDays : 0;
        if (observedDays < DECISION.minimumObservedDays) return "insufficient";
        if (density < DECISION.lowDensityThreshold) return "low";
        if (observedDays < DECISION.mediumObservedDaysThreshold || density < DECISION.mediumDensityThreshold) return "medium";
        return "high";
    }

    function reliabilityRank(level) {
        return { insufficient: 0, low: 1, medium: 2, high: 3 }[level] ?? 0;
    }

    function reliabilityMeta(level) {
        return {
            insufficient: { text: "Za mało danych", status: "neutral" },
            low: { text: "Niska wiarygodność", status: "danger" },
            medium: { text: "Średnia wiarygodność", status: "warning" },
            high: { text: "Wysoka wiarygodność", status: "success" }
        }[level] || { text: "Za mało danych", status: "neutral" };
    }

    // ---- coverage & risk -------------------------------------------------

    function getCoverageRows(rows) {
        const usage = new Map();
        const spans = new Map();
        const units = new Map();
        const labels = new Map();

        rows.forEach((record) => {
            const key = materialIdentity(record);
            labels.set(key, labels.get(key) || materialLabel(record));
            usage.set(key, (usage.get(key) || 0) + (parseNumber(record.quantity) || 0));
            const unit = normalizedUnit(record.unit);
            if (unit) {
                if (!units.has(key)) units.set(key, new Set());
                units.get(key).add(unit);
            }
            const timestamp = dayTimestamp(record.date);
            if (timestamp === null) return;
            const span = spans.get(key) || { min: timestamp, max: timestamp, observed: new Set() };
            span.min = Math.min(span.min, timestamp);
            span.max = Math.max(span.max, timestamp);
            span.observed.add(timestamp);
            spans.set(key, span);
        });

        return getLatestStockByMaterial(rows).map((entry) => {
            const key = entry.materialKey;
            const span = spans.get(key);
            const observedDays = span ? span.observed.size : 0;
            const calendarDays = span ? Math.max(1, Math.round((span.max - span.min) / 86400000) + 1) : 1;
            const totalUsage = usage.get(key) || 0;
            const averageDaily = calendarDays > 0 ? totalUsage / calendarDays : 0;
            const usageUnits = units.get(key) || new Set();
            const stockUnit = normalizedUnit(entry.unit);
            const unitConflict = usageUnits.size > 1;
            const unitMismatch = !unitConflict && stockUnit && usageUnits.size === 1 && !usageUnits.has(stockUnit);
            const dataIssue = unitConflict ? "Niejednolite jednostki zużycia" : unitMismatch ? "Jednostka zapasu nie zgadza się z zużyciem" : null;
            const reliability = dataIssue ? "insufficient" : getReliability(observedDays, calendarDays);
            const reliable = reliability !== "insufficient" && !dataIssue;
            return {
                material: labels.get(key) || entry.material,
                materialKey: key,
                stock: entry.stock,
                unit: entry.unit || null,
                observedDays,
                calendarDays,
                density: calendarDays > 0 ? observedDays / calendarDays : 0,
                reliability,
                reliable,
                dataIssue,
                averageDaily,
                coverageDays: reliable && averageDaily > 0 ? Math.max(0, entry.stock) / averageDaily : null,
                stockMode: entry.stockMode || "snapshot",
                stockDate: entry.stockDate || null,
                asOfDate: entry.asOfDate || null,
                originalStock: entry.originalStock,
                usageSince: entry.usageSince || 0,
                receiptsSince: entry.receiptsSince || 0,
                sourceSheet: entry.sourceSheet || null,
                sourceRow: entry.sourceRow || null
            };
        }).sort((left, right) => {
            const leftDays = left.coverageDays ?? Infinity;
            const rightDays = right.coverageDays ?? Infinity;
            return leftDays - rightDays;
        });
    }

    // ---- Pareto & ABC -------------------------------------------------

    function getParetoResult(rows) {
        const grouped = groupUsageByMaterial(rows);
        const total = sum(grouped.map((item) => item.value));
        let running = 0;
        let materialsFor80 = 0;
        const items = grouped.map((item) => {
            const shareBefore = total ? (running / total) * 100 : 0;
            if (shareBefore < DECISION.paretoThreshold) materialsFor80 += 1;
            running += item.value;
            const cumulativeShare = total ? (running / total) * 100 : 0;
            return { ...item, cumulativeShare };
        });
        return { rows: items, materialsFor80, total };
    }

    function getAbcRows(rows) {
        const grouped = groupUsageByMaterial(rows);
        const total = sum(grouped.map((item) => item.value));
        let cumulative = 0;
        return grouped.map((item) => {
            const share = total ? (item.value / total) * 100 : 0;
            cumulative += share;
            const classification = cumulative <= DECISION.abcThresholdA ? "A" : cumulative <= DECISION.abcThresholdB ? "B" : "C";
            return { material: item.material, value: item.value, share, cumulative, classification };
        });
    }

    // ---- forecast -------------------------------------------------

    function getNextSeason() {
        const currentSeason = PMA.utils.getSeason(new Date().getMonth() + 1);
        const index = SEASON_CYCLE.indexOf(currentSeason);
        return SEASON_CYCLE[(index + 1) % SEASON_CYCLE.length] || SEASON_CYCLE[0];
    }

    function resolveForecastSeason() {
        return forecastSeason === "auto" ? getNextSeason() : forecastSeason;
    }

    function getForecastRows(season, rows) {
        const grouped = new Map();
        rows.forEach((record) => {
            if (record.season !== season) return;
            const key = materialIdentity(record);
            const periodKey = record.seasonPeriod || `${season}-${record.year || "unknown"}`;
            const entry = grouped.get(key) || { materialKey: key, material: materialLabel(record), used: 0, periods: new Map(), units: new Set() };
            entry.used += parseNumber(record.quantity) || 0;
            const unit = normalizedUnit(record.unit);
            if (unit) entry.units.add(unit);
            const timestamp = dayTimestamp(record.date);
            if (timestamp !== null) {
                const period = entry.periods.get(periodKey) || { min: timestamp, max: timestamp, days: new Set() };
                period.min = Math.min(period.min, timestamp);
                period.max = Math.max(period.max, timestamp);
                period.days.add(timestamp);
                entry.periods.set(periodKey, period);
            }
            grouped.set(key, entry);
        });

        const stockByMaterial = new Map(getLatestStockByMaterial(rows).map((item) => [item.materialKey, item]));

        return [...grouped.values()].map((entry) => {
            let observedDays = 0;
            let calendarDays = 0;
            entry.periods.forEach((period) => {
                observedDays += period.days.size;
                calendarDays += Math.max(1, Math.round((period.max - period.min) / 86400000) + 1);
            });
            calendarDays = Math.max(1, calendarDays);
            const averageDaily = entry.used / calendarDays;
            const inventory = stockByMaterial.get(entry.materialKey) || {};
            const stockUnit = normalizedUnit(inventory.unit);
            const unitConflict = entry.units.size > 1;
            const unitMismatch = !unitConflict && stockUnit && entry.units.size === 1 && !entry.units.has(stockUnit);
            const dataIssue = unitConflict ? "Niejednolite jednostki zużycia" : unitMismatch ? "Jednostka zapasu nie zgadza się z zużyciem" : null;
            const reliability = dataIssue ? "insufficient" : getReliability(observedDays, calendarDays);
            const reliable = reliability !== "insufficient" && !dataIssue;
            const leadTimeDays = Math.max(0, parseNumber(inventory.leadTimeDays) || 0);
            const planningDays = Math.max(forecastDays, leadTimeDays);
            const baseForecast = reliable ? averageDaily * planningDays : 0;
            const safetyStock = Math.max(0, parseNumber(inventory.safetyStock) || 0);
            const recommendedQuantity = reliable ? baseForecast * (1 + forecastBuffer) + safetyStock : 0;
            const stock = Math.max(0, parseNumber(inventory.stock) || 0);
            const openOrders = Math.max(0, parseNumber(inventory.openOrders) || 0);
            const minimumOrderQuantity = Math.max(0, parseNumber(inventory.minimumOrderQuantity) || 0);
            const orderMultiple = Math.max(0, parseNumber(inventory.orderMultiple) || 0);
            const rawToOrder = reliable ? Math.max(0, recommendedQuantity - stock - openOrders) : 0;
            let toOrder = rawToOrder;
            if (toOrder > 0 && minimumOrderQuantity > 0) toOrder = Math.max(toOrder, minimumOrderQuantity);
            if (toOrder > 0 && orderMultiple > 0) toOrder = Math.ceil(toOrder / orderMultiple) * orderMultiple;
            return {
                material: entry.material, materialKey: entry.materialKey, observedDays, calendarDays,
                density: calendarDays > 0 ? observedDays / calendarDays : 0,
                reliability, reliable, dataIssue, averageDaily, baseForecast, recommendedQuantity,
                stock, openOrders, safetyStock, leadTimeDays, planningDays,
                minimumOrderQuantity, orderMultiple, rawToOrder, toOrder,
                unit: inventory.unit || null, supplier: inventory.supplier || null
            };
        }).sort((left, right) => {
            const rankDiff = reliabilityRank(right.reliability) - reliabilityRank(left.reliability);
            return rankDiff !== 0 ? rankDiff : right.toOrder - left.toOrder;
        });
    }

    // ---- rendering -------------------------------------------------

    function createBadge(text, status) {
        return dom.createElement("span", { className: `status-badge status-${status}`, text });
    }

    function renderEmptyRow(table, columnCount, message) {
        const row = dom.createElement("tr");
        row.appendChild(dom.createElement("td", { text: message || UI_TEXT.noData, attributes: { colspan: String(columnCount) } }));
        table.appendChild(row);
    }

    function refresh() {
        if (!initialized) return;
        const rows = getRows();
        renderStockNotice();
        renderDashboard(rows);
        renderCoverage(rows);
        renderParetoAbc(rows);
        renderForecast(rows);
        dom.setDisabled(elements.printDecisionReportButton, !rows.length);
        dom.setDisabled(elements.exportForecastCsvButton, !rows.length || !hasStockMapping());
        dom.setStatusBadge(elements.decisionStatusBadge, rows.length ? `${formatInteger(rows.length)} wierszy` : "Brak danych", rows.length ? STATUS.SUCCESS : "neutral");
        document.dispatchEvent(new CustomEvent(EVENTS.DECISION_BUILT, { detail: { rowCount: rows.length } }));
    }

    function renderStockNotice() {
        const mapped = hasStockMapping();
        const modelAudit = state.get("dataset.modelJoinAudit", null);
        const modelEnabled = state.get("import.dataModel.enabled", false);
        elements.decisionStockNotice.hidden = mapped && !modelEnabled;
        elements.decisionStockNotice.replaceChildren();
        if (modelEnabled && modelAudit) {
            const text = document.createElement("span");
            text.textContent = `Model skoroszytu łączy dane kluczem „${modelAudit.resolvedJoinField || "material"}”. Dopasowano ${modelAudit.matchedMaterials || 0} z ${modelAudit.usageMaterials || 0} materiałów; bez zapasu: ${(modelAudit.unmatchedUsage || []).length}; niezgodne jednostki: ${(modelAudit.unitMismatches || []).length}.`;
            const button = document.createElement("button");
            button.type = "button";
            button.className = "button button-secondary button-small";
            button.textContent = "Sprawdź dane zapasów";
            button.addEventListener("click", () => PMA.spreadsheetEngine?.openStockEditor?.());
            elements.decisionStockNotice.append(text, button);
            return;
        }
        if (!mapped) {
            const text = document.createElement("span");
            text.textContent = "Pareto i ABC działają bez danych zapasu. Aby policzyć pokrycie, ryzyko i zamówienia, zmapuj kolumnę zapasu, wczytaj osobny plik albo wpisz dane ręcznie.";
            const button = document.createElement("button");
            button.type = "button";
            button.className = "button button-secondary button-small";
            button.textContent = "Wprowadź dane ręcznie";
            button.addEventListener("click", () => PMA.spreadsheetEngine?.openStockEditor?.());
            elements.decisionStockNotice.append(text, button);
        }
    }

    function renderDashboard(rows) {
        const used = sum(rows.map((record) => record.quantity));
        const materials = new Set(rows.map(materialIdentity)).size;
        const stockRows = getLatestStockByMaterial(rows);
        const stockMapped = hasStockMapping();

        dom.setText(elements.kpiUsed, formatNumber(used));
        const stockUnits = new Set(stockRows.map((item) => item.unit).filter(Boolean));
        dom.setText(elements.kpiStock, !stockMapped ? "—" : stockUnits.size > 1 ? "różne jednostki" : formatNumber(sum(stockRows.map((item) => item.stock))));
        dom.setText(elements.kpiMaterials, formatInteger(materials));

        if (stockMapped) {
            const coverage = getCoverageRows(rows);
            const risk = coverage.filter((item) => item.coverageDays !== null && item.coverageDays < DECISION.riskCoverageDays).length;
            dom.setText(elements.kpiRisk, formatInteger(risk));
        } else {
            dom.setText(elements.kpiRisk, "—");
        }

        renderDashboardSummary(rows, stockMapped);
    }

    function renderDashboardSummary(rows, stockMapped) {
        dom.clear(elements.decisionSummary);
        if (!rows.length) {
            elements.decisionSummary.appendChild(dom.createElement("p", { text: "Aktualne filtry nie zwracają żadnych wierszy." }));
            return;
        }

        const grouped = groupUsageByMaterial(rows);
        const total = sum(grouped.map((item) => item.value));
        const top = grouped[0];
        const topShare = total ? (top.value / total) * 100 : 0;
        const trend = getTrend(rows);

        const paragraphs = [];
        paragraphs.push(dom.createElement("p", {
            children: [
                "Największe zużycie ma ",
                dom.createElement("strong", { text: top.material }),
                ": ",
                dom.createElement("strong", { text: `${formatNumber(top.value)}` }),
                ` (${formatPercent(topShare, { valueIsPercentage: true, maximumFractionDigits: 1 })} całości po filtrach).`
            ]
        }));

        if (trend) {
            paragraphs.push(dom.createElement("p", {
                children: [
                    "Trend zużycia jest ",
                    dom.createElement("strong", { text: trend.label }),
                    ` — druga połowa okresu różni się o ${formatPercent(Math.abs(trend.change), { valueIsPercentage: true, maximumFractionDigits: 1 })} względem pierwszej.`
                ]
            }));
        }

        if (stockMapped) {
            const coverage = getCoverageRows(rows).filter((item) => item.coverageDays !== null);
            if (coverage.length) {
                const lowest = coverage[0];
                paragraphs.push(dom.createElement("p", {
                    children: [
                        "Najniższe pokrycie zapasu ma ",
                        dom.createElement("strong", { text: lowest.material }),
                        ": ok. ",
                        dom.createElement("strong", { text: `${formatNumber(lowest.coverageDays, { maximumFractionDigits: 1 })} dni` }),
                        " przy obecnym tempie zużycia."
                    ]
                }));
            }
        }

        paragraphs.forEach((paragraph) => elements.decisionSummary.appendChild(paragraph));
    }

    function renderCoverage(rows) {
        dom.clear(elements.coverageTableBody);
        if (!hasStockMapping()) {
            renderEmptyRow(elements.coverageTableBody, 11, "Dodaj arkusz zapasów w modelu skoroszytu, zmapuj stan zapasu albo wprowadź dane ręcznie.");
            return;
        }
        const coverage = getCoverageRows(rows).slice(0, RENDER_ROW_LIMIT);
        if (!coverage.length) {
            renderEmptyRow(elements.coverageTableBody, 11, UI_TEXT.noData);
            return;
        }
        coverage.forEach((item) => {
            const meta = item.dataIssue ? { text: item.dataIssue, status: "danger" } : reliabilityMeta(item.reliability);
            const atRisk = !item.dataIssue && item.coverageDays !== null && item.coverageDays < DECISION.riskCoverageDays;
            const row = dom.createElement("tr");
            row.append(
                dom.createElement("td", { text: item.material }),
                dom.createElement("td", { text: formatNumber(item.averageDaily, { maximumFractionDigits: 2 }) }),
                dom.createElement("td", { text: formatNumber(item.stock) }),
                dom.createElement("td", { text: formatInteger(item.observedDays) }),
                dom.createElement("td", { text: formatInteger(item.calendarDays) }),
                dom.createElement("td", { text: formatPercent(item.density * 100, { valueIsPercentage: true, maximumFractionDigits: 1 }) }),
                dom.createElement("td", { text: item.coverageDays === null ? "—" : formatNumber(item.coverageDays, { maximumFractionDigits: 1 }) }),
                dom.createElement("td", { text: `${item.stockMode === "opening" ? "Początkowy → wyliczony" : "Snapshot"}${item.stockDate ? ` · ${item.stockDate}` : ""}` }),
                dom.createElement("td", { text: item.sourceSheet ? `${item.sourceSheet}${item.sourceRow ? ` · wiersz ${item.sourceRow}` : ""}` : "Dane ręczne / aktywny arkusz" }),
                dom.createElement("td", { children: [createBadge(meta.text, meta.status)] }),
                dom.createElement("td", { children: item.dataIssue ? [createBadge("Sprawdź jednostki", "danger")] : atRisk ? [createBadge("Ryzyko braku", "danger")] : [createBadge("OK", "success")] })
            );
            elements.coverageTableBody.appendChild(row);
        });
    }

    function renderParetoAbc(rows) {
        const pareto = getParetoResult(rows);
        renderParetoChart(pareto);
        renderAbcTable(getAbcRows(rows));
        dom.setText(
            elements.decisionParetoSummary,
            pareto.rows.length
                ? `${formatInteger(pareto.materialsFor80)} z ${formatInteger(pareto.rows.length)} materiałów odpowiada za 80% zużycia.`
                : UI_TEXT.noData
        );
    }

    function destroyParetoChart() {
        if (paretoChart) {
            paretoChart.destroy();
            paretoChart = null;
        }
    }

    function renderParetoChart(pareto) {
        destroyParetoChart();
        if (!pareto.rows.length || typeof global.Chart !== "function") return;
        const visible = pareto.rows.slice(0, 15);
        const context = elements.paretoChart.getContext("2d");
        if (!context) return;
        paretoChart = new global.Chart(context, {
            data: {
                labels: visible.map((item) => truncate(item.material, 18)),
                datasets: [
                    {
                        type: "bar",
                        label: "Zużycie",
                        data: visible.map((item) => item.value),
                        backgroundColor: "rgba(200,16,46,.78)",
                        borderColor: "rgb(200,16,46)",
                        borderWidth: 1,
                        yAxisID: "y"
                    },
                    {
                        type: "line",
                        label: "Skumulowany %",
                        data: visible.map((item) => item.cumulativeShare),
                        borderColor: "rgb(39,100,196)",
                        backgroundColor: "rgba(39,100,196,.15)",
                        yAxisID: "y1",
                        tension: 0.25
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { beginAtZero: true, position: "left" },
                    y1: { beginAtZero: true, max: 100, position: "right", grid: { drawOnChartArea: false } }
                }
            }
        });
    }

    function renderAbcTable(abcRows) {
        dom.clear(elements.abcTableBody);
        const visible = abcRows.slice(0, RENDER_ROW_LIMIT);
        if (!visible.length) {
            renderEmptyRow(elements.abcTableBody, 4, UI_TEXT.noData);
            return;
        }
        const classStatus = { A: "success", B: "warning", C: "neutral" };
        visible.forEach((item) => {
            const row = dom.createElement("tr");
            row.append(
                dom.createElement("td", { text: item.material }),
                dom.createElement("td", { text: formatNumber(item.value) }),
                dom.createElement("td", { text: formatPercent(item.share, { valueIsPercentage: true, maximumFractionDigits: 1 }) }),
                dom.createElement("td", { children: [createBadge(item.classification, classStatus[item.classification] || "neutral")] })
            );
            elements.abcTableBody.appendChild(row);
        });
    }

    function renderForecast(rowsOverride) {
        const rows = rowsOverride || getRows();
        dom.clear(elements.forecastTableBody);
        if (!hasStockMapping()) {
            renderEmptyRow(elements.forecastTableBody, 12, "Zmapuj pole \"Aktualny stan zapasu\" lub wczytaj osobną tabelę zapasów, aby oszacować zamówienia.");
            return;
        }
        const season = resolveForecastSeason();
        const forecast = getForecastRows(season, rows).slice(0, RENDER_ROW_LIMIT);
        if (!forecast.length) {
            renderEmptyRow(elements.forecastTableBody, 12, `Brak danych dla sezonu: ${season}.`);
            return;
        }
        forecast.forEach((item) => {
            const meta = item.dataIssue ? { text: item.dataIssue, status: "danger" } : reliabilityMeta(item.reliability);
            const row = dom.createElement("tr");
            const orderRules = [
                item.minimumOrderQuantity > 0 ? `MOQ ${formatNumber(item.minimumOrderQuantity)}` : null,
                item.orderMultiple > 0 ? `× ${formatNumber(item.orderMultiple)}` : null
            ].filter(Boolean).join(" / ") || "—";
            const leadTimeText = item.leadTimeDays > 0
                ? `${formatInteger(item.leadTimeDays)} dni (plan: ${formatInteger(item.planningDays)})`
                : `${formatInteger(item.planningDays)} dni`;
            row.append(
                dom.createElement("td", { text: item.material }),
                dom.createElement("td", { text: formatNumber(item.averageDaily, { maximumFractionDigits: 2 }) }),
                dom.createElement("td", { text: leadTimeText }),
                dom.createElement("td", { text: formatNumber(item.recommendedQuantity, { maximumFractionDigits: 0 }) }),
                dom.createElement("td", { text: formatNumber(item.stock) }),
                dom.createElement("td", { text: formatNumber(item.openOrders) }),
                dom.createElement("td", { text: orderRules }),
                dom.createElement("td", { text: formatNumber(item.toOrder, { maximumFractionDigits: 0 }) }),
                dom.createElement("td", { text: formatInteger(item.observedDays) }),
                dom.createElement("td", { text: formatInteger(item.calendarDays) }),
                dom.createElement("td", { text: formatPercent(item.density * 100, { valueIsPercentage: true, maximumFractionDigits: 1 }) }),
                dom.createElement("td", { children: [createBadge(meta.text, meta.status)] })
            );
            elements.forecastTableBody.appendChild(row);
        });
    }

    function exportForecastCsv() {
        try {
            if (!hasStockMapping()) throw new Error("Zmapuj pole \"Aktualny stan zapasu\" lub wczytaj osobną tabelę zapasów, aby wyeksportować oszacowanie.");
            const season = resolveForecastSeason();
            const rows = getForecastRows(season, getRows());
            if (!rows.length) throw new Error(`Brak danych do oszacowania dla sezonu: ${season}.`);
            const delimiter = ";";
            const headers = [
                "Materiał", "Sezon", "Horyzont użytkownika (dni)", "Lead time (dni)", "Horyzont planowania (dni)",
                "Bufor (%)", "Śr. dzienne zużycie", "Zapotrzebowanie z buforem", "Safety stock",
                "Aktualny stan zapasu", "Otwarte zamówienia", "MOQ", "Krotność zamówienia",
                "Surowe zapotrzebowanie do zamówienia", "Do zamówienia po regułach", "Jednostka", "Dostawca",
                "Dni obserwacji", "Zakres kalendarzowy", "Gęstość danych (%)", "Wiarygodność"
            ];
            const lines = [headers.map(csvCell).join(delimiter)];
            rows.forEach((item) => {
                lines.push([
                    item.material, season, forecastDays, item.leadTimeDays, item.planningDays,
                    forecastBuffer * 100, item.averageDaily, item.recommendedQuantity, item.safetyStock,
                    item.stock, item.openOrders, item.minimumOrderQuantity, item.orderMultiple,
                    item.rawToOrder, item.toOrder, item.unit || "", item.supplier || "",
                    item.observedDays, item.calendarDays, item.density * 100,
                    item.dataIssue || reliabilityMeta(item.reliability).text
                ].map(csvCell).join(delimiter));
            });
            const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
            downloadBlob(blob, `forecast-${slug(season)}-${dateStamp()}.csv`);
            dom.showSuccess("Szacowane zapotrzebowanie wyeksportowano do CSV.", "Eksport zapotrzebowania");
        } catch (error) {
            handleError(error, "Eksport zapotrzebowania");
        }
    }

    function printDecisionReport() {
        global.setTimeout(() => global.print(), 0);
    }

    function csvCell(value) {
        const numericValue = typeof value === "number" && Number.isFinite(value);
        let normalized = value === null || value === undefined
            ? ""
            : numericValue
                ? String(value).replace(".", ",")
                : String(value);
        if (!numericValue && /^[=+\-@\t\r]/.test(normalized)) normalized = `'${normalized}`;
        return /[;"\r\n]/.test(normalized) ? `"${normalized.replace(/"/g, '""')}"` : normalized;
    }

    function downloadBlob(blob, filename) {
        const url = global.URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = filename;
        anchor.hidden = true;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        global.setTimeout(() => global.URL.revokeObjectURL(url), 1000);
    }

    function slug(value) {
        return String(value || "forecast").toLocaleLowerCase("pl-PL").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    }

    function dateStamp() {
        const date = new Date();
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    }

    function handleError(error, context = "Analiza decyzyjna") {
        dom.showError(normalizeError(error).message, context);
    }

    const api = Object.freeze({
        initialize,
        destroy,
        refresh,
        switchTab,
        getCoverageRows,
        getParetoResult,
        getAbcRows,
        getForecastRows,
        exportForecastCsv,
        csvCell,
        printDecisionReport,
        handleError,
        get initialized() {
            return initialized;
        }
    });

    Object.defineProperty(PMA, "decisionEngine", {
        value: api,
        writable: false,
        enumerable: true,
        configurable: false
    });
})(window);
