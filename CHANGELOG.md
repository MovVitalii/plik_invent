# Changelog

## 1.4.1 — audyt integralności

### Formuły i obliczenia

- Dodano prawidłową, zależnościową kolejność obliczania kolumn wyliczanych.
- Dodano wykrywanie i transakcyjne odrzucanie cykli formuł.
- Naprawiono przepisywanie odwołań po zmianie nazwy kolumny oraz ochronę kolumn używanych przez formuły.
- Dodano separator średnikowy, prawostronną łączność potęgowania i właściwy priorytet potęgowania względem znaku minus.
- `IF` oblicza tylko wybraną gałąź, a `IFERROR` przechwytuje błędy ewaluacji.
- `ROUND` działa jak oczekiwane zaokrąglenie arkuszowe: połowy od zera, ujemne miejsca oraz wartości dziesiętne podatne na błąd binarny.
- `MIN` i `MAX` ignorują puste wartości zamiast traktować je jak zero.

### Edytor i filtry

- Naprawiono przełączanie sortowania nagłówka.
- Porównania dat używają wartości chronologicznych, a nie porównania tekstu.
- Nieprawidłowy próg filtra liczbowego jest odrzucany.
- Naprawiono usuwanie zaznaczonych wierszy oraz ponowne wykonanie tej operacji.
- Wielokomórkowe wklejanie aktualizuje formuły dopiero po zapisaniu całego zakresu.
- Zmiany filtrów, sortowania i widoku są uwzględniane przez autosave.

### Import, Workspace i stan

- Zachowano rzeczywiste numery wierszy Excel mimo pustych rekordów.
- Zachowano pochodzenie danych z wielu plików i arkuszy.
- Ujednolicono Workspace do schematu v3.
- Import Workspace waliduje wersję, identyfikatory pól, definicje formuł i zależności przed zastąpieniem bieżącego projektu.
- Brakujące lub powielone identyfikatory wierszy są regenerowane.
- Przy odtwarzaniu projektu czyszczony jest przejściowy stan edytora, historii i podglądów.
- Autosave zachowuje nazwę projektu i można go jednoznacznie usunąć.

### Zapasy i planowanie

- Materiały są dopasowywane bez rozróżniania wielkości liter i polskich znaków.
- Materiały występujące wyłącznie w tabeli zapasów nie pojawiają się poza aktywnym zakresem zużycia.
- Niejednolite albo niezgodne jednostki blokują niewiarygodne wyliczenia.
- Wieloletnie sezony liczą osobne zakresy kalendarzowe zamiast jednego zakresu przez kilka lat.
- MOQ jest stosowane przed zaokrągleniem do krotności zamówienia.
- Liczba materiałów w KPI używa znormalizowanej tożsamości materiału.

### Eksport i bezpieczeństwo

- Eksport CSV neutralizuje tekst rozpoczynający się jak formuła arkusza.
- Ujemne wartości liczbowe pozostają liczbami i nie są modyfikowane przez ochronę CSV.
- Potwierdzono brak `eval` oraz konstruktora `Function` w kodzie aplikacji.

### Weryfikacja

- 12/12 kontroli statycznych.
- 49/49 kontroli analizy decyzyjnej.
- 27/27 kontroli edytora i Workspace.
- 42/42 kontrole regresyjne.
- 8/8 kontroli wydajności na 50 000 wierszy.
- Łącznie **138/138** kontroli.

## 1.4.0

### Import i model danych

- Dodano CSV, wiele plików, konfigurowalny wiersz nagłówków i łączenie zgodnych arkuszy.
- Dodano tryb ogólnego arkusza bez obowiązkowego mapowania materiałowego.
- Wszystkie kolumny źródłowe są zachowywane po mapowaniu.
- Marka przestała być polem obowiązkowym.

### Edytor danych

- Zastąpiono prosty Data Lab edytowalnym, wirtualizowanym arkuszem.
- Dodano edycję komórek, zaznaczanie zakresu, kopiowanie/wklejanie, dodawanie/usuwanie wierszy i kolumn.
- Dodano zarządzanie nazwą, szerokością, kolejnością i widocznością kolumn.
- Dodano warunkowe filtry i sortowanie wielopoziomowe.
- Dodano Undo/Redo oparte na różnicach.

### Transformacje i formuły

- Dodano transformacje z podglądem i wyborem zakresu.
- Dodano historię transformacji.
- Dodano bezpieczne kolumny obliczeniowe z odwołaniami `[Nazwa kolumny]`.
- Dodano edycję błędnych wierszy i ponowną walidację.
- Dodano profil jakości kolumn.

### Zapasy i planowanie

- Dodano osobny import snapshotów zapasu.
- Dodano pola lead time, MOQ, krotność zamówienia, safety stock, otwarte zamówienia i dostawcę.
- Zapotrzebowanie uwzględnia horyzont lead time, zapas bezpieczeństwa, otwarte zamówienia, MOQ i krotność.
- Rozbudowano tabelę i CSV planowania.
- KPI stanu nie sumuje bezpośrednio różnych jednostek.

### Projekty i eksport

- Dodano projekty lokalne, autosave przez IndexedDB i fallback do localStorage.
- Rozszerzono Workspace JSON.
- Dodano wieloarkuszowy eksport projektu XLSX.
