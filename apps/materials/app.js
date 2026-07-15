/* ==========================================================
   Pack Materials Analytics
   app.js
========================================================== */

(function initializeApplication(global) {
    "use strict";

    const PMA = global.PMA || (global.PMA = {});
    const REQUIRED_MODULES = [
        "constants", "state", "utils", "dom", "importEngine", "mappingEngine",
        "valueNormalizationEngine", "normalizationEngine", "pivotEngine", "chartEngine", "exportEngine"
    ];

    const lifecycle = {
        initialized: false,
        initializing: false,
        destroyed: false,
        failed: false,
        phase: "idle",
        startedAt: null,
        readyAt: null,
        error: null
    };

    const bindings = [];
    const runtimeModules = [];
    let initializationPromise = null;
    let resetting = false;
    let dragDepth = 0;
    let fatalOverlay = null;

    function initialize() {
        if (lifecycle.initialized) return Promise.resolve(api);
        if (initializationPromise) return initializationPromise;
        initializationPromise = boot().then(() => api).catch((error) => {
            handleFatalError(error, "Uruchamianie aplikacji");
            throw error;
        });
        return initializationPromise;
    }

    async function boot() {
        lifecycle.initializing = true;
        lifecycle.destroyed = false;
        lifecycle.failed = false;
        lifecycle.phase = "checking";
        lifecycle.startedAt = new Date().toISOString();
        verifyEnvironment();
        verifyModules();
        verifyLibraries();

        lifecycle.phase = "state";
        PMA.state.initialize();
        lifecycle.phase = "interface";
        PMA.dom.initialize();
        PMA.dom.resetUI({ preserveToastMessages: true });

        lifecycle.phase = "modules";
        [
            PMA.importEngine,
            PMA.mappingEngine,
            PMA.valueNormalizationEngine,
            PMA.normalizationEngine,
            PMA.chartEngine,
            PMA.pivotEngine,
            PMA.exportEngine
        ].forEach((module) => {
            module.initialize();
            runtimeModules.push(module);
        });

        lifecycle.phase = "events";
        bindEvents();
        configureDocument();
        PMA.exportEngine.refreshAvailability();
        PMA.state.setActiveSection("importSection");
        PMA.state.setApplicationStatus(PMA.constants.STATUS.READY);

        lifecycle.initialized = true;
        lifecycle.initializing = false;
        lifecycle.phase = "ready";
        lifecycle.readyAt = new Date().toISOString();
        document.documentElement.dataset.appReady = "true";
        document.body.classList.add("app-ready");
        dispatch(PMA.constants.EVENTS.APPLICATION_READY, {
            version: PMA.constants.APP.version,
            startedAt: lifecycle.startedAt,
            readyAt: lifecycle.readyAt
        });
    }

    function verifyEnvironment() {
        const required = {
            FileReader: typeof global.FileReader === "function",
            Blob: typeof global.Blob === "function",
            Promise: typeof global.Promise === "function",
            Map: typeof global.Map === "function",
            Set: typeof global.Set === "function",
            Intl: typeof global.Intl === "object",
            createObjectURL: typeof global.URL?.createObjectURL === "function"
        };
        const missing = Object.entries(required).filter(([, available]) => !available).map(([name]) => name);
        if (missing.length) throw new Error(`Przeglądarka nie obsługuje wymaganych funkcji: ${missing.join(", ")}.`);
    }

    function verifyModules() {
        const missing = REQUIRED_MODULES.filter((name) => !PMA[name]);
        if (missing.length) throw new Error(`Nie załadowano modułów aplikacji: ${missing.join(", ")}.`);
    }

    function verifyLibraries() {
        const missing = [];
        if (!global.XLSX?.read || !global.XLSX?.utils) missing.push("SheetJS");
        if (!global.Chart || typeof global.Chart !== "function") missing.push("Chart.js");
        if (missing.length) throw new Error(`Nie udało się załadować bibliotek: ${missing.join(", ")}. Sprawdź połączenie internetowe i odśwież stronę.`);
    }

    function bindEvents() {
        bind(PMA.dom.elements.resetWorkspaceButton, "click", () => resetWorkspace());
        bind(document, "dragenter", handleDragEnter);
        bind(document, "dragover", handleDragOver);
        bind(document, "dragleave", handleDragLeave);
        bind(document, "drop", handleDrop);
        bind(document, "keydown", handleShortcut);
        bind(global, "error", handleGlobalError);
        bind(global, "unhandledrejection", handleUnhandledRejection);
        bind(global, "pagehide", handlePageHide);
        bind(document, PMA.constants.EVENTS.DATA_NORMALIZED, () => PMA.exportEngine.refreshAvailability());
        bind(document, PMA.constants.EVENTS.PIVOT_BUILT, () => PMA.exportEngine.refreshAvailability());
    }

    function bind(target, eventName, handler, options = false) {
        target.addEventListener(eventName, handler, options);
        bindings.push({ target, eventName, handler, options });
    }

    async function resetWorkspace(options = {}) {
        if (resetting) return false;
        if (options.force !== true && hasWorkspaceData()) {
            const confirmed = global.confirm("Czy na pewno wyczyścić cały obszar roboczy? Wczytane dane, mapowanie, filtry i wynik analizy zostaną usunięte.");
            if (!confirmed) return false;
        }

        resetting = true;
        try {
            clearDragState();
            PMA.dom.closeExportMenu();
            PMA.dom.closeHelpPopover();
            PMA.chartEngine.clear();
            PMA.state.resetWorkspace({
                preservePreferences: true,
                preserveMappingProfiles: true,
                preserveNormalizationRules: true,
                preserveRecentFiles: true
            });
            PMA.dom.resetUI();
            PMA.exportEngine.refreshAvailability();
            PMA.dom.showInfo("Obszar roboczy został wyczyszczony.", "Nowa analiza");
            PMA.dom.focus(PMA.dom.elements.excelFileInput);
            return true;
        } catch (error) {
            reportError(error, "Resetowanie obszaru roboczego");
            return false;
        } finally {
            resetting = false;
        }
    }

    function hasWorkspaceData() {
        return Boolean(
            PMA.state.get("import.file") ||
            PMA.state.get("import.workbook") ||
            PMA.state.get("import.dataRows.length", 0) ||
            PMA.state.get("dataset.normalizedRows.length", 0) ||
            PMA.state.get("pivot.ready", false)
        );
    }

    function isFileDrag(event) {
        return [...(event.dataTransfer?.types || [])].includes("Files");
    }

    function handleDragEnter(event) {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        dragDepth += 1;
        setDragState(true);
    }

    function handleDragOver(event) {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
        setDragState(true);
    }

    function handleDragLeave(event) {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        dragDepth = Math.max(0, dragDepth - 1);
        if (!dragDepth) setDragState(false);
    }

    async function handleDrop(event) {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        clearDragState();
        const files = [...(event.dataTransfer?.files || [])];
        if (!files.length) return;
        if (files.length > 1) PMA.dom.showWarning("Można wczytać tylko jeden plik jednocześnie. Użyto pierwszego pliku.", "Import pliku");
        await PMA.importEngine.importFile(files[0]);
    }

    function setDragState(active) {
        document.documentElement.classList.toggle("is-file-dragging", Boolean(active));
        PMA.dom.elements.importSection.classList.toggle("is-drag-over", Boolean(active));
    }

    function clearDragState() {
        dragDepth = 0;
        setDragState(false);
    }

    function handleShortcut(event) {
        if (!(event.ctrlKey || event.metaKey)) return;
        const key = event.key.toLowerCase();
        if (key === "o") {
            event.preventDefault();
            if (!PMA.state.get("application.busy", false)) PMA.dom.elements.excelFileInput.click();
        } else if (key === "e" && PMA.state.get("pivot.ready", false)) {
            event.preventDefault();
            PMA.dom.toggleExportMenu();
        } else if (key === "r" && event.shiftKey) {
            event.preventDefault();
            resetWorkspace();
        }
    }

    function handleGlobalError(event) {
        const error = event.error || new Error(event.message || "Nieznany błąd aplikacji.");
        if (!shouldIgnore(error)) reportError(error, "Błąd aplikacji");
    }

    function handleUnhandledRejection(event) {
        const error = event.reason instanceof Error ? event.reason : new Error(String(event.reason || "Operacja zakończyła się błędem."));
        if (shouldIgnore(error)) return;
        event.preventDefault();
        reportError(error, "Nieobsłużona operacja");
    }

    function shouldIgnore(error) {
        return [
            "IMPORT_CANCELLED", "VALIDATION_CANCELLED", "NORMALIZATION_CANCELLED",
            "FILTER_CANCELLED", "PIVOT_CANCELLED", "EXPORT_CANCELLED"
        ].includes(error?.code) || String(error?.message || "").includes("ResizeObserver loop");
    }

    function reportError(error, context) {
        if (shouldIgnore(error)) return;
        PMA.state.setError(error, context);
        PMA.dom.hideLoading();
        PMA.dom.showError(PMA.utils.normalizeError(error).message, context);
        console.error(`[PMA] ${context}:`, error);
    }

    function handleFatalError(error, context) {
        lifecycle.initialized = false;
        lifecycle.initializing = false;
        lifecycle.failed = true;
        lifecycle.phase = "failed";
        lifecycle.error = PMA.utils?.normalizeError ? PMA.utils.normalizeError(error, context) : { message: String(error) };
        console.error(`[PMA] ${context}:`, error);
        renderFatalError(lifecycle.error.message);
    }

    function renderFatalError(message) {
        fatalOverlay?.remove();
        const overlay = document.createElement("div");
        overlay.className = "fatal-overlay";
        overlay.setAttribute("role", "alert");
        const panel = document.createElement("section");
        panel.className = "fatal-panel";
        const title = document.createElement("h1");
        title.textContent = "Nie można uruchomić aplikacji";
        const description = document.createElement("p");
        description.textContent = String(message);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "button button-primary";
        button.textContent = "Odśwież stronę";
        button.addEventListener("click", () => global.location.reload());
        panel.append(title, description, button);
        overlay.appendChild(panel);
        document.body.appendChild(overlay);
        fatalOverlay = overlay;
        button.focus();
    }

    function configureDocument() {
        document.title = PMA.constants.APP.name;
        document.documentElement.classList.remove("no-js");
        document.querySelectorAll("[data-app-name]").forEach((element) => {
            if (element !== document.documentElement) element.textContent = PMA.constants.APP.name;
        });
        document.querySelectorAll("[data-app-version]").forEach((element) => {
            if (element !== document.documentElement) element.textContent = PMA.constants.APP.version;
        });
        document.documentElement.dataset.appName = PMA.constants.APP.name;
        document.documentElement.dataset.appVersion = PMA.constants.APP.version;
    }

    function handlePageHide(event) {
        if (!event.persisted) PMA.chartEngine?.clear?.();
    }

    function destroy() {
        if (lifecycle.destroyed) return;
        bindings.forEach(({ target, eventName, handler, options }) => target.removeEventListener(eventName, handler, options));
        bindings.length = 0;
        [...runtimeModules].reverse().forEach((module) => module.destroy?.());
        runtimeModules.length = 0;
        PMA.dom.destroy();
        fatalOverlay?.remove();
        fatalOverlay = null;
        lifecycle.initialized = false;
        lifecycle.destroyed = true;
        lifecycle.phase = "destroyed";
        initializationPromise = null;
        delete document.documentElement.dataset.appReady;
        document.body.classList.remove("app-ready");
    }

    function dispatch(eventName, detail) {
        if (typeof CustomEvent === "function") document.dispatchEvent(new CustomEvent(eventName, { detail }));
    }

    function getStatus() {
        return {
            ...lifecycle,
            error: lifecycle.error ? { ...lifecycle.error } : null,
            modules: Object.fromEntries(REQUIRED_MODULES.map((name) => [name, Boolean(PMA[name])])),
            libraries: { sheetJs: global.XLSX?.version || null, chartJs: global.Chart?.version || null }
        };
    }

    const api = Object.freeze({
        initialize,
        destroy,
        resetWorkspace,
        hasWorkspaceData,
        getStatus,
        isInitialized: () => lifecycle.initialized,
        isResetting: () => resetting
    });

    Object.defineProperty(PMA, "app", {
        value: api,
        writable: false,
        enumerable: true,
        configurable: false
    });

    function start() {
        initialize().catch(() => {});
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
    else global.queueMicrotask ? global.queueMicrotask(start) : global.setTimeout(start, 0);
})(window);
