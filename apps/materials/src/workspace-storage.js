/* ==========================================================
   Materials Analytics
   src/workspace-storage.js
   IndexedDB-backed local project storage with localStorage fallback.
========================================================== */
(function initializeWorkspaceStorage(global) {
    "use strict";

    const PMA = global.PMA || (global.PMA = {});
    const DB_NAME = "materials-analytics-workspaces";
    const DB_VERSION = 1;
    const STORE = "projects";
    const AUTOSAVE_ID = "__autosave__";
    const SCHEMA_VERSION = 4;
    let dbPromise = null;

    function openDatabase() {
        if (!global.indexedDB) return Promise.resolve(null);
        if (dbPromise) return dbPromise;
        dbPromise = new Promise((resolve, reject) => {
            const request = global.indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(STORE)) {
                    const store = db.createObjectStore(STORE, { keyPath: "id" });
                    store.createIndex("updatedAt", "updatedAt", { unique: false });
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => {
                dbPromise = null;
                reject(request.error || new Error("Nie udało się otworzyć IndexedDB."));
            };
            request.onblocked = () => {
                dbPromise = null;
                reject(new Error("Baza projektów jest zablokowana przez inną kartę przeglądarki."));
            };
        });
        return dbPromise;
    }

    async function withStore(mode, operation) {
        const db = await openDatabase();
        if (!db) return fallback(operation);
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE, mode);
            const store = transaction.objectStore(STORE);
            let request;
            try { request = operation(store); } catch (error) { reject(error); return; }
            transaction.oncomplete = () => resolve(request?.result ?? request);
            transaction.onerror = () => reject(transaction.error || new Error("Operacja IndexedDB nie powiodła się."));
            transaction.onabort = () => reject(transaction.error || new Error("Operacja IndexedDB została przerwana."));
        });
    }

    function fallbackKey(id) { return `pma.workspace.v1.${id}`; }
    function fallback(operation) {
        const shim = {
            put(value) { global.localStorage.setItem(fallbackKey(value.id), JSON.stringify(value)); return value; },
            get(id) { const raw = global.localStorage.getItem(fallbackKey(id)); return raw ? JSON.parse(raw) : null; },
            delete(id) { global.localStorage.removeItem(fallbackKey(id)); return true; },
            getAll() {
                const values = [];
                for (let index = 0; index < global.localStorage.length; index += 1) {
                    const key = global.localStorage.key(index);
                    if (!key?.startsWith("pma.workspace.v1.")) continue;
                    try { values.push(JSON.parse(global.localStorage.getItem(key))); } catch (_) { /* ignore damaged entry */ }
                }
                return values;
            }
        };
        return Promise.resolve(operation(shim));
    }

    function normalizeProject(project) {
        const now = new Date().toISOString();
        const incomingVersion = Number(project?.schemaVersion || SCHEMA_VERSION);
        if (incomingVersion > SCHEMA_VERSION) throw new Error(`Nieobsługiwana wersja projektu: ${incomingVersion}.`);
        return {
            ...project,
            id: String(project?.id || `project-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
            name: String(project?.name || project?.project?.name || "Nowy projekt").trim() || "Nowy projekt",
            createdAt: project?.createdAt || now,
            updatedAt: now,
            schemaVersion: SCHEMA_VERSION
        };
    }

    async function saveProject(project) {
        const normalized = normalizeProject(project);
        await withStore("readwrite", (store) => store.put(normalized));
        return normalized;
    }

    async function loadProject(id) { return withStore("readonly", (store) => store.get(String(id))); }
    async function deleteProject(id) { await withStore("readwrite", (store) => store.delete(String(id))); return true; }
    async function listProjects(options = {}) {
        const values = await withStore("readonly", (store) => store.getAll());
        return (Array.isArray(values) ? values : [])
            .filter((item) => options.includeAutosave || item.id !== AUTOSAVE_ID)
            .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
    }
    async function saveAutosave(payload) {
        const originalName = String(payload?.project?.name || payload?.name || "Nowy projekt").trim() || "Nowy projekt";
        return saveProject({ ...payload, id: AUTOSAVE_ID, name: `Automatyczny zapis · ${originalName}`, project: { ...(payload.project || {}), name: originalName } });
    }
    async function loadAutosave() { return loadProject(AUTOSAVE_ID); }
    async function clearAutosave() { return deleteProject(AUTOSAVE_ID); }

    const api = Object.freeze({
        initialize: openDatabase,
        saveProject,
        loadProject,
        deleteProject,
        listProjects,
        saveAutosave,
        loadAutosave,
        clearAutosave,
        AUTOSAVE_ID,
        SCHEMA_VERSION
    });
    Object.defineProperty(PMA, "workspaceStorage", { value: api, writable: false, enumerable: true, configurable: false });
}(window));
