# Weryfikacja

## Uruchomienie

```bash
npm ci
npm test
```

`run-tests.js` uruchamia lokalny serwer HTTP i pięć zestawów kontroli:

- `static-audit-test.js` — 12 kontroli składni, zasobów, HTML, wersji, schematu Workspace i bezpieczeństwa parsera;
- `integration-test.js` — 49 kontroli bootu, normalizacji, sezonów, Coverage Days, ryzyka, Pareto, ABC, planowania, renderowania, filtrów i resetu;
- `data-lab-test.js` — 27 kontroli importu, zachowania kolumn, wirtualnego arkusza, formuł, transformacji, Undo/Redo, osobnego zapasu, reguł zamawiania i Workspace;
- `audit-regression-test.js` — 42 kontrole napraw krytycznych: formuły, filtry, sortowanie, wklejanie, zależności, sezonowość, jednostki, eksport i autosave;
- `performance-test.js` — 8 kontroli przepływu 50 000 wierszy, wirtualizacji, agregacji, formuł i serializacji.

Oczekiwany wynik:

```text
12/12 checks passed.
49/49 checks passed.
27/27 checks passed.
42/42 checks passed.
8/8 checks passed.
```

Łącznie: **138/138**.
