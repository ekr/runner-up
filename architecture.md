# RunnerUp Architecture

## Overview

RunnerUp is a single-page web app that lets users compare GPS tracks side-by-side on an interactive map. Tracks are uploaded as GPX files, stored on a Cloudflare Worker backend, and rendered using Leaflet (map) and Observable Plot (graphs).

## Frontend Modules (`static/`)

All modules are plain browser-global JS scripts loaded in order in `index.html`. No bundler.

| File | Role |
|------|------|
| `settings.js` | `Settings` singleton — reads/writes per-user settings (units, etc.) from localStorage and server |
| `units.js` | `Units()` factory — converts raw meter values to km/mi based on current settings |
| `utils.js` | `clearChildren`, `getColor` helpers |
| `gpx.js` | GPX parsing (`parseGPX`), distance math (`getDistanceFromLatLonInKm`), interpolation (`getValueAtPosition`), track normalization |
| `alignment.js` | DTW-based track alignment (`findOverlappingRegions`, `intersectOverlapRanges`, `createHarmonizedTracks*`) |
| `map.js` | `LeafletMap()` — owns the Leaflet map instance, draws tracks, manages markers, builds the legend DOM |
| `graphs.js` | `drawGraphs`, `removeGraphs` — Observable Plot elevation/pace graphs below the map |
| `storage.js` | API calls to the Cloudflare Worker backend (save/load/delete GPX, auth, settings, shares) |
| `infobox.js` | `computeLeaderInfo(tracks, currentTime, names)` + `renderInfobox(container, info, units)` — live race-state infobox |
| `script.js` | Top-level orchestration — owns `data`, `tracks`, `alignment`, `displayMode` globals; drives the slider event loop; calls all other modules |

## Data Flow

1. User uploads a GPX file → `parseGPX` → appended to `data[]`.
2. `dataUpdated()` computes alignment, then calls `displayTracks()`.
3. `displayTracks()` clones `data` into `tracks[]`, applies normalization/harmonization, sets `point.displayDistance` on every point, redraws the map and legend, and calls `updateMarkers()`.
4. `updateMarkers()` fires on every slider tick: repositions map markers, redraws graphs, and re-renders the infobox.

## Page Layout

The top-level DOM order is: logo/auth-bar → `#add-track` → `#map-container` → slider → graphs → footer.

`#add-track` is a full-width collapsible `<details>` card sitting in document flow directly above the map. When expanded, its three method-groups (file upload, URL, saved tracks) render on a single horizontal row; on mobile (≤767px) they stack vertically. The saved-tracks group carries `class="js-needs-login"` and is toggled by `updateAuthUI()` based on auth state.

The map container uses `position: relative`. Overlaid UI sits in `#overlay-right` — a column absolutely positioned at `top: 10px; right: 10px; bottom: 10px; z-index: 1000; overflow-y: auto`. The `bottom: 10px` constraint prevents the overlay from extending past the map container, so it can never visually cover the time slider below the map. It contains:
- `#display-mode` — toggle between full and overlapping regions (visible when aligned)
- `#legend-container` — per-track color swatches, rename, delete, download (font-size: 13px)
- `#infobox-container` — live leader/follower stats (hidden when no tracks loaded)

All overlay elements are styled as cards with white backgrounds and subtle shadows. On mobile, they reflow below the map (`position: static`).

### Infobox Row Layouts

`renderInfobox` uses two row patterns:
- **Horizontal** (`.infobox-row`): used for the "Elapsed" row, where label and value are short and fixed.
- **Stacked** (`.infobox-stacked-row`): used for per-track rows (leader, behind, fallback). The track-colored label takes its own line; the metric value appears below it. This prevents the `+0:00 · -0.00 mi` value from wrapping mid-unit.

## Narrow Window

A brush affordance on the elevation graph lets the user narrow the view to a selected distance range. The active window is stored in `narrowWindow: { d1, d2 }` (raw `displayDistance` meters) in `script.js`. When non-null, `displayTracks()` applies `applyNarrow()` to produce a sliced `tracks` array from `fullTracks`, then re-renders the map, graphs, slider, and infobox using only the window's data. A banner above the map shows the formatted range and a "Widen" button that clears `narrowWindow`. Narrowing is reset when the track set changes (`dataUpdated`), display mode switches, or the URL hash changes. The window is ephemeral — it is not persisted across reloads.

The brush (`d3.brushX`) is attached to the elevation graph SVG after each `Plot.plot()` call via `attachElevationBrush()` in `graphs.js`. Plot's `chart.scale("x")` provides the pixel↔domain mapping; `Units().distanceFromDisplayed()` converts the selected displayed units (km/mi) back to raw meters for storage in `narrowWindow`.

## Track Distance Fields

Each processed track point has:
- `distance` — raw cumulative GPS distance in meters
- `normalizedDistance` — rescaled distance when tracks are normalized to the same mean length
- `displayDistance` — the field actually rendered; equals `normalizedDistance ?? distance`

`computeLeaderInfo` and `getValueAtPosition` operate on `displayDistance` so they automatically honor whichever display mode is active.

## Backend

Cloudflare Worker (`worker/src/`): handles auth, GPX storage, avatar images, track sharing, and settings. The frontend accesses it via `fetch` calls in `storage.js`.
