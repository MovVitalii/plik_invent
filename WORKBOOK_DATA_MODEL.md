# Workbook Data Model — specyfikacja 1.7.1

## Cel

Model pozwala używać wielu arkuszy jednego skoroszytu w jednym obliczeniu biznesowym bez implementowania adresów `A1`, międzyarkuszowych formuł ani `XLOOKUP`.

## Role danych

W każdej roli materiał musi mieć co najmniej jeden jednoznaczny identyfikator: **kod materiału, SKU albo nazwę materiału**.

| Rola | Wymagane pola poza identyfikatorem | Pola opcjonalne |
|---|---|---|
| Zużycie | Data, Zużycie | Kod materiału, SKU, nazwa, jednostka, marka, kategoria, linia i dowolne dodatkowe kolumny źródłowe |
| Zapasy | Stan zapasu | Data stanu, kod, SKU, nazwa, jednostka, lead time, MOQ, krotność, safety stock, otwarte zamówienia, dostawca |
| Przyjęcia | Ilość przyjęta, Data przyjęcia | Kod, SKU, nazwa, jednostka, dostawca, numer zamówienia |
| Otwarte zamówienia | Ilość otwarta | Kod, SKU, nazwa, data planowana, jednostka, dostawca, lead time, MOQ, krotność, safety stock |
| Kartoteka materiałów | brak | Kod, SKU, nazwa, jednostka, dostawca, lead time, MOQ, krotność, safety stock, kategoria |

## Pipeline

```text
Workbook
  ↓
Detekcja zakresów i wierszy nagłówków
  ↓
Przypisanie roli każdemu arkuszowi
  ↓
Niezależne mapowanie kolumn
  ↓
Normalizacja typów i zachowanie provenance
  ↓
Wybór klucza łączenia
  ↓
Konsolidacja tabel pomocniczych
  ↓
Audyt dopasowania
  ↓
Wirtualna tabela zużycia + osobne tabele zapasów/przyjęć/zamówień/master
  ↓
Decision Analytics / Smart Analytics / eksport / Workspace
```

## Reguły klucza

Tryb automatyczny ocenia pokrycie wspólnych wartości dla:

1. `materialCode`;
2. `sku`;
3. `material`.

Wygrywa pole z najwyższym udziałem materiałów z tabeli zużycia obecnych również w tabelach pomocniczych. Przy remisie preferowana jest większa bezwzględna liczba dopasowań.

Kod i SKU są normalizowane do wielkich liter bez odstępów. Nazwa materiału jest normalizowana tekstowo. Na podstawie tabeli zużycia budowana jest mapa aliasów kod ↔ SKU ↔ nazwa. Alias jest używany tylko wtedy, gdy prowadzi do jednego materiału; relacje niejednoznaczne są raportowane i pomijane.

## Wybór rekordu zapasu

Dla materiału używany jest najnowszy wpis o dacie nieprzekraczającej daty analizy. Data analizy to:

1. aktywny filtr `Data do`, jeżeli podano;
2. w przeciwnym razie najnowsza data spośród zużycia, zapasów i przyjęć;
3. bieżąca data, jeżeli nie ma żadnej poprawnej daty.

Snapshot z datą późniejszą niż historyczna data analizy jest ignorowany. Gdy istnieje więcej niż jeden snapshot tego samego materiału z tą samą datą, audyt wskazuje konflikt źródeł.

## Obliczenie stanu początkowego

Dla rekordu oznaczonego jako `opening`:

```text
stan efektywny = stan bazowy
                + Σ przyjęć, gdzie data ≥ data stanu i data ≤ data analizy
                - Σ zużycia, gdzie data ≥ data stanu i data ≤ data analizy
```

Wartości z dnia stanu początkowego są wliczane. Dla `snapshot`:

```text
stan efektywny = stan bazowy
```

Historyczne zużycie nie jest ponownie odejmowane od aktualnego snapshotu.

## Enrichment

Dane są uzupełniane według przeznaczenia źródła:

- kartoteka materiałów dostarcza domyślne: jednostkę, dostawcę, lead time, MOQ, krotność i safety stock;
- tabela otwartych zamówień dostarcza ilość w drodze oraz może uzupełnić parametry zamówienia;
- tabela zapasów pozostaje źródłem wartości stanu, daty i semantyki `snapshot/opening`;
- ilości otwartych zamówień są sumowane po rozpoznanym kluczu.

## Wirtualna tabela zużycia

Wszystkie arkusze przypisane do roli Zużycie są konsolidowane. Oprócz pól analitycznych zachowywane są **niezmapowane kolumny źródłowe**, aby można było je edytować, filtrować i eksportować po zbudowaniu modelu.

## Audyt

Model raportuje między innymi:

- `usageRows`, `stockRows`, `receiptRows`, `orderRows`, `materialMasterRows`;
- `usageMaterials`, `stockMaterials`, `matchedMaterials`;
- `unmatchedUsage`, `unmatchedStock`;
- `duplicateStockSnapshots` dla tego samego materiału i dnia;
- `ambiguousAliases`;
- `negativeSourceStocks`;
- `unitMismatches`;
- `resolvedJoinField`;
- błędy i ostrzeżenia poszczególnych arkuszy i wierszy.

## Provenance

Każdy rekord pochodzący ze skoroszytu zachowuje:

```text
sourceFile
sourceSheet
sourceRow
role
```

Wirtualny arkusz zużycia przenosi pochodzenie do znormalizowanego datasetu, dzięki czemu wynik można prześledzić do oryginalnego wiersza.

## Zachowanie przy brakach

- Brak arkusza zapasów nie blokuje analizy zużycia; Coverage wymaga wtedy wpisu ręcznego.
- Brak stanu liczbowego powoduje pominięcie danego wiersza zapasu z ostrzeżeniem.
- Stan początkowy bez daty jest pomijany.
- Niezgodność jednostek nie jest automatycznie konwertowana i blokuje rekomendację zamówienia.
- Materiał bez dopasowania pozostaje w tabeli zużycia, ale nie otrzymuje pokrycia zapasu.
- Ujemny stan źródłowy i niejednoznaczny alias są raportowane do ręcznej weryfikacji.

## Zakres świadomie wykluczony

Model nie implementuje:

- adresów komórek i zakresów Excel;
- międzyarkuszowych formuł;
- `XLOOKUP`, `VLOOKUP` ani point-mode;
- dowolnych joinów użytkownika pomiędzy przypadkowymi tabelami.

Obsługiwane relacje są jawne, biznesowe, deterministyczne i testowane.
