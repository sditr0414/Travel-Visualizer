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
- Before editing an existing file, fetch latest `main`, then fetch the exact file and blob SHA.
- Never assume a SHA in this document is current.
- Verify GitHub Actions after code changes. Do not report CI as passed until the final relevant workflow job has `conclusion: success`.
- Prefer structural fixes over compatibility shims.
- Preserve existing UX invariants unless the user explicitly changes them.

---

## 2. Product goal

Travel Camera Visualizer converts Google Maps Timeline JSON into cinematic travel playback:

1. parse Timeline movements
2. infer/correct mobility classes
3. allocate route playback time
4. plan smooth map cameras
5. render route playback
6. optionally match photos/videos by capture time and GPS
7. pause at matched media locations, show media, then resume travel

Primary validation trip is Japan/Korea around `2026-03-17 ~ 2026-03-31`.
Browser-first architecture. Capacitor/native device-media integration remains a future option.

---

## 3. User-facing modes and photo split UX

### Route mode

`JourneyMode.ROUTE` / `발자취`

- full-map route playback
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
- split is user-resizable: desktop horizontal drag, mobile vertical drag
- ratio is clamped so both panes remain usable
- keyboard adjustment and double-click reset remain supported
- map camera target follows the resized map pane
- separator has no decorative center grabber; invisible hit area/boundary is sufficient
- separator is hidden while settings are open; ratio is preserved across settings open/close
- player controls and travel HUD stay in the map pane
- photo location/capture time remain below media, never over the image/video
- between media beats, media pane shows current mobility pictogram/label
- while actual photo/video is active, movement pictogram disappears
- the obsolete background text `사진 여정` must not be shown in the media rail
- photo/video ↔ movement pictogram changes use a crossfade/scale transition rather than hard swapping
- transition duration scales with configured route `영상 길이`, with bounded minimum/maximum; shorter routes transition faster and longer routes more slowly
- `prefers-reduced-motion` disables these media transitions
- final OUTRO returns to full-map overview

Main files:

- `src/route-player-split.js`
- `src/photo-split-layout.js`
- `src/photo-split-resizer.js`
- `src/photo-media-transition.js`
- `src/photo-journey-v4.js`
- `media-journey.css`

---

## 4. Playback duration semantics

Configured `#videoDuration` is the target **route movement playback duration** passed to `planPlayback` as `targetTotalSeconds`.

Actual final playback is:

```text
configured route playback
+ photo hold time
+ video hold/play time
```

After media-stop insertion, `plan.durationSec` is the actual final player duration.
The player clock shows current time / actual total time.

Settings reanalysis invariant:

- `설정 적용 · 경로 다시 분석` must not reset configured route duration to minimum
- `src/main.js` uses `analyzeParsedTimeline(sourceLabel, { preserveVideoDuration })`
- settings apply uses `preserveVideoDuration: true`
- previous duration is clamped into new min/max
- do not restore the old `HTMLInputElement.prototype.value` interception shim

Media transition timing is visual only and does not add to playback duration. `src/photo-media-transition.js` derives a bounded transition time from `#videoDuration` and updates `--photo-media-transition`.

---

## 5. Timeline and camera architecture

Primary files:

- `src/timeline-parser.js`
- `src/mobility.js`
- `src/camera-planner.js`
- `src/playback-pacing.js`
- `src/camera-modes.js`
- `src/camera-modes-auto.js`
- `src/route-player.js`
- `src/route-player-split.js`
- `src/main.js`

Mobility classes include `WALK`, `BIKE`, `URBAN_TRANSIT`, `ROAD`, `FAST_GROUND`, `FERRY`, `FLIGHT`, `UNKNOWN`.

Browser import mapping redirects:

```text
/src/camera-modes.js  -> /src/camera-modes-auto.js
/src/route-player.js  -> /src/route-player-split.js
/src/photo-journey.js -> /src/photo-journey-v4.js
```

Camera rules:

- `AUTO` is normal strategy
- local travel is framed closer than old core defaults
- flights retain wide/overview behavior
- final route overview is preserved
- photo mode keeps camera framing inside current map pane throughout TRAVEL
- `src/photo-split-layout.js` owns split defaults/limits and pane target
- `src/photo-split-resizer.js` updates ratio and triggers immediate camera reframe
- media holds retain a visible approach trail

Do not revert photo-mode travel to full-screen framing between media stops.

---

## 6. Device gallery / local media architecture

Dedicated pipeline:

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

Active media source is centralized in `src/media-library-state.js`:

- `NONE`
- `LOCAL_GALLERY`
- `GOOGLE_PHOTOS_PICKER`
- `GOOGLE_PHOTOS_TAKEOUT`

Do not restore wrapper-local local-gallery preference state or `travel-camera:local-media-ready` source override behavior.
Never reintroduce device gallery → `DataTransfer` → hidden Takeout input.

Local metadata priority:

1. embedded JPEG EXIF capture metadata
2. common camera filename timestamp
3. `File.lastModified`

Memory invariant: no eager Blob/Object URLs for the whole gallery. Create URLs only for currently rendered media and revoke them on scene changes.

---

## 7. Google Photos and Takeout

Google Photos Picker:

- explicit Picker approval only
- public OAuth client ID only; never expose client secret
- temporary media URLs
- preview media must not be persisted to IndexedDB or uploaded to project server
- Picker GPS is not reliable enough here; Timeline-time positioning is used
- downloaded Picker previews may enter the Takeout-compatible metadata loader

Takeout:

- folder may include media + JSON sidecars
- sidecar capture time/GPS preferred when present

Selecting a new source replaces prior active media through `src/media-library-state.js`.

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

`src/photo-journey-v2.js` inserts stationary media frames:

```text
travel -> media hold -> travel resumes
```

Do not place clearly out-of-range photos arbitrarily just to make them appear.

---

## 9. Local video rendering

`File.type` is not authoritative for local video. MP4/MOV can arrive with empty/generic MIME.
Use normalized `mediaType` / extension semantics.

Real local video nodes are muted, `defaultMuted`, `playsInline`, and use `playsinline`.
PLAY mode retries around `loadeddata` / `canplay`.

Google Photos logical videos can use still-thumbnail sentinel files; those remain `<img>`, not `<video>`.

---

## 10. GPS place-name resolution and Korean localization

Active resolver: `src/photo-journey-v4.js`.
Japanese localization helper: `src/japanese-place-ko.js`.

For GPS-based media, prefer administrative geography over nearby POIs. When city-level information is available, show all usable city-and-below units exposed by map data in hierarchy order:

```text
city/town/municipality
-> district/ward/borough
-> neighborhood/suburb/quarter/locality
```

Example target:

```text
오사카시 · 주오구 · 신사이바시
```

If city-level data is unavailable, region/prefecture may be fallback, followed by usable lower levels.

Name-selection invariant for Japanese features:

1. use explicit Korean map property (`name:ko` / `name_ko`) when present
2. if Korean is missing but Japanese identity plus English/Latin romaji is available, convert romaji to Korean phonetic Hangul
3. preserve Japanese administrative suffix meaning, e.g. `市→시`, `区→구`, `県→현`, `府→부`, `都/道→도`, `郡→군`, `町→정`, `村→촌`, `丁目→초메`
4. only fall back to raw source names if a safe Korean conversion cannot be produced

Common Japanese names have explicit Korean spelling overrides where generic Hepburn-style conversion is insufficient (`Tokyo→도쿄`, `Kyoto→교토`, `Chuo→주오`, `Namba→난바`, etc.). Generic romaji conversion covers remaining names approximately.

Do not apply Japanese transliteration to non-Japanese features. `src/japanese-place-ko.js` requires Japanese-script identity before using romaji fallback.

The resolver checks rendered features and relevant source layers. Polygon/MultiPolygon administrative features use a bounded representative position for distance ranking.

Limitation: this is not a true reverse-geocoder. Only map levels and multilingual properties actually present in the active source can be used. Romaji-to-Hangul fallback is phonetic and may differ from an official Korean exonym. Do not fabricate missing administrative levels.

---

## 11. Active photo wrapper chain

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
- v4: robust local video rendering, detailed/Korean-localized administrative GPS labels, movement pictograms, local-ready state integration

`?core=1` avoids import-map recursion.
Technical debt: wrapper stack is deep. Do not casually add v5/v6; consolidate only in a dedicated refactor with regression tests.

---

## 12. Important files

Entry/UI: `index.html`, `styles.css`, `mode-ui.css`, `media-journey.css`.

Main orchestration: `src/main.js`.

Timeline/camera: `src/timeline-parser.js`, `src/mobility.js`, `src/camera-planner.js`, `src/playback-pacing.js`, `src/camera-modes*.js`, `src/route-player*.js`, `src/photo-split-layout.js`, `src/photo-split-resizer.js`.

Media: `src/media-library-state.js`, `src/photo-journey*.js`, `src/japanese-place-ko.js`, `src/photo-media-transition.js`, `src/gallery-photo-ui.js`, `src/local-media-loader.js`, `src/local-media-worker.js`, `src/image-metadata.js`, `src/photo-progress-ui.js`, `src/photo-media-settings-ui.js`, `src/google-photos-picker.js`, `src/google-photos-ui.js`.

Server/map/fixture: `server.mjs`, `src/local-map.js`, `src/bundled-timeline.js`, `scripts/setup-local-map.mjs`, `scripts/setup-timeline.mjs`, `data/`, `maps/`.

---

## 13. Settings and progress UX invariants

Settings workspace must remain viewport-safe and scrollable. Desktop may use columns; short windows reduce density; mobile behaves like a near-full-width/bottom-sheet workspace. Do not introduce fixed heights that make lower controls unreachable.

Large imports need real progress rather than appearing frozen. Conceptual phases: `PREPARE`, `METADATA`, `MATCH`, `BUILD`, `COMPLETE`, `ERROR`.

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

`src/local-map.js` requests basemap labels with `{ lang: 'ko' }`. GPS place localization still needs property fallback because small Japanese features do not always contain `name:ko`.

Fallback online basemap is supported. Local map files are not committed due size. Server supports PMTiles HTTP Range requests.

`server.mjs` exposes only `GOOGLE_PHOTOS_CLIENT_ID` to browser config. Never expose a client secret.

Privacy:

- keep repository private unless location disclosure is intentional
- device photos/videos stay browser-local
- do not upload local media to project server as an optimization shortcut
- do not add persistent browser media caching without explicit request/privacy review

---

## 15. Known failed patterns — do not repeat

1. Device gallery through `DataTransfer` into Takeout input.
2. Eager Blob URLs for entire gallery.
3. Bulk EXIF work on main thread.
4. Full-map ↔ split-map transition for every photo.
5. MIME-only local video detection.
6. Resetting `영상 길이` on every settings apply.
7. Adding another photo wrapper for each small feature.
8. Wrapper-local media source override state.
9. Hard-coding split camera/layout to only 60/40 or 52/48.
10. Raw Japanese `properties.name` before available Korean/romaji localization.

---

## 16. Known technical debt / limitations

### P1 — Photo wrapper consolidation
v2/v3/v4 is functional but costly to reason about.

### P2 — Browser reverse geocoding is approximate
Administrative levels still depend on map features. Korean fallback can phonetic-transliterate Japanese romaji, but this is not an authoritative address translation service.

### P2 — HEIC metadata/rendering
Selection is supported but browser decoding varies and embedded parsing is JPEG-centric.

### P2 — Very large local galleries remain browser-limited
Workers help, but browser I/O/decode/memory limits remain.

### P3 — Playback clock injected by JS
`#playbackTime` is created by `src/photo-media-settings-ui.js` rather than static HTML.

### P3 — Some user-facing copy is duplicated
Photo journey help strings exist in more than one UI module.

---

## 17. Recommended refactor priority

```text
P1. Keep current route/photo/video UX stable
P1. Consolidate photo-journey v2/v3/v4 in a dedicated refactor
P2. Add local-media performance instrumentation
P2. Improve HEIC strategy if real files require it
P2. Evaluate deterministic reverse geocoding only if map-feature labels remain insufficient
P3. Consider Capacitor NativePhotoSource for packaged app
```

---

## 18. Tests and CI

Local: `npm test`.

GitHub Actions performs npm install, JavaScript syntax checks, bundled Timeline/local-server startup checks, static/API endpoint checks, and full Node tests.

Relevant regression tests include camera, route player, mobility, media-source, metadata, photo journey, photo split, administrative-place, Japanese-place Koreanization, media-transition timing, and playback pacing tests.

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

Default URL: `http://localhost:5173`.
After browser module/CSS changes, hard refresh (`Ctrl+F5`) is often useful.

---

## 20. Bug triage shortcuts

Photos counted but never appear: imported count → matched beats → `takenMs`/range → position source/GPS plausibility → active media source → renderer/Object URL errors.

Photo split issues: persistent layout class → import-map target → split state → resizer vars/event → pane-biased camera → settings visibility.

GPS label too coarse: inspect exposed city/district/locality features → classification → representative distance → missing map levels cannot be synthesized.

Japanese GPS label still visible: inspect `name:ko` → `name:ja` identity → `name:en`/`name:latin` romaji availability → `src/japanese-place-ko.js` conversion → raw-name final fallback. Do not transliterate unrelated non-Japanese features.

Media transition feels abrupt: verify `src/photo-media-transition.js` loaded through `photo-split-resizer.js`, `--photo-media-transition` follows `#videoDuration`, both card and pictogram retain DOM during opacity transition, and reduced-motion is not active.

---

## 21. New AI session procedure

1. Read this file completely.
2. Fetch latest `main` HEAD.
3. Fetch exact relevant files and current blob SHAs.
4. Treat current code as authoritative if docs differ.
5. Identify affected invariant.
6. Prefer minimal structural fix over another workaround layer.
7. Preserve route-only vs actual-playback duration semantics.
8. Preserve dedicated local-gallery pipeline/shared media source state.
9. Preserve persistent/resizable photo split unless explicitly changed.
10. Preserve duration-aware photo/video ↔ movement-pictogram transitions unless explicitly changed.
11. Preserve city-and-below GPS labels and Korean-first Japanese place localization when map data supports it.
12. Add/update focused tests.
13. Verify final `main` GitHub Actions before claiming success.
14. Update this file in the same task when maintained architecture/invariants change.

Useful new-chat instruction:

```text
GitHub의 AI_PROJECT_CONTEXT.md를 먼저 읽고 최신 main을 확인한 뒤 이어서 작업하자.
```
