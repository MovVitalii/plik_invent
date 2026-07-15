# Excel Materials Analytics

Połączona wersja dwóch projektów:

- `apps/materials` — pełna logika biznesowa Inventory 2.0 / Pack Materials Analytics;
- `apps/trainer` — unikalne funkcje Excel Analytics Trainer: jakość danych, czyszczenie, obliczenia warunkowe, uniwersalny Pivot i raporty;
- `index.html` — wspólny interfejs i przełącznik modułów w stylistyce nowego projektu.

## Uruchomienie

Otwórz `index.html` albo uruchom lokalny serwer:

```bash
python -m http.server 8000
```

Następnie otwórz `http://localhost:8000`.

## Zasady integracji

- logika biznesowa materiałów nie została usunięta ani uproszczona;
- biblioteki SheetJS i Chart.js są lokalne — moduł Materials nie wymaga CDN;
- oba moduły działają w jednym shellu, ale zachowują niezależny stan, dzięki czemu nie dochodzi do kolizji globalnych namespace `PMA` i `EAT`;
- aktywny moduł jest zapamiętywany w `localStorage`.


## Material Intelligence Center

Trzeci moduł zawiera dashboard zarządczy, coverage days, ryzyko braków, analizę Pareto i ABC, sezonowość, prognozę zapotrzebowania oraz import/eksport ustawień. Biblioteki XLSX i Chart.js są dostarczane lokalnie. Średnie dzienne są liczone po pełnym obserwowanym zakresie kalendarzowym, a wykrywanie nagłówka wykorzystuje ocenę struktury i słowa kluczowe.
