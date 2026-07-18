# Pack Materials Analytics 1.4.1 — dokumentacja techniczna

## Architektura

Aplikacja jest statyczna i działa bez backendu. Moduły są ładowane kolejno z `index.html`:

- `constants.js` — definicje pól, limity, progi i wersja runtime;
- `state.js` — centralny stan oraz zdarzenia;
- `utils.js` — daty, liczby, tekst, bezpieczne zaokrąglanie i walidacja plików;
- `import-engine.js` — Excel/CSV, wiele plików, arkusze i nagłówki;
- `mapping-engine.js` — mapowanie źródła na role analityczne;
- `value-normalization-engine.js` — deterministyczne techniczne ujednolicanie wartości, bez osobnej sekcji UI;
- `normalization-engine.js` — walidacja, zachowanie źródła i budowa rekordu analitycznego;
- `pivot-engine.js` — filtry, Pivot Table i podsumowania;
- `decision-engine.js` — Coverage, ABC/Pareto i planowanie zapotrzebowania;
- `chart-engine.js` — wykresy;
- `export-engine.js` — eksport analizy;
- `workspace-storage.js` — IndexedDB i fallback do localStorage;
- `formula-engine.js` — parser/evaluator formuł bez wykonania kodu;
- `spreadsheet-engine.js` — wirtualny arkusz, transformacje, jakość, zapasy, Workspace i eksport projektu;
- `app.js` — inicjalizacja i koordynacja modułów.

## Import

Obsługiwane formaty:

```text
.xlsx, .xls, .xlsb, .csv
```

Import pozwala:

- wskazać wiersz nagłówków;
- wybrać arkusz;
- wczytać wiele plików;
- połączyć arkusze o zgodnym układzie kolumn;
- zachować nazwę pliku, arkusza i rzeczywisty numer wiersza źródłowego;
- otworzyć dane jako ogólny arkusz lub przejść do mapowania materiałowego.

## Mapowanie

Minimalny zestaw do analizy zużycia:

```text
Data + Materiał + Zużycie
```

`Marka` jest opcjonalna. `Aktualny stan zapasu` jest inną miarą niż `Zużycie`:

- `Zużycie` opisuje przepływ w okresie;
- `Aktualny stan zapasu` opisuje snapshot dostępnej ilości.

Najlepszą praktyką jest importowanie zapasów w osobnej tabeli w zakładce `Zapasy`.

## Edytor danych

### Arkusz

- wszystkie oryginalne kolumny są zachowane;
- komórki są edytowalne;
- zakres można zaznaczyć i kopiować/wklejać jako TSV;
- można dodawać i usuwać wiersze/kolumny;
- kolumny można zmieniać nazwą, szerokością, kolejnością i widocznością;
- tabela jest renderowana wirtualnie, aby ograniczyć liczbę elementów DOM;
- sortowanie wielopoziomowe i filtry są zapisywane przez autosave.

### Transformacje

Operacje:

- zamiana tekstu, w tym regex w formie `/wzorzec/gi`;
- Trim i usuwanie znaków niedrukowalnych;
- wielkie/małe litery i Proper Case;
- Fill Down / Fill Up;
- konwersja na liczbę lub datę;
- zaokrąglenie i wartość bezwzględna;
- usuwanie pustych wierszy;
- usuwanie pełnych duplikatów.

Każda operacja ma podgląd i może działać na całym zbiorze, po filtrach albo na zaznaczeniu. Undo/Redo przechowuje różnice, a nie pełne kopie datasetu.

### Formuły

Parser obsługuje zależności między kolumnami obliczeniowymi i wylicza je topologicznie. Zależności cykliczne są odrzucane przed modyfikacją projektu. Zmiana nazwy kolumny przepisuje jej odwołania w formułach, a kolumna używana przez inną formułę jest chroniona przed usunięciem.

Funkcje:

```text
IF, IFERROR, ISBLANK, ROUND, ABS, COALESCE, CONCAT,
UPPER, LOWER, LEN, MIN, MAX, DATE_DIFF_DAYS
```

`IF` i `IFERROR` są ewaluowane leniwie. `ROUND` stosuje zaokrąglenie połówkowe od zera i obsługuje ujemną liczbę miejsc.

### Błędy

Wiersze, które nie przechodzą walidacji, nie są bezpowrotnie usuwane. Użytkownik może poprawić wartości źródłowe i uruchomić ponowną walidację.

### Jakość

Profil obejmuje liczbę pustych wartości, unikalność, typ, minimum, maksimum, średnią i ocenę kolumny.

## Osobna tabela zapasów

Obsługiwane role:

```text
Materiał, Stan zapasu, Data snapshotu, Jednostka, Lead time,
MOQ, Krotność zamówienia, Safety stock, Otwarte zamówienia, Dostawca
```

Dla wielu snapshotów wybierany jest najnowszy zapis według daty dla każdego materiału. Identyfikator materiału jest normalizowany względem wielkości liter i polskich znaków. Niejednolite jednostki zużycia albo niezgodność jednostki zapasu blokują niewiarygodny wynik zamówienia.

## Workspace

Projekt zawiera dane, pola, mapowanie, filtry, kolumny obliczeniowe, historię transformacji, informacje źródłowe i tabelę zapasów.

- schemat: v3;
- autosave: IndexedDB;
- fallback: localStorage, gdy IndexedDB jest niedostępne;
- transfer między przeglądarkami: Workspace JSON;
- import jest transakcyjny i waliduje strukturę oraz zależności przed zastąpieniem bieżącego stanu;
- eksport projektu: wieloarkuszowy XLSX.

## Bezpieczeństwo

Dane są przetwarzane lokalnie. Parser formuł nie wykonuje kodu JavaScript i nie korzysta z `eval` ani konstruktora `Function`. Eksport CSV neutralizuje tekst, który aplikacja arkuszowa mogłaby uruchomić jako formułę.

## Testy

- `verification/static-audit-test.js` — 12 kontroli;
- `verification/integration-test.js` — 49 kontroli analizy decyzyjnej;
- `verification/data-lab-test.js` — 27 kontroli workspace;
- `verification/audit-regression-test.js` — 42 kontrole regresyjne;
- `verification/performance-test.js` — 8 kontroli na 50 000 wierszy.

Łącznie: **138/138**.
