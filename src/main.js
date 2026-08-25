import { parseTimeline } from './timeline-parser.js';
import { durationLimitsForMovements, planPlayback } from './camera-planner.js';
import { applyCameraMode, CameraMode } from './camera-modes.js';
import { RoutePlayer } from './route-player.js';
import { toGeoJSONLine } from './geo.js';
import { loadBundledTimeline } from './bundled-timeline.js';
import { resolveBasemap } from './local-map.js';

const $ = sel => document.querySelector(sel);
const fileInput = $('#timelineFile');
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
const summary = $('#summary');

let parsedJson = null;
let currentData = null;
let player = null;
let plan = null;

const CAMERA_MODE_LABELS = {
  [CameraMode.AUTO]: '자동 · 하루 지역 + 장거리 예외',
  [CameraMode.DAY]: '하루 지역 중심',
  [CameraMode.SEGMENT]: '이동수단별'
};

const CAMERA_MODE_HINTS = {
  [CameraMode.AUTO]: '하루의 주 활동 지역을 기본 줌으로 유지하고 항공·장거리 철도·페리에서만 넓게 봅니다. 짧은 영상에 권장합니다.',
  [CameraMode.DAY]: '같은 날은 거의 같은 줌 스케일을 유지합니다. 도시 안의 여러 이동을 안정적으로 보여줄 때 적합합니다.',
  [CameraMode.SEGMENT]: '도보·지하철·기차 등 각 이동 구간의 거리와 속도에 따라 줌을 적극적으로 바꿉니다.'
};

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
  status.textContent = `${basemap.label} · 내장 테스트 Timeline(2026-03-17~31) 자동 로드 중…`;
  try {
    parsedJson = await loadBundledTimeline();
    loadButton.disabled = false;
    analyzeParsedTimeline('내장 테스트 Timeline', true);
  } catch (error) {
    parsedJson = null;
    loadButton.disabled = true;
    status.textContent = `기본 테스트 데이터 로드 실패: ${error.message}`;
  }
}

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  status.textContent = `파일 읽는 중: ${file.name}`;
  try {
    parsedJson = JSON.parse(await file.text());
    loadButton.disabled = false;
    analyzeParsedTimeline(file.name, false);
  } catch (error) {
    parsedJson = null;
    currentData = null;
    loadButton.disabled = true;
    videoDuration.disabled = true;
    status.textContent = `JSON 파싱 실패: ${error.message}`;
  }
});

loadButton.addEventListener('click', () => {
  if (parsedJson) analyzeParsedTimeline('현재 Timeline', false);
});

function analyzeParsedTimeline(sourceLabel, autoPlay = false) {
  player?.pause();
  playButton.textContent = '재생';
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
    durationHint.textContent = `${limits.days}일 · 약 ${Math.round(limits.distanceKm).toLocaleString()}km · ${formatDuration(limits.minSeconds)} ~ ${formatDuration(limits.maxSeconds)} (권장 ${formatDuration(limits.recommendedSeconds)})`;

    rebuildPlan(sourceLabel, autoPlay);
  } catch (error) {
    currentData = null;
    status.textContent = `계산 실패: ${error.message}`;
  }
}

videoDuration.addEventListener('input', () => updateDurationLabel(Number(videoDuration.value)));
videoDuration.addEventListener('change', () => {
  if (currentData) rebuildPlan('영상 길이 변경', false);
});

cameraMode.addEventListener('change', () => {
  updateCameraModeHint();
  if (currentData) rebuildPlan('카메라 전략 변경', false);
});

lockCameraToPosition.addEventListener('change', () => {
  updateTrackingControls();
  player?.setLockToPosition(lockCameraToPosition.checked);
  status.textContent = lockCameraToPosition.checked
    ? '카메라 고정: 현재 경로 머리를 화면 중앙에 유지합니다.'
    : `카메라 추적: ${formatTrackingSpeed()} 속도로 경로 앞쪽을 따라갑니다.`;
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
  } else {
    player.play();
    playButton.textContent = '일시정지';
  }
});

resetButton.addEventListener('click', () => {
  player?.reset();
  playButton.textContent = '재생';
  seek.value = '0';
});

seek.addEventListener('input', () => player?.seek(Number(seek.value)));

function rebuildPlan(sourceLabel = 'Timeline', autoPlay = false) {
  if (!currentData?.movements.length) return;
  player?.pause();
  playButton.textContent = '재생';
  status.textContent = `${sourceLabel} · 60fps 경로 계산 중…`;

  requestAnimationFrame(async () => {
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
        `<strong>${CAMERA_MODE_LABELS[plan.cameraMode] || plan.cameraMode}</strong>`,
        `<strong>${formatDuration(plan.durationSec)}</strong>`,
        `<strong>${plan.segments.length}</strong> 이동 구간`,
        inferredCount ? `<strong>${inferredCount}</strong> 추정 연결` : '',
        ...Object.entries(classes).map(([key, value]) => `${key} ${value}`)
      ].filter(Boolean).join('<span>·</span>');

      if (autoPlay) {
        status.textContent = `${basemap.label} 준비 중 · 첫 화면 타일 로딩…`;
        await waitForMapIdle(1800);
        player.play();
        playButton.textContent = '일시정지';
        status.textContent = `내장 테스트 Timeline 자동 재생 중 · ${basemap.label} · ${CAMERA_MODE_LABELS[plan.cameraMode]} · ${formatDuration(plan.durationSec)}`;
      } else {
        status.textContent = `${basemap.label} · ${CAMERA_MODE_LABELS[plan.cameraMode]} 준비 완료 · 마지막 ${plan.outroSec.toFixed(1)}초 전체 경로`;
      }
    } catch (error) {
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
  } else {
    const segment = plan.segments[frame.segmentIndex];
    currentMode.textContent = segment.inferred ? `${frame.mobilityClass} · 추정` : frame.mobilityClass;
    currentSpeed.textContent = `${frame.speedKmh.toFixed(1)} km/h`;
    currentZoom.textContent = frame.zoom.toFixed(2);
    const sourceMs = segment.startMs + (segment.endMs - segment.startMs) * frame.progress;
    currentDate.textContent = new Intl.DateTimeFormat('ko-KR', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
      timeZone: 'Asia/Tokyo'
    }).format(new Date(sourceMs));
  }
  seek.value = String(Math.min(frame.timeSec, plan.durationSec));
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

function waitForMapIdle(timeoutMs = 1800) {
  if (map.loaded() && map.areTilesLoaded?.()) return Promise.resolve();
  return new Promise(resolve => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      map.off('idle', finish);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    map.once('idle', finish);
  });
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
