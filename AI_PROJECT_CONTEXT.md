# AI Project Context — Travel Camera Visualizer

> **Purpose**: This file is the continuity handoff for AI-assisted development of this repository. A new AI session should read this file first, then fetch the latest `main` branch and verify the code before making changes.
>
> **Authority rule**: the latest repository code is always more authoritative than this document if they diverge. Any structural change to the project must update this file in the same task.

## 1. Repository and working conventions

- Repository: `sditr0414/travel-camera-visualizer`
- Default branch: `main`
- Repository is currently private because Timeline fixtures contain location history.
- Runtime: Node.js `>=20`, browser ES modules, MapLibre GL JS.
- Normal project workflow has been direct updates to `main`.
- Before editing an existing file, fetch the latest file content and blob SHA.
- Do not assume a SHA in this document is still current.
- After code changes, verify GitHub Actions. Do not report CI as passed while it is queued or running.
- Prefer structural fixes over accumulating compatibility shims.
- Preserve existing UX invariants unless the user explicitly asks to change them.

### Baseline at the time of this handoff

The last code-audit commit validated before this document was written:

```text
3b69e7d4b6fbff21dccdaeca6ca7cb9a71550c46
```

That commit passed syntax checks, bundled Timeline startup checks, and unit tests. README was then synchronized in:

```text
199cdc5d9c679ff8a25e7a5b51630967a833b2e5
```

These SHAs are reference points only. Always fetch the latest `main` before continuing.

---

## 2. Product goal

Travel Camera Visualizer converts Google Maps Timeline JSON into a cinematic travel playback:

1. Parse Timeline movements.
2. Infer/correct mobility classes when needed.
3. Allocate route playback time.
4. Plan smooth map camera trajectories.
5. Render a moving route at 60 FPS.
6. Optionally match trip photos/videos by capture time and GPS.
7. Pause the route at matched media locations and show the media before continuing.

The current primary validation trip is Japan/Korea travel around:

```text
2026-03-17 ~ 2026-03-31
```

The project is currently browser-first. A Capacitor/native wrapper is a future option, especially for large device photo libraries, but is not the current runtime architecture.

---

## 3. Current user-facing modes

### Route mode

`JourneyMode.ROUTE` / UI label `발자취`

- Full map is used for the route playback.
- Current movement, speed, travel date, route head and trail are shown.
- The last outro shows the full journey route.

### Photo journey mode

`JourneyMode.PHOTOS` / UI label `사진 여정`

The current UX intentionally avoids repeatedly switching between a full-screen map and a media split.

Desktop layout during the travel portion:

```text
┌──────────────────────────────┬────────────────────┐
│ date / movement HUD          │                    │
│                              │     photo/video    │
│        map + route           │                    │
│                              ├────────────────────┤
│ playback controls            │ place + taken time │
└──────────────────────────────┴────────────────────┘
           ~60%                           ~40%
```

Mobile uses a vertical split with the map above and media below.

Important invariants:

- The media rail remains present throughout the travel section in photo mode.
- A photo appearing should not trigger a large full-map → split-map layout jump.
- Map camera framing is biased toward the map pane for the entire photo-mode travel section.
- The final `OUTRO` returns to a full-map overview.
- Player controls and the general travel HUD stay in the map pane, not over the photo.
- Photo place/capture time are shown in a dedicated information area below the media, not as a large overlay covering the image.

Main implementation files:

- `src/route-player-split.js`
- `media-journey.css`

---

## 4. Playback duration semantics

There are two different duration concepts and they must not be conflated.

### Configured `영상 길이`

The range input `#videoDuration` is the target duration for **route movement playback**.

It is passed into `planPlayback` as:

```js
targetTotalSeconds: Number(videoDuration.value)
```

### Actual final player duration

Photo/video stops are inserted after the route plan is generated. Therefore:

```text
actual final playback
= configured route playback
+ photo hold time
+ video hold/play time
```

`plan.durationSec` after media-stop insertion is the actual final playback time.

The player dock displays:

```text
current time / actual total time
```

Example:

```text
2:14 / 7:38
```

This clock is currently created by `src/photo-media-settings-ui.js` and reads `seek.value` / `seek.max`.

### Settings reanalysis invariant

Pressing `설정 적용 · 경로 다시 분석` must **not** reset the user's configured route duration to the minimum.

As of the audit, this is handled directly in `src/main.js`:

- `analyzeParsedTimeline(sourceLabel, { preserveVideoDuration })`
- the settings button calls it with `preserveVideoDuration: true`
- the previous value is clamped into the newly calculated min/max range

Do not reintroduce the old `HTMLInputElement.prototype.value` interception shim.

---

## 5. Timeline architecture

Primary files:

- `src/timeline-parser.js`
- `src/mobility.js`
- `src/camera-planner.js`
- `src/camera-modes.js`
- `src/camera-modes-auto.js`
- `src/playback-pacing.js`
- `src/main.js`

Timeline source can come from:

1. bundled Timeline fixture / source selected by the local server
2. a user-selected JSON file

Default date inputs are currently:

```text
2026-03-17
2026-03-31
```

The browser analyzes `semanticSegments` rather than loading the entire large original Timeline object when a full fixture is available.

Mobility classes used by the UI include:

- `WALK`
- `BIKE`
- `URBAN_TRANSIT`
- `ROAD`
- `FAST_GROUND`
- `FERRY`
- `FLIGHT`
- `UNKNOWN`

The route planner can include inferred connection segments when raw Timeline movements contain gaps.

---

## 6. Camera architecture

Browser import mapping currently redirects camera mode imports:

```text
/src/camera-modes.js
→ /src/camera-modes-auto.js
```

The wrapper imports the core module with a query suffix so the import map does not recurse.

Important behavior:

- `AUTO` is the normal camera strategy.
- Local travel is generally framed slightly closer than the old core defaults.
- Flights preserve wide/overview behavior.
- The final route overview is preserved.
- In photo journey mode, `src/route-player-split.js` keeps travel camera framing inside the map pane instead of changing framing only when a photo appears.
- Media holds keep a stable approach trail visible instead of collapsing the trail to repeated stationary points.

Do not change photo-mode travel back to full-screen framing between every media stop unless the user explicitly requests that UX.

---

## 7. Device gallery / local media architecture

The device gallery path was deliberately separated from Google Photos Takeout.

### Current pipeline

```text
#photoGalleryInput
    ↓
src/gallery-photo-ui.js
    ↓
src/local-media-loader.js
    ↓
src/local-media-worker.js   (when Worker is available)
    ↓
src/image-metadata.js
    ↓
src/media-library-state.js  (MediaLibrarySource.LOCAL_GALLERY)
    ↓
src/main.js rebuildPlan()
    ↓
src/photo-journey-v4.js
    ↓
Timeline/media beat matching
```

The active media collection is represented by one shared state object in `src/media-library-state.js`. `src/main.js` reads that state when rebuilding a photo journey. The local gallery no longer sends a separate `travel-camera:local-media-ready` event to make `photo-journey-v4.js` override `main.js` state.

### Important historical failure

An older implementation did this:

```text
device gallery
→ DataTransfer
→ hidden Takeout folder input
→ Takeout loader
```

That design caused browser compatibility problems, UI freezes, and source-state confusion.

**Do not reintroduce the DataTransfer → Takeout bridge.**

### Local metadata priority

For supported local files:

1. embedded JPEG EXIF capture metadata
2. timestamp parsed from common camera filename patterns
3. `File.lastModified`

`src/image-metadata.js` parses JPEG EXIF including capture time and GPS. It reads only an initial bounded section of the JPEG rather than loading the entire file for metadata inspection.

### Worker behavior

`src/local-media-loader.js` prefers a module Web Worker for metadata extraction.

If Worker creation fails, it falls back to small batches and yields to the browser between batches.

The progress UI reports stages such as:

```text
파일 준비
메타데이터 분석
Timeline 매칭
사진 여정 구성
```

### Media type support

Current local selection recognizes common:

- JPEG/JPG
- PNG
- WebP
- GIF
- AVIF
- HEIC/HEIF
- MP4/M4V/MOV/WebM

Caveat: accepting HEIC/HEIF does not guarantee the current browser can decode/render HEIC. The custom EXIF parser is JPEG-focused, so HEIC metadata may fall back to filename or file time unless metadata arrives through another source.

### Memory rule

Do not eagerly generate Blob/Object URLs for every selected photo during import. Create object URLs only for media that is actually being rendered, and revoke them when the media scene changes.

---

## 8. Google Photos and Takeout

There are separate concepts:

### Google Photos Picker

- Auxiliary web input.
- Requires explicit user selection/approval in the Picker.
- Uses the Picker readonly media scope.
- The browser receives a public OAuth client ID only.
- Never put a client secret in browser code or the repository.
- Picker media URLs are temporary.
- Google Photos preview media must not be persisted to IndexedDB or uploaded to this project server.
- Picker does not provide reliable photo GPS for this use case, so Timeline-time positioning is used.
- Downloaded Picker previews still enter the existing Takeout-compatible metadata loader, but the active state is explicitly recorded as `MediaLibrarySource.GOOGLE_PHOTOS_PICKER`.

### Google Photos Takeout

- Folder import can include media plus JSON sidecars.
- Sidecar capture time and GPS are preferred when available.
- Files without sidecar metadata fall back to embedded metadata / file timing according to the active loader.
- Import UI distinguishes photo and video counts.
- The active state is explicitly recorded as `MediaLibrarySource.GOOGLE_PHOTOS_TAKEOUT`.

Selecting a new media source replaces the previous active media library through `src/media-library-state.js`; source preference must not be reimplemented as hidden wrapper-local state.

---

## 9. Photo ↔ Timeline matching

Core matching lives primarily in `src/photo-journey.js` and is extended by the wrapper chain.

Important behavior:

- Media must have a usable `takenMs`.
- Media outside the trip range by more than the current tolerance is rejected.
- A media capture time is mapped into the closest Timeline segment/frame.
- If a photo has GPS, GPS is used only when it is plausibly close to the Timeline position. The current core safety threshold is approximately `80 km`.
- Otherwise the Timeline-derived position is used.
- Nearby media are grouped into media beats.
- The number of beats is bounded; the current core cap is `48`.
- Media beats are spread across the route video rather than simply using every selected file.

Do not silently place clearly out-of-range photos at arbitrary trip positions just to make them appear.

---

## 10. Photo/video stop insertion

`src/photo-journey-v2.js` expands the route plan with stationary media frames.

Conceptually:

```text
travel frames
→ media hold frames at capture location
→ travel resumes
```

Each hold frame includes fields such as:

- `mediaHold`
- `mediaBeatId`
- `mediaItemIndex`
- `mediaItemProgress`
- `mediaAnchor`
- `mediaTakenMs`

The expanded plan updates:

- `frames`
- `durationSec`
- `travelDurationSec`
- `outroStartSec`
- `mediaStopDurationSec`

This is why actual playback time can exceed the configured route duration.

---

## 11. Local video rendering

A critical compatibility rule is that `File.type` is **not authoritative** for local videos.

Some local file pickers return an empty/generic MIME type for MP4/MOV. The current active renderer uses the normalized `mediaType` classification and creates a real `<video>` element even if MIME is empty.

For autoplay compatibility the video is:

- muted
- `defaultMuted`
- `playsInline`
- given `playsinline`

In `PLAY` mode playback is retried around `loadeddata` / `canplay`.

Google Photos can represent a video with a downloaded still thumbnail whose logical `mediaType` is still `video`. Files prefixed with the internal Google video-thumbnail marker must remain rendered as `<img>`, not `<video>`.

Do not revert to MIME-only `<video>` detection.

---

## 12. GPS place-name resolution

The media info panel prefers administrative geography over nearby POIs when the media beat is GPS-based.

Active implementation: `src/photo-journey-v4.js`.

Desired label shape:

```text
오사카시 · 주오구
후쿠오카시 · 하카타구
```

Resolution priority is roughly:

1. city/town/municipality/locality
2. district/ward/borough/suburb
3. region/prefecture fallback
4. core map-feature place-name fallback

Name fields prefer Korean labels when available, then other map names.

The resolver checks both rendered features near the GPS anchor and relevant source layers. Polygon/MultiPolygon administrative features are reduced to a bounded representative position for distance ranking, so unrelated loaded administrative polygons are less likely to win simply because they have no point geometry.

### Limitation

This is **not a true reverse-geocoding service**. It depends on the currently available map/style/source data. If the map data does not expose district/ward information, the UI may only show the city or a fallback map label.

Do not claim that every GPS coordinate can always resolve to a city+district.

---

## 13. Active module wrapper chain

The browser currently uses an import map in `index.html`:

```text
/src/photo-journey.js
→ /src/photo-journey-v4.js

/src/camera-modes.js
→ /src/camera-modes-auto.js

/src/route-player.js
→ /src/route-player-split.js
```

### Photo journey chain

The active photo implementation is layered:

```text
photo-journey-v4.js
  ↓
photo-journey-v3.js
  ↓
photo-journey-v2.js
  ↓
photo-journey.js?core=1
```

Approximate responsibility split:

- `photo-journey.js`: core photo-to-Timeline matching, grouping, placement primitives, base controller
- `photo-journey-v2.js`: video/media support, media hold insertion, per-item duration behavior
- `photo-journey-v3.js`: richer import/progress/diagnostic behavior and embedded local metadata fallback
- `photo-journey-v4.js`: robust local video rendering, administrative GPS place labels, and local-ready status reporting against the shared media-library state

The `?core=1` pattern is intentional: exact import-map mappings should not remap the core import and recurse.

### Technical debt

This wrapper stack is now deep. It should eventually be consolidated, but **do not casually add `v5`, `v6`, etc.** for every feature. Prefer editing the current active wrapper or deliberately consolidating the chain with regression tests.

Do not aggressively collapse the entire chain during an unrelated UX fix; it touches media timing, import behavior, renderer behavior and matching simultaneously.

---

## 14. Important files

### Entry/UI

- `index.html` — DOM structure, controls, import map, script order
- `styles.css` — base application/map/player styles
- `mode-ui.css` — mode controls and responsive/scroll-safe settings workspace
- `media-journey.css` — media rail, photo/video layout, player placement in photo mode, animations

### Main orchestration

- `src/main.js` — Timeline load/analyze, plan rebuild, route player construction, UI state, duration range

### Timeline and camera

- `src/timeline-parser.js`
- `src/mobility.js`
- `src/camera-planner.js`
- `src/playback-pacing.js`
- `src/camera-modes.js`
- `src/camera-modes-auto.js`
- `src/route-player.js`
- `src/route-player-split.js`

### Media

- `src/media-library-state.js` — single active media source + media collection state
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

### Server/map/fixture

- `server.mjs`
- `src/local-map.js`
- `src/bundled-timeline.js`
- `scripts/setup-local-map.mjs`
- `scripts/setup-timeline.mjs`
- `data/`
- `maps/`

---

## 15. Settings UI invariants

The settings panel previously clipped badly on short/small displays. Current CSS treats an open settings panel as a viewport-safe workspace.

Requirements to preserve:

- Vertical scrolling must remain available when content exceeds viewport height.
- Desktop can use multiple columns.
- Short desktop windows reduce column density.
- Mobile settings use a near-full-width/bottom-sheet-like layout.
- Do not rely on content fitting inside the old narrow right rail.
- Avoid placing fixed-height sections that can make lower controls unreachable.

`mode-ui.css` contains the main responsive overrides.

---

## 16. Media import progress UX

Large local photo selections can take significant time even with a Worker. The app must not look frozen.

The progress UI should expose real processing phases and counts, not only an indeterminate spinner.

Current conceptual phases:

```text
PREPARE
METADATA
MATCH
BUILD
COMPLETE
ERROR
```

Show photo/video counts separately where possible.

Performance work should prioritize:

1. reducing file reads
2. keeping EXIF parsing off the main UI thread
3. avoiding eager decoding/object URLs
4. yielding during fallback batches
5. showing accurate progress

---

## 17. Map architecture

The preferred local map is a PMTiles hybrid:

```text
zoom 0 ~ 5   → maps/world-z5.pmtiles
zoom 6 ~ 14  → maps/korea-japan-z14.pmtiles
```

If local archives are unavailable, the app can fall back to an online basemap.

Local map files are intentionally not committed because of size.

The server supports HTTP Range Requests for PMTiles.

Map label handling tries to prefer Korean names where available and hides noisy POI/house-number layers in the online fallback path.

---

## 18. Server and OAuth security

`server.mjs` is a lightweight local static/API server.

Relevant rules:

- Exposes `GOOGLE_PHOTOS_CLIENT_ID` to the browser through the config endpoint.
- Does not require or expose a Google client secret.
- Serves local map/timeline resources.
- Includes path handling protections and PMTiles range support.

Do not add a client secret to `.env` code paths that are then serialized to browser responses.

---

## 19. Privacy constraints

The repository currently contains a compressed full Timeline fixture with location history.

- Keep the repo private unless location-data disclosure is explicitly intended.
- Device photos/videos are browser-local inputs.
- Do not upload local media to the project server as an optimization shortcut.
- Do not add persistent browser media caching unless the user explicitly asks for it and privacy implications are clear.

---

## 20. Known failed patterns — do not repeat

### 20.1 Device gallery through DataTransfer/Takeout input

Bad:

```text
gallery FileList
→ DataTransfer
→ hidden webkitdirectory Takeout input
```

Use the dedicated local-media path instead.

### 20.2 Eager Blob URLs for the whole gallery

Bad for large imports. Generate preview URLs only for media being displayed and revoke them.

### 20.3 Bulk EXIF work on the main thread

Use `local-media-worker.js`, with a yielding fallback only when necessary.

### 20.4 Full map ↔ split map on every photo

This was visually disruptive. Current photo journey keeps a persistent media rail and map-pane camera framing.

### 20.5 MIME-only video detection

Local MOV/MP4 can have blank MIME types. Use normalized `mediaType` / extension semantics.

### 20.6 Resetting `영상 길이` on every settings apply

`main.js` now preserves the configured route duration when reanalyzing settings. Do not restore the old value-property interception shim.

### 20.7 Adding another wrapper for every small feature

The photo journey already has v2/v3/v4 layers. Extend deliberately or consolidate with tests.

### 20.8 Wrapper-local media source override

Do not restore a second `localGalleryMedia`/preference state inside `photo-journey-v4.js` or a `travel-camera:local-media-ready` bridge. Media source selection belongs in `src/media-library-state.js`.

---

## 21. Known technical debt / limitations

### P1 — Photo wrapper consolidation

The v2/v3/v4 chain is functional but costly to reason about. A future focused refactor should merge responsibilities into a smaller number of modules while preserving all existing tests and import-map behavior.

### P2 — Browser reverse geocoding is approximate

Administrative labels are inferred from map features. A dedicated reverse-geocoder or native geocoder would be more deterministic, but adds network/API/privacy considerations.

### P2 — HEIC metadata/rendering

HEIC/HEIF can be selected, but browser decoding support varies and the custom embedded metadata parser is JPEG-centric.

### P2 — Large local galleries remain browser-limited

Workers prevent the UI from freezing as easily, but browser file I/O, decoding and memory constraints still exist for very large selections.

### P3 — Playback clock is injected by JS

`#playbackTime` is currently created by `photo-media-settings-ui.js` instead of being static in `index.html`. This is acceptable but could be simplified in a future UI cleanup.

### P3 — Some user-facing copy is duplicated

Photo journey help text exists in both `main.js` and `photo-media-settings-ui.js`. Future cleanup can centralize these strings.

---

## 22. Recommended refactor priority

Do not perform all of these at once. Recommended order:

```text
P1. Keep current route/photo/video UX stable
P1. Consolidate photo-journey v2/v3/v4 wrappers in a dedicated refactor
P2. Add performance instrumentation for local media imports
P2. Improve HEIC metadata/decoding strategy if required by real user files
P2. Evaluate a deterministic reverse-geocoder only if map-feature labels are insufficient
P3. Consider Capacitor NativePhotoSource for a packaged desktop/mobile app
```

If moving toward Capacitor, retain the current JS map/camera/playback layer and replace only the device-media input layer first. A full Swift/Kotlin rewrite is not currently justified.

---

## 23. Tests and CI

Run locally:

```bash
npm test
```

GitHub Actions also performs:

1. `npm ci`
2. JavaScript syntax checks (`node --check`)
3. bundled Timeline/local server startup checks
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
- `tests/playback-pacing.test.js`
- `tests/route-player-split.test.js`
- `tests/route-player.test.js`

When fixing a regression, add or update a focused test when the behavior is testable without a real browser.

Never state that CI passed unless the final relevant workflow job has `conclusion: success`.

---

## 24. Local development commands

Initial setup:

```powershell
git pull origin main
npm ci
npm run map:setup
npm start
```

When dependencies/maps are already prepared:

```powershell
git pull origin main
npm start
```

Default URL:

```text
http://localhost:5173
```

After browser-side module/CSS changes, a hard refresh (`Ctrl+F5`) is often useful. When new Worker/module files were added or server state changed, restarting `npm start` is safer.

---

## 25. Timeline fixture notes

The README currently documents the validated full Timeline fixture characteristics, including semantic segment count and source hash.

The fixture setup script can regenerate the compressed Timeline parts from an original `타임라인.json`.

The raw original Timeline JSON itself is intentionally ignored by Git; the compressed fixture is the repository artifact.

Do not expose full personal Timeline content in public documentation or logs.

---

## 26. What to inspect first when a new bug is reported

### Photos are counted but never appear

Check in this order:

1. imported media count
2. matched media beat count
3. parsed `takenMs` range vs selected Timeline range
4. `positionSource` / GPS plausibility
5. `src/media-library-state.js` active source (`LOCAL_GALLERY`, `GOOGLE_PHOTOS_PICKER`, or `GOOGLE_PHOTOS_TAKEOUT`)
6. renderer/object URL errors

### Local gallery hangs or is extremely slow

Check:

1. Worker creation succeeded
2. EXIF reads are still bounded
3. no eager Blob URLs were reintroduced
4. fallback batching yields to browser
5. unusually large/unsupported formats such as HEIC

### Video is counted but not playing

Check:

1. `mediaType === 'video'`
2. do not require MIME to start with `video/`
3. Google thumbnail sentinel is not being treated as real video
4. player is in `PLAY` mode
5. video is muted/playsInline for autoplay
6. play/pause synchronization with route player

### Photo-mode layout feels abrupt

Check:

1. `stage.photo-journey-layout-active` remains active for the whole TRAVEL section
2. `route-player-split.js` is the import-map target
3. media rail persists between media holds
4. map camera is pane-biased throughout photo-mode travel, not just at media holds

### Settings panel is clipped

Check `mode-ui.css` viewport-safe open-state rules before changing the base `.settings-shell` sizing.

---

## 27. New AI session procedure

A new AI session should follow this sequence:

1. Read `AI_PROJECT_CONTEXT.md` completely.
2. Fetch the latest `main` branch HEAD.
3. Fetch the exact files relevant to the user's request and their current blob SHAs.
4. Treat current code as authoritative if it differs from this document.
5. Identify which existing invariant the requested change affects.
6. Prefer a minimal structural fix over an additional workaround layer.
7. Preserve route-only vs actual-playback duration semantics.
8. Preserve the dedicated local-gallery pipeline and shared `media-library-state.js` source state.
9. Preserve persistent photo-mode map/media layout unless explicitly asked otherwise.
10. Add/update regression tests where practical.
11. Verify GitHub Actions before claiming success.
12. If the architecture, active wrappers, media pipeline, commands, invariants or technical debt changed, update this document in the same task.

A useful first message in a new chat is:

```text
GitHub의 AI_PROJECT_CONTEXT.md를 먼저 읽고 최신 main을 확인한 뒤 이어서 작업하자.
```

---

## 28. Maintenance rule for this document

Update this file when any of the following change:

- active import-map targets
- photo journey wrapper structure
- local media import architecture
- photo/video timing semantics
- route/photo layout invariants
- GPS/place resolution strategy
- map/runtime setup commands
- CI/test commands
- major known limitations or refactor priorities

Do **not** update this file for trivial copy/style edits that do not alter how the project works.

When a structural change is made, the code change and the `AI_PROJECT_CONTEXT.md` update should be part of the same development task.
