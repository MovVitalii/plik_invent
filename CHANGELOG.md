# Changelog

## 1.7.1 — jednoznaczny proces mapowania

- usunięto powtórne mapowanie po zbudowaniu wieloarkuszowego modelu danych;
- mapowanie ról i kolumn odbywa się wyłącznie w panelu „Model danych skoroszytu”;
- etap 2 zmieniono na „Przygotowanie i jakość danych”;
- dla modelu skoroszytu etap 2 pokazuje tylko podsumowanie modelu i kontrolę jakości;
- po zbudowaniu modelu kontrola jakości uruchamia się automatycznie;
- tryb pojedynczego arkusza zachowuje dotychczasowe mapowanie;
- przycisk pojedynczego arkusza opisano jednoznacznie jako „Przygotuj tylko wybrany arkusz”.

## 1.7.0 — wieloarkuszowy Workbook Data Model

### Import i role arkuszy

- Usunięto ograniczenie jednego arkusza dla obliczeń decyzyjnych.
- Dodano role: Zużycie, Zapasy, Przyjęcia, Otwarte zamówienia, Kartoteka materiałów i Ignoruj.
- Każdy arkusz ma niezależny wiersz nagłówków i niezależne mapowanie.
- Można przypisać kilka arkuszy do tej samej roli.
- Dodano automatyczne wykrywanie ról i automatyczne mapowanie.

### Łączenie danych

- Dodano deterministyczny join po kodzie materiału, SKU lub znormalizowanej nazwie.
- Tryb automatyczny wybiera klucz o najwyższym pokryciu.
- Dodano mapę aliasów, dzięki której wpis tylko z nazwą może dopasować się do transakcji z kodem lub SKU, jeżeli relacja jest jednoznaczna.
- Tożsamość materiału może być określona przez kod, SKU albo nazwę; nazwa nie jest bezwzględnie wymagana w każdym arkuszu.
- Niejednoznaczne aliasy są wykrywane i nie są używane do automatycznego łączenia.
- Dodano audyt dopasowań, braków, ujemnych stanów, snapshotów powtórzonych tego samego dnia i niezgodności jednostek.
- Zachowano provenance plik/arkusz/wiersz po materializacji wspólnej tabeli zużycia.
- Niezmapowane kolumny źródłowe z arkuszy zużycia pozostają dostępne w Edytorze danych i eksporcie.

### Zapasy i obliczenia

- Dodano semantykę `snapshot` i `opening`.
- Stan początkowy uwzględnia przyjęcia i zużycie od daty stanu włącznie.
- Snapshot nie jest pomniejszany o historyczne zużycie.
- Historyczna data analizy nie używa snapshotu z przyszłości.
- Kartoteka i otwarte zamówienia uzupełniają jednostkę, dostawcę, lead time, MOQ, krotność, safety stock i ilość w drodze.
- Ręczny formularz obsługuje kod, SKU oraz wybór snapshot/stan początkowy.
- Dodano przykład wieloarkuszowego skoroszytu w `examples/Przyklad_Model_Danych.xlsx`.

### Workspace i eksport

- Workspace podniesiono do schematu v5.
- Zapisywane są role, mapowania, audyt i wszystkie tabele pomocnicze.
- Eksport XLSX może zawierać osobne arkusze Przyjęcia, Otwarte zamówienia i Kartoteka materiałów.

### Testy

- Dodano dedykowaną regresję Workbook Data Model: 22/22.
- Pełny pakiet przechodzi 299/299 kontroli.

## 1.6.0 — rozpoznanie skoroszytu i analityka dostaw NCG

### Dane decyzyjne i Edytor danych

- Dodano ręczne wprowadzanie i edycję aktualnego stanu, daty snapshotu, jednostki, lead time, MOQ, krotności, safety stock, otwartych zamówień i dostawcy.
- Komunikat o braku zapasu prowadzi bezpośrednio do formularza ręcznego.
- Edytor danych jest przygotowywany automatycznie natychmiast po analizie arkusza, bez dodatkowego przycisku i bez obowiązkowego mapowania materiałowego.
- Dodano jawny przycisk „Edytuj komórkę” oraz obsługę Enter, F2, dwukliku i rozpoczęcia pisania w aktywnej komórce.
- Naprawiono zachowanie niepoprawnego tekstu w kolumnie liczbowej: wartość nie jest już cicho zamieniana na pustą.

### DuckDB i weryfikacja Smart Analytics

- Zastąpiono niejasny checkbox DuckDB wyborem: automatycznie, zawsze DuckDB lub tylko JavaScript.
- Tryb automatyczny wybiera DuckDB dla zbiorów od 5000 wierszy albo wielowymiarowych Pivot Table i zachowuje bezpieczny fallback JavaScript.
- Dodano odcisk analizowanego zbioru `FNV-1a`, bilans wierszy/kolumn, jawne metody, parametry, ograniczenia i kontrole spójności.
- Dodano zakładkę „Weryfikacja”, eksport audytu JSON oraz arkusze „Weryfikacja” i „Kontrole” w eksporcie Smart Analytics XLSX.
- Rozszerzono testy o rzeczywistą edycję komórki, ręczne dane decyzyjne, automatyczne odblokowanie edytora i odtwarzalność odcisku danych.

### Import i struktura skoroszytu

- Dodano automatyczne wykrywanie rzeczywistego wiersza nagłówków także po wierszach tytułowych.
- Dodano wykrywanie efektywnego zakresu kolumn i ignorowanie pustych „ghost columns” zapisanych w zakresie Excela.
- Dodano panel „Rozpoznanie skoroszytu”, który klasyfikuje wszystkie arkusze przed wyborem tabeli roboczej.
- Dodano rekomendację głównego arkusza oraz automatyczne otwarcie najlepszego źródła.
- Dodano klasyfikację arkuszy: ewidencja dostaw, plan zakupów, zdarzenia rozładunku, plan hierarchiczny, podsumowanie, archiwum i arkusz pomocniczy.
- Dodano wykrywanie podobnych lub archiwalnych kopii, aby nie sumować ich z aktualnym arkuszem bez weryfikacji.
- Dodano wykrywanie relacji między arkuszami na podstawie numerów zamówień i kodów produktów, wraz z pokryciem kluczy.

### Daty i semantyka biznesowa

- Dodano bezpieczne rozpoznawanie konwencji MDY i DMY na poziomie kolumny.
- Dodano obsługę dat Excela, ISO, dat tekstowych oraz okresów planistycznych typu `week 35`, `CW 35` i numer miesiąca.
- Okresy tygodniowe bez konkretnego dnia są zachowywane jako niepełne daty, a nie odrzucane jako błąd typu.
- Rozszerzono role biznesowe o ilość zamówioną, dostarczoną i pozostałą, palety zamówione/dostarczone/pozostałe, numery zamówień, dokumenty WZ, kody produktów, dostawcę, kategorię planistyczną, język i kod lokalizacji.
- Powtarzalny numer zamówienia nie jest już automatycznie uznawany za błędny duplikat identyfikatora.

### Analityka domenowa

- Dodano klasyfikator domeny danych i osobny deterministyczny moduł analizy realizacji dostaw.
- Dla ewidencji dostaw obliczane są zamówione, dostarczone i pozostałe ilości/palety, stopień realizacji, pozycje niepełne, nadrealizacje, braki dokumentów WZ i równanie spójności.
- Dla planu zakupów obliczane są planowane ilości, liczba zamówień, produktów i dostawców oraz lead time między transportem i dostawą.
- Dla planów hierarchicznych puste nazwy materiału są uzupełniane wyłącznie w kopii analitycznej, a wiersze `SUMA/RAZEM/TOTAL` są wykluczane przed agregacją.
- Dla harmonogramów dostaw wyłączono generyczne interpretowanie rozkładu dat jako trendu popytu.
- Naprawiono rozpoznawanie reguł zakotwiczonych, np. `QTY`, gdy wewnętrzny identyfikator kolumny ma postać `source__7`.
- Smart Analytics pomija pola wewnętrzne oraz puste pola pochodne w ogólnym arkuszu, dzięki czemu raport nie zawiera technicznego szumu.
- Raport i eksport XLSX otrzymały osobną sekcję „Analiza biznesowa”.

### Testy regresyjne

- Dodano stały test reprezentatywnego, wieloarkuszowego skoroszytu NCG.
- Test obejmuje import, rekomendację arkusza, archiwalne kopie, puste kolumny, relacje plan–wykonanie, MDY/DMY, tygodnie planistyczne, role ilościowe, duplikaty zamówień, subtotal rows i Fill Down.
- `datasetProfile` raportuje teraz jawnie `originalRows`, `analyzedRows` i `excludedRows`.

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
