# Weryfikacja

## Uruchomienie

```bash
npm ci
npm test
```

`run-tests.js` uruchamia lokalny serwer HTTP oraz jedenaście zestawów kontroli:

- `static-audit-test.js` — 25 kontroli składni, zasobów, HTML, wersji, Workspace, bezpieczeństwa i lokalności runtime;
- `duckdb-local-test.js` — 17 kontroli lokalnych assetów DuckDB i query buildera;
- `duckdb-runtime-test.js` — 8 rzeczywistych kontroli instancjacji WASM i wykonania SQL;
- `smart-analytics-test.js` — 36 kontroli logiki Smart Analytics;
- `smart-performance-test.js` — 9 kontroli wydajności Smart Analytics;
- `integration-test.js` — 59 kontroli pełnego uruchomienia aplikacji;
- `workbook-model-test.js` — 18 kontroli wieloarkuszowego modelu danych;
- `data-lab-test.js` — 35 kontroli Edytora danych, formuł, zapasów i Workspace;
- `ncg-workbook-regression-test.js` — 36 kontroli skoroszytu NCG;
- `audit-regression-test.js` — 42 kontrole krytycznych regresji;
- `performance-test.js` — 8 kontroli przepływu 50 000 wierszy.

Oczekiwany wynik:

```text
25/25
17/17
8/8
36/36
9/9
59/59
18/18
35/35
36/36
42/42
8/8
```

Łącznie: **293/293**.
