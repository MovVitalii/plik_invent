# Przykładowy skoroszyt

`Przyklad_Model_Danych.xlsx` pokazuje zalecaną strukturę wieloarkuszową:

- `Zużycie` — przypisz rolę **Zużycie**;
- `Zapasy` — przypisz rolę **Zapasy** i wybierz **Stan początkowy**;
- `Przyjęcia` — przypisz rolę **Przyjęcia**;
- `Zamówienia` — przypisz rolę **Otwarte zamówienia**;
- `Kartoteka` — przypisz rolę **Kartoteka materiałów**;
- `Instrukcja` — pozostaw jako **Ignoruj**.

Klucz łączenia: `Kod materiału`.

Po zbudowaniu modelu przejdź do mapowania, walidacji i Analizy decyzyjnej. Stan efektywny jest liczony jako stan początkowy plus przyjęcia minus zużycie od daty stanu włącznie.
