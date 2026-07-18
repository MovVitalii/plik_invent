# Materials Analytics 1.5.0 — dokumentacja techniczna

## Model uruchomieniowy

Aplikacja jest statyczna, działa w przeglądarce i nie ma backendu. Dane, statystyki, SQL, raporty i eksporty są przetwarzane lokalnie. Nie ma integracji z AI, LLM, chmurą ani zewnętrznym API.

## Moduły bazowe

- `constants.js` — definicje pól, limity, progi i wersja runtime;
- `state.js` — centralny stan i zdarzenia;
- `utils.js` — tekst, daty, liczby, formaty i walidacja;
- `import-engine.js` — Excel/CSV, wiele plików, arkusze i nagłówki;
- `mapping-engine.js` — mapowanie źródła na role analityczne;
- `value-normalization-engine.js` — techniczne ujednolicanie wartości bez osobnej sekcji UI;
- `normalization-engine.js` — walidacja i budowa rekordu analitycznego;
- `pivot-engine.js` — filtry, Pivot Table i podsumowania;
- `decision-engine.js` — Coverage, ABC/Pareto i planowanie;
- `chart-engine.js` — wykresy;
- `export-engine.js` — eksport analizy;
- `workspace-storage.js` — IndexedDB i fallback localStorage;
- `formula-engine.js` — parser/evaluator bez wykonania kodu;
- `spreadsheet-engine.js` — wirtualny arkusz, transformacje, zapasy, Workspace i eksport;
- `app.js` — inicjalizacja oraz koordynacja workflow.

## Smart Analytics

Katalog `src/analytics/`:

- `rules/analytics-rules.js` — wersjonowane role, progi, agregacje i zasady rekomendacji;
- `analytics-core.js` — wspólne funkcje statystyczne, sampling i normalizacja;
- `schema-profiler.js` — fizyczne typy, rozkład, unikalność i dowody;
- `semantic-role-engine.js` — semantyczne role biznesowe;
- `descriptive-statistics.js` — statystyki opisowe;
- `data-quality-engine.js` — braki, duplikaty, typy mieszane i spójność;
- `outlier-engine.js` — IQR, MAD robust Z-score i anomalie lokalne;
- `trend-engine.js` — szeregi czasowe, granularność, regresja i zmienność;
- `period-comparison-engine.js` — zmiany okres do okresu i contributors;
- `correlation-engine.js` — Pearson, Spearman, eta² i Cramér’s V;
- `confidence-engine.js` — wspólna ocena confidence;
- `pivot-recommender.js` — rekomendacje i JavaScript materializer Pivot;
- `chart-recommender.js` — dobór wykresów;
- `insight-engine.js` — regułowe wnioski, ryzyka i działania;
- `report-generator.js` — raport szablonowy i metodologia;
- `analytics-orchestrator.js` — kolejność etapów i struktura wyniku;
- `analytics.worker.js` — izolacja kosztownych obliczeń;
- `duckdb-engine.js` — lokalny adapter DuckDB-WASM;
- `smart-analytics-engine.js` — UI, eksport, wykresy i integracja z Workspace.

## Pipeline

```text
rows + fields + options
→ schema profile
→ semantic roles
→ descriptive statistics
→ data quality
→ outliers
→ trends
→ period comparisons
→ correlations
→ recommended pivots
→ recommended charts
→ rule-based insights
→ template report
```

Wynik zawiera `datasetProfile`, `schema`, `descriptive`, `quality`, `outliers`, `trends`, `periodComparisons`, `correlations`, `pivots`, `recommendedCharts`, `insights`, `report`, `methodology` i `execution`.

## Metodologia i agregacje

- Quick mode: ograniczona próbka dla profilowania i kosztownych obliczeń.
- Full mode: pełne statystyki jakościowe/opisowe; bounded sample może pozostać dla type detection i korelacji.
- Outliers: IQR oraz robust Z-score oparty na MAD.
- Stock: `latest` według daty i kolejności rekordu.
- Price, percentage, duration: `average`.
- Quantity, currency, cost, generic measure: `sum`.

Raport zawsze przechowuje liczbę wierszy, tryb, sampling, metody i wersję reguł.

## DuckDB-WASM

Lokalne pliki znajdują się w `vendor/duckdb/`:

```text
duckdb-browser.bundle.mjs
duckdb-browser-mvp.worker.js
duckdb-mvp.wasm
```

Adapter:

- ładuje runtime wyłącznie lokalnie;
- rejestruje tymczasowy JSON jako tabelę;
- generuje CTE `base`, `grouped`, `totals`;
- używa prawdziwego total z rekordów źródłowych;
- obsługuje `sum`, `average`, `min`, `max`, `count` i `latest`;
- usuwa tabelę i plik po wykonaniu;
- w przypadku niedostępności SQL pozostawia JavaScript fallback.

## Workspace

- schemat: **v4**;
- autosave: IndexedDB;
- fallback: localStorage;
- eksport/import: Workspace JSON;
- wynik Smart Analytics jest serializowany;
- import jest transakcyjny i waliduje strukturę przed zastąpieniem stanu.

## Zasady bezpieczeństwa

- brak `eval` i `new Function` w kodzie aplikacji;
- brak zewnętrznych URL w Smart Analytics;
- brak wykonania kodu z formuł użytkownika;
- CSV injection protection;
- bounded rendering i bounded sampling;
- jawne limitations/confidence zamiast ukrywania słabej jakości wyniku.

## Testy

Pełny zestaw: `npm test` w katalogu głównym.

Łącznie: **222/222** kontroli, w tym 8 rzeczywistych testów instancjacji dołączonego DuckDB-WASM i wykonania SQL.
