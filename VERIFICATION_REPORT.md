# Verification Report — Materials Analytics 1.7.1

Data końcowej weryfikacji: 2026-07-20

## Wynik końcowy

```text
Static Integrity & Security:     29/29
Local DuckDB Package:            17/17
DuckDB-WASM Runtime + SQL:         8/8
Smart Analytics Logic:           36/36
Smart Analytics Performance:       9/9
Application Integration:         59/59
Workbook Data Model:             25/25
Spreadsheet Workspace:           35/35
NCG Workbook Regression:          36/36
Regression Audit:                42/42
Performance 50k:                   8/8
──────────────────────────────────────
Łącznie:                        304/304
```

Pełny przebieg znajduje się w `verification/final-test-v171.log`.

## Integralność i bezpieczeństwo

Potwierdzono:

- poprawną składnię wszystkich modułów JavaScript;
- brak zduplikowanych identyfikatorów HTML;
- istnienie wszystkich lokalnych zasobów aplikacji;
- zgodność wersji pakietu, UI i runtime: `1.7.1`;
- zgodność schematu Workspace: `v5`;
- brak `eval` i konstruktora `Function`;
- brak zewnętrznych URL w Smart Analytics;
- lokalne biblioteki SheetJS, Chart.js i DuckDB-WASM;
- poprawny Windows launcher i obsługę MIME WebAssembly;
- obecność formularza ręcznych danych decyzyjnych, Edytora danych i audytu Smart Analytics;
- obecność dokumentacji Workbook Data Model oraz przykładowego skoroszytu XLSX.

## Workbook Data Model

Dedykowana regresja tworzy rzeczywisty skoroszyt z pięcioma arkuszami:

```text
Zużycie
Zapasy
Przyjęcia
Zamówienia
Kartoteka
```

Sprawdzono:

- przypisanie pięciu ról;
- niezależne mapowanie każdego arkusza;
- brak powtórnego mapowania po zbudowaniu modelu;
- automatyczną kontrolę jakości w etapie przygotowania;
- ukrycie klasycznego panelu mapowania w trybie wieloarkuszowym;
- automatyczny wybór `materialCode` jako klucza;
- zgodność audytu dopasowań;
- utworzenie wirtualnego arkusza zużycia;
- osobne przechowywanie zapasów, przyjęć, zamówień i kartoteki;
- zachowanie oryginalnego pliku, arkusza i numeru wiersza;
- obliczenie stanu początkowego według wzoru `stan + przyjęcia - zużycie`;
- wliczanie przyjęć i zużycia z dnia stanu początkowego;
- niezależne obliczenie dla każdego materiału;
- enrichment przez lead time, MOQ, krotność, safety stock, otwarte zamówienia i dostawcę;
- identyfikację materiału tylko przez kod lub SKU, bez obowiązkowej nazwy;
- zachowanie niezmapowanych kolumn źródłowych z tabeli zużycia;
- enrichment kodowych danych zapasu kartoteką zawierającą tylko nazwę;
- snapshot jako wartość autorytatywną bez ponownego odejmowania zużycia;
- wykluczenie snapshotu z przyszłości przy analizie historycznej;
- dopasowanie ręcznego wpisu tylko z nazwą do transakcji posiadających kod materiału;
- serializację ról i tabel pomocniczych w Workspace v5;
- brak nieobsłużonych błędów przeglądarkowych.

Fixture kontrolny daje:

```text
Folia:
stan początkowy 100
+ przyjęcia 5
- zużycie 30
= stan efektywny 75

Karton:
stan początkowy 50
- zużycie 5
= stan efektywny 45
```

## DuckDB-WASM

Sprawdzono integralność plików lokalnych oraz rzeczywistą instancjację dołączonego WASM. Wykonane zapytania potwierdzają:

- prawidłową średnią w komórce i totalu Pivot;
- pomijanie pustych ciągów przez `count`;
- deterministyczny wybór najnowszego snapshotu;
- zgodność JavaScript fallback.

DuckDB jest lokalnym silnikiem SQL, nie usługą AI.

## Smart Analytics

Testy obejmują:

- fizyczne i semantyczne typy kolumn;
- confidence i evidence;
- braki, duplikaty, typy mieszane i wartości błędne;
- IQR i robust Z-score/MAD;
- trendy i porównania okresów;
- Pearson, Spearman, eta² i Cramér’s V;
- rekomendowane Pivot Table i wykresy;
- deterministyczne wnioski i raport;
- fingerprint danych i audyt metodologii;
- brak usług AI i danych zewnętrznych.

## Integracja aplikacji

Zweryfikowano:

- import XLSX/XLS/XLSB/CSV i wykrywanie nagłówków;
- mapowanie, walidację i normalizację;
- zachowanie wszystkich kolumn źródłowych;
- filtry, Pivot, wykresy i eksport;
- Coverage Days, ryzyko, Pareto, ABC i zapotrzebowanie;
- wirtualny Edytor danych, copy/paste, formuły, transformacje i Undo/Redo;
- ręczne snapshoty i stany początkowe wraz z parametrami zamówień;
- Workspace, autosave i odtworzenie projektu;
- Smart Analytics UI i zakładkę Weryfikacja.

## Regresja NCG

Na reprezentatywnym wieloarkuszowym skoroszycie dostaw potwierdzono:

- rekomendację głównego arkusza;
- wykrycie planu zakupów i kopii archiwalnej;
- usuwanie pustych `ghost columns`;
- daty MDY/DMY, daty Excela i okresy `week 35`;
- rozdzielenie ilości zamówionej, dostarczonej i pozostałej;
- poprawne traktowanie wielopozycyjnych numerów zamówień;
- Fill Down i wykluczenie subtotal rows;
- dedykowane KPI realizacji dostaw.

## Wydajność

Sprawdzono:

- pełny Smart Analytics dla 50 000 wierszy;
- profilowanie schematu dla 150 000 wierszy;
- wirtualizację tabeli dla 50 000 wierszy;
- formuły, agregację decyzyjną i serializację Workspace;
- bounded sampling dla kosztownych korelacji.

## Granice potwierdzenia

Raport potwierdza zadeklarowane scenariusze i rzeczywiste wykonanie runtime w środowisku testowym. Nie stanowi matematycznego dowodu braku każdego możliwego błędu w dowolnym pliku Excel.

Aplikacja nie implementuje VBA, makr, natywnych obiektów Excel PivotTable, adresów `A1`, międzyarkuszowego `XLOOKUP` ani pełnego katalogu formuł Microsoft Excel. Wieloarkuszowe połączenia realizowane są przez jawny i audytowalny model ról biznesowych.
