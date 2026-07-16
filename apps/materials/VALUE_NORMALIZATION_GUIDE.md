# Normalizacja wartości — instrukcja

## Cel

Sekcja **Normalizacja wartości** służy do łączenia różnych zapisów tej samej wartości po zakończeniu mapowania kolumn.

Przykłady:

- `H&M`, `h&m`, `H & M` → `H&M`
- `Packing Tape`, `packing tape`, `Packing  Tape` → `Packing Tape`
- `pcs`, `piece`, `szt.` → `szt.`

## Obsługa

1. Zmapuj kolumny źródłowe.
2. W sekcji **Normalizacja wartości** wybierz pole, np. `Marka` lub `Materiał`.
3. Sprawdź listę wariantów źródłowych i liczbę rekordów.
4. W kolumnie **Wartość docelowa** wpisz wspólną nazwę.
5. Kliknij **Zapisz reguły**.
6. Uruchom ponownie **Sprawdź dane** i **Przetwórz dane**.

Zapisane reguły są automatycznie stosowane przy kolejnych importach w tej samej przeglądarce.

## Sposób działania

Automatycznie, bez reguły użytkownika, aplikacja łączy techniczne warianty:

- różną wielkość liter;
- zbędne i podwójne spacje;
- niektóre różnice znaków interpunkcyjnych;
- typowe warianty jednostek i zmian.

Znaczeniowe synonimy, np. `Adhesive Tape` i `Packing Tape`, wymagają ręcznego wskazania jednej wartości docelowej.

## Znaczenie wskaźników

- **Warianty źródłowe** — liczba różnych zapisów znalezionych w Excelu.
- **Wartości docelowe** — liczba wartości, które pozostaną po normalizacji.
- **Aktywne reguły** — liczba zapisanych reguł użytkownika dla wybranego pola.
- **Scalone rekordy** — liczba rekordów, których zapis zostanie zmieniony w danych analitycznych.

## Ważne ograniczenie jednostek

Normalizacja nazw jednostek nie jest konwersją ilości.

Aplikacja może ujednolicić:

- `pcs`, `piece`, `szt.` → `szt.`

Nie może jednak bez dodatkowej reguły przeliczeniowej zamienić:

- `1000 g` na `1 kg`;
- `100 cm` na `1 m`;
- `1000 ml` na `1 l`.

Takie jednostki pozostają oddzielne, aby nie zafałszować sum.
