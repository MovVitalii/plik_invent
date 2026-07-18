# Materials Analytics 1.4.1

Lokalny, przeglądarkowy workspace do pracy z plikami Excel/CSV, analizy zużycia materiałów, kontroli zapasów i przygotowania decyzji zakupowych. Dane nie są wysyłane na serwer.

## Uruchomienie

### Windows

Uruchom `START_WINDOWS.bat`, a następnie otwórz adres pokazany w terminalu.

### Linux / macOS

```bash
./start.sh
```

### GitHub Pages

Repozytorium nie wymaga procesu build. Główny `index.html` przekierowuje do `apps/materials/index.html`.

## Główne obszary

1. **Import** — XLSX, XLS, XLSB i CSV; wiele plików; wybór arkusza; ustawienie wiersza nagłówków; łączenie zgodnych arkuszy.
2. **Mapowanie** — przypisanie kolumn do ról analitycznych. Marka jest opcjonalna. Plik można też otworzyć jako ogólny arkusz bez analityki materiałowej.
3. **Analiza** — filtry, Pivot Table, wykresy, analiza miesięczna i sezonowa oraz eksport wyników.
4. **Analiza decyzyjna** — Coverage Days, ryzyko braków, Pareto, ABC i szacowane zapotrzebowanie.
5. **Edytor danych** — zachowanie wszystkich kolumn źródłowych, edycja komórek, kopiowanie/wklejanie zakresu, filtry, sortowanie, transformacje, formuły, kontrola jakości, osobna tabela zapasów i projekty lokalne.

## Najważniejsze zmiany w 1.4.1

Wersja 1.4.1 jest wydaniem audytowym. Usunięto błędy wykryte podczas ponownej kontroli całego przepływu danych:

- poprawiono numerację wierszy źródłowych po pustych rekordach oraz zachowanie informacji o pliku i arkuszu;
- naprawiono sortowanie nagłówków, filtry liczbowe i chronologiczne filtry dat;
- naprawiono usuwanie wierszy, wielokomórkowe wklejanie oraz Undo/Redo zmian strukturalnych;
- dodano bezpieczne przepisywanie zależności formuł po zmianie nazwy kolumny;
- dodano kolejność topologiczną kolumn obliczeniowych oraz blokadę zależności cyklicznych;
- formuły obsługują przecinki i polskie średniki jako separatory argumentów;
- potęgowanie ma prawidłową łączność i priorytet, a `IF` oraz `IFERROR` działają leniwie;
- `ROUND` stosuje zaokrąglenie połówkowe od zera, obsługuje ujemną liczbę miejsc i nie traci wartości typu `1,005` przez błąd binarny;
- snapshoty zapasu są dopasowywane bez rozróżniania wielkości liter i polskich znaków;
- niezgodność jednostek blokuje błędne wyliczenie zamówienia;
- poprawiono kolejność MOQ i krotności opakowania oraz wieloletnie okresy sezonowe;
- eksport CSV chroni przed uruchamianiem formuł arkusza, nie niszcząc liczb ujemnych;
- import Workspace jest transakcyjny: błędny albo cykliczny projekt nie zastępuje aktualnych danych;
- dodano test statyczny, regresyjny oraz test wydajności na 50 000 wierszy.

## Model danych

Aplikacja rozdziela trzy warstwy:

- **kolumny źródłowe** — oryginalne wartości z pliku;
- **pola analityczne** — role wskazane podczas mapowania, np. data, materiał i zużycie;
- **kolumny obliczeniowe** — pola utworzone w edytorze za pomocą formuł.

Dane zapasu mogą pochodzić z głównego pliku albo z osobnej tabeli snapshotów. Osobna tabela ma priorytet w analizie decyzyjnej.

## Formuły

Odwołania do kolumn zapisuje się w nawiasach kwadratowych:

```text
ROUND([Zużycie] * [Cena jednostkowa]; 2)
IF([Stan] < [Minimum]; "Zamów"; "OK")
IFERROR([Wartość] / [Ilość]; 0)
CONCAT([Materiał]; " / "; [Dostawca])
DATE_DIFF_DAYS([Data dostawy]; [Data zamówienia])
```

Obsługiwane są operatory arytmetyczne, porównania, `AND`, `OR`, `NOT` oraz funkcje:

```text
IF, IFERROR, ISBLANK, ROUND, ABS, COALESCE, CONCAT,
UPPER, LOWER, LEN, MIN, MAX, DATE_DIFF_DAYS
```

Argumenty funkcji można rozdzielać przecinkiem albo średnikiem. Zależne kolumny obliczeniowe są liczone w poprawnej kolejności. Cykle są odrzucane przed zapisaniem projektu. Parser nie używa `eval` ani konstruktora `Function`.

## Szacowane zapotrzebowanie

Dla materiału z wystarczającą historią:

```text
horyzont planowania = max(horyzont użytkownika, lead time)
zużycie bazowe = średnie dzienne zużycie × horyzont planowania
zapotrzebowanie = zużycie bazowe × (1 + bufor) + safety stock
surowe do zamówienia = max(0, zapotrzebowanie - stan - otwarte zamówienia)
```

Dodatni wynik jest najpierw podnoszony co najmniej do MOQ, a następnie zaokrąglany w górę do pełnej krotności zamówienia.

To deterministyczny model planistyczny, a nie statystyczny forecast popytu. Nie uwzględnia automatycznie promocji, zewnętrznych planów sprzedaży ani modeli ML.

## Ograniczenia

Aplikacja nie jest pełną kopią Microsoft Excel. Nie obsługuje VBA, makr, natywnych obiektów PivotTable Excela, współpracy wielu użytkowników w czasie rzeczywistym ani całego katalogu formuł Excela. Praktyczna wielkość pliku zależy od pamięci urządzenia, liczby kolumn i złożoności formuł.

## Testy

```bash
npm ci
npm test
```

Pakiet przechodzi **138/138** automatycznych kontroli:

- 12 kontroli statycznych i integralności pakietu;
- 49 kontroli analizy decyzyjnej;
- 27 kontroli importu, edytora, transformacji, zapasów i Workspace;
- 42 kontrole regresyjne logiki krytycznej;
- 8 kontroli wydajności na 50 000 wierszy.
