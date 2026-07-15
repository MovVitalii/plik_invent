# Pack Materials Analytics

Static browser application for local Excel analysis.

## Deployment

Publish the repository with GitHub Pages. Local CSS and JavaScript files receive a unique `build` query parameter on every page load, so browser cache clearing and manual asset-version changes are not required.

For each update:

```bash
git add .
git commit -m "Describe the change"
git push
```

Imported workbooks, source rows and processed rows remain in memory only. Persistent browser storage is limited to preferences, mapping profiles, recent file names and user-defined value-normalization rules.

## Column mapping and value normalization

Column mapping answers: **which source column contains a system field?**

Value normalization answers: **which different source values should be treated as one value?**

The application automatically removes technical differences such as extra whitespace and letter case. Built-in aliases standardize common units and shifts. The user can additionally create persistent aliases, for example:

- `hm` → `H&M`
- `H and M` → `H&M`
- `Adhesive Tape` → `Packing Tape`

The original workbook is never changed. Normalized records keep an internal audit of values that were changed. Semantic aliases are only applied after the user saves a rule.

Unit aliases do not perform quantity conversion. Values such as `g` and `kg`, or `cm` and `m`, remain separate unless a dedicated conversion mechanism is added.

See `VALUE_NORMALIZATION_GUIDE.md` for usage details.

## Duplicate detection

Duplicates are detected by a mapped unique record/operation ID when available. Without such an ID, only fully identical source rows are treated as duplicates. Order ID alone is not treated as a unique row identifier because one order may contain multiple material operations. Validation cards are disjoint: `Błędne` excludes duplicates, while `Duplikaty` is reported separately.

## Calculation rules

- Summary cards (`Suma`, `Średnia`, `Minimum`, `Maksimum`) are calculated from filtered source values, not from already aggregated pivot cells.
- `Liczba rekordów` counts source records in each group.
- Pivot footers use the complete filtered dataset and weighted averages.
- Derived date fields are dimensions only and cannot be used as numeric measures.
- Duplicate records are detected by a mapped unique operation ID, or by a fully identical source row when no such ID exists.

## Seasonal periods

The application keeps two separate date dimensions:

- `Pora roku (ogólnie)` — Zima, Wiosna, Lato, Jesień; useful only for broad comparisons across years.
- `Okres sezonowy` — a continuous period tied to a specific year, for example `Zima 2025/2026`.

Winter is assigned as follows:

- January and February 2026 → `Zima 2025/2026`
- December 2026 → `Zima 2026/2027`

The quick seasonal analysis and seasonal filter use `Okres sezonowy`, preventing December from being silently combined with January–February of the wrong winter.

Seasonal periods are ordered by a hidden numeric `seasonSortKey`. The application does not parse the visible label, so changing the label format or interface language does not break chronological sorting.
