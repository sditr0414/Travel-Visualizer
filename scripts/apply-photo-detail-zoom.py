from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f'missing patch anchor: {label}')
    return text.replace(old, new, 1)


# PlayerController
path = Path('src/player/player-controller.ts')
text = path.read_text(encoding='utf-8')
text = replace_once(
    text,
    "const ZOOM_OFFSET_MAX = 1.5;\n",
    "const ZOOM_OFFSET_MAX = 1.5;\nconst PHOTO_DETAIL_ZOOM_STRENGTH_MAX = 1.5;\n",
    'detail strength constant'
)
text = replace_once(
    text,
    "  private zoomOffset = 0;\n",
    "  private zoomOffset = 0;\n  private photoDetailZoomStrength = 0;\n",
    'detail strength state'
)
text = replace_once(
    text,
    "  private stopDurationSec = 0;\n",
    "  private stopDurationSec = 0;\n  private mediaStopDurationSec = 0;\n",
    'media stop duration state'
)
old = """  setZoomOffset(offset: number): void {
    this.zoomOffset = clamp(Number(offset) || 0, ZOOM_OFFSET_MIN, ZOOM_OFFSET_MAX);
    this.displayedZoom = null;
    this.displayedZoomTimelineSec = this.timeSec;
    this.tileZoomLevel = null;
    if (this.ownsCamera()) this.renderForTime(true);
  }

"""
new = old + """  setPhotoDetailZoomStrength(strength: number): void {
    this.photoDetailZoomStrength = clamp(Number(strength) || 0, 0, PHOTO_DETAIL_ZOOM_STRENGTH_MAX);
    this.displayedFreeJourneyZoomBoost = null;
    this.displayedFreeJourneyZoomBoostTimelineSec = this.timeSec;
    this.displayedZoom = null;
    this.displayedZoomTimelineSec = this.timeSec;
    this.tileZoomLevel = null;
    if (this.ownsCamera()) this.renderForTime(true);
  }

"""
text = replace_once(text, old, new, 'detail strength setter')
text = replace_once(
    text,
    "    this.stopDurationSec = 0;\n    this.fullRouteData = emptyCollection();\n",
    "    this.stopDurationSec = 0;\n    this.mediaStopDurationSec = 0;\n    this.fullRouteData = emptyCollection();\n",
    'dispose media duration'
)
text = replace_once(
    text,
    "      const journeyBoostTarget = photoJourneyZoomBoost(photoDistanceMeters, frame.mobilityClass);\n",
    "      const journeyBoostTarget = this.photoJourneyBoost(photoDistanceMeters, frame.mobilityClass);\n",
    'render journey boost'
)
anchor = """  private stabilizeFreeJourneyZoomBoost(targetBoost: number, timelineSec: number): number {
"""
helper = """  private photoJourneyBoost(distanceMeters: number, mobilityClass: MobilityClass): number {
    const baseBoost = photoJourneyZoomBoost(distanceMeters, mobilityClass);
    if (!this.plan) return baseBoost;
    return baseBoost + photoJourneyDetailZoomBoost(
      this.plan.durationLimits?.extentKm ?? this.plan.durationLimits?.distanceKm ?? 0,
      this.plan.durationSec,
      this.mediaStopDurationSec,
      this.photoDetailZoomStrength,
      mobilityClass
    );
  }

"""
text = replace_once(text, anchor, helper + anchor, 'detail boost helper')
text = replace_once(
    text,
    "      zoom = photoJourneyZoom(zoom, photoDistanceMeters, frame.mobilityClass);\n",
    "      zoom = clamp(zoom + this.photoJourneyBoost(photoDistanceMeters, frame.mobilityClass), 4, 17.3);\n",
    'warmup detail boost'
)
text = replace_once(
    text,
    "    this.stopDurationSec = next.totalDurationSec;\n",
    "    this.stopDurationSec = next.totalDurationSec;\n    this.mediaStopDurationSec = next.stops.reduce((sum, stop) =>\n      isDayMarkerId(stop.id) ? sum : sum + Math.max(0, Number(stop.durationSec) || 0), 0);\n",
    'media duration calculation'
)
old = """export function photoJourneyZoomBoost(distanceMeters: number, mobilityClass: MobilityClass): number {
  if (mobilityClass === 'FLIGHT') return 0;
  const distanceKm = Math.max(0, Number(distanceMeters) || 0) / 1000;
  return PHOTO_JOURNEY_BASE_ZOOM_BOOST + 1.08 * Math.exp(-distanceKm / 20);
}

"""
new = old + """export function photoJourneyDetailZoomBoost(
  extentKm: number,
  routeDurationSec: number,
  mediaStopDurationSec: number,
  strength: number,
  mobilityClass: MobilityClass
): number {
  if (mobilityClass === 'FLIGHT') return 0;
  const resolvedStrength = clamp(Number(strength) || 0, 0, PHOTO_DETAIL_ZOOM_STRENGTH_MAX);
  const stopSeconds = Math.max(0, Number(mediaStopDurationSec) || 0);
  if (!(resolvedStrength > 0) || !(stopSeconds > 0)) return 0;

  const extent = Math.max(0, Number(extentKm) || 0);
  const routeSeconds = Math.max(1, Number(routeDurationSec) || 1);
  const dwellRatio = stopSeconds / routeSeconds;
  const smallAreaFactor = Math.exp(-extent / 24);
  const dwellFactor = 1 - Math.exp(-dwellRatio / 0.55);
  return clamp(1.35 * smallAreaFactor * dwellFactor * resolvedStrength, 0, 1.8);
}

"""
text = replace_once(text, old, new, 'detail boost function')
path.write_text(text, encoding='utf-8')


# App
path = Path('src/App.tsx')
text = path.read_text(encoding='utf-8')
text = replace_once(
    text,
    "  const [photoDisplaySec, setPhotoDisplaySec] = useState(3);\n",
    "  const [photoDisplaySec, setPhotoDisplaySec] = useState(3);\n  const [photoDetailZoomMode, setPhotoDetailZoomMode] = useState<'AUTO' | 'OFF'>('AUTO');\n  const [photoDetailZoomStrength, setPhotoDetailZoomStrength] = useState(1);\n",
    'photo detail state'
)
anchor = """  const attachMediaFiles = useCallback(async (files: File[], plan: PlaybackPlan, activatePhotoJourney = true) => {
"""
text = replace_once(
    text,
    anchor,
    "  const photoDetailZoom = photoDetailZoomMode === 'AUTO' ? photoDetailZoomStrength : 0;\n\n" + anchor,
    'photo detail resolved value'
)
text = replace_once(
    text,
    "      controller.setZoomOffset(zoomOffset);\n      controller.loadPlan(state.plan!, stops);\n",
    "      controller.setZoomOffset(zoomOffset);\n      controller.setPhotoDetailZoomStrength(mode === 'PHOTOS' ? photoDetailZoom : 0);\n      controller.loadPlan(state.plan!, stops);\n",
    'controller photo detail init'
)
anchor = """  useEffect(() => {
    playersRef.current.ROUTE?.setZoomOffset(zoomOffset);
    playersRef.current.PHOTOS?.setZoomOffset(zoomOffset);
  }, [zoomOffset]);

"""
text = replace_once(
    text,
    anchor,
    anchor + "  useEffect(() => {\n    playersRef.current.PHOTOS?.setPhotoDetailZoomStrength(photoDetailZoom);\n  }, [photoDetailZoom]);\n\n",
    'photo detail live effect'
)
anchor = """            <label className=\"range-field\"><span><span>사진 표시 시간</span><output>{photoDisplaySec.toFixed(1)}초</output></span>
              <input type=\"range\" min=\"1.5\" max=\"8\" step=\"0.5\" value={photoDisplaySec} onChange={event => setPhotoDisplaySec(Number(event.target.value))} />
            </label>
"""
ui = anchor + """            <label className=\"select-field\">사진 경로 확대
              <select aria-label=\"사진 경로 확대\" value={photoDetailZoomMode} onChange={event => setPhotoDetailZoomMode(event.target.value as 'AUTO' | 'OFF')}>
                <option value=\"AUTO\">좁은 지역 상세 확대 · 추천</option><option value=\"OFF\">기본 확대만</option>
              </select>
            </label>
            {photoDetailZoomMode === 'AUTO' && <label className=\"range-field\"><span><span>상세 확대 강도</span><output>{photoDetailZoomStrength.toFixed(1)}×</output></span>
              <input aria-label=\"상세 확대 강도\" type=\"range\" min=\"0.5\" max=\"1.5\" step=\"0.1\" value={photoDetailZoomStrength} onChange={event => setPhotoDetailZoomStrength(Number(event.target.value))} />
            </label>}
"""
text = replace_once(text, anchor, ui, 'photo detail settings UI')
path.write_text(text, encoding='utf-8')


# Player tests
path = Path('src/player/player-controller.test.ts')
text = path.read_text(encoding='utf-8')
text = replace_once(
    text,
    "import { PlayerController, applyUserZoomOffset, mapJourneyTime, photoJourneyZoom, photoStopZoomBoost, remapJourneyTimeForStops, smoothPhotoStopZoomBoost, stabilizeTileZoomBoundary } from './player-controller';\n",
    "import { PlayerController, applyUserZoomOffset, mapJourneyTime, photoJourneyDetailZoomBoost, photoJourneyZoom, photoStopZoomBoost, remapJourneyTimeForStops, smoothPhotoStopZoomBoost, stabilizeTileZoomBoundary } from './player-controller';\n",
    'player test import'
)
anchor = """  it('continues easing closer while a short-route photo is on screen', () => {
"""
test = """  it('adds adjustable detail zoom when photo dwell time is long and the trip extent is small', () => {
    const smallArea = photoJourneyDetailZoomBoost(3, 120, 120, 1, 'WALK');
    const wideArea = photoJourneyDetailZoomBoost(60, 120, 120, 1, 'WALK');
    const shortDwell = photoJourneyDetailZoomBoost(3, 120, 20, 1, 'WALK');

    expect(smallArea).toBeGreaterThan(0.9);
    expect(smallArea).toBeGreaterThan(wideArea);
    expect(smallArea).toBeGreaterThan(shortDwell);
    expect(photoJourneyDetailZoomBoost(3, 120, 120, 0, 'WALK')).toBe(0);
    expect(photoJourneyDetailZoomBoost(3, 120, 120, 1.5, 'WALK')).toBeGreaterThan(smallArea);
    expect(photoJourneyDetailZoomBoost(3, 120, 120, 1.5, 'FLIGHT')).toBe(0);
  });

  it('applies photo detail zoom live without changing the base route controller behavior', () => {
    const jumpTo = vi.fn();
    const map = { getSource: () => ({ setData: vi.fn() }), jumpTo } as unknown as Map;
    const plan = simplePlan();
    plan.durationSec = 60;
    plan.durationLimits.extentKm = 2;
    const controller = new PlayerController(map);
    controller.setPhotoDetailZoomStrength(1);
    controller.loadPlan(plan, [{ id: 'photo', atSec: 0, durationSec: 60 }]);
    const detailed = (jumpTo.mock.calls.at(-1)?.[0] as { zoom: number }).zoom;

    controller.setPhotoDetailZoomStrength(0);
    const base = (jumpTo.mock.calls.at(-1)?.[0] as { zoom: number }).zoom;
    expect(detailed).toBeGreaterThan(base + 0.8);
  });

"""
text = replace_once(text, anchor, test + anchor, 'photo detail tests')
path.write_text(text, encoding='utf-8')


# App tests
path = Path('src/App.test.tsx')
text = path.read_text(encoding='utf-8')
anchor = """    expect(screen.getByLabelText('사진 표시 범위')).toHaveValue('PREVIEW');
    expect(screen.getByLabelText('날짜 변경 표시')).toBeChecked();
"""
replacement = """    expect(screen.getByLabelText('사진 표시 범위')).toHaveValue('PREVIEW');
    expect(screen.getByLabelText('사진 경로 확대')).toHaveValue('AUTO');
    expect(screen.getByRole('slider', { name: '상세 확대 강도' })).toHaveValue('1');
    fireEvent.change(screen.getByLabelText('사진 경로 확대'), { target: { value: 'OFF' } });
    expect(screen.queryByRole('slider', { name: '상세 확대 강도' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('사진 경로 확대'), { target: { value: 'AUTO' } });
    fireEvent.change(screen.getByRole('slider', { name: '상세 확대 강도' }), { target: { value: '1.4' } });
    expect(screen.getByRole('slider', { name: '상세 확대 강도' })).toHaveValue('1.4');
    expect(screen.getByLabelText('날짜 변경 표시')).toBeChecked();
"""
text = replace_once(text, anchor, replacement, 'app detail setting assertions')
path.write_text(text, encoding='utf-8')


# Context docs
path = Path('AI_PROJECT_CONTEXT.md')
text = path.read_text(encoding='utf-8')
text = replace_once(
    text,
    "설정 동기화를 위한 `setStops`, `setLockToPosition`, `setZoomOffset`이 있습니다.",
    "설정 동기화를 위한 `setStops`, `setLockToPosition`, `setZoomOffset`, `setPhotoDetailZoomStrength`가 있습니다.",
    'controller contract docs'
)
old = "사진 여정에서는 비행기 이외 이동에만 **기본 추가 확대 `PHOTO_JOURNEY_BASE_ZOOM_BOOST = 0.62`**와 `1.08 * exp(-distanceKm / 20)` 거리 기반 확대를 먼저 계산한 뒤 사용자 확대를 최종 적용하며, 사진 전용 확대는 FLIGHT에 적용하지 않는다."
new = old + " 사진 여정의 `사진 경로 확대` 기본값은 `좁은 지역 상세 확대 · 추천`이며, `상세 확대 강도`는 **0.5~1.5, 기본 1.0**이다. 이 추가 상세 확대는 `DurationLimits.extentKm`가 작을수록, 실제 사진/영상 stop으로 늘어난 시간이 경로 재생 시간에 비해 길수록 커지며 날짜 marker 시간은 계산에서 제외한다. 설정을 `기본 확대만`으로 바꾸면 이 전역 상세 보정만 0이 되고 기존 구간 거리 기반 사진 확대와 photo-stop boost는 유지된다. FLIGHT에는 이 전역 상세 확대도 적용하지 않는다."
text = replace_once(text, old, new, 'photo detail UX docs')
marker = "\n## Privacy and repository rules\n"
entry = "\n- **2026-09-03 사진 여정 좁은 지역 상세 확대**: 사진/영상 stop으로 늘어난 실제 감상 시간과 여행 전체 `extentKm`를 결합해 좁은 지역을 오래 감상하는 사진 여정에서 경로를 더 자세히 보여주는 전역 zoom boost를 추가했다. 사진 설정에서 `좁은 지역 상세 확대 · 추천 / 기본 확대만`을 선택하고 강도 0.5~1.5를 실시간 조정할 수 있다. 날짜 marker와 FLIGHT는 상세 확대 계산에서 제외하며, 기존 구간 거리 기반 확대와 photo-stop 완화는 유지한다. 이번 수정은 전체 verify/build/Playwright 없이 typecheck, 변경 파일 ESLint, 관련 PlayerController/App 단위 테스트만 실행한다.\n"
if marker not in text:
    raise SystemExit('missing patch anchor: context status marker')
text = text.replace(marker, entry + marker, 1)
path.write_text(text, encoding='utf-8')
