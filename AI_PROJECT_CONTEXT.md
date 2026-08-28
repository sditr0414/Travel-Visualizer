# AI Project Context — Travel Camera Visualizer

> **Purpose**: continuity handoff for AI-assisted development. Read this file completely, then fetch the latest `main` and verify current code before editing.
>
> **Authority rule**: current repository code is more authoritative than this document if they diverge. Update this file in the same task when architecture, active wrappers, media pipeline, timing semantics, route/photo UX invariants, GPS/place resolution, runtime commands, CI, or major technical debt changes.

## 1. Repository and workflow

- Repository: `sditr0414/travel-camera-visualizer`
- Default branch: `main`
- Private repository because Timeline fixtures contain location history.
- Runtime: Node.js `>=20`, browser ES modules, MapLibre GL JS.
- Normal workflow has been direct updates to `main`.
- Before editing an existing file, fetch latest file content and blob SHA.
- Never assume a SHA in this document is current.
- Verify GitHub Actions after code changes. Do not report CI as passed until the final relevant workflow has `conclusion: success`.
- Prefer structural fixes over compatibility shims.
- Preserve existing UX invariants unless the user explicitly changes them.

Historical validated reference points only:

```text
3b69e7d4b6fbff21dccdaeca6ca7cb9a71550c46  code audit
199cdc5d9c679ff8a25e7a5b51630967a833b2e5  README sync
```

Always fetch latest `main` before continuing.

---

## 2. Product goal

Travel Camera Visualizer converts Google Maps Timeline JSON into cinematic travel playback:

1. parse Timeline movements
2. infer/correct mobility classes
3. allocate route playback time
4. plan smooth map cameras
5. render route playback at 60 FPS
6. optionally match photos/videos by capture time and GPS
7. pause at matched media locations, show media, then resume travel

Primary validation trip is Japan/Korea around `2026-03-17 ~ 2026-03-31`.

Browser-first architecture. Capacitor/native device-media integration is a future option, not the current runtime.

---

## 3. User-facing modes and photo split UX

### Route mode

`JourneyMode.ROUTE` / `발자취`

- full map route playback
- movement, speed, travel date, route head/trail
- final OUTRO shows full journey route

### Photo journey mode

`JourneyMode.PHOTOS` / `사진 여정`

Desktop is a persistent horizontal map/media split, default about `60% / 40%`.
Mobile is a persistent vertical map/media split, default about `52% / 48%`.

Important invariants:

- media rail remains present throughout TRAVEL in photo mode
- photo appearance must not cause repeated full-map → split-map jumps
- map camera is biased to the current map pane for the entire photo-mode TRAVEL section
- user can drag the separator to resize map/media space
- desktop separator resizes horizontally; mobile vertically
- split ratio is clamped so both panes remain usable
- separator supports keyboard adjustment
- map camera target follows the resized map pane rather than a fixed 60/40 or 52/48 center
- separator has no decorative center grabber; the line/hit area is enough
- separator is hidden while the settings workspace is open
- player controls and travel HUD remain in the map pane
- photo place/capture time live below the media instead of covering it
- while traveling between media stops, the media pane shows the current mobility pictogram/label (`WALK`, `BIKE`, transit, road, rail, ferry, flight)
- media pictogram disappears while an actual photo/video beat is shown
- final `OUTRO` returns to full-map overview

Main files:

- `src/route-player-split.js`
- `src/photo-split-layout.js`
- `src/photo-split-resizer.js`
- `src/photo-journey-v4.js`
- `media-journey.css`

---

## 4. Playback duration semantics

Two different duration concepts must remain separate.

Configured `#videoDuration` is the target **route movement playback duration** and is passed to `planPlayback` as `targetTotalSeconds`.

Actual final playback is:

```text
configured route playback
+ photo hold time
+ video hold/play time
```

After media-stop insertion, `plan.durationSec` is the actual final player duration.
The player clock shows current time / actual total time.

Settings reanalysis invariant:

- `설정 적용 · 경로 다시 분석` must not reset the configured route duration to minimum
- `src/main.js` uses `analyzeParsedTimeline(sourceLabel, { preserveVideoDuration })`
- settings apply uses `preserveVideoDuration: true`
- previous duration is clamped into new min/max
- do not restore the old `HTMLInputElement.prototype.value` interception shim

---

## 5. Timeline and camera architecture

Primary Timeline/camera files:

- `src/timeline-parser.js`
- `src/mobility.js`
- `src/camera-planner.js`
- `src/playback-pacing.js`
- `src/camera-modes.js`
- `src/camera-modes-auto.js`
- `src/route-player.js`
- `src/route-player-split.js`
- `src/main.js`

Timeline source can be bundled/default or user-selected JSON.
Default dates are currently `2026-03-17` to `2026-03-31`.

Mobility classes include:

- `WALK`
- `BIKE`
- `URBAN_TRANSIT`
- `ROAD`
- `FAST_GROUND`
- `FERRY`
- `FLIGHT`
- `UNKNOWN`

Browser import mapping redirects:

```text
/src/camera-modes.js -> /src/camera-modes-auto.js
/src/route-player.js  -> /src/route-player-split.js
```

Camera rules:

- `AUTO` is normal strategy
- local travel is generally framed closer than old core defaults
- flights retain wide/overview behavior
- final route overview is preserved
- photo mode keeps camera framing inside the current map pane throughout TRAVEL
- `src/photo-split-layout.js` owns active split defaults/limits and pane target
- `src/photo-split-resizer.js` updates ratio and triggers immediate camera reframe
- media holds retain a visible approach trail instead of collapsing to stationary points

Do not revert photo-mode travel to full-screen framing between every media stop.

---

## 6. Device gallery / local media architecture

Dedicated local pipeline:

```text
#photoGalleryInput
  -> src/gallery-photo-ui.js
  -> src/local-media-loader.js
  -> src/local-media-worker.js (when available)
  -> src/image-metadata.js
  -> src/media-library-state.js (LOCAL_GALLERY)
  -> src/main.js rebuildPlan()
  -> src/photo-journey-v4.js
  -> Timeline/media matching
```

Active media source is centralized in `src/media-library-state.js`.
`src/main.js` reads that shared state when rebuilding.
Do not restore wrapper-local `localGalleryMedia` preference state or `travel-camera:local-media-ready` source override behavior.

Historical failure — never reintroduce:

```text
device gallery -> DataTransfer -> hidden Takeout folder input
```

Local metadata priority:

1. embedded JPEG EXIF capture metadata
2. common camera filename timestamp
3. `File.lastModified`

`src/image-metadata.js` bounds JPEG EXIF reads rather than loading entire files.
`src/local-media-loader.js` prefers a module Worker; fallback batches must yield to the browser.

Recognized media includes JPEG/JPG, PNG, WebP, GIF, AVIF, HEIC/HEIF, MP4/M4V/MOV/WebM.
HEIC selection does not guarantee browser rendering or embedded metadata parsing.

Memory invariant: do not create Blob/Object URLs for the whole gallery. Create URLs only for media actually rendered and revoke them on scene changes.

---

## 7. Google Photos and Takeout

### Google Photos Picker

- explicit Picker approval only
- public OAuth client ID only; never expose a client secret
- temporary media URLs
- preview media must not be persisted to IndexedDB or uploaded to project server
- Picker GPS is not reliable enough here; Timeline-time positioning is used
- downloaded Picker previews can enter the Takeout-compatible metadata loader
- active source is `GOOGLE_PHOTOS_PICKER`

### Takeout

- folder can include media + JSON sidecars
- sidecar capture time/GPS preferred when present
- active source is `GOOGLE_PHOTOS_TAKEOUT`

Selecting a new source replaces previous active media through `src/media-library-state.js`.

---

## 8. Photo ↔ Timeline matching and media holds

Core matching is in `src/photo-journey.js` and wrapper layers.

Important behavior:

- media needs usable `takenMs`
- clearly out-of-trip media is rejected
- capture time maps to nearest Timeline segment/frame
- GPS is used only when plausibly close to Timeline position; core safety threshold is about `80 km`
- otherwise Timeline-derived position is used
- nearby media are grouped into beats
- beat count is bounded; current core cap is `48`
- beats are distributed across route playback

Do not place clearly out-of-range photos arbitrarily just to make them appear.

`src/photo-journey-v2.js` inserts stationary media frames:

```text
travel -> media hold -> travel resumes
```

Hold frames include fields such as `mediaHold`, `mediaBeatId`, `mediaItemIndex`, `mediaItemProgress`, `mediaAnchor`, `mediaTakenMs`.
Expanded plans update `frames`, `durationSec`, `travelDurationSec`, `outroStartSec`, `mediaStopDurationSec`.

---

## 9. Local video rendering

`File.type` is not authoritative for local videos. MP4/MOV can arrive with empty/generic MIME.
Use normalized `mediaType` / extension semantics.

Real local video nodes are muted, `defaultMuted`, `playsInline`, and use `playsinline` for autoplay compatibility.
PLAY mode retries playback around `loadeddata` / `canplay`.

Google Photos can represent a logical video with a downloaded still thumbnail. Internal Google video-thumbnail sentinel files must remain `<img>`, not `<video>`.

---

## 10. GPS place-name resolution

Active implementation: `src/photo-journey-v4.js`.

For GPS-based media, prefer administrative geography over nearby POIs.
When city-level information is available, show **all usable city-and-below units** exposed by map data in hierarchical order:

```text
city/town/municipality
-> district/ward/borough
-> neighborhood/suburb/quarter/locality
```

Example target shapes:

```text
오사카시 · 주오구 · 신사이바시
후쿠오카시 · 하카타구 · (available lower locality)
```

If city-level data is unavailable, region/prefecture may be used as fallback, followed by any usable lower administrative levels.
Names prefer Korean map labels when available, then other names.

The resolver checks rendered features and relevant source layers. Polygon/MultiPolygon administrative features use a bounded representative position for distance ranking.

Limitation: this is not a true reverse-geocoder. Only levels actually exposed by the active map/style/source can be shown. Do not promise every coordinate will resolve to city + ward + neighborhood.

---

## 11. Active photo wrapper chain

Import map:

```text
/src/photo-journey.js -> /src/photo-journey-v4.js
```

Active chain:

```text
photo-journey-v4.js
  -> photo-journey-v3.js
  -> photo-journey-v2.js
  -> photo-journey.js?core=1
```

Responsibilities:

- core `photo-journey.js`: matching/grouping/placement/base controller
- v2: media/video support, hold insertion, per-item duration
- v3: richer import/progress/diagnostics, embedded local metadata fallback
- v4: robust local video rendering, detailed administrative GPS labels, media-rail movement pictograms, local-ready status via shared media-library state

`?core=1` is intentional to avoid import-map recursion.

Technical debt: wrapper stack is deep. Do not casually add v5/v6. Consolidate only as a dedicated refactor with regression tests.

---

## 12. Important files

Entry/UI:

- `index.html`
- `styles.css`
- `mode-ui.css`
- `media-journey.css`

Main orchestration:

- `src/main.js`

Timeline/camera:

- `src/timeline-parser.js`
- `src/mobility.js`
- `src/camera-planner.js`
- `src/playback-pacing.js`
- `src/camera-modes.js`
- `src/camera-modes-auto.js`
- `src/route-player.js`
- `src/route-player-split.js`
- `src/photo-split-layout.js`
- `src/photo-split-resizer.js`

Media:

- `src/media-library-state.js`
- `src/photo-journey.js`
- `src/photo-journey-v2.js`
- `src/photo-journey-v3.js`
- `src/photo-journey-v4.js`
- `src/gallery-photo-ui.js`
- `src/local-media-loader.js`
- `src/local-media-worker.js`
- `src/image-metadata.js`
- `src/photo-progress-ui.js`
- `src/photo-media-settings-ui.js`
- `src/google-photos-picker.js`
- `src/google-photos-ui.js`

Server/map/fixture:

- `server.mjs`
- `src/local-map.js`
- `src/bundled-timeline.js`
- `scripts/setup-local-map.mjs`
- `scripts/setup-timeline.mjs`
- `data/`
- `maps/`

---

## 13. Settings and progress UX invariants

Settings workspace:

- open settings must remain viewport-safe and vertically scrollable
- desktop can use multiple columns
- short desktop windows reduce column density
- mobile behaves like a near-full-width/bottom-sheet workspace
- do not introduce fixed heights that make lower controls unreachable

Large media imports must show real processing progress rather than appearing frozen.
Conceptual phases: `PREPARE`, `METADATA`, `MATCH`, `BUILD`, `COMPLETE`, `ERROR`.

Performance priorities:

1. reduce file reads
2. keep EXIF work off main UI thread
3. avoid eager decoding/object URLs
4. yield during fallback batches
5. show accurate progress/counts

---

## 14. Map, server, security, privacy

Preferred local PMTiles hybrid:

```text
zoom 0 ~ 5  -> maps/world-z5.pmtiles
zoom 6 ~ 14 -> maps/korea-japan-z14.pmtiles
```

Fallback online basemap is supported. Local map files are not committed due size. Server supports PMTiles HTTP Range requests.

`server.mjs` exposes only `GOOGLE_PHOTOS_CLIENT_ID` to browser config. Never expose a client secret.

Privacy:

- keep repository private unless location-data disclosure is intentional
- device photos/videos stay browser-local
- do not upload local media to project server as an optimization shortcut
- do not add persistent browser media caching without explicit user request and privacy review

---

## 15. Known failed patterns — do not repeat

1. Device gallery through `DataTransfer` into Takeout input.
2. Eager Blob URLs for entire gallery.
3. Bulk EXIF work on main thread.
4. Full-map ↔ split-map transition for every photo.
5. MIME-only local video detection.
6. Resetting `영상 길이` on every settings apply.
7. Adding another photo wrapper for each small feature.
8. Wrapper-local media source preference/override state.
9. Hard-coding photo split camera/layout to only 60/40 or 52/48.

---

## 16. Known technical debt / limitations

### P1 — Photo wrapper consolidation

v2/v3/v4 is functional but costly to reason about. Consolidate in a dedicated refactor while preserving tests/import behavior.

### P2 — Browser reverse geocoding is approximate

Detailed administrative labels still depend on map features; lower city subdivisions may be unavailable. A dedicated reverse-geocoder/native geocoder would be more deterministic but has network/API/privacy costs.

### P2 — HEIC metadata/rendering

Selection is supported but browser decoding varies and custom embedded metadata parsing is JPEG-centric.

### P2 — Very large local galleries remain browser-limited

Workers help, but browser file I/O, decode, and memory limits remain.

### P3 — Playback clock injected by JS

`#playbackTime` is currently created by `src/photo-media-settings-ui.js` rather than static HTML.

### P3 — Some user-facing copy is duplicated

Photo journey help strings exist in more than one UI module.

---

## 17. Recommended refactor priority

```text
P1. Keep current route/photo/video UX stable
P1. Consolidate photo-journey v2/v3/v4 in a dedicated refactor
P2. Add local-media performance instrumentation
P2. Improve HEIC strategy if real files require it
P2. Evaluate deterministic reverse geocoding only if map-feature labels are insufficient
P3. Consider Capacitor NativePhotoSource for packaged app
```

If moving toward Capacitor, retain current JS map/camera/playback layer and replace device-media input first. A full Swift/Kotlin rewrite is not currently justified.

---

## 18. Tests and CI

Local:

```bash
npm test
```

GitHub Actions performs:

1. `npm ci`
2. JavaScript syntax checks (`node --check`)
3. bundled Timeline/local-server startup checks
4. static/API endpoint checks
5. full Node test suite

Relevant regression tests include:

- `tests/camera-auto-closer.test.js`
- `tests/camera-modes.test.js`
- `tests/camera-quality.test.js`
- `tests/core.test.js`
- `tests/google-photos-picker.test.js`
- `tests/image-metadata.test.js`
- `tests/media-library-state.test.js`
- `tests/mobility-identity.test.js`
- `tests/photo-administrative-place.test.js`
- `tests/photo-journey.test.js`
- `tests/photo-media-journey.test.js`
- `tests/photo-split-layout.test.js`
- `tests/playback-pacing.test.js`
- `tests/route-player-split.test.js`
- `tests/route-player.test.js`

Add focused tests for testable regressions. Never claim CI passed until final job conclusion is success.

---

## 19. Local development

Initial setup:

```powershell
git pull origin main
npm ci
npm run map:setup
npm start
```

When dependencies/maps are ready:

```powershell
git pull origin main
npm start
```

Default URL: `http://localhost:5173`.
After browser module/CSS changes, hard refresh (`Ctrl+F5`) is often useful.

---

## 20. Bug triage shortcuts

Photos counted but never appear:

1. imported count
2. matched beat count
3. `takenMs` vs selected Timeline range
4. `positionSource` / GPS plausibility
5. active `MediaLibrarySource`
6. renderer/object URL errors

Local gallery slow/hanging:

1. Worker created
2. EXIF reads remain bounded
3. no eager Blob URLs
4. fallback batches yield
5. unsupported/large formats such as HEIC

Video counted but not playing:

1. `mediaType === 'video'`
2. no MIME-only requirement
3. Google thumbnail sentinel not treated as real video
4. PLAY mode active
5. muted/playsInline
6. player synchronization

Photo layout/split issues:

1. `stage.photo-journey-layout-active` remains through TRAVEL
2. `route-player-split.js` remains import-map target
3. media rail persists
4. `photo-split-layout.js` owns active clamped ratio
5. `photo-split-resizer.js` updates CSS vars and emits split-change event
6. camera is biased to current resized pane
7. separator is hidden while settings are open

GPS place label too coarse:

1. inspect city/district/locality features exposed near photo anchor
2. verify `administrativeFeatureLevel` classification
3. verify representative feature position/distance filtering
4. remember missing map levels cannot be synthesized by this resolver

---

## 21. New AI session procedure

1. Read this file completely.
2. Fetch latest `main` HEAD.
3. Fetch exact relevant files and current blob SHAs.
4. Treat current code as authoritative if docs differ.
5. Identify affected invariant.
6. Prefer minimal structural fix over another workaround layer.
7. Preserve route-only vs actual-playback duration semantics.
8. Preserve dedicated local-gallery pipeline and shared media source state.
9. Preserve persistent/resizable photo split unless explicitly changed.
10. Preserve media-rail movement pictograms between photo/video beats unless explicitly changed.
11. Preserve city-and-below GPS administrative labels when map data exposes them.
12. Add/update focused tests.
13. Verify GitHub Actions before claiming success.
14. Update this file in the same task when maintained architecture/invariants change.

Useful new-chat instruction:

```text
GitHub의 AI_PROJECT_CONTEXT.md를 먼저 읽고 최신 main을 확인한 뒤 이어서 작업하자.
```
