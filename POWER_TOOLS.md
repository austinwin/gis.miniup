# GIS Discovery, Styling, Analysis and Annotation

## What is implemented

The existing Map Studio now includes the following optional, read-only tools without changing the ArcGIS authentication flow:

1. **Public GIS discovery.** Open **+ Layer → Search public GIS catalog** and search public ArcGIS Online items of type Feature Service or Map Service. Results show publisher/title and, when a REST URL is available, offer Add or Browse Layers. Pagination is 30 results per request. This is federated search of an existing public index, **not** an exhaustive crawl of the public internet. Some hosted services are not indexed or do not expose a direct REST URL; users can still paste a known HTTPS ArcGIS REST URL and browse the current server.
2. **Thematic styling.** Open **Layers → Style → Style by field**. Use unique-value or graduated-color classification on the currently loaded preview features. Category colors are limited to eight classes; missing/other values are neutral. These classes are computed on the preview, not every feature in a large dataset.
3. **Spatial analysis.** Tap a feature on a vector map layer, open **Tools → Spatial analysis**, choose another visible layer, then run *Select within buffer*, *Select intersecting*, or *Nearest centroid within distance*. Buffer units are feet, meters or miles. Results appear as a separate orange overlay and are downloadable as GeoJSON.
4. **Exact, bounded query contract.** The analysis fetches all matching object IDs from the target ArcGIS service within the source feature or buffer bounding box, then fetches the candidate records in batches and evaluates intersections with Turf. It refuses a target query exceeding 3,000 candidates, any transfer-limit indicator, a missing geometry, or a partial/mismatched page. It **never** calls a 500-feature map preview a complete result. Nearest is **centroid distance**, not exact edge-to-edge distance; be explicit when using it for engineering decisions.
5. **Annotation and measurement.** Open **Tools → Draw & measure**. Draw points, lines, polygons, and text. Lines and polygons display geodesic length or area calculated with Turf, and annotations can be undone, cleared and downloaded as GeoJSON.
6. **Portable local projects.** **Map Studio → More → Export project JSON** downloads layer URLs, visibility, styling, filters, map center/zoom, and up to 300 annotations (no tokens and no feature payload). **Import project JSON** reads that file and rebuilds the map using the referenced live services. **Print map / PDF** invokes the browser print interface. Results depend on print/CORS support of individual basemap providers.
7. **Local layout persistence.** Existing Save/Restore continues, now carrying thematic styles and annotations. Map changes do not write back to the ArcGIS service.

## What is not implemented

An exhaustive, always-on global GIS crawler or private federated catalog index, full ArcGIS Pro geoprocessing parity, arbitrary server-side network tracing, raster modeling, real-time temporal slider, portable data snapshots, and verified PNG/PDF rendering across all basemap providers **are not part of this release**. Those require separate ingestion infrastructure, projection handling, resource scheduling, export services or dedicated dataset capabilities.

## Correctness and security boundaries

- A map preview is bounded to 500 features per layer and is a **visualization**, not a statistical sample of the full source.
- Analysis is bounded to 3,000 server-returned candidates. It stops rather than silently returning incomplete results. Unsupported ArcGIS query services cannot run exact analysis.
- Cross-origin external layers are public; the active server's token is not forwarded to a different origin.
- Sources must expose public HTTPS ArcGIS REST endpoints. Browsers still enforce CORS, so some otherwise public services may be inaccessible.
- Only user-initiated project exports include annotations and service URLs. **A project file can reveal internal service URLs or notes** if shared; inspect before distributing.
- Buffer and measurement math uses a pinned Turf 7.4.0 browser build. If unavailable, analysis reports an error instead of producing a fabricated result.
- Thematic styling does not alter the REST service renderer; all changes are local.

## Smoke-test sequence

1. On mobile and desktop, open an ArcGIS FeatureServer point layer and verify Symbols, Clusters, Density and thematic category/numeric styles.
2. In + Layer, search public catalog and browse a result's sublayers; verify no results exposes an Add button with an invalid URL.
3. Add two independently queryable public FeatureServer layers, tap a feature, then test intersect and a 500-ft buffer, including a zero-result case.
4. Force the server to return more than 3,000 candidate IDs and verify the analysis refuses to claim completeness.
5. Draw a line and polygon, check measurements, undo one, download annotations, and open the GeoJSON in a GIS viewer.
6. Save a layout, switch away and back, export project JSON, import it, verify symbology and notes persist without storing authentication tokens.
7. Test the print interface with a basemap; if tiles fail to print, use the Map Studio screenshot only as a manual fallback, not a claimed automated export.
8. Test a secured same-server layer and a public third-party layer. Confirm no token is passed to an unrelated server.
9. Run `node --test tests/*.test.cjs` and verify on a real mobile browser before declaring the deployment production-validated.

This release is deliberately a bounded foundation for a larger data discovery and analysis platform, not a substitute for a geodatabase, ArcGIS Pro, or a validated engineering network model.
