# Verification Report — Materials Analytics 1.4.1

Data weryfikacji: 2026-07-18

## Wynik końcowy

```text
Static Integrity:       12/12
Decision Analytics:     49/49
Spreadsheet Workspace: 27/27
Regression Audit:       42/42
Performance 50k:         8/8
Łącznie:               138/138
```

Wszystkie zadeklarowane testy automatyczne zakończyły się powodzeniem.

## Kontrole statyczne

- wszystkie pliki JavaScript aplikacji przechodzą analizę składni;
- brak zduplikowanych identyfikatorów HTML;
- wszystkie lokalne odwołania `src` i `href` istnieją;
- fizycznie istnieje wejście importu Workspace JSON;
- usunięty panel normalizacji nie występuje w HTML;
- istnieje osobna akcja czyszczenia tabeli zapasów;
- kod aplikacji nie używa `eval` ani konstruktora `Function`;
- brak referencji do starego `data-lab-engine.js`;
- wersja pakietu, UI i runtime jest zgodna: 1.4.1;
- wersja schematu Workspace jest spójna: v3;
- główny `index.html` prawidłowo przekierowuje do aplikacji.

## Zakres testu integracyjnego

- uruchomienie pełnej aplikacji przez lokalny HTTP;
- realne lokalne moduły SheetJS i Chart.js;
- normalizacja dat, liczb, jednostek i sezonów przez granicę grudzień–styczeń;
- Coverage Days, ryzyko, ABC, Pareto i szacowane zapotrzebowanie;
- działanie bez mapowania zapasu oraz na pustym datasecie;
- import z konfigurowalnym wierszem nagłówków;
- zachowanie niezmapowanych kolumn źródłowych;
- wirtualny arkusz, formuły, transformacje i Undo/Redo;
- osobna tabela zapasów;
- lead time, otwarte zamówienia, MOQ, krotność, dostawca i jednostka;
- zapis, autosave, eksport i odtworzenie Workspace.

## Audyt regresyjny

Sprawdzono między innymi:

- źródłowe numery wierszy i pochodzenie z wielu plików;
- łączność i priorytet potęgowania;
- przecinki/średniki w formułach;
- leniwe `IF` i `IFERROR`;
- dokładność `ROUND`, także dla `1,005`, liczb ujemnych i ujemnej liczby miejsc;
- zależności formuł, zmiany nazw, usuwanie i cykle;
- sortowanie, filtry liczbowe i filtry dat;
- wielokomórkowe wklejanie oraz Undo/Redo usuwania;
- dopasowanie materiałów, jednostki, sezony wieloletnie, MOQ i krotność;
- ochronę eksportu CSV przed formułami;
- transakcyjne odrzucanie nieprawidłowego Workspace;
- brak błędów przeglądarkowych w scenariuszach testowych.

## Test wydajności

Fixture 50 000 wierszy sprawdza:

- zapis 50 000 rekordów w workspace;
- ograniczony DOM wirtualnej tabeli zamiast renderowania wszystkich wierszy;
- agregację decyzyjną;
- obliczenie kolumny formułowej;
- serializację pełnego projektu;
- ukończenie testu w przyjętym budżecie bezpieczeństwa;
- brak błędów aplikacji podczas testu.

Ostatni zmierzony przebieg zakończył się w około 2,5 s w środowisku testowym. Wynik na urządzeniu użytkownika zależy od procesora, pamięci, liczby kolumn oraz złożoności formuł.

## Granice potwierdzenia

Raport potwierdza spójność i działanie funkcji zadeklarowanych dla Materials Analytics 1.4.1 w opisanych scenariuszach. Nie oznacza pełnej zgodności z całym Microsoft Excel. VBA, makra, natywne obiekty PivotTable, współpraca czasu rzeczywistego i pełny katalog funkcji Excela pozostają poza zakresem produktu.
