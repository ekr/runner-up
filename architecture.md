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

## Map Overlay Layout

The map container uses `position: relative`. Overlaid UI sits in `#overlay-right` — a column absolutely positioned at `top: 10px; right: 10px; z-index: 1000`. It contains:
- `#add-track` — collapsible `<details>` card for uploading/adding tracks
- `#display-mode` — toggle between full and overlapping regions (visible when aligned)
- `#legend-container` — per-track color swatches, rename, delete, download
- `#infobox-container` — live leader/follower stats (hidden when no tracks loaded)

All overlay elements are styled as cards with white backgrounds and subtle shadows. On mobile, they reflow below the map.

## Track Distance Fields

Each processed track point has:
- `distance` — raw cumulative GPS distance in meters
- `normalizedDistance` — rescaled distance when tracks are normalized to the same mean length
- `displayDistance` — the field actually rendered; equals `normalizedDistance ?? distance`

`computeLeaderInfo` and `getValueAtPosition` operate on `displayDistance` so they automatically honor whichever display mode is active.

## Backend

Cloudflare Worker (`worker/src/`): handles auth, GPX storage, avatar images, track sharing, and settings. The frontend accesses it via `fetch` calls in `storage.js`.
