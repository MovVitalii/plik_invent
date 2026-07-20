# Audyt obliczeń — Materials Analytics 1.7.1

## Zużycie i filtrowanie

Wszystkie podsumowania analizy są liczone z rekordów po aktywnych filtrach. Średnia jest liczona z wartości źródłowych, a nie ze średnich już zagregowanych komórek Pivot.

Tożsamość materiału jest normalizowana dla porównań: wielkość liter oraz polskie znaki nie tworzą sztucznych duplikatów.

## Coverage Days

```text
średnie dzienne zużycie = całkowite zużycie / liczba dni kalendarzowych zakresu
coverage days = aktualny stan zapasu / średnie dzienne zużycie
```

Wynik nie jest pokazywany jako precyzyjna liczba, gdy historia nie spełnia minimalnego progu liczby dni obserwacji. Wiarygodność uwzględnia liczbę obserwowanych dni i gęstość danych w zakresie kalendarzowym.

Jeżeli zużycie ma różne jednostki albo jednostka snapshotu nie zgadza się z jednostką zużycia, Coverage i zamówienie są blokowane jako niewiarygodne.

## Pareto i ABC

Materiały są sortowane malejąco według zużycia. Pareto wskazuje liczbę materiałów potrzebną do osiągnięcia 80% skumulowanego udziału.

Klasy ABC:

```text
A: skumulowany udział do 80%
B: powyżej 80% do 95%
C: powyżej 95%
```

## Szacowane zapotrzebowanie

```text
planningDays = max(forecastDays, leadTimeDays)
baseForecast = averageDaily × planningDays
recommended = baseForecast × (1 + buffer) + safetyStock
rawToOrder = max(0, recommended - stock - openOrders)
```

Reguły zamówienia są stosowane w kolejności:

1. dodatni wynik jest podnoszony co najmniej do `MOQ`;
2. wynik jest zaokrąglany w górę do pełnego `orderMultiple`.

Dzięki tej kolejności wynik nigdy nie spada poniżej MOQ po zaokrągleniu do opakowania.

## Jednostki

Stanów i zużycia w różnych jednostkach nie wolno sumować jako jednej wartości. KPI łącznego stanu pokazuje informację o różnych jednostkach zamiast mylącej sumy.

## Sezony

`season` grupuje ogólnie: Zima, Wiosna, Lato, Jesień. `seasonPeriod` wiąże sezon z rokiem. Grudzień 2025 oraz styczeń–luty 2026 należą do `Zima 2025/2026`.

Przy historii wieloletniej liczba dni kalendarzowych jest sumą osobnych zakresów każdego `seasonPeriod`; aplikacja nie tworzy jednego sztucznego zakresu przez przerwę między latami.

## Formuły arkuszowe

- potęgowanie jest prawostronne: `2^3^2 = 512`;
- potęgowanie ma wyższy priorytet niż minus jednoargumentowy: `-2^2 = -4`;
- `IF` oblicza tylko wybraną gałąź;
- `IFERROR` przechwytuje błędy ewaluacji pierwszego argumentu;
- `ROUND` zaokrągla połowy od zera, obsługuje ujemną liczbę miejsc i koryguje typowe błędy reprezentacji binarnej (`ROUND(1,005; 2) = 1,01`);
- `MIN` i `MAX` pomijają puste lub nienumeryczne argumenty;
- kolumny zależne są liczone topologicznie;
- cykle zależności są odrzucane przed modyfikacją danych.

## Zakres modelu

Szacowane zapotrzebowanie jest deterministycznym modelem planistycznym. Nie jest prognozą statystyczną i nie uwzględnia automatycznie promocji, trendu zewnętrznego, planu sprzedaży ani modeli probabilistycznych.

## Realizacja dostaw

Dla rozpoznanej ewidencji dostaw pola są rozdzielane na:

```text
zamówiona ilość
+ dostarczona ilość
+ pozostała ilość
+ palety zamówione / rozładowane / pozostałe
```

Podstawowy KPI:

```text
stopień realizacji = dostarczona ilość / zamówiona ilość
```

Kontrola spójności pojedynczego wiersza:

```text
zamówiona ilość = dostarczona ilość + pozostała ilość
```

Wartości opisowe, których nie da się jednoznacznie zamienić na liczbę, nie są dodawane do sum i są raportowane. Powtarzalny numer zamówienia może poprawnie występować w wielu pozycjach i nie jest automatycznie traktowany jako unikalny klucz rekordu.

## Plan zakupów i lead time

Dla planu zakupów:

```text
lead time = dokładna data dostawy on-site − data transportu
```

Średnia, mediana, minimum i maksimum są liczone tylko dla wierszy z dwiema dokładnymi datami. Wartości typu `week 35` są zachowywane jako okres planistyczny, ale nie są zamieniane na arbitralny dzień bez roku i dodatkowej reguły biznesowej.

## Plany hierarchiczne

Przed agregacją na kopii analitycznej wykonywane są dwa kontrolowane kroki:

1. `Fill Down` pustej nazwy materiału w ramach kolejnych pozycji;
2. wykluczenie wierszy `SUMA`, `RAZEM` i `TOTAL`.

Dane źródłowe pozostają niezmienione. Liczba wierszy źródłowych, analizowanych i wykluczonych jest zapisana w `datasetProfile`.

## Wieloarkuszowy stan efektywny — v1.7.1

### Aktualny snapshot

```text
stan efektywny = stockLevel
```

Snapshot jest wybierany jako najnowszy wpis o dacie nieprzekraczającej daty analizy.

### Stan początkowy

```text
stan efektywny = stockLevel
                + suma przyjęć po dacie stanu do daty analizy
                - suma zużycia po dacie stanu do daty analizy
```

Zakres jest otwarty z lewej i domknięty z prawej: `(data stanu, data analizy]`. Zapobiega to podwójnemu liczeniu ruchów już uwzględnionych w stanie początkowym.

### Data analizy

```text
filtr Data do
lub
max(data zużycia, data zapasu, data przyjęcia)
```

Snapshot z datą późniejszą niż data analizy jest wykluczany.
