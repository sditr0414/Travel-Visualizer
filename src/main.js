import { parseTimeline } from './timeline-parser.js';
import { durationLimitsForMovements, planPlayback } from './camera-planner.js';
import { applyCameraMode, CameraMode } from './camera-modes.js';
import { RoutePlayer } from './route-player.js';
import { toGeoJSONLine } from './geo.js';
import { bundledTimelineMeta, loadBundledTimeline } from './bundled-timeline.js';
import { resolveBasemap } from './local-map.js';

const $ = sel => document.querySelector(sel);
const fileInput = $('#timelineFile');
const currentDataSourceName = $('#currentDataSourceName');
const currentDataSourceType = $('#currentDataSourceType');
const startDate = $('#startDate');
const endDate = $('#endDate');
const includeFlights = $('#includeFlights');
const cameraMode = $('#cameraMode');
const cameraModeHint = $('#cameraModeHint');
const lockCameraToPosition = $('#lockCameraToPosition');
const cameraTrackingSpeed = $('#cameraTrackingSpeed');
const cameraTrackingSpeedLabel = $('#cameraTrackingSpeedLabel');
const showFullRoute = $('#showFullRoute');
const videoDuration = $('#videoDuration');
const videoDurationLabel = $('#videoDurationLabel');
const durationHint = $('#durationHint');
const loadButton = $('#loadButton');
const playButton = $('#playButton');
const resetButton = $('#resetButton');
const seek = $('#seek');
const status = $('#status');
const currentMode = $('#currentMode');
const currentSpeed = $('#currentSpeed');
const currentZoom = $('#currentZoom');
const currentDate = $('#currentDate');
const videoDate = $('#videoDate');
const summary = $('#summary');

let parsedJson = null;
let currentData = null;
let currentSourceLabel = '타임라인.json';
let player = null;
let plan = null;

const CAMERA_MODE_LABELS = {
  [CameraMode.AUTO]: '자동 · 하루 지역 + 장거리 예외',
  [CameraMode.DAY]: '하루 지역 중심',
  [CameraMode.SEGMENT]: '이동수단별'
};

const CAMERA_MODE_HINTS = {
  [CameraMode.AUTO]: '하루 지역을 안정적으로 유지하고 장거리 이동에서만 자연스럽게 넓게 봅니다.',
  [CameraMode.DAY]: '같은 날은 거의 같은 지도 범위를 유지합니다.',
  [CameraMode.SEGMENT]: '이동수단과 거리 변화에 맞춰 줌을 더 적극적으로 바꿉니다.'
};

const MOBILITY_LABELS = {
  WALK: '도보',
  BIKE: '자전거',
  URBAN_TRANSIT: '도시교통',
  ROAD: '도로',
  FAST_GROUND: '철도',
  FERRY: '페리',
  FLIGHT: '항공',
  UNKNOWN: '기타',
  OVERVIEW: '전체 경로'
};

const TRAVEL_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: 'Asia/Tokyo'
});

status.textContent = '지도 소스 확인 중…';
const basemap = await resolveBasemap();
status.textContent = `${basemap.label} 불러오는 중…`;

const map = new maplibregl.Map({
  container: 'map',
  style: basemap.style,
  center: [135.5, 34.7],
  zoom: 4.8,
  attributionControl: true,
  localIdeographFontFamily: 'Noto Sans CJK KR, Apple SD Gothic Neo, Malgun Gothic, sans-serif'
});
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

map.on('load', async () => {
  if (!basemap.local) simplifyAndLocalizeBaseMap(map);

  map.addSource('route-all', { type: 'geojson', data: emptyLine() });
  map.addSource('route-progress', { type: 'geojson', data: emptyFeatureCollection() });
  map.addSource('route-head', { type: 'geojson', data: emptyFeatureCollection() });

  map.addLayer({
    id: 'route-all',
    type: 'line',
    source: 'route-all',
    layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
    paint: { 'line-color': '#64748b', 'line-width': 2.0, 'line-opacity': 0.17 }
  });
  map.addLayer({
    id: 'route-progress-casing',
    type: 'line',
    source: 'route-progress',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-width': 8.2, 'line-opacity': 0.9, 'line-color': '#ffffff' }
  });
  map.addLayer({
    id: 'route-progress',
    type: 'line',
    source: 'route-progress',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-width': 5.2,
      'line-opacity': 1,
      'line-color': ['coalesce', ['get', 'color'], '#ef4444']
    }
  });
  map.addLayer({
    id: 'route-head',
    type: 'circle',
    source: 'route-head',
    paint: {
      'circle-radius': 5.5,
      'circle-color': ['coalesce', ['get', 'color'], '#ef4444'],
      'circle-stroke-width': 2,
      'circle-stroke-color': '#ffffff',
      'circle-opacity': 1
    }
  });

  updateCameraModeHint();
  updateTrackingControls();
  await loadDefaultTimeline();
});

map.on('error', event => {
  const message = event?.error?.message || '';
  if (basemap.local && /pmtiles|range|tile/i.test(message)) {
    status.textContent = `로컬 지도 오류: ${message}`;
  }
});

async function loadDefaultTimeline() {
  const meta = bundledTimelineMeta();
  const sourceName = meta.sourceName || '타임라인.json';
  const sourceType = meta.fullTimeline
    ? `전체 원본 Timeline · ${Number(meta.semanticSegments || 0).toLocaleString()}개`
    : `축소 Timeline · ${Number(meta.semanticSegments || 0).toLocaleString()}개`;

  status.textContent = `${basemap.label} · ${sourceName} 불러오는 중…`;
  setCurrentDataSource(sourceName, sourceType);
  try {
    parsedJson = await loadBundledTimeline();
    currentSourceLabel = sourceName;
    loadButton.disabled = false;
    analyzeParsedTimeline(currentSourceLabel);
  } catch (error) {
    parsedJson = null;
    loadButton.disabled = true;
    videoDate.hidden = true;
    status.textContent = `기본 Timeline 로드 실패: ${error.message}`;
  }
}

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  status.textContent = `파일 읽는 중: ${file.name}`;
  setCurrentDataSource(file.name, '직접 선택 파일');
  try {
    parsedJson = JSON.parse(await file.text());
    currentSourceLabel = file.name;
    loadButton.disabled = false;
    analyzeParsedTimeline(currentSourceLabel);
  } catch (error) {
    parsedJson = null;
    currentData = null;
    loadButton.disabled = true;
    videoDuration.disabled = true;
    playButton.disabled = true;
    resetButton.disabled = true;
    seek.disabled = true;
    videoDate.hidden = true;
    status.textContent = `JSON 파싱 실패: ${error.message}`;
  }
});

loadButton.addEventListener('click', () => {
  if (parsedJson) analyzeParsedTimeline(currentSourceLabel);
});

function analyzeParsedTimeline(sourceLabel) {
  player?.pause();
  playButton.textContent = '재생';
  videoDate.hidden = true;
  status.textContent = `${sourceLabel} 분석 중…`;

  try {
    currentData = parseTimeline(parsedJson, {
      startDate: startDate.value,
      endDate: endDate.value,
      includeFlights: includeFlights.checked
    });
    if (!currentData.movements.length) throw new Error('선택 기간에 이동 구간이 없습니다.');

    const limits = durationLimitsForMovements(currentData.movements);
    videoDuration.min = String(limits.minSeconds);
    videoDuration.max = String(limits.maxSeconds);
    videoDuration.value = String(limits.minSeconds);
    videoDuration.disabled = false;
    updateDurationLabel(limits.minSeconds);
    durationHint.textContent = `${limits.days}일 · 약 ${Math.round(limits.distanceKm).toLocaleString()}km · ${formatDuration(limits.minSeconds)} ~ ${formatDuration(limits.maxSeconds)} · 권장 ${formatDuration(limits.recommendedSeconds)}`;

    rebuildPlan(sourceLabel);
  } catch (error) {
    currentData = null;
    videoDate.hidden = true;
    status.textContent = `계산 실패: ${error.message}`;
  }
}

videoDuration.addEventListener('input', () => updateDurationLabel(Number(videoDuration.value)));
videoDuration.addEventListener('change', () => {
  if (currentData) rebuildPlan('영상 길이 변경');
});

cameraMode.addEventListener('change', () => {
  updateCameraModeHint();
  if (currentData) rebuildPlan('카메라 전략 변경');
});

lockCameraToPosition.addEventListener('change', () => {
  updateTrackingControls();
  player?.setLockToPosition(lockCameraToPosition.checked);
  status.textContent = lockCameraToPosition.checked
    ? '현재 위치에 카메라를 고정했습니다.'
    : `카메라 추적 속도 ${formatTrackingSpeed()}`;
});

cameraTrackingSpeed.addEventListener('input', () => {
  updateTrackingControls();
  player?.setTrackingSpeed(Number(cameraTrackingSpeed.value));
});

showFullRoute.addEventListener('change', () => {
  if (map.getLayer('route-all')) {
    map.setLayoutProperty('route-all', 'visibility', showFullRoute.checked ? 'visible' : 'none');
  }
});

playButton.addEventListener('click', () => {
  if (!player) return;
  if (player.playing) {
    player.pause();
    playButton.textContent = '재생';
    status.textContent = `${currentSourceLabel} · 일시정지`;
  } else {
    player.play();
    playButton.textContent = '일시정지';
    status.textContent = `${currentSourceLabel} · 재생 중 · ${CAMERA_MODE_LABELS[plan.cameraMode]} · ${formatDuration(plan.durationSec)}`;
  }
});

resetButton.addEventListener('click', () => {
  player?.reset();
  playButton.textContent = '재생';
  seek.value = '0';
  status.textContent = `${currentSourceLabel} · 처음 위치 · 재생 대기`;
});

seek.addEventListener('input', () => player?.seek(Number(seek.value)));

function rebuildPlan(sourceLabel = 'Timeline') {
  if (!currentData?.movements.length) return;
  player?.pause();
  playButton.textContent = '재생';
  videoDate.hidden = true;
  status.textContent = `${sourceLabel} · 60fps 경로 계산 중…`;

  requestAnimationFrame(() => {
    try {
      const viewportWidth = map.getCanvas().clientWidth || 1100;
      const viewportHeight = map.getCanvas().clientHeight || 700;
      plan = planPlayback(currentData.movements, {
        fps: 60,
        targetTotalSeconds: Number(videoDuration.value),
        viewportWidth,
        viewportHeight
      });
      plan = applyCameraMode(plan, {
        mode: cameraMode.value,
        viewportWidth,
        viewportHeight
      });

      const fullRoute = currentData.movements.flatMap(segment => segment.points || []);
      map.getSource('route-all').setData(toGeoJSONLine(fullRoute));
      map.getSource('route-progress').setData(emptyFeatureCollection());
      map.getSource('route-head').setData(emptyFeatureCollection());
      map.setLayoutProperty('route-all', 'visibility', showFullRoute.checked ? 'visible' : 'none');

      player = new RoutePlayer({
        map,
        plan,
        onFrame: updateFrameUi,
        onComplete: handlePlaybackComplete,
        lockToPosition: lockCameraToPosition.checked,
        trackingSpeed: Number(cameraTrackingSpeed.value),
        trailSeconds: 3.2
      });
      player.reset();

      playButton.disabled = false;
      resetButton.disabled = false;
      seek.disabled = false;
      seek.max = String(plan.durationSec);
      seek.step = String(1 / plan.fps);
      seek.value = '0';

      const classes = countBy(plan.segments, segment => segment.inference.mobilityClass);
      const inferredCount = currentData.movements.filter(segment => segment.inferred).length;
      summary.innerHTML = [
        '<strong>60 FPS</strong>',
        `<strong>${basemap.label}</strong>`,
        `<strong>${formatDuration(plan.durationSec)}</strong>`,
        `<strong>${plan.segments.length}</strong> 구간`,
        inferredCount ? `<strong>${inferredCount}</strong> 추정 연결` : '',
        ...Object.entries(classes).map(([key, value]) => `${mobilityLabel(key)} ${value}`)
      ].filter(Boolean).join('<span>·</span>');

      status.textContent = `${currentSourceLabel} · 준비 완료 · 재생을 눌러 시작`;
    } catch (error) {
      videoDate.hidden = true;
      status.textContent = `카메라 계산 실패: ${error.message}`;
    }
  });
}

function updateFrameUi(frame) {
  const isOutro = frame.kind === 'OUTRO';
  if (isOutro) {
    currentMode.textContent = '전체 경로';
    currentSpeed.textContent = '—';
    currentZoom.textContent = frame.zoom.toFixed(2);
    currentDate.textContent = '여행 전체';
    videoDate.hidden = true;
  } else {
    const segment = plan.segments[frame.segmentIndex];
    const label = mobilityLabel(frame.mobilityClass);
    currentMode.textContent = segment.inferred ? `${label} · 추정` : label;
    currentSpeed.textContent = `${frame.speedKmh.toFixed(1)} km/h`;
    currentZoom.textContent = frame.zoom.toFixed(2);
    const sourceMs = segment.startMs + (segment.endMs - segment.startMs) * frame.progress;
    const dateLabel = formatTravelDate(sourceMs);
    currentDate.textContent = dateLabel;
    if (videoDate.textContent !== dateLabel) videoDate.textContent = dateLabel;
    videoDate.hidden = false;
  }
  seek.value = String(Math.min(frame.timeSec, plan.durationSec));
}

function handlePlaybackComplete() {
  playButton.textContent = '재생';
  seek.value = String(plan?.durationSec || 0);
  status.textContent = `${currentSourceLabel} · 재생 완료 · 재생을 누르면 처음부터 다시 시작`;
}

function formatTravelDate(ms) {
  const parts = Object.fromEntries(
    TRAVEL_DATE_FORMATTER.formatToParts(new Date(ms))
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value])
  );
  return `${parts.year}.${parts.month}.${parts.day}`;
}

function mobilityLabel(value) {
  return MOBILITY_LABELS[value] || value || '기타';
}

function setCurrentDataSource(name, type) {
  currentDataSourceName.textContent = name || '—';
  currentDataSourceName.title = name || '';
  currentDataSourceType.textContent = type || '';
}

function updateCameraModeHint() {
  cameraModeHint.textContent = CAMERA_MODE_HINTS[cameraMode.value] || CAMERA_MODE_HINTS[CameraMode.AUTO];
}

function updateTrackingControls() {
  const value = Number(cameraTrackingSpeed.value) || 1;
  cameraTrackingSpeedLabel.textContent = `${value.toFixed(1)}×`;
  cameraTrackingSpeed.disabled = lockCameraToPosition.checked;
}

function formatTrackingSpeed() {
  return `${(Number(cameraTrackingSpeed.value) || 1).toFixed(1)}×`;
}

function simplifyAndLocalizeBaseMap(targetMap) {
  const style = targetMap.getStyle();
  const labelExpression = [
    'case',
    ['has', 'name:ko'], ['to-string', ['get', 'name:ko']],
    ['has', 'name_ko'], ['to-string', ['get', 'name_ko']],
    ['has', 'name'], ['to-string', ['get', 'name']],
    ['has', 'name_en'], ['to-string', ['get', 'name_en']],
    ''
  ];

  for (const layer of style.layers || []) {
    if (layer.type !== 'symbol') continue;
    const id = String(layer.id || '').toLowerCase();
    const field = layer.layout?.['text-field'];
    const fieldText = JSON.stringify(field || '').toLowerCase();

    if (/poi|housenumber|house_number|shop|amenity|airport_gate|aeroway_gate/.test(id)) {
      try { targetMap.setLayoutProperty(layer.id, 'visibility', 'none'); } catch {}
      continue;
    }
    if (field && fieldText.includes('name')) {
      try { targetMap.setLayoutProperty(layer.id, 'text-field', labelExpression); } catch {}
    }
  }
}

function updateDurationLabel(seconds) {
  videoDurationLabel.textContent = formatDuration(Number(seconds) || 0);
}

function countBy(items, fn) {
  return items.reduce((acc, item) => {
    const key = fn(item);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function formatDuration(sec) {
  const value = Math.max(0, Math.round(Number(sec) || 0));
  const h = Math.floor(value / 3600);
  const m = Math.floor((value % 3600) / 60);
  const s = value % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function emptyLine() {
  return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } };
}

function emptyFeatureCollection() {
  return { type: 'FeatureCollection', features: [] };
}
