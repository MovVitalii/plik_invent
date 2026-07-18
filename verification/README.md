# Weryfikacja

## Uruchomienie

```bash
npm ci
npm test
```

`run-tests.js` uruchamia lokalny serwer HTTP oraz dziewięć zestawów kontroli:

- `static-audit-test.js` — 19 kontroli składni, zasobów, HTML, wersji, schematu Workspace, lokalności Smart Analytics i bezpieczeństwa parsera;
- `duckdb-local-test.js` — 17 kontroli lokalnych assetów DuckDB, query buildera, konwersji wyników i fallbacku;
- `duckdb-runtime-test.js` — 8 rzeczywistych kontroli instancjacji dołączonego WASM oraz wykonania SQL;
- `smart-analytics-test.js` — 32 kontrole typów, semantyki, jakości, anomalii, trendów, okresów, korelacji, Pivot, wykresów, insightów i raportu;
- `smart-performance-test.js` — 9 kontroli skalowania pipeline Smart Analytics;
- `integration-test.js` — 58 kontroli bootu, normalizacji, sezonów, Coverage Days, ryzyka, Pareto, ABC, planowania, renderowania, filtrów i Smart Analytics UI;
- `data-lab-test.js` — 29 kontroli importu, kolumn źródłowych, wirtualnego arkusza, formuł, transformacji, Undo/Redo, zapasu, Workspace i wyniku Smart Analytics;
- `audit-regression-test.js` — 42 kontrole krytycznych napraw formuł, filtrów, sortowania, zależności, sezonowości, jednostek, eksportu i autosave;
- `performance-test.js` — 8 kontroli przepływu 50 000 wierszy, wirtualizacji, agregacji, formuł i serializacji.

Oczekiwany wynik:

```text
19/19 checks passed.
17/17 checks passed.
8/8 checks passed.
32/32 checks passed.
9/9 checks passed.
58/58 checks passed.
29/29 checks passed.
42/42 checks passed.
8/8 checks passed.
```

Łącznie: **222/222**.
