# GIS Map Studio

The Map tab now opens a map-first, read-only layer composition workspace for ArcGIS REST servers. It is designed to offer common GIS inspection and cartography operations without replicating the full ArcGIS Pro desktop feature set.

## Everyday workflow

Open **Map** from any ArcGIS directory, service, or layer. The current spatial layer (or a few default-visible layers from its service) loads automatically; otherwise click **+ Layer**. Browse the current server's folders, services, and published layers, or paste an HTTPS \`FeatureServer/{id}\` or \`MapServer/{id}\` URL. Show/hide layers, move them up/down, zoom to their extent, open their attribute table, or remove them. The map stays visible while working with the layer list. On mobile the list is a collapsible overlay and is initially closed.

Click **Style** on a layer:
- Point layers: edit color/size, switch to clustered markers, or display heat-density. Cluster/density require the optional Leaflet plugins. Clustering and density use the *features returned for the visible map*, not the whole database.
- Polyline and polygon layers: outline/fill colors, stroke width, solid/dashed/dotted lines, polygon transparency.
- Labels: toggle and choose a field. Labels are rendered on screen only and not written to the ArcGIS service.
- Advanced layer-specific WHERE: an optional ArcGIS SQL expression is evaluated on the server. For the currently selected data layer, it is combined with its Explore filters.

Choose a basemap: Esri Streets, Esri Imagery, OpenStreetMap, or **OpenFreeMap Liberty**. OpenFreeMap uses a lazily loaded pinned MapLibre GL v5 build plus the MapLibre GL Leaflet adapter. If loading fails, the workspace falls back to Esri Streets. Attribution is displayed on the map.

Additional map actions: Fit, filter the active Explore layer to the visible map area, draw a rectangular selection with two taps, and clear the area filter. Clicking a vector feature opens its attribute inspector. Selecting features in Explore can highlight them in Map.

Click **More > Save map layout** to save layer URLs, visibility, order, styling, labels, filters, basemap and view extent *in this browser only*. Restore and clear are manual. No tokens, fetched features, or attachments are saved.

## Technical structure

- \`gis-map-studio.js\`: standalone layer manager, ArcGIS metadata discovery and guarded queries, symbols and overlays, controls and state.
- \`gis-map-studio.css\`: map-first desktop/mobile layout with responsive overlay sidebar.
- \`app.js\`: routes the Map view to Map Studio while retaining older map code as a fallback; calls cleanup when changing views.
- \`index.html\`: loads Leaflet marker clustering, Leaflet heat, and Map Studio. MapLibre is loaded only when OpenFreeMap is selected.
- \`tests/map-studio.test.cjs\`: URL validation, style limits, saved-layer settings and a lightweight map-mount smoke test.

Supported sources are HTTPS ArcGIS REST FeatureServer or MapServer spatial layers. Additional **public** cross-server layers use CORS with no credentials or borrowed tokens. For a secured service, connect to its ArcGIS REST root in the main explorer to use an appropriately scoped token. Image-only MapServer layers retain opacity, visibility and ordering; editing their server-rendered symbols requires a working feature query endpoint.

## Limits and safety

- Preview queries are capped at 500 geometries per layer per visible map. Zoom in for detailed coverage; the map indicates when a result may be truncated. Density heatmaps reflect that bounded preview, not a scientifically valid global density surface.
- Layer count is bounded to 16 and map-pan requests are debounced. Late responses are ignored when layer state or view changes.
- Raster fallback uses temporary Blob URLs for protected MapServer exports, rather than placing ArcGIS tokens in image URLs. Blob URLs are revoked when layers are removed or the map closes.
- Cross-origin ArcGIS metadata/features depend on each server's CORS and read permissions. Unsupported spatial references or true-curve geometries may not render as editable features.
- Map Studio performs **no ArcGIS edits** and does not change the source service renderer, feature data, or service configuration.

## Manual acceptance checklist

1. Open a Houston MapServer with multiple layers. Confirm the map stays visible on a phone while you hide/show, reorder and remove layers.
2. Add a FeatureServer point layer by URL; switch from symbols to clusters and density. Change color, size and label field. Inspect a point.
3. Add a line and polygon layer; test dashed lines, width, outline/fill, opacity and layering order.
4. Browse the current server from the Add panel, including nested folders, then select another published layer.
5. Switch all four basemaps, including OpenFreeMap, and confirm attribution and fallback.
6. Pan/zoom with a large layer; check truncation notice, request errors and bounded map performance.
7. Use **This area**, **Draw box**, **Clear area**, and a table-selected record to check map/table coordination.
8. Save and restore a map layout; sign out, navigate away and return; confirm no token or feature payload was persisted.
9. Test a public cross-server layer and a secured same-server layer. Verify external credentials are never inherited.
10. Run \`node --test tests/*.test.cjs\` and \`node --check gis-map-studio.js\`; test on desktop Safari/Chrome and mobile Safari before treating the feature as fully verified.
