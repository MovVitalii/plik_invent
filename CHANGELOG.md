# Changelog

## 1.5.0 — lokalny Smart Analytics Engine

### Architektura

- Dodano całkowicie lokalny i deterministyczny pipeline Smart Analytics bez AI, chmury i backendu.
- Rozdzielono logikę na profilowanie schematu, semantykę, jakość, statystyki, anomalie, trendy, porównania okresów, korelacje, rekomendacje Pivot/wykresów, wnioski i raport.
- Dodano wersjonowaną bibliotekę reguł `analytics-rules.js`.
- Dodano osobny Web Worker oraz automatyczny fallback do głównego wątku.
- Workspace podniesiono do schematu v4 i rozszerzono o wynik Smart Analytics.

### Profilowanie i semantyka

- Dodano rozpoznawanie fizycznych typów kolumn oraz typów mieszanych.
- Dodano role semantyczne: data, identyfikator, kategoria, materiał, marka, dostawca, lokalizacja, ilość, zapas, cena, koszt, waluta, procent, czas trwania, status i tekst swobodny.
- Każda klasyfikacja zawiera confidence oraz dowody oparte na nazwie i rozkładzie wartości.
- Dodano tryb szybki i pełny wraz z jawną metodologią próbkowania.

### Jakość danych i anomalie

- Dodano analizę braków, unikalności, duplikatów pełnych i duplikatów identyfikatorów.
- Dodano wykrywanie kolumn stałych, prawie stałych, typów mieszanych, błędów konwersji i podejrzanych liczb ujemnych.
- Dodano wahania odstające metodą IQR i robust Z-score/MAD.
- Dodano detekcję globalną oraz lokalną w obrębie odpowiednich kategorii.
- Wyniki zawierają metodę, próg, expected range, severity, confidence i przykłady wierszy.

### Trendy i porównania okresów

- Dodano automatyczne wykrywanie głównego pola daty, miary i wymiaru.
- Dodano dobór granularności czasu według zakresu danych.
- Dodano role-aware aggregation: suma, średnia albo najnowszy snapshot.
- Dodano kierunek, slope, procentową zmianę, zmienność i jakość dopasowania trendu.
- Dodano porównania kolejnych okresów oraz ranking kategorii odpowiedzialnych za zmianę.

### Korelacje

- Dodano Pearson i Spearman dla liczba–liczba.
- Dodano eta² dla kategoria–liczba.
- Dodano Cramér’s V dla kategoria–kategoria.
- Identyfikatory są wykluczane z interpretacji jako miary.
- Wyniki raportują liczebność próby, siłę, kierunek, confidence i zastrzeżenie o braku przyczynowości.

### Rekomendacje i raport

- Dodano automatyczne projektowanie rekomendowanych Pivot Table.
- Dodano automatyczny dobór wykresów według struktury danych.
- Dodano regułowy Insight Engine z priorytetem, dowodami, ograniczeniami i rekomendowanym działaniem.
- Dodano polski raport szablonowy: executive summary, zakres, jakość, KPI, trendy, zmiany, anomalie, zależności, ryzyka, działania i metodologia.
- Dodano eksport Smart Analytics do JSON/XLSX oraz wydruk raportu.

### DuckDB-WASM i wydajność

- Dołączono lokalny runtime DuckDB-WASM; aplikacja nie pobiera go z CDN.
- Dodano opcjonalną materializację rekomendowanych Pivot Table przez lokalny SQL.
- Dodano JavaScript fallback oraz strumieniowe akumulatory bez przechowywania tablic wartości w każdym bucketcie.
- Poprawiono total dla `average`, `count`, `min`, `max` i `latest` — total jest liczony z surowych rekordów, nie z agregatów komórek.
- `count` pomija puste ciągi.
- `latest` wybiera najnowszy snapshot według daty i deterministycznego numeru kolejności źródłowej.
- Daty w rekomendowanych pivotach są grupowane według właściwej granularności.

### Uruchomienie na laptopie służbowym

- Rozbudowano `START_WINDOWS.bat`.
- Dodano serwer PowerShell z poprawną obsługą MIME dla `.wasm` i `.mjs`.
- Zachowano wariant Python oraz skrypt `start.sh`.
- Wszystkie zasoby runtime są lokalne.

### Weryfikacja

- 19/19 kontroli statycznych i bezpieczeństwa.
- 17/17 kontroli lokalnego pakietu DuckDB.
- 8/8 rzeczywistych kontroli runtime DuckDB-WASM i SQL.
- 32/32 kontrole logiki Smart Analytics.
- 9/9 kontroli wydajności Smart Analytics.
- 58/58 kontroli integracyjnych aplikacji.
- 29/29 kontroli edytora i Workspace.
- 42/42 kontrole regresyjne.
- 8/8 kontroli przepływu 50 000 wierszy.
- Łącznie **222/222**.

## 1.4.1 — audyt integralności

- Naprawiono zależności i cykle formuł, `ROUND`, leniwe `IF`/`IFERROR`, filtry i sortowanie dat.
- Naprawiono wielokomórkowe wklejanie, strukturalne Undo/Redo, mapowanie snapshotów, jednostki, MOQ i sezony wieloletnie.
- Dodano transakcyjny import Workspace, ochronę CSV i test 50 000 wierszy.

## 1.4.0 — Excel-like Data Workspace

- Dodano wieloplikowy import Excel/CSV, edytowalny wirtualny arkusz, transformacje, bezpieczne formuły, Undo/Redo, osobną tabelę zapasów, projekty lokalne i wieloarkuszowy eksport XLSX.
