/* ==========================================================
   Pack Materials Analytics
   src/constants.js
========================================================== */

(function initializeConstants(global) {
    "use strict";

    const PMA = global.PMA || (global.PMA = {});

    const DATA_TYPES = Object.freeze({
        TEXT: "text",
        NUMBER: "number",
        DATE: "date",
        BOOLEAN: "boolean",
        MIXED: "mixed",
        EMPTY: "empty"
    });

    const SYSTEM_FIELDS = [
        {
            id: "date",
            label: "Data",
            description: "Data operacji lub zużycia materiału.",
            type: DATA_TYPES.DATE,
            required: true
        },
        {
            id: "material",
            label: "Materiał",
            description: "Nazwa materiału opakowaniowego.",
            type: DATA_TYPES.TEXT,
            required: true
        },
        {
            id: "quantity",
            label: "Zużycie / ilość wykorzystana",
            description: "Ilość materiału zużyta w danym wierszu lub okresie. To pole jest podstawą analizy wykorzystania.",
            type: DATA_TYPES.NUMBER,
            required: true
        },
        {
            id: "stockLevel",
            label: "Aktualny stan zapasu",
            description: "Opcjonalna ilość materiału pozostająca obecnie w magazynie. Nie jest wyliczana z samego zużycia; do wyliczenia potrzebne byłyby także stan początkowy i przyjęcia.",
            type: DATA_TYPES.NUMBER,
            required: false
        },
        {
            id: "brand",
            label: "Marka",
            description: "Marka lub brand przypisany do operacji.",
            type: DATA_TYPES.TEXT,
            required: false
        },
        {
            id: "line",
            label: "Linia / stanowisko",
            description: "Linia, obszar lub stanowisko pakujące. Pole opcjonalne: część źródeł danych (np. eksporty zakupowe) może nie zawierać tego wymiaru. Zmień na true tylko jeśli Twoje źródło danych zawsze je zawiera.",
            type: DATA_TYPES.TEXT,
            required: false
        },
        {
            id: "materialCode",
            label: "Kod materiału",
            description: "Kod wewnętrzny materiału.",
            type: DATA_TYPES.TEXT,
            required: false
        },
        {
            id: "sku",
            label: "SKU",
            description: "Kod SKU produktu lub materiału.",
            type: DATA_TYPES.TEXT,
            required: false
        },
        {
            id: "description",
            label: "Opis",
            description: "Dodatkowy opis rekordu.",
            type: DATA_TYPES.TEXT,
            required: false
        },
        {
            id: "unit",
            label: "Jednostka",
            description: "Jednostka miary, np. szt., kg lub rolka.",
            type: DATA_TYPES.TEXT,
            required: false
        },
        {
            id: "shift",
            label: "Zmiana",
            description: "Zmiana produkcyjna lub operacyjna.",
            type: DATA_TYPES.TEXT,
            required: false
        },
        {
            id: "operator",
            label: "Operator",
            description: "Operator lub osoba odpowiedzialna za operację.",
            type: DATA_TYPES.TEXT,
            required: false
        },
        {
            id: "order",
            label: "Zamówienie",
            description: "Numer zamówienia lub zlecenia.",
            type: DATA_TYPES.TEXT,
            required: false
        },
        {
            id: "recordId",
            label: "ID rekordu / operacji",
            description: "Unikalny identyfikator pojedynczego rekordu lub operacji. Jeżeli go brak, duplikaty są wykrywane wyłącznie jako identyczne wiersze źródłowe.",
            type: DATA_TYPES.TEXT,
            required: false
        },
        {
            id: "packagingType",
            label: "Typ opakowania",
            description: "Rodzaj opakowania lub materiału.",
            type: DATA_TYPES.TEXT,
            required: false
        },
        {
            id: "category",
            label: "Kategoria",
            description: "Kategoria materiału.",
            type: DATA_TYPES.TEXT,
            required: false
        }
    ].map(Object.freeze);

    const SYSTEM_FIELD_MAP = Object.freeze(
        Object.fromEntries(SYSTEM_FIELDS.map((field) => [field.id, field]))
    );

    const REQUIRED_FIELDS = Object.freeze(
        SYSTEM_FIELDS.filter((field) => field.required).map((field) => field.id)
    );

    const FIELD_ALIASES = Object.freeze({
        date: Object.freeze([
            "data", "date", "timestamp", "date time", "datetime", "dzień", "dzien", "datum", "created at",
            "operation date", "usage date", "data zużycia", "data zuzycia"
        ]),
        material: Object.freeze([
            "materiał", "material", "material name", "nazwa materiału",
            "nazwa materialu", "pack material", "packaging material", "item"
        ]),
        quantity: Object.freeze([
            "ilość", "ilosc", "quantity", "qty", "used", "usage",
            "zużycie", "zuzycie", "consumption", "amount", "value"
        ]),
        stockLevel: Object.freeze([
            "stan zapasu", "stan magazynowy", "zapas", "stan końcowy", "stan koncowy",
            "stock", "stock level", "ending stock", "on hand", "quantity on hand",
            "saldo", "balance", "inventory", "stan"
        ]),
        brand: Object.freeze([
            "marka", "brand", "brand name", "client brand", "client"
        ]),
        line: Object.freeze([
            "linia", "line", "stanowisko", "station", "packing station",
            "pack station", "workstation", "area", "obszar"
        ]),
        recordId: Object.freeze([
            "record id", "operation id", "transaction id", "usage id",
            "event id", "row id", "id rekordu", "id operacji", "id transakcji"
        ]),
        materialCode: Object.freeze([
            "kod materiału", "kod materialu", "material code", "item code",
            "article code", "article", "kod"
        ]),
        sku: Object.freeze(["sku", "stock keeping unit", "product sku"]),
        description: Object.freeze([
            "opis", "description", "comment", "uwagi", "notes"
        ]),
        unit: Object.freeze([
            "jednostka", "unit", "uom", "unit of measure", "miara"
        ]),
        shift: Object.freeze([
            "zmiana", "shift", "schicht", "work shift"
        ]),
        operator: Object.freeze([
            "operator", "pracownik", "employee", "user", "worker"
        ]),
        order: Object.freeze([
            "zamówienie", "zamowienie", "order", "order id", "order no", "order number",
            "zlecenie", "job"
        ]),
        packagingType: Object.freeze([
            "typ opakowania", "packaging type", "package type", "material type",
            "typ materiału", "typ materialu"
        ]),
        category: Object.freeze([
            "kategoria", "category", "group", "grupa", "family"
        ])
    });

    const DERIVED_FIELDS = [
        { id: "year", label: "Rok", type: DATA_TYPES.NUMBER },
        { id: "quarter", label: "Kwartał", type: DATA_TYPES.TEXT },
        { id: "month", label: "Miesiąc", type: DATA_TYPES.TEXT },
        { id: "monthNumber", label: "Numer miesiąca", type: DATA_TYPES.NUMBER },
        { id: "monthKey", label: "Rok–miesiąc", type: DATA_TYPES.TEXT },
        { id: "week", label: "Tydzień", type: DATA_TYPES.NUMBER },
        { id: "weekKey", label: "Rok–tydzień", type: DATA_TYPES.TEXT },
        { id: "weekday", label: "Dzień tygodnia", type: DATA_TYPES.TEXT },
        { id: "weekdayNumber", label: "Numer dnia tygodnia", type: DATA_TYPES.NUMBER },
        { id: "day", label: "Dzień miesiąca", type: DATA_TYPES.NUMBER },
        {
            id: "season",
            label: "Pora roku (ogólnie)",
            type: DATA_TYPES.TEXT,
            description: "Ogólna pora roku. Łączy te same pory roku ze wszystkich lat."
        },
        {
            id: "seasonPeriod",
            label: "Okres sezonowy",
            type: DATA_TYPES.TEXT,
            sortFieldId: "seasonSortKey",
            description: "Konkretny ciągły sezon, np. Zima 2025/2026. Dla pełnej zimy używaj tego pola bez dodatkowego grupowania według roku."
        },
        {
            id: "seasonStartYear",
            label: "Rok rozpoczęcia sezonu",
            type: DATA_TYPES.NUMBER,
            description: "Techniczne pole używane do chronologicznego sortowania sezonów.",
            filterable: false,
            groupable: false,
            hidden: true
        },
        {
            id: "seasonOrder",
            label: "Kolejność sezonu",
            type: DATA_TYPES.NUMBER,
            description: "Techniczne pole kolejności sezonu w roku sezonowym.",
            filterable: false,
            groupable: false,
            hidden: true
        },
        {
            id: "seasonSortKey",
            label: "Klucz sortowania sezonu",
            type: DATA_TYPES.NUMBER,
            description: "Techniczny klucz zapewniający prawidłową kolejność okresów sezonowych.",
            filterable: false,
            groupable: false,
            hidden: true
        },
        { id: "isWeekend", label: "Weekend", type: DATA_TYPES.BOOLEAN },
        { id: "hour", label: "Godzina", type: DATA_TYPES.NUMBER },
        { id: "time", label: "Czas", type: DATA_TYPES.TEXT }
    ].map(Object.freeze);

    const INTERNAL_FIELDS = Object.freeze([
        "id",
        "sourceRow",
        "sourceSheet",
        "sourceFile",
        "importedAt",
        "validationStatus",
        "validationErrors",
        "duplicateKey",
        "originalValues"
    ]);

    const MONTHS = [
        [1, "Styczeń"], [2, "Luty"], [3, "Marzec"], [4, "Kwiecień"],
        [5, "Maj"], [6, "Czerwiec"], [7, "Lipiec"], [8, "Sierpień"],
        [9, "Wrzesień"], [10, "Październik"], [11, "Listopad"], [12, "Grudzień"]
    ].map(([number, label]) => Object.freeze({ number, label }));

    const WEEKDAYS = [
        [1, "Poniedziałek"], [2, "Wtorek"], [3, "Środa"], [4, "Czwartek"],
        [5, "Piątek"], [6, "Sobota"], [7, "Niedziela"]
    ].map(([number, label]) => Object.freeze({ number, label }));

    const SEASONS = [
        { id: "winter", label: "Zima", months: [12, 1, 2], sortOrder: 1 },
        { id: "spring", label: "Wiosna", months: [3, 4, 5], sortOrder: 2 },
        { id: "summer", label: "Lato", months: [6, 7, 8], sortOrder: 3 },
        { id: "autumn", label: "Jesień", months: [9, 10, 11], sortOrder: 4 }
    ].map((season) => Object.freeze({ ...season, months: Object.freeze(season.months) }));

    const AGGREGATIONS = [
        { id: "sum", label: "Suma" },
        { id: "count", label: "Liczba rekordów" },
        { id: "avg", label: "Średnia" },
        { id: "min", label: "Minimum" },
        { id: "max", label: "Maksimum" }
    ].map(Object.freeze);

    const AGGREGATION_IDS = Object.freeze(AGGREGATIONS.map((item) => item.id));

    const CHART_TYPES = [
        { id: "bar", label: "Słupkowy", chartJsType: "bar" },
        { id: "line", label: "Liniowy", chartJsType: "line" },
        { id: "pie", label: "Kołowy", chartJsType: "pie" },
        { id: "stacked", label: "Skumulowany", chartJsType: "bar" }
    ].map(Object.freeze);

    const CHART_TYPE_IDS = Object.freeze(CHART_TYPES.map((item) => item.id));

    const RESULT_VIEWS = Object.freeze({
        TABLE: "table",
        CHART: "chart"
    });

    const ANALYSIS_TEMPLATES = Object.freeze({
        material: Object.freeze({
            id: "material",
            label: "Według materiału",
            rows: Object.freeze(["material"]),
            columns: Object.freeze([]),
            values: Object.freeze(["quantity"]),
            aggregation: "sum",
            chartType: "bar"
        }),
        brand: Object.freeze({
            id: "brand",
            label: "Według marki",
            rows: Object.freeze(["brand"]),
            columns: Object.freeze([]),
            values: Object.freeze(["quantity"]),
            aggregation: "sum",
            chartType: "bar"
        }),
        line: Object.freeze({
            id: "line",
            label: "Według linii",
            rows: Object.freeze(["line"]),
            columns: Object.freeze([]),
            values: Object.freeze(["quantity"]),
            aggregation: "sum",
            chartType: "bar"
        }),
        month: Object.freeze({
            id: "month",
            label: "Trend miesięczny",
            rows: Object.freeze(["monthKey"]),
            columns: Object.freeze([]),
            values: Object.freeze(["quantity"]),
            aggregation: "sum",
            chartType: "line"
        }),
        season: Object.freeze({
            id: "season",
            label: "Według okresu sezonowego",
            rows: Object.freeze(["seasonPeriod"]),
            columns: Object.freeze([]),
            values: Object.freeze(["quantity"]),
            aggregation: "sum",
            chartType: "line"
        })
    });

    const DEFAULT_ANALYSIS = Object.freeze({
        rows: Object.freeze(["material"]),
        columns: Object.freeze([]),
        values: Object.freeze(["quantity"]),
        aggregation: "sum",
        chartType: "bar",
        resultView: RESULT_VIEWS.TABLE,
        activeTemplate: "material",
        sort: Object.freeze({ field: null, direction: "asc" })
    });

    const FILTER_FIELDS = Object.freeze([
        "material",
        "brand",
        "line",
        "materialCode",
        "unit",
        "shift",
        "packagingType",
        "category",
        "seasonPeriod"
    ]);

    const VALIDATION_CODES = Object.freeze({
        MISSING_DATE: "missing_date",
        INVALID_DATE: "invalid_date",
        MISSING_MATERIAL: "missing_material",
        MISSING_QUANTITY: "missing_quantity",
        INVALID_QUANTITY: "invalid_quantity",
        NEGATIVE_QUANTITY: "negative_quantity",
        ZERO_QUANTITY: "zero_quantity",
        MISSING_BRAND: "missing_brand",
        MISSING_LINE: "missing_line",
        DUPLICATE_RECORD: "duplicate_record"
    });

    const VALIDATION_MESSAGES = Object.freeze({
        missing_date: "Brak daty.",
        invalid_date: "Nieprawidłowa data.",
        missing_material: "Brak nazwy materiału.",
        missing_quantity: "Brak ilości.",
        invalid_quantity: "Nieprawidłowa ilość.",
        negative_quantity: "Ilość nie może być ujemna.",
        zero_quantity: "Ilość wynosi zero.",
        missing_brand: "Brak marki.",
        missing_line: "Brak linii lub stanowiska.",
        duplicate_record: "Wiersz powtarza identyczny rekord źródłowy lub ten sam unikalny identyfikator operacji."
    });

    const STATUS = Object.freeze({
        IDLE: "idle",
        LOADING: "loading",
        READY: "ready",
        PROCESSING: "processing",
        SUCCESS: "success",
        WARNING: "warning",
        ERROR: "error"
    });

    const EVENTS = Object.freeze({
        APPLICATION_READY: "pma:application-ready",
        APPLICATION_STATUS_CHANGED: "pma:application-status-changed",
        APPLICATION_BUSY_CHANGED: "pma:busy-changed",
        APPLICATION_ERROR: "pma:application-error",
        WORKSPACE_RESET: "pma:workspace-reset",
        FILE_SELECTED: "pma:file-selected",
        WORKBOOK_LOADED: "pma:workbook-loaded",
        SHEET_SELECTED: "pma:sheet-selected",
        SHEET_ANALYZED: "pma:sheet-analyzed",
        MAPPING_CHANGED: "pma:mapping-changed",
        MAPPING_VALIDATED: "pma:mapping-validated",
        VALIDATION_COMPLETED: "pma:validation-completed",
        DATA_NORMALIZED: "pma:data-normalized",
        FILTERS_CHANGED: "pma:filters-changed",
        ANALYSIS_CHANGED: "pma:analysis-changed",
        PIVOT_BUILT: "pma:pivot-built",
        DECISION_BUILT: "pma:decision-built",
        CHART_RENDERED: "pma:chart-rendered",
        EXPORT_STARTED: "pma:export-started",
        EXPORT_COMPLETED: "pma:export-completed",
        EXPORT_FAILED: "pma:export-failed",
        NORMALIZATION_RULES_CHANGED: "pma:normalization-rules-changed",
        DATA_CLEANED: "pma:data-cleaned",
        WORKSPACE_IMPORTED: "pma:workspace-imported",
        SMART_ANALYTICS_STARTED: "pma:smart-analytics-started",
        SMART_ANALYTICS_PROGRESS: "pma:smart-analytics-progress",
        SMART_ANALYTICS_COMPLETED: "pma:smart-analytics-completed",
        SMART_ANALYTICS_FAILED: "pma:smart-analytics-failed",
        SMART_ANALYTICS_INVALIDATED: "pma:smart-analytics-invalidated"
    });

    const constants = {
        APP: Object.freeze({
            name: "Pack Materials Analytics",
            shortName: "PMA",
            version: "1.7.1",
            storageSchemaVersion: 5,
            locale: "pl-PL",
            company: "",
            repositoryMode: "static"
        }),

        STORAGE_KEYS: Object.freeze({
            schemaVersion: "pma.storage.schemaVersion",
            preferences: "pma.preferences.v2",
            mappingProfiles: "pma.mappingProfiles.v2",
            recentFiles: "pma.recentFiles.v2",
            normalizationRules: "pma.normalizationRules.v1"
        }),

        DATA_TYPES,
        FIELD_TYPES: DATA_TYPES,
        REQUIRED_FIELDS,
        SYSTEM_FIELDS: Object.freeze(SYSTEM_FIELDS),
        SYSTEM_FIELD_MAP,
        FIELD_ALIASES,
        DERIVED_FIELDS: Object.freeze(DERIVED_FIELDS),
        INTERNAL_FIELDS,
        MONTHS: Object.freeze(MONTHS),
        WEEKDAYS: Object.freeze(WEEKDAYS),
        SEASONS: Object.freeze(SEASONS),
        AGGREGATIONS: Object.freeze(AGGREGATIONS),
        AGGREGATION_IDS,
        CHART_TYPES: Object.freeze(CHART_TYPES),
        CHART_TYPE_IDS,
        ANALYSIS_TEMPLATES,
        DEFAULT_ANALYSIS,
        FILTER_FIELDS,
        NORMALIZABLE_FIELDS: Object.freeze([
            "material", "brand", "line", "unit", "shift", "packagingType", "category"
        ]),
        VALIDATION_CODES,
        VALIDATION_MESSAGES,

        MAPPING_CONFIDENCE: Object.freeze({
            autoSelectThreshold: 0.56,
            highThreshold: 0.82,
            mediumThreshold: 0.66
        }),

        IMPORT_LIMITS: Object.freeze({
            maximumFileSizeBytes: 100 * 1024 * 1024,
            maximumSheets: 200,
            maximumRows: 500000,
            maximumColumns: 500,
            previewRowLimit: 100,
            typeDetectionSampleSize: 300
        }),

        PROCESSING_LIMITS: Object.freeze({
            batchSize: 3000,
            maximumFilterOptions: 1000,
            maximumRenderedPivotRows: 1000,
            maximumChartLabels: 100,
            maximumStoredMappingProfiles: 20,
            maximumStoredNormalizationRules: 5000,
            maximumRenderedNormalizationGroups: 300,
            toastDurationMilliseconds: 4500
        }),

        NUMBER_FORMAT: Object.freeze({
            locale: "pl-PL",
            minimumFractionDigits: 0,
            maximumFractionDigits: 2
        }),

        DATE_FORMAT: Object.freeze({
            locale: "pl-PL",
            dateOptions: Object.freeze({ year: "numeric", month: "2-digit", day: "2-digit" }),
            dateTimeOptions: Object.freeze({
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit"
            }),
            excelEpochUTC: Date.UTC(1899, 11, 30),
            millisecondsPerDay: 86400000
        }),

        BOOLEAN_VALUES: Object.freeze({
            trueValues: Object.freeze(["true", "tak", "yes", "1", "y", "t"]),
            falseValues: Object.freeze(["false", "nie", "no", "0", "n"])
        }),

        NORMALIZATION: Object.freeze({
            quantityAllowsNegative: false,
            quantityAllowsZero: true,
            duplicateDetectionEnabled: true,
            duplicateIdentifierField: "recordId",
            duplicateIdentifierCaseSensitive: false,
            duplicateFallback: "exact_source_row",
            duplicateSourceRowCaseSensitive: true
        }),

        EXPORT: Object.freeze({
            csvDelimiter: ";",
            csvLineEnding: "\r\n",
            csvIncludeBom: true
        }),

        DECISION: Object.freeze({
            minimumObservedDays: 3,
            lowDensityThreshold: 0.1,
            mediumDensityThreshold: 0.3,
            mediumObservedDaysThreshold: 7,
            riskCoverageDays: 7,
            abcThresholdA: 80,
            abcThresholdB: 95,
            paretoThreshold: 80,
            forecastDefaultDays: 90,
            forecastDefaultBuffer: 0.15,
            forecastMaxDays: 365,
            forecastMaxBuffer: 1
        }),

        SORT_ORDERS: Object.freeze({ ASC: "asc", DESC: "desc" }),
        RESULT_VIEWS,
        STATUS,
        EVENTS,

        UI_TEXT: Object.freeze({
            loadingFile: "Wczytywanie pliku",
            analyzingSheet: "Analizowanie arkusza",
            processingData: "Przetwarzanie danych",
            buildingAnalysis: "Budowanie analizy",
            noData: "Brak danych.",
            allValues: "Wszystkie wartości",
            emptyValue: "(pusta wartość)"
        }),

        HELP_CONTENT: Object.freeze({
            import: Object.freeze({
                title: "Import danych",
                message: "Wczytaj plik XLSX, XLS lub XLSB. Pierwszy wiersz wybranego arkusza musi zawierać nazwy kolumn."
            }),
            mapping: Object.freeze({
                title: "Przygotowanie i jakość danych",
                message: "W trybie pojedynczego arkusza przypisz kolumny źródłowe do pól systemowych. W trybie modelu skoroszytu mapowanie wykonuje się wcześniej przy rolach arkuszy, dlatego etap 2 pokazuje tylko podsumowanie modelu i kontrolę jakości."
            }),
            analysis: Object.freeze({
                title: "Analiza",
                message: "Przeciągaj pola do Wierszy, Kolumn i Wartości, aby utworzyć tabelę przestawną oraz wykres."
            }),
            decision: Object.freeze({
                title: "Analiza decyzyjna",
                message: "Pareto i ABC korzystają ze zużycia. Pokrycie, ryzyko i szacowane zapotrzebowanie używają priorytetowo osobnej tabeli zapasów z Edytora danych, a w drugiej kolejności pola „Aktualny stan zapasu”."
            }),
            dataLab: Object.freeze({
                title: "Edytor danych",
                message: "Arkusz zachowuje wszystkie kolumny źródłowe. Możesz edytować komórki, kopiować i wklejać zakresy, filtrować, sortować, wykonywać transformacje, tworzyć kolumny obliczeniowe, poprawiać błędne wiersze i zapisywać projekty lokalnie."
            }),
            smartAnalytics: Object.freeze({
                title: "Smart Analytics",
                message: "Silnik działa lokalnie i deterministycznie. Rozpoznaje typy oraz role kolumn, kontroluje jakość, wykrywa anomalie, analizuje trendy i zależności, a następnie tworzy rekomendowane zestawienia, wykresy i raport bez użycia zewnętrznej AI."
            })
        })
    };

    Object.defineProperty(PMA, "constants", {
        value: Object.freeze(constants),
        writable: false,
        enumerable: true,
        configurable: false
    });
})(window);
