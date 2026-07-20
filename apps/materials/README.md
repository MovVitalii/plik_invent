# Materials Analytics 1.7.1 — dokumentacja techniczna

## Runtime

Aplikacja statyczna: HTML, CSS i JavaScript uruchamiane lokalnie przez HTTP. Brak backendu, AI i zewnętrznych API.

Główne biblioteki runtime są dostarczane lokalnie:

- SheetJS;
- Chart.js;
- DuckDB-WASM.

## Nowy moduł `workbook-model-engine.js`

Moduł odpowiada za wieloarkuszowy model danych.

### API

```text
initialize()
destroy()
prepareFromWorkbook(options)
analyzeSheetDetached(sheetName, headerRowIndex)
autoMapRole(role, headers, detectedTypes)
buildDataModel()
resolveJoinField(strategy, usageRows, stockRows)
getMaterialIdentity(record)
getInventoryRows(visibleUsageRows)
stockFieldDefinitions()
```

### Stan

```text
import.dataModel
  enabled
  status
  joinStrategy
  resolvedJoinField
  generatedUsageSheet
  roles[]
  audit
  preparedAt

dataset.stockRows
dataset.receiptRows
dataset.orderRows
dataset.materialMasterRows
dataset.modelJoinAudit
```

Każdy element `roles[]` przechowuje `sheetName`, `role`, `headerRowIndex`, `mapping`, `stockMode`, nagłówki i typy wykryte dla konkretnego arkusza.

### Przepływ

1. `import-engine.js` czyta cały workbook i wywołuje `prepareFromWorkbook()`.
2. UI pozwala przypisać role i mapowania.
3. `buildDataModel()` parsuje wszystkie przypisane arkusze.
4. Transakcje zużycia są materializowane jako wirtualny arkusz `Model danych — Zużycie`.
5. Pozostałe role trafiają do osobnych tablic stanu.
6. `normalization-engine.js` normalizuje wirtualny arkusz przy zachowaniu oryginalnego provenance.
7. `decision-engine.js` pobiera stan przez `workbookModelEngine.getInventoryRows()`.

## Integracja

- `app.js` inicjalizuje moduł przed normalizacją.
- `state.js` przechowuje model i tabele pomocnicze.
- `decision-engine.js` używa wspólnej identyfikacji materiałów oraz obliczonego stanu efektywnego.
- `spreadsheet-engine.js` zapisuje model w Workspace v5 i eksportuje osobne arkusze pomocnicze.
- `workspace-storage.js` obsługuje schemat v5.

## Reguły stanu

Snapshot jest autorytatywny. Stan początkowy jest przeliczany przez przyjęcia i zużycie po jego dacie. Dla filtra historycznego nie wolno użyć snapshotu z przyszłości.

## Edytor ręczny

Ręczny rekord obsługuje nazwę, kod, SKU, snapshot/stan początkowy, datę, jednostkę, lead time, MOQ, krotność, safety stock, otwarte zamówienia i dostawcę.

## Testy

Dedykowany test `verification/workbook-model-test.js` sprawdza:

- pięć ról arkuszy;
- niezależne mapowania;
- automatyczny klucz po kodzie materiału;
- zachowanie provenance;
- stan początkowy, przyjęcia i zużycie;
- snapshot bez ponownego odejmowania;
- historyczny as-of bez przyszłego snapshotu;
- enrichment kartoteką i zamówieniami;
- alias nazwa ↔ kod dla danych ręcznych;
- zapis modelu w Workspace.

Pełny pakiet: **293/293** kontroli.
