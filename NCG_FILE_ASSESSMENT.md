# Ocena pliku `NCG— kopia (1)(1).xlsx`

Data sprawdzenia: 2026-07-19

## Wniosek

Aplikacja nadaje się do pełnej analizy **każdego logicznego arkusza osobno**: realizacji dostaw, planu dostaw, rozładunków, jakości danych oraz wykrywania wiarygodnych relacji plan–wykonanie. W obecnej wersji aplikacja **nie łączy automatycznie wszystkich arkuszy w jeden relacyjny raport plan–wykonanie**; wykryte relacje są wskazywane użytkownikowi i mogą zostać wykorzystane do świadomego porównania tabel. Nie należy również traktować tego pliku jako kompletnego źródła do Coverage Days, ryzyka braku i prognozy zamówienia, ponieważ nie zawiera historii zużycia ani aktualnego snapshotu stanu magazynowego.

Brakujące dane decyzyjne można wprowadzić w `Edytor danych → Zapasy`, ale do wiarygodnego Coverage nadal potrzebna jest historia faktycznego zużycia materiałów.

## Rozpoznana struktura

Skoroszyt zawiera 10 arkuszy. Silnik wskazuje jako główne źródło `Ewidencja dostaw`:

- 70 wierszy danych;
- 14 rzeczywistych kolumn;
- domena: ewidencja realizacji dostaw;
- główna relacja plan–wykonanie z arkuszem `planowane dostawy` przez numer zamówienia;
- `(old)Arkusz1` został rozpoznany jako kopia archiwalna;
- arkusze `Sheet1`, `Arkusz1`, `Sheet2` i `Arkusz4` są podsumowaniami, a nie źródłami transakcyjnymi.

## Co aplikacja analizuje prawidłowo

- ilość zamówioną, dostarczoną i pozostałą;
- liczbę i stopień realizacji zamówień;
- pozycje niepełne i nadrealizacje;
- brak dokumentów WZ;
- zgodność równania `zamówiono = dostarczono + pozostało`;
- planowane dostawy w wybranym arkuszu oraz wykrywanie relacji między arkuszami;
- konwencje dat MDY/DMY, daty Excela i okresy typu `week 35`;
- braki, typy mieszane, opisowe liczby, duplikaty i anomalie;
- rekomendowane Pivot Table, wykresy i raport regułowy.

## Wynik pełnej analizy głównego arkusza

- jakość danych: **61/100, klasa D**;
- zamówiona ilość: **12 979 000**;
- dostarczona ilość: **9 414 868**;
- pozostała ilość: **1 015 928**;
- realizacja: **72,5%**;
- liczba zamówień: **22**;
- pozycje niepełne: **11**.

Najważniejsze problemy wykryte w danych:

- wartość opisowa `70 (66)` w kolumnie liczbowej;
- 1 wiersz niespełniający równania ilości;
- 2 wiersze, w których dostawa przekracza ilość zamówioną;
- 41 zrealizowanych pozycji bez numeru WZ;
- duża liczba braków w polach pozostałych palet, pozostałej ilości, numeru WZ i rozmiaru.

## Czego ten plik nie zapewnia

- aktualnego stanu magazynowego dla każdego materiału;
- dziennej/tygodniowej historii zużycia;
- jednostek magazynowych i konwersji jednostek;
- lead time, MOQ, krotności, safety stock i otwartych zamówień w kompletnej postaci.

Bez tych danych aplikacja nie powinna generować wiążącego Coverage Days ani ilości do zamówienia. Moduł decyzji blokuje te obliczenia i prosi o mapowanie, import osobnej tabeli lub ręczne uzupełnienie.

## Zalecany sposób pracy

1. Analizować `Ewidencja dostaw` jako główną ewidencję realizacji.
2. Analizować `planowane dostawy` jako osobną tabelę i porównywać ją z `Ewidencja dostaw` przez wykrytą relację numeru zamówienia; automatyczny wieloarkuszowy join nie jest wykonywany.
3. Nie sumować automatycznie arkusza `(old)Arkusz1` ani arkuszy podsumowań.
4. Poprawić wskazane rekordy w Edytorze danych.
5. Dla Coverage i planowania dodać osobny plik zużycia oraz snapshot zapasów albo uzupełnić parametry ręcznie.
