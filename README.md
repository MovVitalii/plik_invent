# Materials Analytics 1.5.0 — Smart Analytics

Lokalny, przeglądarkowy workspace do pracy z plikami Excel/CSV, analizy zużycia materiałów, kontroli zapasów, przygotowania decyzji zakupowych i automatycznego audytu danych.

Aplikacja działa bez backendu, konta użytkownika, chmury, modelu AI i zewnętrznego API. Dane pozostają na komputerze użytkownika. Wszystkie wnioski Smart Analytics są wynikiem jawnych reguł i deterministycznych obliczeń statystycznych.

## Uruchomienie na komputerze służbowym

### Windows

1. Rozpakuj archiwum.
2. Uruchom `START_WINDOWS.bat`.
3. Otwórz adres wyświetlony w oknie terminala, zwykle `http://127.0.0.1:8080`.

Launcher najpierw próbuje uruchomić lokalny serwer przez Python. Gdy Python nie jest dostępny, używa dołączonego skryptu PowerShell `start-server.ps1`, który obsługuje także poprawny typ MIME dla plików `.wasm` i `.mjs`.

### Linux / macOS

```bash
./start.sh
```

### GitHub Pages

Projekt jest statyczny i nie wymaga procesu build. Główny `index.html` otwiera `apps/materials/index.html`.

> Nie należy otwierać aplikacji bezpośrednio przez `file://`. Web Worker i DuckDB-WASM wymagają lokalnego serwera HTTP.

## Główne obszary

1. **Import** — XLSX, XLS, XLSB i CSV; wiele plików; wybór arkusza; ustawienie wiersza nagłówków; łączenie zgodnych arkuszy.
2. **Mapowanie** — przypisanie kolumn do ról analitycznych. Plik można również otworzyć jako ogólny arkusz bez analityki materiałowej.
3. **Analiza** — filtry, Pivot Table, wykresy, analiza miesięczna i sezonowa oraz eksport.
4. **Analiza decyzyjna** — Coverage Days, ryzyko braków, Pareto, ABC i szacowane zapotrzebowanie.
5. **Edytor danych** — pełna tabela źródłowa, edycja, kopiowanie/wklejanie, filtry, sortowanie, transformacje, formuły, kontrola jakości, osobna tabela zapasów i projekty lokalne.
6. **Smart Analytics** — automatyczne profilowanie, kontrola jakości, anomalie, trendy, porównania okresów, korelacje, rekomendowane Pivot Table, dobór wykresów i raport tekstowy.

## Smart Analytics

### Zakres funkcjonalny

Wbudowany silnik automatycznie:

- określa fizyczne typy kolumn: tekst, liczba, data, boolean i typ mieszany;
- rozpoznaje role semantyczne, m.in. data, identyfikator, kategoria, materiał, marka, dostawca, lokalizacja, ilość, zapas, cena, koszt, waluta, procent i czas trwania;
- pokazuje poziom pewności i uzasadnienie klasyfikacji;
- wykrywa braki, pełne duplikaty, duplikaty identyfikatorów, kolumny stałe lub prawie stałe, błędy typów i podejrzane wartości ujemne;
- wykrywa wahania odstające metodą IQR i robust Z-score opartym na MAD, globalnie oraz w sensownych grupach lokalnych;
- oblicza trendy, zmianę kierunku, zmienność i dynamikę szeregu czasowego;
- porównuje kolejne okresy oraz wskazuje kategorie mające największy udział w zmianie;
- oblicza Pearson, Spearman, eta² oraz Cramér’s V zależnie od typów zmiennych;
- projektuje rekomendowane Pivot Table i materializuje ich wyniki;
- dobiera typ wykresu na podstawie struktury danych;
- tworzy uporządkowane wnioski, ryzyka i działania z biblioteki reguł;
- generuje polski raport tekstowy bez modelu językowego;
- eksportuje wynik Smart Analytics do JSON i XLSX oraz umożliwia wydruk raportu.

### Tryby analizy

- **Szybki** — profilowanie i część kosztownych obliczeń wykorzystują reprezentatywną próbkę; raport jawnie podaje liczbę przeanalizowanych wierszy.
- **Pełny** — statystyki jakościowe i opisowe są obliczane na pełnym zbiorze; próbka może być nadal użyta wyłącznie do wykrywania fizycznego typu kolumny i ograniczenia kosztu macierzy korelacji.

Raport zawiera sekcję metodologiczną z trybem, liczbą wierszy, zastosowanymi metodami, regułami agregacji i wersją biblioteki reguł.

### Silniki wykonawcze

- **JavaScript + Web Worker** — główny deterministyczny pipeline; przy awarii Workera aplikacja przechodzi na bezpieczny fallback w głównym wątku.
- **DuckDB-WASM** — lokalny silnik SQL do materializacji rekomendowanych zestawień. Pliki runtime są dostarczone w projekcie; nie są pobierane z CDN.
- **Fallback JavaScript** — gdy DuckDB-WASM jest wyłączony albo niedostępny, Pivot Table są liczone lokalnie przez strumieniowy akumulator JavaScript.

Dla miar typu zapas stosowana jest agregacja „najnowsza wartość według daty”, dla ceny/procentu/czasu średnia, a dla ilości/wartości/kosztu suma. Reguły są wersjonowane w `src/analytics/rules/analytics-rules.js`.

## Model danych

Aplikacja rozdziela:

- **kolumny źródłowe** — wszystkie wartości z pliku;
- **pola analityczne** — role wskazane podczas mapowania;
- **kolumny obliczeniowe** — pola utworzone za pomocą formuł;
- **snapshoty zapasu** — osobna, opcjonalna tabela stanów magazynowych i parametrów zamówień;
- **wynik Smart Analytics** — serializowalny wynik audytu i rekomendacji.

Workspace używa schematu **v4** i zapisuje również ostatni deterministyczny wynik Smart Analytics.

## Formuły

Przykłady:

```text
ROUND([Zużycie] * [Cena jednostkowa]; 2)
IF([Stan] < [Minimum]; "Zamów"; "OK")
IFERROR([Wartość] / [Ilość]; 0)
CONCAT([Materiał]; " / "; [Dostawca])
DATE_DIFF_DAYS([Data dostawy]; [Data zamówienia])
```

Obsługiwane są operatory arytmetyczne, porównania, `AND`, `OR`, `NOT` oraz:

```text
IF, IFERROR, ISBLANK, ROUND, ABS, COALESCE, CONCAT,
UPPER, LOWER, LEN, MIN, MAX, DATE_DIFF_DAYS
```

Parser nie korzysta z `eval` ani konstruktora `Function`.

## Szacowane zapotrzebowanie

```text
horyzont planowania = max(horyzont użytkownika, lead time)
zużycie bazowe = średnie dzienne zużycie × horyzont planowania
zapotrzebowanie = zużycie bazowe × (1 + bufor) + safety stock
surowe do zamówienia = max(0, zapotrzebowanie - stan - otwarte zamówienia)
```

Dodatni wynik jest najpierw podnoszony do MOQ, a następnie zaokrąglany w górę do pełnej krotności zamówienia. Jest to deterministyczny model planistyczny, nie model ML prognozujący popyt.

## Prywatność i bezpieczeństwo

- brak połączenia z usługą AI, LLM lub zewnętrznym API;
- brak wysyłania danych na serwer;
- brak zewnętrznych URL w kodzie Smart Analytics;
- lokalne biblioteki SheetJS, Chart.js i DuckDB-WASM;
- formuły użytkownika nie wykonują kodu JavaScript;
- import Workspace jest walidowany transakcyjnie;
- eksport CSV neutralizuje tekst, który arkusz mógłby uruchomić jako formułę.

## Ograniczenia

Smart Analytics jest profesjonalnym, deterministycznym asystentem analitycznym, ale nie zastępuje oceny eksperta w sytuacjach wymagających wiedzy biznesowej spoza danych. Silnik:

- nie wykonuje wnioskowania przyczynowego;
- nie używa ML, modeli językowych ani danych zewnętrznych;
- nie zna promocji, planów produkcji, zmian procesu ani zdarzeń, których nie ma w pliku;
- nie gwarantuje sensowności korelacji przy małej próbie albo błędnej semantyce kolumn;
- nie jest pełnym Microsoft Excel i nie obsługuje VBA, makr, natywnych obiektów PivotTable Excela, współpracy w czasie rzeczywistym ani całego katalogu funkcji Excela.

Praktyczny limit danych zależy od pamięci komputera, liczby kolumn, liczby formuł i wybranego trybu analizy.

## Testy

```bash
npm ci
npm test
```

Pakiet przechodzi **222/222** automatyczne kontrole, w tym rzeczywistą instancjację dołączonego pliku DuckDB-WASM i wykonanie zapytań SQL na wygenerowanych rekomendacjach Pivot.

Szczegóły: `VERIFICATION_REPORT.md`.
