# Audyt obliczeń — Materials Analytics 1.4.1

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
