# Analiza okresów sezonowych

## Zasada

Aplikacja rozróżnia ogólną porę roku od konkretnego okresu sezonowego.

| Data | Pora roku (ogólnie) | Okres sezonowy |
|---|---|---|
| 15.01.2026 | Zima | Zima 2025/2026 |
| 15.02.2026 | Zima | Zima 2025/2026 |
| 15.03.2026 | Wiosna | Wiosna 2026 |
| 15.07.2026 | Lato | Lato 2026 |
| 15.10.2026 | Jesień | Jesień 2026 |
| 15.12.2026 | Zima | Zima 2026/2027 |

## Zastosowanie

- `Okres sezonowy` należy stosować do planowania zakupów, porównywania konkretnych sezonów i prognozowania.
- `Pora roku (ogólnie)` można stosować do zbiorczego porównania wszystkich zim, wiosen, lat i jesieni niezależnie od roku.

Szybka analiza `Okres sezonowy` grupuje dane chronologicznie i nie łączy stycznia–lutego z grudniem tego samego roku kalendarzowego.

## Sortowanie techniczne

Kolejność okresów sezonowych jest wyznaczana przez ukryte pole liczbowe `seasonSortKey`, a nie przez analizę tekstu etykiety. Dzięki temu zmiana nazwy sezonu lub lokalizacji interfejsu nie wpływa na chronologiczne sortowanie.
