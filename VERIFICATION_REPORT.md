# Verification Report — Materials Analytics 1.5.0

Data końcowej weryfikacji: 2026-07-19

## Wynik końcowy

```text
Static Integrity & Security:     19/19
Local DuckDB Package:            17/17
DuckDB-WASM Runtime + SQL:         8/8
Smart Analytics Logic:           32/32
Smart Analytics Performance:       9/9
Application Integration:         58/58
Spreadsheet Workspace:           29/29
Regression Audit:                42/42
Performance 50k:                   8/8
──────────────────────────────────────
Łącznie:                        222/222
```

Wszystkie zadeklarowane testy automatyczne zakończyły się powodzeniem.

## Kontrole statyczne i bezpieczeństwa

Potwierdzono:

- poprawną składnię wszystkich modułów JavaScript aplikacji;
- brak zduplikowanych identyfikatorów HTML;
- istnienie wszystkich lokalnych odwołań `src` i `href`;
- obecność całego modułowego pipeline Smart Analytics;
- obecność osobnego Web Workera;
- brak `eval` i konstruktora `Function` w kodzie aplikacji;
- brak zewnętrznych URL w źródłach Smart Analytics;
- lokalne dostarczenie bundle, worker i WASM DuckDB;
- zgodność wersji pakietu, UI i runtime: 1.5.0;
- zgodność schematu Workspace: v4;
- poprawny launcher Windows oraz MIME `application/wasm`.

## Weryfikacja DuckDB-WASM

Sprawdzono dwa poziomy:

1. **Integralność pakietu lokalnego** — obecność plików, nagłówek WASM, brak CDN, generowanie bezpiecznego SQL, konwersję wyniku i JavaScript fallback.
2. **Rzeczywiste wykonanie** — dołączony `duckdb-mvp.wasm` został zainicjalizowany przez blokujące bindingi Node pakietu DuckDB-WASM, a SQL wygenerowany przez projekt został wykonany na testowej tabeli.

Rzeczywisty test SQL potwierdził:

- średnią w komórce pivot;
- prawdziwą średnią total z rekordów źródłowych;
- pomijanie pustych ciągów przez `count`;
- prawidłowy total `count`;
- najnowszy snapshot zapasu;
- deterministyczny tie-breaker przy tej samej dacie;
- zgodność wartości i total dla `latest`.

## Smart Analytics — zakres logiki

Testy obejmują:

- fizyczne i semantyczne typy kolumn oraz confidence/evidence;
- liczby, daty, kategorie, identyfikatory, ilości, zapasy, ceny i koszty;
- braki, duplikaty, typy mieszane, kolumny stałe i błędne wartości;
- IQR oraz robust Z-score/MAD;
- anomalie globalne i lokalne;
- role-aware aggregation;
- trendy, granularność czasu, zmienność i jakość dopasowania;
- porównania okresów i contributor analysis;
- Pearson, Spearman, eta² i Cramér’s V;
- rekomendacje Pivot Table i wykresów;
- deterministyczne wnioski i raport szablonowy;
- tryb szybki, tryb pełny oraz jawne metadane metodologiczne;
- eksportowalny, serializowalny wynik.

## Testy wydajności Smart Analytics

Fixture Smart Analytics potwierdza:

- profilowanie schematu na 150 000 wierszy w trybie kontrolowanym;
- kompletny pipeline na 50 000 wierszy;
- bounded sampling dla kosztownych kombinacji korelacyjnych;
- brak materializacji pełnych tablic wartości w bucketach Pivot;
- ukończenie w założonym budżecie bezpieczeństwa środowiska testowego.

## Zakres integracyjny aplikacji

Zweryfikowano pełne uruchomienie aplikacji przez lokalny HTTP oraz:

- lokalne SheetJS i Chart.js;
- import, mapowanie, normalizację i zachowanie kolumn źródłowych;
- filtry, Pivot Table, wykresy i eksport;
- Coverage Days, ryzyko, ABC, Pareto i planowanie zapotrzebowania;
- wirtualny arkusz, formuły, transformacje i Undo/Redo;
- osobną tabelę zapasów;
- lead time, otwarte zamówienia, MOQ, krotność, jednostki i dostawcę;
- autosave, Workspace JSON, eksport i odtworzenie projektu;
- krok Smart Analytics w pełnym UI;
- brak błędów przeglądarkowych w scenariuszach testowych.

## Audyt regresyjny

Ponownie sprawdzono między innymi:

- numery wierszy źródłowych i pochodzenie z wielu plików;
- parser formuł, zależności, zmianę nazw, cykle i dokładność `ROUND`;
- chronologiczne filtry dat, filtry liczbowe i sortowanie;
- wielokomórkowe wklejanie i strukturalne Undo/Redo;
- sezonowość wieloletnią, mapowanie materiałów i zgodność jednostek;
- kolejność MOQ i krotności;
- ochronę eksportu CSV;
- transakcyjne odrzucanie uszkodzonego Workspace.

## Test 50 000 wierszy

Potwierdzono:

- zapis 50 000 rekordów;
- ograniczony DOM wirtualnej tabeli;
- agregację decyzyjną;
- obliczenie kolumny formułowej;
- serializację pełnego projektu;
- brak błędów aplikacji.

Ostatni pełny przebieg testów należy traktować jako test regresyjny i wydajnościowy środowiska CI, nie gwarancję identycznego czasu na każdym laptopie.

## Granice potwierdzenia

Raport potwierdza działanie zadeklarowanych funkcji w opisanych scenariuszach i rzeczywiste wykonanie lokalnego WASM/SQL w środowisku testowym. Nie stanowi matematycznego dowodu braku każdego możliwego błędu ani certyfikacji zgodności z całym Microsoft Excel.

Smart Analytics nie wykonuje wnioskowania przyczynowego, nie korzysta z ML/LLM ani informacji spoza danych wejściowych. Wyniki o małej liczebności, słabej jakości danych lub niepewnej semantyce są oznaczane ograniczeniami i wymagają oceny człowieka.
