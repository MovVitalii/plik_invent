/* ==========================================================
   Excel Analytics Trainer
   src/constants.js
========================================================== */

(function initializeConstants(global) {
    "use strict";

    const APP = Object.freeze({
        name: "Excel Analytics Trainer",
        shortName: "EAT",
        version: "1.0.0",
        locale: "pl-PL"
    });

    const STATUS = Object.freeze({
        IDLE: "idle",
        LOADING: "loading",
        PROCESSING: "processing",
        READY: "ready",
        SUCCESS: "success",
        WARNING: "warning",
        ERROR: "error"
    });

    const SECTIONS = Object.freeze({
        IMPORT: "importSection",
        PREVIEW: "previewSection",
        QUALITY: "qualitySection",
        CLEANING: "cleaningSection",
        CALCULATION: "calculationSection",
        PIVOT: "pivotSection",
        REPORT: "reportSection"
    });

    const SECTION_ORDER = Object.freeze([
        SECTIONS.IMPORT,
        SECTIONS.PREVIEW,
        SECTIONS.QUALITY,
        SECTIONS.CLEANING,
        SECTIONS.CALCULATION,
        SECTIONS.PIVOT,
        SECTIONS.REPORT
    ]);

    const EVENTS = Object.freeze({
        STATE_CHANGED: "eat:state-changed",
        WORKSPACE_RESET: "eat:workspace-reset",
        DATA_READY: "eat:data-ready",
        QUALITY_COMPLETED: "eat:quality-completed",
        CLEANING_APPLIED: "eat:cleaning-applied",
        CLEANING_UNDONE: "eat:cleaning-undone",
        CALCULATION_COMPLETED: "eat:calculation-completed",
        PIVOT_BUILT: "eat:pivot-built"
    });

    const DATA_TYPES = Object.freeze({
        TEXT: "text",
        NUMBER: "number",
        DATE: "date",
        BOOLEAN: "boolean",
        EMPTY: "empty",
        MIXED: "mixed"
    });

    const FILE_LIMITS = Object.freeze({
        maximumBytes: 50 * 1024 * 1024,
        defaultPageSize: 25,
        maximumPreviewRows: 100000
    });

    const CLEANING_OPERATIONS = Object.freeze([
        { id: "trim", label: "Usuń spacje z początku i końca" },
        { id: "clean", label: "Usuń znaki niedrukowalne" },
        { id: "upper", label: "Wielkie litery" },
        { id: "lower", label: "Małe litery" },
        { id: "proper", label: "Każde słowo wielką literą" },
        { id: "replace", label: "Zamień tekst" },
        { id: "remove-empty", label: "Usuń wiersze z pustą wartością" },
        { id: "remove-duplicates", label: "Usuń pełne duplikaty" }
    ]);

    const CALCULATION_FUNCTIONS = Object.freeze([
        {
            id: "sum",
            excelName: "SUM",
            label: "Suma",
            description: "Sumuje wartości liczbowe w wybranej kolumnie."
        },
        {
            id: "average",
            excelName: "AVERAGE",
            label: "Średnia",
            description: "Oblicza średnią arytmetyczną wartości liczbowych."
        },
        {
            id: "count",
            excelName: "COUNT",
            label: "Liczba wartości liczbowych",
            description: "Liczy komórki zawierające liczby."
        },
        {
            id: "counta",
            excelName: "COUNTA",
            label: "Liczba wartości niepustych",
            description: "Liczy wszystkie komórki niepuste, także tekst, 0 i FALSE."
        },
        {
            id: "min",
            excelName: "MIN",
            label: "Minimum",
            description: "Zwraca najmniejszą wartość liczbową."
        },
        {
            id: "max",
            excelName: "MAX",
            label: "Maksimum",
            description: "Zwraca największą wartość liczbową."
        },
        {
            id: "sumifs",
            excelName: "SUMIFS",
            label: "Suma z warunkami",
            supportsCriteria: true,
            description: "Sumuje wartości dla wierszy spełniających wszystkie warunki."
        },
        {
            id: "countifs",
            excelName: "COUNTIFS",
            label: "Liczba wierszy z warunkami",
            supportsCriteria: true,
            description: "Liczy wiersze spełniające wszystkie warunki."
        },
        {
            id: "averageifs",
            excelName: "AVERAGEIFS",
            label: "Średnia z warunkami",
            supportsCriteria: true,
            description: "Oblicza średnią dla wierszy spełniających wszystkie warunki."
        },
        {
            id: "minifs",
            excelName: "MINIFS",
            label: "Minimum z warunkami",
            supportsCriteria: true,
            description: "Zwraca minimum dla wierszy spełniających wszystkie warunki."
        },
        {
            id: "maxifs",
            excelName: "MAXIFS",
            label: "Maksimum z warunkami",
            supportsCriteria: true,
            description: "Zwraca maksimum dla wierszy spełniających wszystkie warunki."
        }
    ]);

    const CRITERIA_OPERATORS = Object.freeze([
        { id: "equals", label: "Równe", symbol: "=" },
        { id: "not-equals", label: "Różne", symbol: "<>" },
        { id: "contains", label: "Zawiera" },
        { id: "not-contains", label: "Nie zawiera" },
        { id: "starts-with", label: "Zaczyna się od" },
        { id: "ends-with", label: "Kończy się na" },
        { id: "greater-than", label: "Większe niż", symbol: ">" },
        { id: "greater-or-equal", label: "Większe lub równe", symbol: ">=" },
        { id: "less-than", label: "Mniejsze niż", symbol: "<" },
        { id: "less-or-equal", label: "Mniejsze lub równe", symbol: "<=" },
        { id: "is-empty", label: "Puste" },
        { id: "is-not-empty", label: "Niepuste" }
    ]);

    const AGGREGATIONS = Object.freeze([
        { id: "sum", label: "Suma" },
        { id: "average", label: "Średnia" },
        { id: "count", label: "Liczba" },
        { id: "min", label: "Minimum" },
        { id: "max", label: "Maksimum" }
    ]);

    const CHART_TYPES = Object.freeze([
        {
            id: "bar",
            label: "Kolumnowy",
            chartJsType: "bar",
            indexAxis: "x"
        },
        {
            id: "horizontal-bar",
            label: "Poziomy",
            chartJsType: "bar",
            indexAxis: "y"
        },
        {
            id: "line",
            label: "Liniowy",
            chartJsType: "line",
            indexAxis: "x"
        },
        {
            id: "pie",
            label: "Kołowy",
            chartJsType: "pie",
            indexAxis: "x"
        },
        {
            id: "doughnut",
            label: "Pierścieniowy",
            chartJsType: "doughnut",
            indexAxis: "x"
        }
    ]);

    const LEARNING_CONTENT = Object.freeze({
        import: Object.freeze({
            explanation: "Wczytaj plik Excel lub CSV, wybierz arkusz i rozpocznij analizę.",
            excelEquivalent: "Dane → Pobierz dane → Z pliku",
            verificationTip: "Sprawdź nazwę pliku, liczbę arkuszy oraz poprawność wiersza nagłówków."
        }),
        preview: Object.freeze({
            explanation: "Przeglądaj dane, wyszukuj wartości i sortuj kolumny przed rozpoczęciem analizy.",
            excelEquivalent: "Ctrl+T, Sortuj i filtruj",
            verificationTip: "Porównaj liczbę wierszy i kolumn z plikiem źródłowym."
        }),
        quality: Object.freeze({
            explanation: "Kontrola jakości wykrywa puste komórki, pełne duplikaty i niespójne typy.",
            excelEquivalent: "Filtry, formatowanie warunkowe, Usuń duplikaty",
            verificationTip: "Nie usuwaj danych automatycznie, dopóki nie rozumiesz przyczyny problemu."
        }),
        cleaning: Object.freeze({
            explanation: "Czyszczenie zmienia dane robocze, ale pozwala cofnąć ostatnią operację.",
            excelEquivalent: "TRIM, CLEAN, SUBSTITUTE oraz Power Query",
            verificationTip: "Porównaj próbki przed i po zmianie oraz liczbę wierszy."
        }),
        calculation: Object.freeze({
            explanation: "Wykonuj podstawowe funkcje oraz obliczenia wielowarunkowe.",
            excelEquivalent: "SUM, AVERAGE, COUNT, SUMIFS, COUNTIFS",
            verificationTip: "Sprawdź wynik na małej próbce, którą można policzyć ręcznie."
        }),
        pivot: Object.freeze({
            explanation: "Grupuj dane według pól i agreguj jedną kolumnę wartości.",
            excelEquivalent: "Wstaw → Tabela przestawna",
            verificationTip: "Suma kontrolna Pivot powinna zgadzać się z danymi źródłowymi."
        }),
        report: Object.freeze({
            explanation: "Zbuduj wykres i wyeksportuj oczyszczone dane lub pełną analizę.",
            excelEquivalent: "Wstaw → Wykres oraz Plik → Eksportuj",
            verificationTip: "Sprawdź tytuł, legendę, jednostkę oraz zakres danych."
        })
    });

    const REQUIRED_MODULES = Object.freeze([
        "state",
        "utils",
        "dom",
        "importEngine",
        "dataQualityEngine",
        "cleaningEngine",
        "calculationEngine",
        "pivotEngine",
        "chartEngine",
        "exportEngine",
        "learningEngine"
    ]);

    const constants = Object.freeze({
        APP,
        STATUS,
        SECTIONS,
        SECTION_ORDER,
        EVENTS,
        DATA_TYPES,
        FILE_LIMITS,
        CLEANING_OPERATIONS,
        CALCULATION_FUNCTIONS,
        CRITERIA_OPERATORS,
        AGGREGATIONS,
        CHART_TYPES,
        LEARNING_CONTENT,
        REQUIRED_MODULES
    });

    const EAT = global.EAT || (global.EAT = {});

    Object.defineProperty(EAT, "constants", {
        value: constants,
        writable: false,
        enumerable: true,
        configurable: false
    });
})(window);
