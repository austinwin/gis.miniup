# GIS Explorer — interactive ArcGIS data workspace

GIS Explorer is a read-only browser for public and authorized ArcGIS REST services. Its layer workspace prioritizes **Explore**, **Analyze**, and **Map**. Other resource tools are available under **More**.

## How to use

1. Paste an ArcGIS REST services URL and open a queryable layer or table from the directory.
2. **Explore** loads a bounded first page of records. Use a chosen field to search, add typed filters, sort column headers, or change visible columns. Select a row for the feature inspector (attributes, supported attachments and relationships). Use the table action menu for map selection and export.
3. **Analyze** computes grouped category counts and numeric statistics with ArcGIS server queries. Choose fields and click a category to return to a filtered Explore view. Incomplete/truncated grouped results are identified; the current table page is never assumed to represent the entire layer.
4. **Map** uses the active data filter. FeatureServer vector previews are bounded by the visible map and any spatial selection, and MapServer layer image requests send attribute layer definitions when applicable.
5. Use **More > Fields** for the schema, **Export** for full/selected exports, and **Advanced** for additional utilities.

Saved views are opt-in and stored only in the current browser using localStorage. They include layer URLs, visual filters, search, sorting, visible columns and optional spatial bounds; **they do not store tokens or query results**. Avoid saving sensitive filter values on shared devices.

## Architecture

- `app.js`: navigation, ArcGIS REST requests, authorization, map rendering and export.
- `gis-enhancements.js`: table state, filters, paging, record details, vector map, and safe query operations.
- `gis-workspace.js`: focused Explore toolbar/drawer, saved views, and server-side Analyze.
- `gis-workspace.css`: responsive workspace presentation.
- `gis-field-utils.js`: shared ArcGIS date/field formatting.

The workspace add-on reuses the existing authenticated ArcGIS query client and per-layer model. No framework migration or mock dataset was introduced in production.

## Important limitations

- All ArcGIS access remains subject to server permissions, HTTPS, CORS and service capabilities.
- Map vector rendering is intentionally a bounded preview (500 features per view), not an exhaustive result. Zoom in when the preview is capped.
- MapServer image layers may not support every dynamic layer definition; map service support varies.
- The Analyze group query is bounded by a maximum result count. A warning is displayed if grouped results may be incomplete.
- Exact global sorting requires a capable server. On services without server paging, the existing ID-page fallback warns that only the current page is sorted.
- Spatial clipping of a MapServer raster image is not equivalent to filtering its underlying records; for exact spatial feature selection use the feature layer queries.

## Manual regression checklist

- Navigate folders, MapServer, FeatureServer, feature layers and nonspatial tables.
- Confirm a layer initially opens Explore and loads one page plus server count.
- Search a string field (including an apostrophe) and an integer field; combine with OR visual filters.
- Change a filter and verify count, table, Analyze and Map use the same scope.
- Sort, page, change visible columns, scroll horizontally and vertically; inspect a record and close its drawer without losing table position.
- Validate coded-value domains, date fields, attachments and related records.
- Check Analyze totals, group counts, nulls, numeric summaries and truncated-result warnings.
- Choose a map extent/area and verify server queries are restricted accordingly.
- Test full filtered/selected exports and authenticated layers (including sign-out).
- Verify desktop, 390px mobile width, keyboard access, HTTPS/CORS errors and service capability fallbacks.

## Local checks

Existing unit tests: `node --test tests/*.test.cjs`. For JavaScript syntax: `node --check app.js`, `node --check gis-enhancements.js`, and `node --check gis-workspace.js`.
