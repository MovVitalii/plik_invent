'use strict';

/* =========================================================
   Material Intelligence Center
   Outbound Pack Online
========================================================= */

const App = {
    workbook: null,
    sheetNames: [],
    currentSheet: '',
    fileName: '',
    rows: [],
    columns: [],
    filteredRows: [],
    charts: {},
    page: 1,
    pageSize: 50,

    mapping: {
        date: '',
        material: '',
        type: '',
        brand: '',
        product: '',
        beginStock: '',
        received: '',
        used: '',
        damaged: '',
        returned: '',
        ending: '',
        unit: ''
    },

    filters: {
        dateFrom: '',
        dateTo: '',
        material: '',
        type: '',
        brand: '',
        product: '',
        season: ''
    },

    tableSearch: '',
    forecast: {
        season: 'auto',
        days: 90,
        buffer: 0.15
    }
};

const COLORS = [
    '#e8a23d', '#5fb88a', '#5794e8', '#d9605c',
    '#9a79dd', '#48b9ba', '#ef8952', '#d374c2',
    '#84a84b', '#cc9a4f', '#6d9de0', '#c36d66'
];

const MAP_FIELDS = {
    date: 'mapDate',
    material: 'mapMaterial',
    type: 'mapType',
    brand: 'mapBrand',
    product: 'mapProduct',
    beginStock: 'mapBeginStock',
    received: 'mapReceived',
    used: 'mapUsed',
    damaged: 'mapDamaged',
    returned: 'mapReturned',
    ending: 'mapEnding',
    unit: 'mapUnit'
};

document.addEventListener('DOMContentLoaded', init);

/* =========================================================
   INIT
========================================================= */

function init() {
    bindMainButtons();
    bindUpload();
    bindTabs();
    bindFilters();
    bindMapping();
    bindForecastControls();
    bindTableControls();
    updateDataStatus('Oczekiwanie na dane');
}

function bindMainButtons() {
    byId('btnLoadExcel')?.addEventListener('click', () => byId('fileInput').click());
    byId('btnExportFiltered')?.addEventListener('click', exportCurrentData);
    byId('btnExportWorkspace')?.addEventListener('click', exportWorkspace);
    byId('btnImportWorkspace')?.addEventListener('click', () => byId('workspaceImportInput').click());
    byId('btnPrint')?.addEventListener('click', () => window.print());

    byId('workspaceImportInput')?.addEventListener('change', importWorkspace);
    byId('sheetSelect')?.addEventListener('change', event => loadSheet(event.target.value));

    byId('btnAutoDetect')?.addEventListener('click', () => {
        autoDetectColumns(true);
        syncMappingToUI();
        toast('Automatyczne mapowanie zostało zaktualizowane.', 'success');
    });

    byId('btnApplyMapping')?.addEventListener('click', () => {
        readMappingFromUI();
        applyConfiguration();
        toast('Mapowanie kolumn zostało zastosowane.', 'success');
    });

    byId('btnResetFilters')?.addEventListener('click', resetFilters);
    byId('btnRefreshForecast')?.addEventListener('click', () => {
        readForecastControls();
        renderForecast();
        toast('Prognoza została przeliczona.', 'success');
    });

    byId('btnExportForecast')?.addEventListener('click', exportForecast);
    byId('btnExportTable')?.addEventListener('click', exportCurrentData);
    byId('btnClearTableSearch')?.addEventListener('click', () => {
        App.tableSearch = '';
        const input = byId('tableSearch');
        if (input) input.value = '';
        App.page = 1;
        renderTable();
    });

    document.querySelectorAll('[data-open-tab]').forEach(button => {
        button.addEventListener('click', () => openTab(button.dataset.openTab));
    });
}

function bindUpload() {
    const input = byId('fileInput');
    const dropZone = byId('dropZone');

    input?.addEventListener('change', event => {
        const file = event.target.files?.[0];
        if (file) readFile(file);
    });

    dropZone?.addEventListener('click', () => input?.click());

    dropZone?.addEventListener('dragover', event => {
        event.preventDefault();
        dropZone.classList.add('drag-over');
    });

    dropZone?.addEventListener('dragleave', () => {
        dropZone.classList.remove('drag-over');
    });

    dropZone?.addEventListener('drop', event => {
        event.preventDefault();
        dropZone.classList.remove('drag-over');

        const file = event.dataTransfer.files?.[0];
        if (file) readFile(file);
    });
}

function bindTabs() {
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => openTab(tab.dataset.tab));
    });
}

function bindFilters() {
    const filterIds = [
        'filterDateFrom',
        'filterDateTo',
        'filterMaterial',
        'filterType',
        'filterBrand',
        'filterProduct',
        'filterSeason'
    ];

    filterIds.forEach(id => {
        byId(id)?.addEventListener('change', () => {
            readFiltersFromUI();
            App.page = 1;
            applyFilters();
            renderAll();
        });
    });
}

function bindMapping() {
    Object.values(MAP_FIELDS).forEach(id => {
        byId(id)?.addEventListener('change', () => {
            updateMappingInfo();
        });
    });
}

function bindForecastControls() {
    byId('forecastSeason')?.addEventListener('change', () => {
        readForecastControls();
        renderForecast();
    });

    byId('forecastDays')?.addEventListener('change', () => {
        readForecastControls();
        renderForecast();
    });

    byId('forecastBuffer')?.addEventListener('change', () => {
        readForecastControls();
        renderForecast();
    });
}

function bindTableControls() {
    byId('tableSearch')?.addEventListener('input', event => {
        App.tableSearch = event.target.value.trim().toLowerCase();
        App.page = 1;
        renderTable();
    });

    byId('btnTablePrev')?.addEventListener('click', () => {
        if (App.page > 1) {
            App.page--;
            renderTable();
        }
    });

    byId('btnTableNext')?.addEventListener('click', () => {
        const totalPages = getTablePageCount();

        if (App.page < totalPages) {
            App.page++;
            renderTable();
        }
    });
}

/* =========================================================
   FILE / EXCEL
========================================================= */

function readFile(file) {
    showLoading('Odczyt pliku...', 'Trwa ładowanie raportu Excel.');

    const reader = new FileReader();

    reader.onload = event => {
        window.setTimeout(() => {
            try {
                App.workbook = XLSX.read(event.target.result, {
                    type: 'array',
                    cellDates: true
                });

                App.fileName = file.name;
                App.sheetNames = App.workbook.SheetNames || [];

                if (!App.sheetNames.length) {
                    throw new Error('Plik nie zawiera żadnych arkuszy.');
                }

                renderSheetSelect();
                loadSheet(App.sheetNames[0]);

                byId('uploadScreen').hidden = true;
                byId('app').hidden = false;

                byId('loadedFile').textContent = file.name;
                byId('infoFile').textContent = file.name;

                byId('btnExportFiltered').disabled = false;
                byId('btnExportWorkspace').disabled = false;
                byId('btnExportTable').disabled = false;

                toast(`Załadowano plik: ${file.name}`, 'success');
            } catch (error) {
                console.error(error);
                toast(`Nie można odczytać pliku: ${error.message}`, 'error');
            } finally {
                hideLoading();
                byId('fileInput').value = '';
            }
        }, 40);
    };

    reader.onerror = () => {
        hideLoading();
        toast('Nie można odczytać wybranego pliku.', 'error');
    };

    reader.readAsArrayBuffer(file);
}

function renderSheetSelect() {
    const select = byId('sheetSelect');
    if (!select) return;

    select.innerHTML = App.sheetNames
        .map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`)
        .join('');

    select.disabled = App.sheetNames.length <= 1;
}

function loadSheet(sheetName) {
    if (!App.workbook || !sheetName) return;

    showLoading('Przetwarzanie arkusza...', 'Wykrywanie nagłówków oraz typów danych.');

    window.setTimeout(() => {
        try {
            const sheet = App.workbook.Sheets[sheetName];

            if (!sheet) {
                throw new Error('Nie znaleziono wybranego arkusza.');
            }

            App.currentSheet = sheetName;

            const headerRow = detectHeaderRow(sheet);

            const rows = XLSX.utils.sheet_to_json(sheet, {
                range: headerRow,
                raw: false,
                defval: ''
            });

            App.rows = normalizeRows(
                rows.filter(row =>
                    Object.values(row).some(value => String(value ?? '').trim() !== '')
                )
            );

            App.columns = App.rows.length ? Object.keys(App.rows[0]) : [];
            App.filteredRows = [...App.rows];
            App.page = 1;

            clearInvalidMappingColumns();
            autoDetectColumns(false);
            populateMappingSelects();
            syncMappingToUI();

            resetFilters();
            readForecastControls();

            byId('sheetSelect').value = sheetName;
            byId('infoRows').textContent = formatNumber(App.rows.length, 0);
            byId('infoCols').textContent = formatNumber(App.columns.length, 0);

            updateDataStatus(`${App.rows.length.toLocaleString('pl-PL')} wierszy gotowych do analizy`);

            applyConfiguration(false);
        } catch (error) {
            console.error(error);
            toast(`Błąd arkusza: ${error.message}`, 'error');
        } finally {
            hideLoading();
        }
    }, 30);
}

function normalizeText(value) {
    return String(value ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

function detectHeaderRow(sheet) {
    const matrix = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        raw: false,
        defval: ''
    });

    const headerKeywords = [
        'date', 'data', 'material', 'materiał', 'sku', 'article', 'artykuł',
        'stock', 'zapas', 'ending', 'used', 'usage', 'zużycie', 'received',
        'delivery', 'dostawa', 'returned', 'zwrot', 'damage', 'brand', 'season'
    ];

    let bestIndex = 0;
    let bestScore = -Infinity;

    for (let index = 0; index < Math.min(matrix.length, 20); index++) {
        const row = matrix[index] || [];
        const values = row.map(value => String(value ?? '').trim()).filter(Boolean);
        if (values.length < 2) continue;

        const normalized = values.map(normalizeText);
        const uniqueRatio = new Set(normalized).size / values.length;
        const textCells = values.filter(value => Number.isNaN(Number(value.replace(',', '.')))).length;
        const textRatio = textCells / values.length;
        const keywordHits = normalized.filter(value =>
            headerKeywords.some(keyword => value.includes(normalizeText(keyword)))
        ).length;

        const followingRows = matrix.slice(index + 1, index + 5);
        const followingDensity = followingRows.length
            ? followingRows.reduce((total, nextRow) => {
                const filled = (nextRow || []).filter(value => String(value ?? '').trim() !== '').length;
                return total + Math.min(filled, values.length) / values.length;
            }, 0) / followingRows.length
            : 0;

        const score =
            values.length * 2 +
            uniqueRatio * 4 +
            textRatio * 3 +
            keywordHits * 6 +
            followingDensity * 5;

        if (score > bestScore) {
            bestScore = score;
            bestIndex = index;
        }
    }

    return bestIndex;
}

function normalizeRows(rows) {
    return rows.map(row => {
        const normalized = {};

        Object.entries(row).forEach(([key, value]) => {
            const cleanKey = String(key ?? '').trim();

            if (!cleanKey) return;

            normalized[cleanKey] = typeof value === 'string'
                ? value.trim()
                : value;
        });

        return normalized;
    });
}

/* =========================================================
   MAPPING
========================================================= */

function populateMappingSelects() {
    Object.values(MAP_FIELDS).forEach(id => {
        const select = byId(id);

        if (!select) return;

        select.disabled = App.columns.length === 0;
        select.innerHTML = `
            <option value="">— nie wybrano —</option>
            ${App.columns
                .map(column => `<option value="${escapeHtml(column)}">${escapeHtml(column)}</option>`)
                .join('')
            }
        `;
    });

    updateMappingInfo();
}

function syncMappingToUI() {
    Object.entries(MAP_FIELDS).forEach(([key, id]) => {
        const select = byId(id);

        if (!select) return;

        select.value = App.mapping[key] || '';
    });

    updateMappingInfo();
}

function readMappingFromUI() {
    Object.entries(MAP_FIELDS).forEach(([key, id]) => {
        App.mapping[key] = byId(id)?.value || '';
    });
}

function clearInvalidMappingColumns() {
    Object.keys(App.mapping).forEach(key => {
        if (App.mapping[key] && !App.columns.includes(App.mapping[key])) {
            App.mapping[key] = '';
        }
    });
}

function autoDetectColumns(overwrite = false) {
    // Patterns are ordered from most specific (exact/anchored) to most generic.
    // This ordering matters: within a single field, a broad pattern like /stock/i
    // must only be tried after every more specific pattern has been checked
    // against ALL columns, otherwise a generic word matches the wrong column
    // just because it happens to come first in the sheet (e.g. "Begin Stock"
    // being picked for "ending" instead of the actual "Ending" column).
    const rules = {
        date: [/^date$/i, /^data$/i, /date/i, /data/i, /dzień/i, /day/i, /datum/i],
        material: [/^material$/i, /^materiał$/i, /^sku$/i, /^item$/i, /^article$/i,
            /material/i, /materiał/i, /item/i, /sku/i, /article/i, /karton/i, /box/i, /foil/i, /paper/i],
        type: [/^type$/i, /^typ$/i, /material.*type/i, /type/i, /typ/i, /category/i, /kategoria/i, /rodzaj/i, /packaging/i],
        brand: [/^brand$/i, /^marka$/i, /brand/i, /marka/i, /marke/i],
        product: [/^product$/i, /^produkt$/i, /product/i, /produkt/i, /style/i, /assortment/i, /department/i, /dept/i, /nazwa/i],
        beginStock: [/^begin.*stock$/i, /^opening.*stock$/i, /begin/i, /opening/i, /start.*stock/i, /initial/i, /początk/i],
        received: [/received/i, /delivery/i, /inbound/i, /przyję/i, /przych[oó]d/i, /dostaw/i],
        used: [/^used$/i, /used/i, /usage/i, /consum/i, /consume/i, /zuży/i, /wydan/i, /qty.*out/i, /issue/i, /rozch[oó]d/i],
        damaged: [/damage/i, /damaged/i, /scrap/i, /waste/i, /uszkodz/i, /strat/i],
        returned: [/return/i, /returned/i, /zwrot/i],
        ending: [/^ending$/i, /^end.*stock$/i, /^stan.*końcow/i, /ending/i, /end.*stock/i, /on.*hand/i,
            /balance/i, /available/i, /remaining/i, /left/i, /stan/i, /zapas/i, /stock/i],
        unit: [/^unit$/i, /uom/i, /jednost/i, /^jm$/i]
    };

    // Columns already claimed (either by a previous auto-detect run, or by an
    // earlier field in this same pass) are taken out of the running so two
    // different mapping fields can never silently point at the same column.
    const claimedColumns = new Set(
        overwrite ? [] : Object.values(App.mapping).filter(Boolean)
    );

    Object.entries(rules).forEach(([key, patterns]) => {
        if (!overwrite && App.mapping[key]) {
            claimedColumns.add(App.mapping[key]);
            return;
        }

        let found = null;

        for (const pattern of patterns) {
            found = App.columns.find(column =>
                !claimedColumns.has(column) && pattern.test(column)
            );

            if (found) break;
        }

        if (found) {
            App.mapping[key] = found;
            claimedColumns.add(found);
        }
    });
}

function updateMappingInfo() {
    const info = byId('mappingInfo');

    if (!info) return;

    if (!App.columns.length) {
        info.textContent = 'Załaduj plik Excel, aby zobaczyć dostępne kolumny.';
        return;
    }

    const material = byId('mapMaterial')?.value;
    const used = byId('mapUsed')?.value;
    const date = byId('mapDate')?.value;
    const ending = byId('mapEnding')?.value;

    const missing = [];

    if (!material) missing.push('Materiał');
    if (!used) missing.push('Zużycie');

    if (!missing.length) {
        info.innerHTML = `
            Mapowanie podstawowe jest kompletne.
            ${date ? ' Wykres trendu i sezonowość będą dostępne.' : ' Dodaj Datę, aby aktywować trend oraz prognozę sezonową.'}
            ${ending ? ' Pokrycie zapasu będzie dostępne.' : ' Dodaj Stan końcowy, aby obliczać pokrycie zapasu.'}
        `;
        return;
    }

    info.innerHTML = `
        Brakuje pól wymaganych do pełnej analizy:
        <strong>${missing.join(', ')}</strong>.
    `;
}

function applyConfiguration(showToast = true) {
    readMappingFromUI();
    populateFilters();
    applyFilters();
    renderAll();

    if (showToast) {
        updateDataStatus('Mapowanie i dashboard zostały zaktualizowane');
    }
}

function mappingIsReady() {
    return Boolean(App.mapping.material && App.mapping.used);
}

function hasForecastData() {
    return Boolean(App.mapping.date && App.mapping.material && App.mapping.used);
}

function hasCoverageData() {
    return Boolean(App.mapping.material && App.mapping.used && App.mapping.ending);
}

/* =========================================================
   FILTERS
========================================================= */

function populateFilters() {
    fillFilter('filterMaterial', App.mapping.material, App.filters.material);
    fillFilter('filterType', App.mapping.type, App.filters.type);
    fillFilter('filterBrand', App.mapping.brand, App.filters.brand);
    fillFilter('filterProduct', App.mapping.product, App.filters.product);

    const dateFrom = byId('filterDateFrom');
    const dateTo = byId('filterDateTo');

    if (dateFrom) dateFrom.value = App.filters.dateFrom || '';
    if (dateTo) dateTo.value = App.filters.dateTo || '';

    const season = byId('filterSeason');
    if (season) season.value = App.filters.season || '';
}

function fillFilter(id, column, currentValue) {
    const select = byId(id);

    if (!select) return;

    if (!column) {
        select.innerHTML = '<option value="">Wszystkie</option>';
        select.disabled = true;
        return;
    }

    const values = uniqueValues(
        App.rows.map(row => row[column])
    );

    select.disabled = false;
    select.innerHTML = `
        <option value="">Wszystkie</option>
        ${values.map(value =>
            `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`
        ).join('')}
    `;

    select.value = currentValue || '';
}

function readFiltersFromUI() {
    App.filters = {
        dateFrom: byId('filterDateFrom')?.value || '',
        dateTo: byId('filterDateTo')?.value || '',
        material: byId('filterMaterial')?.value || '',
        type: byId('filterType')?.value || '',
        brand: byId('filterBrand')?.value || '',
        product: byId('filterProduct')?.value || '',
        season: byId('filterSeason')?.value || ''
    };
}

function resetFilters() {
    App.filters = {
        dateFrom: '',
        dateTo: '',
        material: '',
        type: '',
        brand: '',
        product: '',
        season: ''
    };

    populateFilters();
    applyFilters();
    App.page = 1;
    renderAll();
}

function applyFilters() {
    const f = App.filters;
    const map = App.mapping;

    App.filteredRows = App.rows.filter(row => {
        if (map.date) {
            const date = parseDate(row[map.date]);

            if (f.dateFrom && (!date || date < parseDate(f.dateFrom))) return false;
            if (f.dateTo && (!date || date > endOfDay(parseDate(f.dateTo)))) return false;
            if (f.season && getSeason(row[map.date]) !== f.season) return false;
        }

        if (map.material && f.material && stringValue(row[map.material]) !== f.material) return false;
        if (map.type && f.type && stringValue(row[map.type]) !== f.type) return false;
        if (map.brand && f.brand && stringValue(row[map.brand]) !== f.brand) return false;
        if (map.product && f.product && stringValue(row[map.product]) !== f.product) return false;

        return true;
    });
}

/* =========================================================
   RENDER
========================================================= */

function renderAll() {
    destroyAllCharts();
    renderMappingWarning();
    renderDashboardVisibility();
    renderKpis();
    renderExecutiveSummary();
    renderDashboardCharts();
    renderRecommendations();
    renderMaterialHealth();
    renderAnalytics();
    renderForecast();
    renderTable();

    updateDataStatus(
        App.rows.length
            ? `${App.filteredRows.length.toLocaleString('pl-PL')} / ${App.rows.length.toLocaleString('pl-PL')} wierszy po filtrach`
            : 'Oczekiwanie na dane'
    );
}

function renderMappingWarning() {
    const warning = byId('mappingWarning');

    if (!warning) return;

    const missing = [];

    if (!App.mapping.material) missing.push('Materiał');
    if (!App.mapping.used) missing.push('Zużycie');

    warning.hidden = missing.length === 0;

    if (missing.length) {
        warning.innerHTML = `
            <strong>Brakuje wymaganych pól: ${missing.join(', ')}.</strong>
            Przejdź do zakładki „Mapowanie kolumn”, aby wskazać dane źródłowe.
        `;
    }
}

function renderDashboardVisibility() {
    const empty = byId('dashboardEmptyState');
    const content = byId('dashboardContent');

    const ready = mappingIsReady();

    if (empty) empty.hidden = ready;
    if (content) content.hidden = !ready;
}

function renderKpis() {
    if (!mappingIsReady()) {
        setText('kpiUsed', '—');
        setText('kpiStock', '—');
        setText('kpiMaterials', '—');
        setText('kpiRisk', '—');
        setText('kpiUsedMeta', 'Brak mapowania');
        setText('kpiStockMeta', 'Brak mapowania');
        setText('kpiMaterialsMeta', 'Brak mapowania');
        setText('kpiRiskMeta', 'Brak mapowania');
        return;
    }

    const unit = getUnit();
    const used = sum(App.filteredRows.map(row => numberValue(row[App.mapping.used])));
    const materials = uniqueValues(App.filteredRows.map(row => row[App.mapping.material])).length;

    const stockRecords = getLatestStockByMaterial(App.filteredRows);
    const stock = sum(stockRecords.map(item => item.stock));

    const coverage = getCoverageRows(App.filteredRows);
    const risk = coverage.filter(item => item.coverageDays !== null && item.coverageDays < 7).length;

    setText('kpiUsed', `${formatNumber(used)}${unit ? ` ${unit}` : ''}`);
    setText('kpiStock', App.mapping.ending ? `${formatNumber(stock)}${unit ? ` ${unit}` : ''}` : '—');
    setText('kpiMaterials', formatNumber(materials, 0));
    setText('kpiRisk', App.mapping.ending ? formatNumber(risk, 0) : '—');

    setText('kpiUsedMeta', `${formatNumber(App.filteredRows.length, 0)} wierszy po filtrach`);
    setText('kpiStockMeta', App.mapping.ending ? 'Suma ostatnich stanów materiałów' : 'Wskaż stan końcowy');
    setText('kpiMaterialsMeta', 'Unikalne pozycje materiałowe');
    setText('kpiRiskMeta', App.mapping.ending ? 'Pokrycie poniżej 7 dni' : 'Wskaż stan końcowy');
}

function renderExecutiveSummary() {
    const host = byId('analysisSummary');
    const badge = byId('summaryScope');

    if (!host) return;

    if (!mappingIsReady()) {
        host.textContent = 'Wskaż Materiał i Zużycie, aby rozpocząć analizę.';
        if (badge) badge.textContent = 'Brak mapowania';
        return;
    }

    if (!App.filteredRows.length) {
        host.innerHTML = `
            <p>Aktualne filtry nie zwracają żadnych wierszy.</p>
            <p>Wyczyść filtry lub wybierz inny zakres danych.</p>
        `;

        if (badge) badge.textContent = '0 wierszy';
        return;
    }

    const usedByMaterial = groupSum(App.filteredRows, App.mapping.material, App.mapping.used);
    const totalUsed = sum(usedByMaterial.map(item => item.value));
    const topMaterial = usedByMaterial[0];
    const topShare = totalUsed ? (topMaterial.value / totalUsed) * 100 : 0;

    const trend = getTrend(App.filteredRows);
    const coverage = getCoverageRows(App.filteredRows)
        .filter(item => item.coverageDays !== null)
        .sort((a, b) => a.coverageDays - b.coverageDays);

    const coverageText = coverage.length
        ? `<p>Najniższe pokrycie zapasu ma <strong>${escapeHtml(coverage[0].material)}</strong>: około <strong>${formatNumber(coverage[0].coverageDays, 1)} dni</strong> przy obecnym średnim tempie zużycia.</p>`
        : '';

    const trendText = trend
        ? `<p>Trend zużycia jest <strong>${trend.label}</strong>. Druga połowa wybranego okresu jest <strong>${formatNumber(Math.abs(trend.change), 1)}%</strong> ${trend.change >= 0 ? 'wyższa' : 'niższa'} niż pierwsza.</p>`
        : '';

    host.innerHTML = `
        <p>
            Wybrany zakres zawiera <strong>${formatNumber(App.filteredRows.length, 0)}</strong> wpisów
            oraz <strong>${formatNumber(usedByMaterial.length, 0)}</strong> unikalnych materiałów.
        </p>

        <p>
            Największe zużycie ma <strong>${escapeHtml(topMaterial.label)}</strong>:
            <strong>${formatNumber(topMaterial.value)}</strong> ${escapeHtml(getUnit())}.
            To <strong>${formatNumber(topShare, 1)}%</strong> całkowitego zużycia po filtrach.
        </p>

        ${trendText}
        ${coverageText}

        <p>
            Wysokie zużycie nie jest samo w sobie problemem. Ryzyko powstaje,
            gdy wysokie zużycie łączy się z niskim zapasem albo rosnącym trendem.
        </p>
    `;

    if (badge) {
        badge.textContent = `${formatNumber(App.filteredRows.length, 0)} wierszy`;
    }
}

function renderDashboardCharts() {
    renderMaterialChart();
    renderTrendChart();
    renderCoverageChart();
    renderBrandChart();
}

function renderMaterialChart() {
    if (!mappingIsReady()) {
        setInsight('insightMaterial', 'Wskaż Materiał i Zużycie w mapowaniu kolumn.', 'warning');
        return;
    }

    const grouped = groupSum(App.filteredRows, App.mapping.material, App.mapping.used).slice(0, 10);

    if (!grouped.length) {
        setInsight('insightMaterial', 'Brak danych dla aktualnych filtrów.', 'warning');
        return;
    }

    createChart('chartMaterial', 'bar', {
        labels: grouped.map(item => item.label),
        datasets: [{
            label: 'Zużycie',
            data: grouped.map(item => item.value),
            backgroundColor: COLORS,
            borderColor: COLORS,
            borderWidth: 1
        }]
    });

    const total = sum(grouped.map(item => item.value));
    const top = grouped[0];
    const share = total ? (top.value / total) * 100 : 0;

    setInsight(
        'insightMaterial',
        `Najczęściej używany materiał to <strong>${escapeHtml(top.label)}</strong>:
        <strong>${formatNumber(top.value)} ${escapeHtml(getUnit())}</strong>.
        Stanowi około <strong>${formatNumber(share, 1)}%</strong> zużycia widocznego na wykresie.
        To priorytetowa pozycja do kontroli zapasu.`,
        'warning'
    );
}

function renderTrendChart() {
    if (!App.mapping.date || !App.mapping.used) {
        setInsight('insightTrend', 'Wskaż Datę i Zużycie, aby zbudować trend.', 'warning');
        return;
    }

    const trendData = getDailyUsage(App.filteredRows);

    if (trendData.labels.length < 2) {
        setInsight('insightTrend', 'Potrzebne są co najmniej dwa dni danych.', 'warning');
        return;
    }

    createChart('chartTrend', 'line', {
        labels: trendData.labels,
        datasets: [{
            label: 'Zużycie dzienne',
            data: trendData.values,
            borderColor: COLORS[0],
            backgroundColor: 'rgba(232,162,61,.18)',
            pointBackgroundColor: COLORS[0],
            pointRadius: 3,
            borderWidth: 2,
            fill: true,
            tension: .28
        }]
    });

    const trend = getTrend(App.filteredRows);

    setInsight(
        'insightTrend',
        trend
            ? `Trend jest <strong>${trend.label}</strong>. Druga połowa okresu jest
               <strong>${formatNumber(Math.abs(trend.change), 1)}%</strong>
               ${trend.change >= 0 ? 'wyższa' : 'niższa'} niż pierwsza.
               ${trend.change > 10 ? 'Przy rosnącym zużyciu należy wcześniej planować replenishment.' : ''}
              `
            : 'Brak wystarczających danych do oceny trendu.',
        trend && trend.change > 10 ? 'warning' : 'good'
    );
}

function renderCoverageChart() {
    if (!hasCoverageData()) {
        setInsight(
            'insightCoverage',
            'Wskaż Materiał, Zużycie i Stan końcowy, aby obliczyć pokrycie zapasu.',
            'warning'
        );
        return;
    }

    const coverage = getCoverageRows(App.filteredRows)
        .filter(item => item.coverageDays !== null)
        .sort((a, b) => a.coverageDays - b.coverageDays)
        .slice(0, 10);

    if (!coverage.length) {
        setInsight('insightCoverage', 'Brak poprawnych wartości do obliczenia pokrycia.', 'warning');
        return;
    }

    createChart('chartCoverage', 'bar', {
        labels: coverage.map(item => item.material),
        datasets: [{
            label: 'Dni pokrycia',
            data: coverage.map(item => item.coverageDays),
            backgroundColor: coverage.map(item => {
                if (item.coverageDays < 7) return COLORS[3];
                if (item.coverageDays < 14) return COLORS[0];
                return COLORS[1];
            }),
            borderWidth: 0
        }]
    });

    const lowest = coverage[0];

    setInsight(
        'insightCoverage',
        `Najkrótsze pokrycie ma <strong>${escapeHtml(lowest.material)}</strong>:
        około <strong>${formatNumber(lowest.coverageDays, 1)} dni</strong>.
        ${lowest.coverageDays < 7
            ? 'Materiał wymaga pilnej weryfikacji zamówienia.'
            : lowest.coverageDays < 14
                ? 'Warto rozpocząć planowanie uzupełnienia.'
                : 'Poziom nie wygląda na krytyczny przy obecnym tempie zużycia.'
        }`,
        lowest.coverageDays < 7 ? 'bad' : lowest.coverageDays < 14 ? 'warning' : 'good'
    );
}

function renderBrandChart() {
    if (!App.mapping.brand || !App.mapping.used) {
        setInsight('insightBrand', 'Wskaż Markę i Zużycie, aby porównać marki.', 'warning');
        return;
    }

    const grouped = groupSum(App.filteredRows, App.mapping.brand, App.mapping.used).slice(0, 10);

    if (!grouped.length) {
        setInsight('insightBrand', 'Brak danych marki po filtrach.', 'warning');
        return;
    }

    createChart('chartBrand', 'bar', {
        labels: grouped.map(item => item.label),
        datasets: [{
            label: 'Zużycie',
            data: grouped.map(item => item.value),
            backgroundColor: COLORS,
            borderColor: COLORS,
            borderWidth: 1
        }]
    });

    const top = grouped[0];
    const total = sum(grouped.map(item => item.value));
    const share = total ? (top.value / total) * 100 : 0;

    setInsight(
        'insightBrand',
        `Marka <strong>${escapeHtml(top.label)}</strong> ma najwyższe zużycie:
        <strong>${formatNumber(top.value)} ${escapeHtml(getUnit())}</strong>.
        Jej udział w widocznych danych to <strong>${formatNumber(share, 1)}%</strong>.
        Przy danych sezonowych warto porównać ją osobno dla lata i zimy.`,
        'warning'
    );
}

/* =========================================================
   RECOMMENDATIONS / MATERIAL HEALTH
========================================================= */

function renderRecommendations() {
    const host = byId('recommendations');

    if (!host) return;

    if (!mappingIsReady()) {
        host.textContent = 'Wskaż Materiał i Zużycie, aby wygenerować rekomendacje.';
        return;
    }

    const items = [];
    const coverage = getCoverageRows(App.filteredRows)
        .filter(item => item.coverageDays !== null)
        .sort((a, b) => a.coverageDays - b.coverageDays);

    coverage.filter(item => item.coverageDays < 7).slice(0, 4).forEach(item => {
        items.push({
            type: 'bad',
            text: `<strong>${escapeHtml(item.material)}</strong> ma tylko
                   <strong>${formatNumber(item.coverageDays, 1)} dni</strong> pokrycia.
                   Zweryfikuj status zamówienia oraz planowaną dostawę.`
        });
    });

    coverage
        .filter(item => item.coverageDays >= 7 && item.coverageDays < 14)
        .slice(0, 3)
        .forEach(item => {
            items.push({
                type: 'warning',
                text: `<strong>${escapeHtml(item.material)}</strong> ma
                       <strong>${formatNumber(item.coverageDays, 1)} dni</strong> pokrycia.
                       Warto rozpocząć planowanie replenishment.`
            });
        });

    const trend = getTrend(App.filteredRows);

    if (trend?.change > 12) {
        items.push({
            type: 'warning',
            text: `Zużycie rośnie o <strong>${formatNumber(trend.change, 1)}%</strong>.
                   Zapas oraz zamówienia powinny uwzględniać przyspieszenie tempa.`
        });
    }

    const pareto = getParetoData(App.filteredRows);

    if (pareto.rows.length) {
        items.push({
            type: 'good',
            text: `<strong>${pareto.materialsFor80}</strong> materiałów generuje około 80% całkowitego zużycia.
                   Skup kontrolę zapasu przede wszystkim na tej grupie.`
        });
    }

    if (!items.length) {
        items.push({
            type: 'good',
            text: 'Brak krytycznych sygnałów w dostępnych danych. Dodaj Stan końcowy, aby monitorować ryzyko braków.'
        });
    }

    host.innerHTML = items.map(item => `
        <div class="recommendationItem">
            <span class="statusDot ${item.type}"></span>
            <div>${item.text}</div>
        </div>
    `).join('');
}

function renderMaterialHealth() {
    const host = byId('materialHealthList');

    if (!host) return;

    if (!hasCoverageData()) {
        host.textContent = 'Dodaj Stan końcowy, aby zobaczyć status materiałów.';
        return;
    }

    const coverage = getCoverageRows(App.filteredRows)
        .filter(item => item.coverageDays !== null)
        .sort((a, b) => a.coverageDays - b.coverageDays)
        .slice(0, 8);

    if (!coverage.length) {
        host.textContent = 'Brak danych do wyliczenia statusu materiałów.';
        return;
    }

    host.innerHTML = coverage.map(item => {
        const status = item.coverageDays < 7
            ? 'bad'
            : item.coverageDays < 14
                ? 'warning'
                : 'good';

        const label = item.coverageDays < 7
            ? 'Krytyczne'
            : item.coverageDays < 14
                ? 'Uwaga'
                : 'Stabilne';

        const densityNote = item.reliability !== 'high'
            ? `<br><small class="text-muted">${item.observedDays} z ${item.calendarDays} dni danych (${formatNumber(item.observationDensity * 100, 0)}%) — ${reliabilityBadge(item.reliability)}</small>`
            : '';

        return `
            <div class="materialHealthItem">
                <span class="statusDot ${status}"></span>
                <div>
                    <strong>${escapeHtml(item.material)}</strong><br>
                    ${label}: stan <strong>${formatNumber(item.stock)}</strong>,
                    średnio <strong>${formatNumber(item.averageDaily, 1)}</strong>/dzień,
                    pokrycie <strong>${formatNumber(item.coverageDays, 1)} dni</strong>.
                    ${densityNote}
                </div>
            </div>
        `;
    }).join('');
}

/* =========================================================
   ANALYTICS
========================================================= */

function renderAnalytics() {
    const empty = byId('analyticsEmptyState');
    const container = byId('analyticsContainer');

    if (!mappingIsReady()) {
        if (empty) empty.hidden = false;
        if (container) container.hidden = true;
        return;
    }

    if (empty) empty.hidden = true;
    if (container) container.hidden = false;

    renderParetoChart();
    renderTypeChart();
    renderProductChart();
    renderAbcAnalysis();
}

function renderParetoChart() {
    const pareto = getParetoData(App.filteredRows);

    if (!pareto.rows.length) {
        setInsight('insightPareto', 'Brak danych do analizy Pareto.', 'warning');
        return;
    }

    const rows = pareto.rows.slice(0, 12);

    createChart('chartPareto', 'bar', {
        labels: rows.map(item => item.label),
        datasets: [
            {
                label: 'Zużycie',
                data: rows.map(item => item.value),
                backgroundColor: COLORS,
                borderWidth: 0
            },
            {
                label: 'Udział skumulowany %',
                data: rows.map(item => item.cumulativeShare),
                type: 'line',
                yAxisID: 'percentage',
                borderColor: '#5794e8',
                backgroundColor: '#5794e8',
                pointRadius: 2,
                borderWidth: 2,
                tension: .28
            }
        ]
    }, {
        secondAxis: true,
        legend: true
    });

    setInsight(
        'insightPareto',
        `<strong>${pareto.materialsFor80}</strong> materiałów odpowiada za około 80% zużycia.
        To grupa A — jej zapas i forecast powinny być monitorowane najczęściej.`,
        'warning'
    );
}

function renderTypeChart() {
    if (!App.mapping.type || !App.mapping.used) {
        setInsight('insightType', 'Wskaż Typ materiału, aby porównać grupy.', 'warning');
        return;
    }

    const grouped = groupSum(App.filteredRows, App.mapping.type, App.mapping.used).slice(0, 10);

    if (!grouped.length) {
        setInsight('insightType', 'Brak danych typu materiału.', 'warning');
        return;
    }

    createChart('chartType', 'doughnut', {
        labels: grouped.map(item => item.label),
        datasets: [{
            label: 'Zużycie',
            data: grouped.map(item => item.value),
            backgroundColor: COLORS,
            borderWidth: 0
        }]
    }, {
        legend: true,
        doughnut: true
    });

    const top = grouped[0];

    setInsight(
        'insightType',
        `Największe zużycie ma typ <strong>${escapeHtml(top.label)}</strong>:
        <strong>${formatNumber(top.value)} ${escapeHtml(getUnit())}</strong>.
        Użyj tego podziału do planowania dostaw według grup materiałowych.`,
        'warning'
    );
}

function renderProductChart() {
    if (!App.mapping.product || !App.mapping.used) {
        setInsight('insightProduct', 'Wskaż Produkt, aby zbudować analizę zależności.', 'warning');
        return;
    }

    const grouped = groupSum(App.filteredRows, App.mapping.product, App.mapping.used).slice(0, 10);

    if (!grouped.length) {
        setInsight('insightProduct', 'Brak danych produktowych.', 'warning');
        return;
    }

    createChart('chartProduct', 'bar', {
        labels: grouped.map(item => item.label),
        datasets: [{
            label: 'Zużycie',
            data: grouped.map(item => item.value),
            backgroundColor: COLORS,
            borderWidth: 0
        }]
    });

    const top = grouped[0];

    setInsight(
        'insightProduct',
        `Produkt lub kategoria <strong>${escapeHtml(top.label)}</strong> generuje najwyższe zużycie materiałów:
        <strong>${formatNumber(top.value)} ${escapeHtml(getUnit())}</strong>.
        Wysoka wartość może wynikać z dużego wolumenu, gabarytu produktu albo sposobu pakowania.`,
        'warning'
    );
}

function renderAbcAnalysis() {
    const host = byId('abcTableWrap');
    const insight = byId('insightABC');

    if (!host || !mappingIsReady()) return;

    const rows = getAbcRows(App.filteredRows).slice(0, 30);

    if (!rows.length) {
        host.innerHTML = '<div class="emptyInline">Brak danych do klasyfikacji ABC.</div>';
        return;
    }

    host.innerHTML = `
        <table>
            <thead>
                <tr>
                    <th>Materiał</th>
                    <th>Zużycie</th>
                    <th>Udział</th>
                    <th>Klasa</th>
                </tr>
            </thead>
            <tbody>
                ${rows.map(row => `
                    <tr>
                        <td>${escapeHtml(row.material)}</td>
                        <td>${formatNumber(row.value)} ${escapeHtml(getUnit())}</td>
                        <td>${formatNumber(row.share, 1)}%</td>
                        <td><strong>${row.class}</strong></td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;

    if (insight) {
        const groupA = rows.filter(row => row.class === 'A').length;
        const groupB = rows.filter(row => row.class === 'B').length;
        const groupC = rows.filter(row => row.class === 'C').length;

        insight.innerHTML = `
            Klasa <strong>A</strong>: ${groupA} materiałów o największym wpływie na zużycie.
            Klasa <strong>B</strong>: ${groupB} pozycji średniego wpływu.
            Klasa <strong>C</strong>: ${groupC} materiałów o najmniejszym udziale.
        `;
    }
}

/* =========================================================
   FORECAST
========================================================= */

function readForecastControls() {
    App.forecast.season = byId('forecastSeason')?.value || 'auto';
    App.forecast.days = Number(byId('forecastDays')?.value || 90);
    App.forecast.buffer = Number(byId('forecastBuffer')?.value || 0.15);
}

function renderForecast() {
    const empty = byId('forecastEmptyState');
    const content = byId('forecastContent');
    const exportButton = byId('btnExportForecast');

    if (!hasForecastData()) {
        if (empty) empty.hidden = false;
        if (content) content.hidden = true;
        if (exportButton) exportButton.disabled = true;
        return;
    }

    if (empty) empty.hidden = true;
    if (content) content.hidden = false;
    if (exportButton) exportButton.disabled = false;

    renderSeasonalityChart();

    const season = getSelectedForecastSeason();
    const rows = getForecastRows(season);
    const title = byId('forecastTitle');
    const badge = byId('forecastSeasonBadge');
    const text = byId('forecastText');

    if (title) {
        title.textContent = `Prognoza: ${seasonLabel(season)} · ${App.forecast.days} dni`;
    }

    if (badge) {
        badge.textContent = `${Math.round(App.forecast.buffer * 100)}% bufor`;
    }

    if (!rows.length) {
        if (text) {
            text.textContent = 'Brak danych z wybranego sezonu do przygotowania prognozy.';
        }

        byId('forecastTableWrap').innerHTML =
            '<div class="emptyInline">Brak danych prognozowych.</div>';

        return;
    }

    const totalForecast = sum(rows.map(row => row.recommendedQuantity));
    const totalStock = sum(rows.map(row => row.stock));
    const totalToOrder = sum(rows.map(row => row.toOrder));

    if (text) {
        text.innerHTML = `
            Prognoza wykorzystuje średnie dzienne zużycie z historycznych danych dla sezonu
            <strong>${seasonLabel(season)}</strong>, pomnożone przez <strong>${App.forecast.days} dni</strong>
            oraz powiększone o <strong>${Math.round(App.forecast.buffer * 100)}%</strong> bufor bezpieczeństwa.
            Łączne przewidywane zapotrzebowanie wynosi <strong>${formatNumber(totalForecast)} ${escapeHtml(getUnit())}</strong>.
            Aktualny stan to <strong>${formatNumber(totalStock)} ${escapeHtml(getUnit())}</strong>.
            Szacowana ilość do zamówienia: <strong>${formatNumber(totalToOrder)} ${escapeHtml(getUnit())}</strong>.
        `;
    }

    renderForecastTable(rows);
}

function renderSeasonalityChart() {
    const seasons = ['Winter', 'Spring', 'Summer', 'Autumn'];
    const values = seasons.map(season => {
        return sum(
            App.rows
                .filter(row => getSeason(row[App.mapping.date]) === season)
                .map(row => numberValue(row[App.mapping.used]))
        );
    });

    createChart('chartSeasonality', 'bar', {
        labels: seasons.map(seasonLabel),
        datasets: [{
            label: 'Historyczne zużycie',
            data: values,
            backgroundColor: [COLORS[0], COLORS[1], COLORS[2], COLORS[4]],
            borderWidth: 0
        }]
    });

    const max = Math.max(...values);
    const index = values.indexOf(max);

    setInsight(
        'insightSeasonality',
        max > 0
            ? `Najwyższe historyczne zużycie występuje w sezonie <strong>${seasonLabel(seasons[index])}</strong>:
               <strong>${formatNumber(max)} ${escapeHtml(getUnit())}</strong>.
               Ten sezon powinien otrzymać większy bufor w planie materiałowym.`
            : 'Brak poprawnych danych sezonowych.',
        'warning'
    );
}

function getSelectedForecastSeason() {
    return App.forecast.season === 'auto'
        ? getNextSeason()
        : App.forecast.season;
}


function getDataReliability(observedDays, calendarDays) {
    const density = calendarDays > 0
        ? observedDays / calendarDays
        : 0;

    if (observedDays < 3) {
        return 'insufficient';
    }

    if (density < 0.1) {
        return 'low';
    }

    if (observedDays < 7 || density < 0.3) {
        return 'medium';
    }

    return 'high';
}

function reliabilityRank(level) {
    return {
        insufficient: 0,
        low: 1,
        medium: 2,
        high: 3
    }[level] ?? 0;
}

function reliabilityBadge(level) {
    const badges = {
        insufficient: '<span class="badge orange">Za mało danych</span>',
        low: '<span class="badge red">Niska wiarygodność</span>',
        medium: '<span class="badge orange">Średnia wiarygodność</span>',
        high: '<span class="badge blue">Wysoka wiarygodność</span>'
    };

    return badges[level] || badges.insufficient;
}

function getForecastRows(season) {
    if (!hasForecastData()) return [];

    const MIN_OBSERVED_DAYS = 3;
    const grouped = {};

    App.rows.forEach(row => {
        if (getSeason(row[App.mapping.date]) !== season) return;

        const material = stringValue(row[App.mapping.material]) || 'Nieznany materiał';

        if (!grouped[material]) {
            grouped[material] = {
                material,
                used: 0,
                days: new Set()
            };
        }

        grouped[material].used += numberValue(row[App.mapping.used]);

        const date = isoDate(row[App.mapping.date]);
        if (date) grouped[material].days.add(date);
    });

    const latestStocks = getLatestStockByMaterial(App.rows);
    const stockMap = Object.fromEntries(
        latestStocks.map(item => [item.material, item.stock])
    );

    return Object.values(grouped)
        .map(item => {
            const observedDays = item.days.size;
            const observedDates = [...item.days].map(value => parseDate(value)).filter(Boolean);
            const calendarDays = observedDates.length
                ? Math.max(1, Math.round((Math.max(...observedDates.map(date => date.getTime())) - Math.min(...observedDates.map(date => date.getTime()))) / 86400000) + 1)
                : 1;
            const averageDaily = calendarDays > 0
                ? item.used / calendarDays
                : 0;
            const reliability = getDataReliability(observedDays, calendarDays);
            const reliable = reliability !== 'insufficient';
            const observationDensity = calendarDays > 0
                ? observedDays / calendarDays
                : 0;
            const baseForecast = reliable
                ? averageDaily * App.forecast.days
                : 0;
            const recommendedQuantity = reliable
                ? baseForecast * (1 + App.forecast.buffer)
                : 0;
            const stock = stockMap[item.material] || 0;
            const toOrder = reliable
                ? Math.max(0, recommendedQuantity - stock)
                : 0;

            return {
                material: item.material,
                observedDays,
                calendarDays,
                observationDensity,
                reliability,
                reliable,
                averageDaily,
                baseForecast,
                recommendedQuantity,
                stock,
                toOrder
            };
        })
        .sort((a, b) => {
            const reliabilityDiff = reliabilityRank(b.reliability) - reliabilityRank(a.reliability);

            if (reliabilityDiff !== 0) {
                return reliabilityDiff;
            }

            return b.toOrder - a.toOrder;
        });
}

function renderForecastTable(rows) {
    const host = byId('forecastTableWrap');

    if (!host) return;

    host.innerHTML = `
        <table>
            <thead>
                <tr>
                    <th>Materiał</th>
                    <th>Dni obserwacji</th>
                    <th>Rozpiętość kalendarzowa</th>
                    <th>Średnio / dzień</th>
                    <th>Forecast bazowy</th>
                    <th>Forecast z buforem</th>
                    <th>Aktualny stan</th>
                    <th>Do zamówienia</th>
                    <th>Wiarygodność</th>
                </tr>
            </thead>
            <tbody>
                ${rows.map(row => `
                    <tr>
                        <td>${escapeHtml(row.material)}</td>
                        <td>${row.observedDays}</td>
                        <td>${row.observedDays} z ${row.calendarDays} dni (${formatNumber(row.observationDensity * 100, 0)}%)</td>
                        <td>${formatNumber(row.averageDaily, 1)}</td>
                        <td>${row.reliable ? formatNumber(row.baseForecast) : '—'}</td>
                        <td>${row.reliable ? formatNumber(row.recommendedQuantity) : '—'}</td>
                        <td>${formatNumber(row.stock)}</td>
                        <td>${row.reliable ? `<strong>${formatNumber(row.toOrder)}</strong>` : '—'}</td>
                        <td>
                            ${reliabilityBadge(row.reliability)}
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

/* =========================================================
   TABLE
========================================================= */

function getTableRows() {
    const search = App.tableSearch;

    if (!search) return [...App.filteredRows];

    return App.filteredRows.filter(row =>
        Object.values(row).some(value =>
            String(value ?? '').toLowerCase().includes(search)
        )
    );
}

function getTablePageCount() {
    return Math.max(1, Math.ceil(getTableRows().length / App.pageSize));
}

function renderTable() {
    const container = byId('tableContainer');
    const pagination = byId('tablePagination');
    const resultCount = byId('tableResultCount');

    if (!container) return;

    const rows = getTableRows();
    const totalPages = Math.max(1, Math.ceil(rows.length / App.pageSize));

    if (App.page > totalPages) App.page = totalPages;

    if (resultCount) {
        resultCount.textContent = `${formatNumber(rows.length, 0)} wierszy`;
    }

    if (!rows.length) {
        container.innerHTML = `
            <div class="emptyState compact">
                <div class="emptyIcon">📋</div>
                <h2>Brak wierszy</h2>
                <p>Nie znaleziono danych dla aktualnych filtrów lub wyszukiwania.</p>
            </div>
        `;

        if (pagination) pagination.hidden = true;
        return;
    }

    const start = (App.page - 1) * App.pageSize;
    const pageRows = rows.slice(start, start + App.pageSize);

    container.innerHTML = `
        <table class="dataTable">
            <thead>
                <tr>
                    ${App.columns.map(column => `<th>${escapeHtml(column)}</th>`).join('')}
                </tr>
            </thead>
            <tbody>
                ${pageRows.map(row => `
                    <tr>
                        ${App.columns.map(column => `
                            <td title="${escapeHtml(row[column])}">
                                ${escapeHtml(row[column])}
                            </td>
                        `).join('')}
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;

    if (pagination) {
        pagination.hidden = totalPages <= 1;

        setText('tablePageInfo', `Strona ${App.page} / ${totalPages}`);

        const prev = byId('btnTablePrev');
        const next = byId('btnTableNext');

        if (prev) prev.disabled = App.page <= 1;
        if (next) next.disabled = App.page >= totalPages;
    }
}

/* =========================================================
   EXPORT / IMPORT
========================================================= */

function exportCurrentData() {
    const rows = getTableRows();

    if (!rows.length) {
        toast('Brak danych do eksportu.', 'warning');
        return;
    }

    const data = rows.map(row => {
        const output = {};

        App.columns.forEach(column => {
            output[column] = row[column];
        });

        return output;
    });

    exportRowsToCsv(data, `material_intelligence_${fileStamp()}.csv`);
    toast(`Wyeksportowano ${rows.length} wierszy CSV.`, 'success');
}

function exportForecast() {
    const rows = getForecastRows(getSelectedForecastSeason());

    if (!rows.length) {
        toast('Brak danych prognozowych do eksportu.', 'warning');
        return;
    }

    const exportRows = rows.map(row => ({
        Material: row.material,
        Average_Daily_Usage: round(row.averageDaily, 2),
        Base_Forecast: round(row.baseForecast, 2),
        Forecast_With_Buffer: round(row.recommendedQuantity, 2),
        Current_Stock: round(row.stock, 2),
        Recommended_Order: round(row.toOrder, 2)
    }));

    exportRowsToCsv(exportRows, `material_forecast_${fileStamp()}.csv`);
    toast('Prognoza została wyeksportowana.', 'success');
}

function exportRowsToCsv(rows, filename) {
    const sheet = XLSX.utils.json_to_sheet(rows);
    const csv = XLSX.utils.sheet_to_csv(sheet, {
        FS: ';',
        RS: '\n'
    });

    const blob = new Blob(
        ['\uFEFF', csv],
        { type: 'text/csv;charset=utf-8' }
    );

    downloadBlob(blob, filename);
}

function exportWorkspace() {
    const payload = {
        app: 'Material Intelligence Center',
        version: '2.0',
        exportedAt: new Date().toISOString(),
        fileName: App.fileName,
        sheet: App.currentSheet,
        mapping: App.mapping,
        filters: App.filters,
        forecast: App.forecast
    };

    const blob = new Blob(
        [JSON.stringify(payload, null, 2)],
        { type: 'application/json;charset=utf-8' }
    );

    downloadBlob(blob, `material_workspace_${fileStamp()}.json`);
    toast('Ustawienia zostały wyeksportowane.', 'success');
}

function importWorkspace(event) {
    const file = event.target.files?.[0];

    if (!file) return;

    const reader = new FileReader();

    reader.onload = loadEvent => {
        try {
            const workspace = JSON.parse(loadEvent.target.result);

            if (!workspace || typeof workspace !== 'object') {
                throw new Error('Nieprawidłowy plik ustawień.');
            }

            if (workspace.mapping && typeof workspace.mapping === 'object') {
                App.mapping = {
                    ...App.mapping,
                    ...workspace.mapping
                };
            }

            if (workspace.filters && typeof workspace.filters === 'object') {
                App.filters = {
                    ...App.filters,
                    ...workspace.filters
                };
            }

            if (workspace.forecast && typeof workspace.forecast === 'object') {
                App.forecast = {
                    ...App.forecast,
                    ...workspace.forecast
                };
            }

            if (App.columns.length) {
                clearInvalidMappingColumns();
                populateMappingSelects();
                syncMappingToUI();
                populateFilters();
                syncFiltersToUI();
                syncForecastToUI();
                applyFilters();
                renderAll();
            }

            toast(
                App.columns.length
                    ? 'Ustawienia zostały zaimportowane i zastosowane.'
                    : 'Ustawienia zaimportowano. Załaduj raport Excel, aby je zastosować.',
                'success'
            );
        } catch (error) {
            console.error(error);
            toast(`Nie można zaimportować ustawień: ${error.message}`, 'error');
        } finally {
            event.target.value = '';
        }
    };

    reader.readAsText(file);
}

function syncFiltersToUI() {
    setValue('filterDateFrom', App.filters.dateFrom);
    setValue('filterDateTo', App.filters.dateTo);
    setValue('filterMaterial', App.filters.material);
    setValue('filterType', App.filters.type);
    setValue('filterBrand', App.filters.brand);
    setValue('filterProduct', App.filters.product);
    setValue('filterSeason', App.filters.season);
}

function syncForecastToUI() {
    setValue('forecastSeason', App.forecast.season);
    setValue('forecastDays', App.forecast.days);
    setValue('forecastBuffer', App.forecast.buffer);
}

/* =========================================================
   CALCULATIONS
========================================================= */

function groupSum(rows, groupColumn, valueColumn) {
    if (!groupColumn || !valueColumn) return [];

    const groups = {};

    rows.forEach(row => {
        const label = stringValue(row[groupColumn]) || 'Nieznane';
        const value = numberValue(row[valueColumn]);

        groups[label] = (groups[label] || 0) + value;
    });

    return Object.entries(groups)
        .map(([label, value]) => ({ label, value }))
        .sort((a, b) => b.value - a.value);
}

function getDailyUsage(rows) {
    if (!App.mapping.date || !App.mapping.used) {
        return { labels: [], values: [] };
    }

    const groups = {};

    rows.forEach(row => {
        const date = isoDate(row[App.mapping.date]);

        if (!date) return;

        groups[date] = (groups[date] || 0) + numberValue(row[App.mapping.used]);
    });

    const labels = Object.keys(groups).sort();

    return {
        labels,
        values: labels.map(label => groups[label])
    };
}

function getTrend(rows) {
    const daily = getDailyUsage(rows);

    if (daily.values.length < 2) return null;

    const midpoint = Math.max(1, Math.floor(daily.values.length / 2));
    const firstAverage = average(daily.values.slice(0, midpoint));
    const secondAverage = average(daily.values.slice(midpoint));

    if (!firstAverage) return null;

    const change = ((secondAverage - firstAverage) / firstAverage) * 100;

    return {
        change,
        label: change > 10
            ? 'rosnący'
            : change < -10
                ? 'malejący'
                : 'stabilny'
    };
}

function getLatestStockByMaterial(rows) {
    if (!App.mapping.material || !App.mapping.ending) return [];

    const latest = {};

    rows.forEach((row, index) => {
        const material = stringValue(row[App.mapping.material]) || 'Nieznany materiał';
        const stock = numberValueOrNull(row[App.mapping.ending]);

        if (stock === null) return;

        const date = App.mapping.date
            ? parseDate(row[App.mapping.date])
            : null;

        const timestamp = date
            ? date.getTime()
            : index;

        if (!latest[material] || timestamp >= latest[material].timestamp) {
            latest[material] = {
                material,
                stock,
                timestamp
            };
        }
    });

    return Object.values(latest);
}

function startOfDay(date) {
    const result = new Date(date.getTime());
    result.setHours(0, 0, 0, 0);
    return result;
}

function getCoverageRows(rows) {
    if (!hasCoverageData()) return [];

    const MIN_OBSERVED_DAYS = 3;
    const usage = {};
    const periods = {};

    rows.forEach(row => {
        const material = stringValue(row[App.mapping.material]) || 'Nieznany materiał';

        usage[material] = (usage[material] || 0) + numberValue(row[App.mapping.used]);

        if (!App.mapping.date) return;

        const date = parseDate(row[App.mapping.date]);
        if (!date) return;

        const timestamp = startOfDay(date).getTime();
        const period = periods[material] || { min: timestamp, max: timestamp, observed: new Set() };
        period.min = Math.min(period.min, timestamp);
        period.max = Math.max(period.max, timestamp);
        period.observed.add(timestamp);
        periods[material] = period;
    });

    return getLatestStockByMaterial(rows).map(item => {
        const period = periods[item.material];
        const observedDays = period ? period.observed.size : 0;
        const totalUsage = usage[item.material] || 0;
        const calendarDays = period
            ? Math.max(1, Math.round((period.max - period.min) / 86400000) + 1)
            : 1;
        const averageDaily = calendarDays > 0
            ? totalUsage / calendarDays
            : 0;
        const reliability = getDataReliability(observedDays, calendarDays);
        const reliable = reliability !== 'insufficient';
        const observationDensity = calendarDays > 0
            ? observedDays / calendarDays
            : 0;

        return {
            material: item.material,
            stock: item.stock,
            observedDays,
            calendarDays,
            observationDensity,
            reliability,
            reliable,
            averageDaily,
            coverageDays: reliable && averageDaily > 0
                ? item.stock / averageDaily
                : null
        };
    });
}

function getParetoData(rows) {
    const grouped = groupSum(rows, App.mapping.material, App.mapping.used);
    const total = sum(grouped.map(item => item.value));

    let running = 0;
    let materialsFor80 = 0;

    const result = grouped.map(item => {
        const cumulativeShareBefore = total
            ? (running / total) * 100
            : 0;

        if (cumulativeShareBefore < 80) {
            materialsFor80++;
        }

        running += item.value;

        const cumulativeShare = total
            ? (running / total) * 100
            : 0;

        return {
            ...item,
            cumulativeShare
        };
    });

    return {
        rows: result,
        materialsFor80
    };
}

function getAbcRows(rows) {
    const grouped = groupSum(rows, App.mapping.material, App.mapping.used);
    const total = sum(grouped.map(item => item.value));

    let cumulative = 0;

    return grouped.map(item => {
        const share = total ? (item.value / total) * 100 : 0;
        cumulative += share;

        let classification = 'C';

        if (cumulative <= 80) {
            classification = 'A';
        } else if (cumulative <= 95) {
            classification = 'B';
        }

        return {
            material: item.label,
            value: item.value,
            share,
            cumulative,
            class: classification
        };
    });
}

/* =========================================================
   CHARTS
========================================================= */

function createChart(id, type, data, options = {}) {
    const canvas = byId(id);

    if (!canvas || typeof Chart === 'undefined') return;

    destroyChart(id);

    const baseOptions = {
        responsive: true,
        maintainAspectRatio: false,
        animation: {
            duration: 260
        },
        plugins: {
            legend: {
                display: options.legend ?? false,
                labels: {
                    color: '#9aa5b1',
                    boxWidth: 12,
                    font: {
                        size: 11
                    }
                }
            },
            tooltip: {
                backgroundColor: '#1c2228',
                titleColor: '#e8ecef',
                bodyColor: '#d4dbe1',
                borderColor: '#46515d',
                borderWidth: 1,
                padding: 10,
                callbacks: {
                    label: context => {
                        const value = context.raw;
                        const label = context.dataset.label || '';

                        if (context.dataset.yAxisID === 'percentage') {
                            return `${label}: ${formatNumber(value, 1)}%`;
                        }

                        return `${label}: ${formatNumber(value, 2)} ${getUnit()}`;
                    }
                }
            }
        }
    };

    if (type !== 'doughnut') {
        baseOptions.scales = {
            x: {
                ticks: {
                    color: '#8b97a3',
                    font: { size: 10 },
                    maxRotation: 42,
                    minRotation: 0
                },
                grid: {
                    color: 'rgba(255,255,255,.045)'
                }
            },
            y: {
                beginAtZero: true,
                ticks: {
                    color: '#8b97a3',
                    font: { size: 10 }
                },
                grid: {
                    color: 'rgba(255,255,255,.06)'
                }
            }
        };

        if (options.secondAxis) {
            baseOptions.scales.percentage = {
                position: 'right',
                min: 0,
                max: 100,
                grid: {
                    drawOnChartArea: false
                },
                ticks: {
                    color: '#5794e8',
                    callback: value => `${value}%`
                }
            };
        }
    }

    App.charts[id] = new Chart(canvas, {
        type,
        data,
        options: baseOptions
    });
}

function destroyChart(id) {
    if (!App.charts[id]) return;

    try {
        App.charts[id].destroy();
    } catch (error) {
        console.warn(error);
    }

    delete App.charts[id];
}

function destroyAllCharts() {
    Object.keys(App.charts).forEach(destroyChart);
}

/* =========================================================
   TAB NAVIGATION
========================================================= */

function openTab(name) {
    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === name);
    });

    document.querySelectorAll('.tabContent').forEach(content => {
        content.classList.toggle('active', content.id === `tab-${name}`);
    });

    window.setTimeout(() => {
        Object.values(App.charts).forEach(chart => {
            try {
                chart.resize();
            } catch (error) {
                console.warn(error);
            }
        });
    }, 90);
}

/* =========================================================
   HELPERS
========================================================= */

function byId(id) {
    return document.getElementById(id);
}

function setText(id, value) {
    const element = byId(id);

    if (element) {
        element.textContent = value;
    }
}

function setValue(id, value) {
    const element = byId(id);

    if (element) {
        element.value = value ?? '';
    }
}

function setInsight(id, html, type = '') {
    const element = byId(id);

    if (!element) return;

    element.className = `insight ${type}`.trim();
    element.innerHTML = html;
}

function updateDataStatus(text) {
    setText('dataStatus', text);
}

function stringValue(value) {
    return String(value ?? '').trim();
}

function numberValue(value) {
    return numberValueOrNull(value) ?? 0;
}

function numberValueOrNull(value) {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }

    let input = stringValue(value);

    if (!input) return null;

    input = input.replace(/\s/g, '');

    if (/^-?[\d.]+,\d+$/.test(input)) {
        input = input.replace(/\./g, '').replace(',', '.');
    } else {
        input = input.replace(/,/g, '');
    }

    if (!/^-?\d+(\.\d+)?$/.test(input)) return null;

    const result = Number(input);

    return Number.isFinite(result) ? result : null;
}

function parseDate(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return new Date(value.getTime());
    }

    if (typeof value === 'number' && typeof XLSX !== 'undefined') {
        const parsed = XLSX.SSF.parse_date_code(value);

        if (parsed) {
            return new Date(parsed.y, parsed.m - 1, parsed.d);
        }
    }

    const input = stringValue(value);

    if (!input) return null;

    let match = input.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);

    if (match) {
        return new Date(
            Number(match[1]),
            Number(match[2]) - 1,
            Number(match[3])
        );
    }

    match = input.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);

    if (match) {
        const year = match[3].length === 2
            ? 2000 + Number(match[3])
            : Number(match[3]);

        return new Date(
            year,
            Number(match[2]) - 1,
            Number(match[1])
        );
    }

    const timestamp = Date.parse(input);

    return Number.isNaN(timestamp) ? null : new Date(timestamp);
}

function isoDate(value) {
    const date = parseDate(value);

    if (!date) return '';

    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0')
    ].join('-');
}

function endOfDay(date) {
    if (!date) return null;

    const output = new Date(date.getTime());
    output.setHours(23, 59, 59, 999);

    return output;
}

function getSeason(value) {
    const date = parseDate(value);

    if (!date) return '';

    const month = date.getMonth() + 1;

    if ([12, 1, 2].includes(month)) return 'Winter';
    if ([3, 4, 5].includes(month)) return 'Spring';
    if ([6, 7, 8].includes(month)) return 'Summer';

    return 'Autumn';
}

function getNextSeason() {
    const current = new Date().getMonth() + 1;

    if ([12, 1, 2].includes(current)) return 'Spring';
    if ([3, 4, 5].includes(current)) return 'Summer';
    if ([6, 7, 8].includes(current)) return 'Autumn';

    return 'Winter';
}

function seasonLabel(season) {
    return {
        Winter: 'Zima',
        Spring: 'Wiosna',
        Summer: 'Lato',
        Autumn: 'Jesień'
    }[season] || season;
}

function uniqueValues(values) {
    return [...new Set(
        values
            .map(stringValue)
            .filter(Boolean)
    )].sort((a, b) => a.localeCompare(b, 'pl'));
}

function sum(values) {
    return values.reduce((total, value) => total + (Number(value) || 0), 0);
}

function average(values) {
    return values.length ? sum(values) / values.length : 0;
}

function round(value, decimals = 2) {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
}

function formatNumber(value, decimals = 0) {
    const number = Number(value);

    if (!Number.isFinite(number)) return '—';

    return number.toLocaleString('pl-PL', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    });
}

function getUnit() {
    if (!App.mapping.unit) return '';

    const unit = App.filteredRows
        .map(row => stringValue(row[App.mapping.unit]))
        .find(Boolean);

    return unit || '';
}

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function fileStamp() {
    const now = new Date();

    return [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0'),
        '_',
        String(now.getHours()).padStart(2, '0'),
        String(now.getMinutes()).padStart(2, '0')
    ].join('');
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');

    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);

    anchor.click();
    anchor.remove();

    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function showLoading(title, text) {
    setText('loadingTitle', title);
    setText('loadingText', text);

    const overlay = byId('loadingOverlay');

    if (overlay) overlay.hidden = false;
}

function hideLoading() {
    const overlay = byId('loadingOverlay');

    if (overlay) overlay.hidden = true;
}

function toast(message, type = 'success') {
    const container = byId('toastContainer');

    if (!container) return;

    const item = document.createElement('div');

    item.className = `toast ${type}`;
    item.textContent = message;

    container.appendChild(item);

    window.setTimeout(() => {
        item.remove();
    }, 4200);
}

window.addEventListener('error', event => {
    console.error(event.error || event.message);
});
