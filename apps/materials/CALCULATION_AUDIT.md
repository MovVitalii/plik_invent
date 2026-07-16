# Calculation, normalization and seasonal-period audit — version 1.0.13

## Fixes in this version

- **Fixed a real, pre-existing crash: `dom.renderEmptyTableRow is not a function`.**
  This function was defined inside `dom.js` and already used internally there, and
  was also called externally as `dom.renderEmptyTableRow(...)` from
  `value-normalization-engine.js` — but was never added to `dom.js`'s exported `api`
  object, so it was inaccessible from outside the module. This predates all fixes in
  this document; it was not introduced by any change here. Found via a systematic
  cross-check of every `moduleName.functionName(...)` call in the app against that
  module's actual exports — the same check was run for all eleven modules; this was
  the only gap found.
- **Introduced full end-to-end integration testing**, not just isolated unit tests.
  Using jsdom with the exact pinned CDN library versions (SheetJS 0.18.5,
  Chart.js 4.4.1) downloaded from the npm registry, the real `index.html` +
  all 12 real application files are executed together, in the same sequential
  order the app's own loader uses. This is what caught the `renderEmptyTableRow`
  gap above — a plain per-file syntax check (`node --check`) cannot catch a missing
  cross-module export, since the file itself is syntactically valid; only actually
  loading every module together and exercising real cross-module calls surfaces it.
  Verified in this environment (three jsdom-specific gaps — `URL.createObjectURL`,
  `Element.scrollIntoView`, `HTMLCanvasElement.getContext` — were polyfilled since
  jsdom doesn't implement them and real browsers do; these are test-harness gaps,
  not application bugs):
  - Full boot completes with `data-app-ready="true"` and no fatal overlay.
  - A synthetic workbook (Polish-diacritic headers, no "Linia" column, a row
    spanning the Dec/Jan season boundary, one exact-duplicate row) imports,
    auto-maps, validates and processes correctly end to end: `line` is
    auto-detected as unmapped and does not block validation; the duplicate row is
    correctly isolated (1 duplicate, 0 invalid, not conflated); the processed total
    quantity is arithmetically correct; the "Linia" quick-template button is
    disabled with the expected tooltip while "Materiał" remains enabled; every row
    in the Dec 2025–Feb 2026 span groups under the single `seasonPeriod`
    `"Zima 2025/2026"`, with March 2026 correctly starting `"Wiosna 2026"`.

# Calculation, normalization and seasonal-period audit — version 1.0.12

## Fixes in this version

- **Corrected deployment folder structure.** `index.html` loads the eleven engine
  files from a `src/` subfolder (`src/constants.js`, `src/state.js`, ... — matching
  the original repository layout), while `app.js`, `index.html` and `styles.css` sit
  at the project root. The previous delivered bundle was flat and would have 404'd
  on every `src/*.js` request if extracted directly into place. Verified by checking
  every path `index.html`'s script loader references against the actual bundle
  layout — all resolve correctly now.
- **`ł` now folds to `l` in text comparison** (`normalizeComparableText`, `utils.js`).
  Every other Polish diacritic (ą, ć, ę, ń, ó, ś, ź, ż) already folded to its plain
  Latin base letter via Unicode NFD decomposition; `ł` has no such decomposition and
  was silently left untouched, so e.g. `"Materiał"` and an encoding-mangled
  `"Material"` variant (a realistic pattern for external exports with limited
  charset handling) were not recognized as the same value, unlike every other
  diacritic pair. This affects header-signature matching, auto-mapping scoring, and
  value-normalization grouping consistently, since they all share this function.
  Verified: `"Materiał"` and `"Material"` now produce identical normalized text and
  header signatures; other diacritic folding (`"Zużycie"`/`"Zuzycie"`,
  `"Będzie"`/`"Bedzie"`) confirmed unaffected.
- **Removed the second, previously-missed unused `innerHTML` pathway** — the
  `options.html` branch inside `dom.js`'s `createElement()`. This is the same class
  of dead code as `setTrustedHtml` (removed in 1.0.10): confirmed zero call sites
  anywhere in the app pass an `html` option; every real call uses `text`,
  `attributes`, `children`, etc. `dom.js` now has zero `innerHTML` usage.
  (`utils.js`'s `stripHtml` still uses `innerHTML` internally, but only on a
  detached, never-attached element purely to read back `.textContent` — this is a
  safe, standard HTML-stripping technique, not a rendering sink, so it was left
  as is; it remains unused/uncalled but isn't part of this class of issue.)

# Calculation, normalization and seasonal-period audit — version 1.0.11

## Fixes in this version

- **Mapping-profile signature migration.** The 1.0.10 fix that made `state.js` delegate
  to the more robust `createHeaderSignature` (diacritic folding, duplicate-suffix
  stripping) changed the actual signature string for headers containing foldable
  Polish diacritics. Profiles saved before 1.0.10 would have silently stopped
  matching. `normalizeMappingProfiles` now recomputes each stored profile's signature
  from its saved `headers` array on load (not from the persisted `signature` field),
  and writes the migrated result back to storage. Verified with an executable test:
  a profile saved under the old algorithm (`"zużycie"`, unfolded) is still found by
  `findMappingProfile` after migration, and the new signature (`"zuzycie"`, folded) is
  confirmed persisted.
- **Quick-analysis template "Linia" no longer silently degrades.** Since 1.0.10 the
  `line` field can be unmapped. Previously, clicking the "Linia" quick-template on
  such a file did not error — `applyTemplate` already filtered out unavailable
  fields — but it silently fell back to an ungrouped "all data" total while still
  marking the button active, with nothing telling the user their chosen grouping
  didn't apply. Fixed in two layers:
  - `pivot-engine.js` now computes template availability against `dataset.fields`
    (the actually-mapped/derived field list, not the SYSTEM_FIELD_MAP-padded field
    cache) and disables the corresponding button via a new
    `dom.setAnalysisTemplateAvailability()`, with a explanatory `title` tooltip.
    Runs once during `prepareAnalysis()`, right after processing.
  - `applyTemplate()` also throws a clear, named error if a template that requires a
    row/column grouping field ends up with none available, as defence-in-depth in
    case it's ever invoked outside the (now-disabled) button.
  - Verified with an isolated executable test against the real `ANALYSIS_TEMPLATES`
    definitions: with `line` absent from the available-fields set, only the `line`
    template is marked unavailable; `material`, `brand`, `month`, `season` remain
    available.

# Calculation, normalization and seasonal-period audit — version 1.0.10

## Fixes in this version

- `line` (pack station) is no longer a hard-required field. Source files without this
  concept (e.g. procurement exports) no longer have 100% of rows rejected. The
  requirement is now a single flag (`SYSTEM_FIELDS` → `line.required`) that can be
  re-enabled if a specific source always provides it.
- Fixed silent data loss on sparsely-populated trailing columns: the sheet analyzer
  previously only scanned the first 100 rows to decide how many columns actually
  contain data. A column whose first real value appeared after row 100 was dropped
  together with its header, with no warning. The analyzer now scans the full sheet.
- Removed duplicated business logic that existed as separate, independently
  maintained copies in two files each:
  - `validateRecord` / `validateRawRecord` (mapping-engine.js and normalization-engine.js)
  - `createDuplicateKey` (mapping-engine.js and normalization-engine.js)
  - `createHeaderSignature` (a weaker private copy in state.js shadowed the more
    robust version in utils.js — diacritic folding and duplicate-suffix stripping
    were not applied to saved mapping-profile matching until now)
  All three now have a single implementation in `utils.js`; the previous per-engine
  functions delegate to it.
- Removed an `innerHTML` string-interpolation call in the fatal startup-error handler
  (`index.html`) — the only place in the app that did not follow the textContent-only
  rendering discipline used everywhere else. Replaced with explicit DOM construction.
- Removed unused `setTrustedHtml` helper in `dom.js` (dead code, no callers, and the
  only other latent HTML-injection sink besides the one above).
- Removed a dead `dateNF` option passed to `sheet_to_json` during import (`raw: true`
  already returns Date objects/numbers, so the option had no effect).

## Known, deliberate trade-offs (not changed)

- Mapping-profile matching (`findMappingProfile`) still requires an exact,
  order-independent match of the full header set. If a source file adds, removes, or
  renames a column, a saved profile silently stops matching and the app falls back to
  auto-mapping. This is a conscious safety choice (a stale profile should not be
  applied to a structurally different file) rather than a bug; changing it to fuzzy
  "closest match, please review" matching would be a UX feature addition, not a fix.
- Value-normalization automatic target selection (choosing which spelling variant
  becomes canonical when counts tie) uses a heuristic (symbol count → length →
  case → locale order). This is a reasonable default, not a provably "correct" choice;
  user-defined alias rules exist specifically to override it when needed.
- Subresource Integrity (SRI) hashes were not added to the two CDN script tags
  (SheetJS, Chart.js) in `index.html`. Guessing a hash is worse than having none — a
  wrong hash blocks the script from loading at all. To add this safely, generate the
  exact hash for the pinned versions via jsdelivr's own package page (it shows a
  ready-to-copy `<script>` tag with the correct `integrity` and `crossorigin`
  attributes for that exact file).

# Calculation, normalization and seasonal-period audit — version 1.0.9

Test source: `inventory_operations_2026_one_sheet_50k(1).xlsx`.

## Verified source data

- data rows: 50,000
- fully identical source rows: 0
- invalid required values: 0
- total quantity: 50,169.98
- average quantity: 1.0033996
- minimum quantity: 0.03
- maximum quantity: 2.43

## Verified filter

Filters:

- Material: `Packing Tape`
- Brand: `ARKET`

Expected result:

- rows: 120
- groups by material: 1
- sum: 11.92
- average: 0.0993333333 (displayed as 0.10)
- minimum: 0.03
- maximum: 0.18

## Rules verified

- Summary cards are calculated from filtered source values, not from pivot group results.
- Sum, weighted average, minimum, maximum and record count were verified.
- `Liczba rekordów` counts rows, not only non-empty values.
- Pivot footer averages use all source rows and are weighted correctly.
- Cross-dimensional pivot totals reconcile to the source total.
- Pie charts use a precomputed group aggregate instead of re-aggregating pivot cells.
- Non-additive aggregations (`avg`, `min`, `max`) are not described as totals in chart accessibility text.
- Numeric date-derived fields are dimensions and cannot be selected as measures.
- Validation counts satisfy: total = valid + invalid + duplicates.

## Automated test coverage

- 40 template/aggregation combinations
- 160 chart model combinations
- all 5 aggregation functions
- filters, date ranges, normalization, duplicate keys, validation counters, date derivation and number parsing


## Value-normalization coverage

- technical variants are grouped by normalized text keys;
- the most frequent display variant is selected automatically, with deterministic tie-breaking;
- built-in unit and shift aliases are applied;
- saved semantic aliases override automatic targets;
- original changed values are retained in `originalValues`;
- normalization rules persist, while imported source and normalized rows remain memory-only;
- unsaved normalization edits block validation and processing;
- changing a rule invalidates previous analysis results.

## Test workbook value scan

For `inventory_operations_2026_one_sheet_50k(1).xlsx`:

- Brand: 6 source values → 6 target values;
- Material: 12 source values → 12 target values;
- Pack Station: 16 source values → 16 target values;
- Shift: 3 source values → 3 target values;
- Category: 7 source values → 7 target values;
- Unit: 3 source values → 3 target values.

Built-in unit standardization changes 46,495 records:

- `pcs` → `szt.`: 45,367 records;
- `roll` → `rolka`: 1,128 records;
- `m` remains `m`: 3,505 records.

No quantity conversion is performed.

## Seasonal-period coverage

The seasonal model now separates the general season name from a concrete continuous period:

- December 2025, January 2026 and February 2026 → `Zima 2025/2026`;
- March–May 2026 → `Wiosna 2026`;
- June–August 2026 → `Lato 2026`;
- September–November 2026 → `Jesień 2026`;
- December 2026, January 2027 and February 2027 → `Zima 2026/2027`.

Verified behavior:

- December is no longer combined with January–February of the same calendar year;
- the quick seasonal template groups by `Okres sezonowy`;
- the seasonal filter uses `Okres sezonowy`;
- seasonal periods are sorted chronologically using the hidden numeric `seasonSortKey`;
- pivot rows, pivot columns and filter options receive the stored sort key directly;
- sorting does not parse or depend on the displayed Polish season label;
- a localization smoke test confirmed correct ordering after replacing the labels with non-Polish text;
- the general field `Pora roku (ogólnie)` remains available for cross-year comparison and is clearly labelled as a broad grouping.
