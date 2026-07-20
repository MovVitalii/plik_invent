# Materials Analytics 1.7.1 — Workbook Data Model

Lokalna aplikacja przeglądarkowa do pracy z plikami Excel/CSV, analizy zużycia materiałów, kontroli zapasów, planowania zamówień i deterministycznego Smart Analytics.

Wersja 1.7.1 usuwa ograniczenie jednego aktywnego arkusza w procesie decyzyjnym. Jeden skoroszyt może równocześnie dostarczać tabelę zużycia, zapasów, przyjęć, otwartych zamówień i kartotekę materiałów.

Aplikacja nie korzysta z backendu, chmury, AI/LLM ani zewnętrznych API. Dane pozostają na komputerze użytkownika.

## Uruchomienie

### Windows

1. Rozpakuj archiwum.
2. Uruchom `START_WINDOWS.bat`.
3. Otwórz adres pokazany w terminalu, zwykle `http://127.0.0.1:8080`.

Launcher używa Pythona, a gdy Python nie jest dostępny — dołączonego serwera PowerShell z prawidłową obsługą plików `.wasm` i `.mjs`.

### Linux / macOS

```bash
./start.sh
```

Nie otwieraj aplikacji przez `file://`. Web Worker i DuckDB-WASM wymagają lokalnego HTTP.

## Główne moduły

1. **Import i model skoroszytu** — XLSX, XLS, XLSB i CSV, wiele plików, rozpoznawanie arkuszy, wykrywanie nagłówków, przypisywanie ról wielu arkuszom i niezależne mapowanie.
2. **Mapowanie** — mapowanie wygenerowanej tabeli zużycia do pól analitycznych.
3. **Analiza** — filtry, Pivot Table, wykresy, okresy i sezony.
4. **Analiza decyzyjna** — Coverage Days, ryzyko, Pareto, ABC i szacowane zapotrzebowanie.
5. **Edytor danych** — edycja komórek, copy/paste, sortowanie, filtry, transformacje, formuły, jakość, ręczne dane zapasów i projekty lokalne.
6. **Smart Analytics** — profilowanie, braki, duplikaty, anomalie, trendy, porównania okresów, korelacje, rekomendowane zestawienia i raport szablonowy.

## Jedno mapowanie bez powtórzeń

W trybie wieloarkuszowym role i kolumny mapuje się wyłącznie w panelu `Model danych skoroszytu`. Po wybraniu `Zbuduj model danych` etap 2 nie pokazuje ponownie pól mapowania. Wyświetla podsumowanie użytego modelu, automatyczny wynik kontroli jakości i przycisk przetworzenia. Klasyczne mapowanie w etapie 2 pozostaje dostępne wyłącznie dla trybu pojedynczego arkusza.

## Model danych skoroszytu

Po wczytaniu pliku aplikacja pokazuje wszystkie arkusze i pozwala przypisać im role:

```text
Zużycie                — transakcje wykorzystania materiałów
Zapasy                 — snapshot albo stan początkowy
Przyjęcia              — dostawy/przyjęcia zwiększające stan
Otwarte zamówienia     — ilości w drodze i parametry zamówienia
Kartoteka materiałów   — kod, SKU, jednostka, dostawca, lead time, MOQ itd.
Ignoruj                 — arkusz pomocniczy lub archiwalny
```

Każdy arkusz ma:

- własny wiersz nagłówków;
- własne mapowanie;
- własną rolę biznesową;
- zachowane źródło: plik, arkusz i numer wiersza.

Można przypisać więcej niż jeden arkusz do tej samej roli, np. osobne arkusze zużycia dla kolejnych miesięcy.

### Klucz łączenia

Dostępne strategie:

```text
Automatycznie
Kod materiału
SKU
Nazwa materiału
```

Tryb automatyczny porównuje pokrycie kluczy i wybiera najlepszą dostępną opcję w kolejności: kod materiału, SKU, nazwa. Nazwy są normalizowane pod kątem wielkości liter, odstępów i znaków diakrytycznych. Wpis ręczny zawierający tylko nazwę może zostać powiązany z transakcjami posiadającymi kod, jeżeli nazwa jednoznacznie odpowiada materiałowi.

Po zbudowaniu modelu wyświetlany jest audyt:

- liczba wierszy w każdej roli;
- wykorzystany klucz;
- liczba dopasowanych materiałów;
- materiały bez zapasu;
- zapasy bez zużycia;
- niezgodności jednostek;
- powtarzające się snapshoty zapasu dla tego samego materiału i dnia;
- ostrzeżenia dotyczące nieprawidłowych wierszy.

## Semantyka zapasu

Dla każdego arkusza zapasów należy wybrać znaczenie wartości.

### Aktualny snapshot

Wartość jest traktowana jako faktyczny stan na podaną datę:

```text
stan efektywny = wartość snapshotu
```

Historyczne zużycie nie jest odejmowane ponownie.

### Stan początkowy

Stan jest przeliczany do daty analizy:

```text
stan efektywny = stan początkowy
                + przyjęcia od daty stanu włącznie
                - zużycie od daty stanu włącznie
```

Gdy ustawiono filtr `Data do`, używany jest wyłącznie stan dostępny najpóźniej w tej dacie. Snapshot z przyszłości nie jest wykorzystywany w analizie historycznej.

## Przykładowy skoroszyt

```text
Arkusz „Zużycie”
Data | Kod materiału | Materiał | Zużycie | Jednostka

Arkusz „Zapasy”
Kod materiału | Materiał | Stan początkowy | Data stanu | Jednostka

Arkusz „Przyjęcia”
Kod materiału | Ilość przyjęta | Data przyjęcia

Arkusz „Zamówienia”
Kod materiału | Ilość otwarta | Dostawca | MOQ | Krotność

Arkusz „Kartoteka”
Kod materiału | Jednostka | Lead time | Safety stock
```

Gotowy plik demonstracyjny znajduje się w `examples/Przyklad_Model_Danych.xlsx`.

Po wybraniu **Zbuduj model danych** aplikacja:

1. czyta wszystkie przypisane arkusze;
2. waliduje ich mapowania;
3. tworzy wspólną tabelę transakcji zużycia;
4. zachowuje zapasy, przyjęcia, zamówienia i kartotekę jako osobne zbiory;
5. łączy je deterministycznie po kluczu materiału;
6. przekazuje wynik do Analizy decyzyjnej i Smart Analytics.

Nie trzeba pisać `XLOOKUP`. Połączenie tabel jest częścią modelu danych, a nie formułą użytkownika.

## Ręczne dane decyzyjne

W **Edytor danych → Zapasy** można ręcznie dodać lub zmienić:

- materiał, kod materiału i SKU;
- aktualny snapshot albo stan początkowy;
- datę i jednostkę;
- lead time;
- MOQ i krotność zamówienia;
- safety stock;
- otwarte zamówienia;
- dostawcę.

Dane ręczne działają razem z danymi pochodzącymi ze skoroszytu i zachowują informację o źródle.

## Szacowane zapotrzebowanie

```text
horyzont = max(horyzont użytkownika, lead time)
zużycie bazowe = średnie dzienne zużycie × horyzont
zapotrzebowanie = zużycie bazowe × (1 + bufor) + safety stock
surowe do zamówienia = max(0, zapotrzebowanie - stan - otwarte zamówienia)
```

Dodatni wynik jest podnoszony do MOQ, a następnie zaokrąglany do pełnej krotności zamówienia. Niezgodność jednostek blokuje rekomendację ilościową.

## Smart Analytics

Silnik jest deterministyczny i lokalny. Automatycznie:

- określa typy fizyczne i role semantyczne kolumn;
- wykrywa braki, duplikaty, błędy typów i kolumny stałe;
- wykrywa anomalie metodami IQR i robust Z-score/MAD;
- oblicza trendy i porównania okresów;
- oblicza Pearson, Spearman, eta² i Cramér’s V;
- rekomenduje Pivot Table i typy wykresów;
- tworzy raport z kontrolowanych szablonów;
- zapisuje fingerprint danych i ślad metodologiczny.

DuckDB-WASM służy wyłącznie do lokalnego wykonywania wybranych zestawień SQL. Nie jest AI i nie wysyła danych.

## Workspace

Workspace używa schematu **v5** i zapisuje:

- mapowania i role arkuszy;
- model danych skoroszytu i audyt połączeń;
- dane zużycia, zapasów, przyjęć, zamówień i kartoteki;
- edycje, formuły i transformacje;
- filtry i konfigurację analizy;
- ostatni wynik Smart Analytics.

## Bezpieczeństwo

- brak AI/LLM i usług zewnętrznych;
- brak wysyłania plików;
- lokalne SheetJS, Chart.js i DuckDB-WASM;
- parser formuł bez `eval` i `new Function`;
- walidowany import Workspace;
- ochrona eksportu CSV przed formula injection.

## Granice produktu

Aplikacja nie jest pełnym klonem Microsoft Excel. Nie obsługuje VBA, makr, natywnych Excel PivotTable, formuł adresowanych przez `A1`, międzyarkuszowego `XLOOKUP`, współpracy w czasie rzeczywistym ani całego katalogu funkcji Excela.

Model skoroszytu realizuje potrzebne połączenia biznesowe jawnie i audytowalnie, zamiast wymagać od użytkownika budowania własnych formuł między arkuszami.

## Testy

```bash
npm ci
npm test
```

Wersja 1.7.1 przechodzi **304/304** automatycznych kontroli. Szczegóły znajdują się w `VERIFICATION_REPORT.md` i `WORKBOOK_DATA_MODEL.md`.
