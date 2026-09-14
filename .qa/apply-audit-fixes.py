from pathlib import Path
import re

def read(path):
    return Path(path).read_text(encoding='utf-8')
def write(path, text):
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding='utf-8')
def replace(path, old, new, count=1):
    text = read(path)
    assert text.count(old) == count, (path, 'unexpected match count', text.count(old), old[:80])
    write(path, text.replace(old, new))
def section(path, start, end, new):
    text = read(path)
    assert text.count(start) == 1 and text.count(end) == 1, (path, start, end)
    a, b = text.index(start), text.index(end)
    assert b > a
    write(path, text[:a] + new + text[b:])

# Preserve omission of explicit flights without interpreting their absence as a recorded path.
replace('src/types.ts', 'export interface Movement {', "export interface Movement {\n  connectionBefore?: 'excluded-flight';\n  hideRoute?: boolean;")
replace('src/timeline-parser.js', '  const activities = [];', '  const activities = [];\n  const excludedFlights = [];')
replace('src/timeline-parser.js', "      if (!includeFlights && googleType === 'FLYING') continue;", "      if (!includeFlights && googleType === 'FLYING') {\n        excludedFlights.push({ startMs: segmentStart, endMs: segmentEnd });\n        continue;\n      }")
replace('src/timeline-parser.js', '  const movements = bridgeMovementGaps(enriched, allTimelinePoints, includeFlights);', '''  for (let i = 1; i < enriched.length; i += 1) {
    if (excludedFlights.some(flight => flight.endMs > enriched[i - 1].endMs && flight.startMs < enriched[i].startMs)) {
      enriched[i].connectionBefore = 'excluded-flight';
    }
  }
  const movements = bridgeMovementGaps(enriched, allTimelinePoints, includeFlights);''')
replace('src/timeline-parser.js', '    if (gapSec < 0 || gapMeters < 140) continue;', "    if (gapSec < 30 || gapMeters < 140 || next.connectionBefore === 'excluded-flight') continue;")
replace('src/timeline-parser.js', '    const candidateDistance = pathDistanceMeters(candidate);', '''    // Without temporally distinct samples this is a visual connection, not speed evidence.
    if (new Set(between.map(point => point.timeMs)).size < 2) continue;
    const candidateDistance = pathDistanceMeters(candidate);''')
replace('src/timeline-parser.js', '    if (speedKmh > 1400) continue;', '    if (speedKmh > 1400 || speedKmh > 360 && evidenceDistance < 20_000) continue;')
replace('src/timeline-parser.js', "  if (speedKmh > 330 || distanceKm > 300 && speedKmh > 150) return 'FLYING';", "  if (distanceKm >= 20 && speedKmh > 330 || distanceKm > 300 && speedKmh > 150) return 'FLYING';")
replace('src/mobility.js', 'export function inferMobility(segment) {', '''export function inferMobility(segment) {
  if (segment.inferenceSource === 'visual-gap') {
    return {
      mobilityClass: MobilityClass.UNKNOWN, confidence: 0,
      scores: { UNKNOWN: 1 }, speedKmh: 0,
      distanceKm: Math.max(0, Number(segment.distanceMeters) || 0) / 1000,
      straightness: 1, googleClass: MobilityClass.UNKNOWN,
      googleConfidence: 0, activityConfidence: 0, priorCompatibility: 0, identityAnchor: null
    };
  }''')
replace('src/mobility.js', '  const sorted = [...scores.entries()].sort((a, b) => b[1] - a[1]);', '''  // High speed over a very short inferred gap is bad timing evidence, not aviation.
  if (segment.inferred && directKm < 20) scores.set(MobilityClass.FLIGHT, 0);
  const sorted = [...scores.entries()].sort((a, b) => b[1] - a[1]);''')
replace('src/playback-pacing.js', 'function protectedLocalFloor(segment) {', '''function protectedLocalFloor(segment) {
  if (segment.inferenceSource === 'visual-gap') {
    return clamp(0.4 + Math.log2(1 + segmentDistanceKm(segment)) * 0.22, 0.4, 2.5);
  }''')

# Keep the single content clock running. Normal recording gaps are planned above;
# older/imported plans and returning from a manual map pan get a nonblocking blend.
p = 'src/player/player-controller.ts'
replace(p, '  private transition: { from: { center: Coordinate; zoom: number }; to: { center: Coordinate; zoom: number }; elapsed: number; duration: number; wideZoom: number } | null = null;', '  private transition: { from: { center: Coordinate; zoom: number }; position: Coordinate | null; startSec: number; duration: number } | null = null;')
replace(p, "      this.beginTransition(destination, '현재 재생 위치로 이동 중');", '      this.beginTransition(destination, false);')
replace(p, '''    if (this.transition) {
      this.renderTransition(dt);
      this.raf = requestAnimationFrame(this.tick);
      return;
    }
''', '')
replace(p, '    if (!this.transition && this.timeSec >= this.getDuration()) {', '    if (this.timeSec >= this.getDuration()) {')
replace(p, '    if (!force && Math.abs(clampedPosition - this.framePosition) < 0.001) return;', '    if (!force && !this.transition && Math.abs(clampedPosition - this.framePosition) < 0.001) return;')
replace(p, '    const frame = interpolatePlaybackFrame(baseFrame, this.plan.frames[nextIndex], mix, this.plan);', '    let frame = interpolatePlaybackFrame(baseFrame, this.plan.frames[nextIndex], mix, this.plan);')
section(p, '    const previous = this.lastFrame;', '    this.lastCamera = { center, zoom };\n    this.map.jumpTo', '''    const previous = this.lastFrame;
    const gap = previous?.kind === 'TRAVEL' && frame.kind === 'TRAVEL' && previous.segmentIndex !== frame.segmentIndex
      ? haversineMeters(this.plan.segments[previous.segmentIndex].end, this.plan.segments[frame.segmentIndex].start) : 0;
    const changesScene = previous?.kind === 'TRAVEL' && frame.kind === 'TRAVEL' && previous.sceneId !== frame.sceneId;
    const beginsOverview = previous?.kind === 'TRAVEL' && frame.kind === 'OUTRO';
    if (this.playing && this.lastCamera && (gap > 30 || changesScene || beginsOverview)) {
      this.beginTransition({ center, zoom }, !beginsOverview);
    }
    this.lastFrame = frame;
    if (this.transition) {
      const blend = this.transition;
      const ratio = clamp((this.timeSec - blend.startSec) / blend.duration, 0, 1);
      const t = ratio * ratio * (3 - 2 * ratio);
      center = interpolateCoordinate(blend.from.center, center, t);
      zoom = lerp(blend.from.zoom, zoom, t);
      if (frame.kind === 'TRAVEL' && blend.position) {
        frame = { ...frame, position: interpolateCoordinate(blend.position, frame.position, t) };
      }
      if (ratio >= 1) this.transition = null;
    }
''')
replace(p, '    const geometryChanged = this.lastGeometryPosition !== clampedPosition;', '    const geometryChanged = this.lastGeometryPosition !== clampedPosition || Boolean(this.transition);')
replace(p, "        this.setSource('route-progress', trailForFrame(this.plan, baseIndex));", "        this.setSource('route-progress', trailForFrame(this.plan, baseIndex, frame));")
replace(p, "        this.setSource('route-head', headForFrame(frame));", "        this.setSource('route-head', this.plan.segments[frame.segmentIndex]?.hideRoute ? emptyCollection() : headForFrame(frame));")
section(p, '  private cancelTransition(): void {', '  private photoJourneyBoost(', '''  private cancelTransition(): void {
    this.transition = null;
    this.lastGeometryAt = -Infinity;
    this.lastGeometryPosition = -1;
  }

  private beginTransition(to: { center: Coordinate; zoom: number }, moveHead: boolean): void {
    if (!this.lastCamera) return;
    this.transition = {
      from: this.lastCamera,
      position: moveHead && this.lastFrame?.kind === 'TRAVEL' ? this.lastFrame.position : null,
      startSec: this.timeSec,
      duration: Math.max(1 / (this.plan?.fps || 60), Math.min(2, this.getDuration() - this.timeSec))
    };
    warmMapTilesAhead(this.map, to.center, to.zoom);
  }

''')
replace(p, 'function trailForFrame(plan: PlaybackPlan, index: number): object {', 'function trailForFrame(plan: PlaybackPlan, index: number, current?: TravelFrame): object {')
replace(p, '  return lineFeatures(frames.reverse(), plan);', '''  frames.reverse();
  if (current && frames.length) frames[frames.length - 1] = current;
  return lineFeatures(frames, plan);''')
# Excluded flights stay omitted, while ordinary inferred connectors remain visible.
replace(p, '  if (!frames.length) return emptyCollection();\n  const features: object[] = [];', '''  if (!frames.length) return emptyCollection();
  if (frames.some(frame => plan.segments[frame.segmentIndex]?.hideRoute)) {
    const groups: TravelFrame[][] = [];
    let group: TravelFrame[] = [];
    for (const frame of frames) {
      if (plan.segments[frame.segmentIndex]?.hideRoute) {
        if (group.length) groups.push(group);
        group = [];
      } else group.push(frame);
    }
    if (group.length) groups.push(group);
    return { type: 'FeatureCollection', features: groups.flatMap(items =>
      (lineFeatures(items, plan) as { features: object[] }).features) };
  }
  const features: object[] = [];''')

# Native selection has correct keyboard/touch dismissal and does not grow the panel.
p = 'src/App.tsx'
section(p, '            {!!state.scan.tripCandidates?.length && <div', '            <div className="trip-range-fields">', '''            {!!state.scan.tripCandidates?.length && <label className="select-field trip-candidate-picker">
              <span>추천 여행</span>
              <select aria-label="추천 여행" value={state.scan.tripCandidates.find(candidate =>
                candidate.startDate === startDate && candidate.endDate === endDate)?.id ?? ''}
                onChange={event => {
                  const candidate = state.scan?.tripCandidates?.find(item => item.id === event.target.value);
                  if (candidate) { setStartDate(candidate.startDate); setEndDate(candidate.endDate); }
                }}>
                <option value="" disabled>여행 선택</option>
                {state.scan.tripCandidates.map((candidate, index) => <option key={candidate.id} value={candidate.id}>
                  {candidate.destinationHint ?? ('추천 여행 ' + (index + 1))} · {formatTripRange(candidate.startDate, candidate.endDate)} · {formatTripCandidateSummary(candidate)}
                </option>)}
              </select>
            </label>}
''')
replace(p, '          <p className="setting-help">? 버튼에 마우스를 올리거나 눌러 설명을 확인하세요.</p>\n', '')
replace(p, "  const canPlay = Boolean(state.plan && map && !busy);", "  const canPlay = Boolean(state.plan && map && !busy && !settingsOpen);")
replace(p, "      data-playback-chrome={playbackChrome.visible ? 'visible' : 'hidden'}", "      data-settings-open={settingsOpen ? 'true' : 'false'}\n      data-playback-chrome={playbackChrome.visible ? 'visible' : 'hidden'}")
replace(p, 'className="import-button overview-button" type="button"', 'className="import-button overview-button" type="button" aria-label="전체 경로"')
replace(p, "    speed: `${travel.speedKmh.toFixed(0)} km/h`,", "    speed: segment.inferenceSource === 'visual-gap' ? '—' : `${travel.speedKmh.toFixed(0)} km/h`,")
replace(p, "    mobility: `${MOBILITY_LABELS[travel.mobilityClass] ?? '기타'}${segment.inferred ? ' · 추정' : ''}`,", "    mobility: segment.inferenceSource === 'visual-gap' ? '경로 연결' : `${MOBILITY_LABELS[travel.mobilityClass] ?? '기타'}${segment.inferred ? ' · 추정' : ''}`,")
# UI copy replacements are also applied to tests and help text using the same labels.
replacements = {
    '발자취': '경로 보기',
    'Timeline 선택': '타임라인 파일 열기',
    'Timeline JSON 선택': '타임라인 파일 열기',
    'Timeline 다시 선택': '타임라인 파일 다시 열기',
    '현재 Timeline': '현재 타임라인',
    '화면 구성': '지도 보기 방식',
    '사진 표시 범위': '표시할 사진',
    '미리보기 · 대표': '대표 사진만 ·',
    '전체 보기 ·': '모든 사진 ·',
    '미리보기는 비슷한 시간·장소의 사진 중 대표 장면만, 전체 보기는': '대표 사진만은 비슷한 시간·장소에서 고른 사진을, 모든 사진은',
    '사진 경로 확대': '사진을 볼 때 지도 확대',
    '경로 재생 길이': '경로 재생 시간',
    '대표 장면만': '첫 화면만 표시',
}
for folder in ('src', 'e2e'):
    for file in Path(folder).rglob('*'):
        if file.suffix not in ('.tsx', '.ts'): continue
        text = read(file)
        updated = text
        for old, new in replacements.items(): updated = updated.replace(old, new)
        if updated != text: write(file, updated)

# A single SVG family avoids platform emoji glyph, baseline and colour differences.
p = 'src/media/MediaJourneyPane.tsx'
replace(p, "import { Film, ImageOff, ImagePlus, Play } from 'lucide-react';", "import { Accessibility, Bike, Car, CircleHelp, Film, ImageOff, ImagePlus, Plane, Play, Ship, TrainFront, TramFront, type LucideIcon } from 'lucide-react';\nimport { videoTargetTime } from './video-sync';")
replace(p, '<span className="movement-pictogram" aria-hidden="true">{movement.icon}</span>', '<span className="movement-pictogram" data-mobility={scene.mobilityClass} aria-hidden="true"><movement.icon strokeWidth={1.6} /></span>')
replace(p, "const MOVEMENT_VISUALS: Record<MobilityClass, { icon: string; label: string }> = {", "const MOVEMENT_VISUALS: Record<MobilityClass, { icon: LucideIcon; label: string }> = {")
for old, new in {"icon: '🚶'": 'icon: Accessibility', "icon: '🚲'": 'icon: Bike', "icon: '🚇'": 'icon: TramFront', "icon: '🚆'": 'icon: TrainFront', "icon: '⛴'": 'icon: Ship', "icon: '✈'": 'icon: Plane', "icon: '🚗'": 'icon: Car', "icon: '●'": 'icon: CircleHelp'}.items(): replace(p, old, new)
replace(p, ' /> 대표 장면</span>', ' /> 첫 화면</span>')
replace(p, 'url && <MediaAsset playing=', 'url && <MediaAsset key={url} playing=')
replace(p, "  const unknown = '알 수 없음';", "  const unknown = '장소 정보 없음';")
replace(p, "place === unknown || looksLikeCoordinates(place)", "place === unknown || place === '알 수 없음' || looksLikeCoordinates(place)")
section(p, '  const playRequested = playing && videoMode', "  if (failed) return <div", '''  const playRequested = playing && videoMode === 'PLAY';
  useEffect(() => {
    const video = videoRef.current;
    if (!video || item.kind !== 'video') return;
    let cancelled = false;
    let requesting = false;
    const synchronize = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : Infinity;
      const target = videoTargetTime(elapsedSec, duration, videoMode, video.currentTime);
      const tolerance = playRequested ? 0.45 : 0.04;
      if (video.readyState >= 1 && Math.abs(video.currentTime - target) > tolerance) video.currentTime = target;
      if (!playRequested || elapsedSec >= duration) video.pause();
      else if (video.paused && !blocked && !requesting) {
        requesting = true;
        void video.play().then(() => {
          // A new effect/scene may have paused this element while play was pending.
          if (cancelled) video.pause();
        }).catch((error: unknown) => {
          if (!cancelled && error instanceof DOMException && error.name === 'NotAllowedError') setBlocked(true);
        }).finally(() => { requesting = false; });
      }
    };
    synchronize();
    video.addEventListener('loadedmetadata', synchronize);
    video.addEventListener('loadeddata', synchronize);
    return () => {
      cancelled = true;
      video.removeEventListener('loadedmetadata', synchronize);
      video.removeEventListener('loadeddata', synchronize);
    };
  }, [item.kind, url, videoMode, videoMuted, playRequested, elapsedSec, blocked]);

''')
replace(p, "  const readyState = videoMode === 'PLAY' ? 2 : 1;\n  const readyEvent = videoMode === 'PLAY' ? 'loadeddata' : 'loadedmetadata';", "  const readyState = 2;\n  const readyEvent = 'loadeddata';")
replace(p, "  video.preload = videoMode === 'PLAY' ? 'auto' : 'metadata';", "  video.preload = 'auto';")
# videoMode is part of preload identity but both modes must decode a first frame.
replace(p, '      const preloadCleanup = preloadMediaAsset(item, resolved.url, videoMode, status => {', '      const preloadCleanup = preloadMediaAsset(item, resolved.url, status => {')
replace(p, "  url: string,\n  videoMode: Props['videoMode'],\n  onStatus:", "  url: string,\n  onStatus:")
replace(p, '''      latestSceneRef.current = desiredScene;
      const updateFrame = window.requestAnimationFrame(() => {
        setTransition''', '''      const updateFrame = window.requestAnimationFrame(() => {
        latestSceneRef.current = desiredScene;
        setTransition''')
replace(p, '''    enteredAtRef.current = now;
    latestSceneRef.current = desiredScene;

    const showFrame = window.requestAnimationFrame(() => {
      setTransition''', '''    const showFrame = window.requestAnimationFrame(() => {
      enteredAtRef.current = now;
      latestSceneRef.current = desiredScene;
      setTransition''')
write('src/media/video-sync.ts', '''/** NaN elapsed time freezes an outgoing scene; finite elapsed time supports seeking both ways. */
export function videoTargetTime(elapsed: number, duration: number, mode: 'PLAY' | 'THUMBNAIL', current: number): number {
  if (!Number.isFinite(elapsed)) return Math.max(0, Number(current) || 0);
  if (mode === 'THUMBNAIL') return 0;
  const end = Number.isFinite(duration) ? Math.max(0, duration - 0.01) : Infinity;
  return Math.min(Math.max(0, elapsed), end);
}
''')

# Align JS's 820px layout split with every CSS rule; remove the fixed-height canvas floor.
for file in Path('src').glob('*.css'):
    text = read(file).replace('max-width: 720px', 'max-width: 820px').replace('min-width: 721px', 'min-width: 821px')
    text = text.replace('min-height: 520px', 'min-height: 0').replace('min-height: 440px', 'min-height: 0')
    write(file, text)
replace('src/main.tsx', "import './styles.css';", "import '@fontsource-variable/noto-sans-kr/wght.css';\nimport './styles.css';")
replace('src/styles.css', 'font-family: Inter, Pretendard, "Noto Sans KR", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;', 'font-family: "Noto Sans KR Variable", "Noto Sans KR", system-ui, sans-serif;')
section('src/settings-polish.css', '/* Keep recommendations compact until', '.trip-range-fields {', '')
p = 'src/usability-fixes.css'
write(p, read(p) + '''
/* Audited composition: the settings panel always sits above playback chrome. */
.app-shell { height: 100dvh; min-height: 0; }
.settings-panel[open] { z-index: 40; }
.settings-panel .settings-content { max-height: calc(100dvh - 86px - env(safe-area-inset-bottom)); overscroll-behavior: contain; }
.topbar-actions, .mode-switch, .mode-switch button, .import-button { flex-shrink: 0; }
.mode-switch button, .import-button, .settings-panel summary { white-space: nowrap; }
.topbar, .topbar-actions, .timeline-control { min-width: 0; }
.player-dock { grid-template-columns: 42px 96px minmax(0, 1fr); }
.photo-mode .player-dock { grid-template-columns: 38px 80px minmax(0, 1fr); gap: 7px; }
.photo-mode .secondary-control { width: 38px; }
.trip-candidate-picker { min-width: 0; }
.trip-candidate-picker select { width: 100%; min-width: 0; min-height: 44px; text-overflow: ellipsis; }
.setting-help-anchor { display: inline-block; max-width: 100%; border-radius: 3px; touch-action: manipulation; }
.setting-help-anchor:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
.movement-pictogram { display: grid; place-items: center; width: 1em; height: 1em; filter: none; color: var(--paper); }
.movement-pictogram svg { display: block; width: 100%; height: 100%; }
.media-caption, .movement-primary, .media-day-marker, .timeline-meta { font-family: inherit; }
.media-caption-place, .media-caption-date { overflow-wrap: anywhere; }
.media-day-marker { min-height: 0; }
.media-frame { min-height: 0; }
@media (max-width: 1100px) {
  .brand-lockup { display: none; }
  .topbar { justify-content: flex-end; }
  .import-button span { display: none; }
  .import-button { width: 44px; min-width: 44px; padding: 0; justify-content: center; }
}
@media (max-width: 820px) {
  .topbar { left: 10px; right: 150px; justify-content: flex-start; }
  .photo-mode .topbar { justify-content: flex-start; }
  .mode-switch button { padding: 0 8px; }
  .settings-panel summary { font-size: 13px; }
  .player-dock, .photo-mode .player-dock { grid-template-columns: 40px 82px minmax(0, 1fr); }
  .photo-mode .player-dock, .photo-mode .player-reveal-zone {
    left: 50%; width: calc(100vw - 20px);
    bottom: calc(100% - var(--photo-map-share, 34%) + 10px);
  }
  .photo-mode .secondary-control { width: 40px; }
  .media-card { min-height: 0; }
}
@media (max-height: 500px) {
  .settings-panel .settings-content { max-height: calc(100dvh - 76px - env(safe-area-inset-bottom)); }
  .media-journey-pane { padding-top: 70px; padding-bottom: 10px; }
  .media-card .media-caption { min-height: 38px; gap: 5px; padding-top: 5px; }
  .media-caption-date, .media-caption-place { font-size: 12px; }
  .media-day-marker { gap: 8px; }
  .media-day-marker > time { font-size: 30px; }
  .media-day-marker > strong { font-size: 20px; }
  .movement-date { font-size: 24px; }
  .movement-pictogram { font-size: 64px; }
  .movement-mode { font-size: 18px; }
  .local-import-panel { max-height: calc(100dvh - 90px); overflow-y: auto; }
}
''')

# Update assertions whose UI contracts intentionally changed; retain numeric camera/cursor tests.
p = 'src/media/MediaJourneyPane.test.tsx'
text = read(p).replace("'알 수 없음'", "'장소 정보 없음'")
text = text.replace(".toHaveTextContent('🚗')", ".toHaveAttribute('data-mobility', 'ROAD')").replace(".toHaveTextContent('🚶')", ".toHaveAttribute('data-mobility', 'WALK')")
write(p, text)
p = 'src/domain/planner-continuity.test.ts'
replace(p, 'expect(connected[1].durationSec).toBeGreaterThan(0);', "expect(connected[1].durationSec).toBe(0);\n    expect(connected[1].googleType).toBe('UNKNOWN');\n    expect(connected[1].avgSpeedKmh).toBe(0);")
replace(p, "it('does not fabricate a nearby bridge for a very large discontinuity'", "it('visually connects large gaps without pretending the transport is known'")
replace(p, 'expect(connectVisualGaps([first, second])).toHaveLength(2);', "const connected = connectVisualGaps([first, second]);\n    expect(connected).toHaveLength(3);\n    expect(connected[1].googleType).toBe('UNKNOWN');")
p = 'src/player/player-controller.test.ts'
section(p, "  it.each([0, 1])('moves across recording gaps", "  it('interpolates across the date line", '''  it.each([0, 1])('keeps the content clock and route visible across old-plan gaps in scene %s', sceneId => {
    const p = playback();
    const plan = simplePlan();
    const first = plan.frames[0];
    if (first.kind !== 'TRAVEL') throw new Error('fixture');
    plan.fps = 10;
    plan.durationSec = 1;
    plan.segments.push({ ...plan.segments[0], index: 1, sceneId: 1, start: { lng: 129, lat: 35 } });
    plan.frames = [first, { ...first, sceneId, segmentIndex: 1, position: { lng: 129, lat: 35 }, center: { lng: 129, lat: 35 } }];
    p.player.loadPlan(plan);
    p.player.play();
    p.tick(50); p.tick(100);
    expect(p.onTransitionChange).not.toHaveBeenCalled();
    expect(p.onFrame.mock.calls.at(-1)?.[2]).toBeCloseTo(0.1, 6);
    p.setData.mockClear();
    p.tick(150); p.tick(200);
    expect(p.onFrame.mock.calls.at(-1)?.[2]).toBeCloseTo(0.2, 6);
    expect(p.jumpTo.mock.calls.at(-1)?.[0].center[0]).toBeGreaterThan(127);
    expect(p.jumpTo.mock.calls.at(-1)?.[0].center[0]).toBeLessThan(129);
    expect(p.setData.mock.calls.every(call => call[0].features.length > 0)).toBe(true);
    for (let ms = 250; ms <= 1050; ms += 50) p.tick(ms);
    expect(p.player.isPlaying()).toBe(false);
    expect(p.onFrame.mock.calls.at(-1)?.[2]).toBeCloseTo(1, 6);
    p.player.seek(0);
    expect(p.jumpTo.mock.calls.at(-1)?.[0].center).toEqual([127, 37.5]);
    p.player.dispose();
  });

''')
# This integration case performs four complete play/pause cycles; give those actions a scoped budget.
replace('e2e/travel-flow.spec.ts', "test('route and photo journeys keep playback state and cursors separate', async ({ page }) => {", "test('route and photo journeys keep playback state and cursors separate', async ({ page }) => {\n  test.setTimeout(60_000);")
# Assertions for recommendation selection are upgraded after inspecting the existing test below.
print('Patched audit scope; product tests remain enabled.')
print(read('src/App.test.tsx')[read('src/App.test.tsx').index("  it('offers multiple"):read('src/App.test.tsx').index("  it('keeps live")])
