import { parseTimeline } from './timeline-parser.js';
import { durationLimitsForMovements, planPlayback } from './camera-planner.js';
import { RoutePlayer } from './route-player.js';
import { toGeoJSONLine } from './geo.js';
import { loadBundledTimeline } from './bundled-timeline.js';

const $ = sel => document.querySelector(sel);
const fileInput = $('#timelineFile');
const startDate = $('#startDate');
const endDate = $('#endDate');
const includeFlights = $('#includeFlights');
const lockCameraToPosition = $('#lockCameraToPosition');
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

const map = new maplibregl.Map({
  container: 'map',
  style: 'https://tiles.openfreemap.org/styles/positron',
  center: [135.5, 34.7],
  zoom: 4.8,
  attributionControl: true
});
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

map.on('load', async () => {
  simplifyAndLocalizeBaseMap(map);

  map.addSource('route-all', { type: 'geojson', data: emptyLine() });
  map.addSource('route-progress', { type: 'geojson', data: emptyLine(), lineMetrics: true });
  map.addLayer({
    id: 'route-all',
    type: 'line',
    source: 'route-all',
    layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
    paint: { 'line-color': '#64748b', 'line-width': 2.0, 'line-opacity': 0.17 }
  });
  map.addLayer({
    id: 'route-progress',
    type: 'line',
    source: 'route-progress',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-width': 4.8, 'line-opacity': 0.98, 'line-color': '#ef4444' }
  });

  await loadDefaultTimeline();
});

async function loadDefaultTimeline() {
  status.textContent = '기본 테스트 Timeline(2026-03-17~31) 자동 로드 중…';
  try {
    parsedJson = await loadBundledTimeline();
    loadButton.disabled = false;
    analyzeParsedTimeline('내장 테스트 Timeline');
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
    analyzeParsedTimeline(file.name);
  } catch (error) {
    parsedJson = null;
    currentData = null;
    loadButton.disabled = true;
    videoDuration.disabled = true;
    status.textContent = `JSON 파싱 실패: ${error.message}`;
  }
});

loadButton.addEventListener('click', () => {
  if (parsedJson) analyzeParsedTimeline('현재 Timeline');
});

function analyzeParsedTimeline(sourceLabel) {
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
    videoDuration.value = String(limits.recommendedSeconds);
    videoDuration.disabled = false;
    updateDurationLabel(limits.recommendedSeconds);
    durationHint.textContent = `${limits.days}일 · 약 ${Math.round(limits.distanceKm).toLocaleString()}km · ${formatDuration(limits.minSeconds)} ~ ${formatDuration(limits.maxSeconds)} (권장 ${formatDuration(limits.recommendedSeconds)})`;

    rebuildPlan(sourceLabel);
  } catch (error) {
    currentData = null;
    status.textContent = `계산 실패: ${error.message}`;
  }
}

videoDuration.addEventListener('input', () => updateDurationLabel(Number(videoDuration.value)));
videoDuration.addEventListener('change', () => {
  if (currentData) rebuildPlan('영상 길이 변경');
});

lockCameraToPosition.addEventListener('change', () => {
  player?.setLockToPosition(lockCameraToPosition.checked);
  status.textContent = lockCameraToPosition.checked
    ? '현재 경로 머리를 화면 중앙에 고정합니다.'
    : '시네마틱 카메라 중심을 사용합니다.';
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

function rebuildPlan(sourceLabel = 'Timeline') {
  if (!currentData?.movements.length) return;
  player?.pause();
  playButton.textContent = '재생';
  status.textContent = `${sourceLabel} · 60fps 경로 계산 중…`;

  requestAnimationFrame(() => {
    try {
      plan = planPlayback(currentData.movements, {
        fps: 60,
        targetTotalSeconds: Number(videoDuration.value),
        viewportWidth: map.getCanvas().clientWidth || 1100,
        viewportHeight: map.getCanvas().clientHeight || 700
      });

      // Complete route including inferred bridge segments. Hidden by default during travel.
      const fullRoute = currentData.movements.flatMap(segment => segment.points || []);
      map.getSource('route-all').setData(toGeoJSONLine(fullRoute));
      map.getSource('route-progress').setData(emptyLine());
      map.setLayoutProperty('route-all', 'visibility', showFullRoute.checked ? 'visible' : 'none');

      player = new RoutePlayer({
        map,
        plan,
        onFrame: updateFrameUi,
        lockToPosition: lockCameraToPosition.checked,
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
        `<strong>${formatDuration(plan.durationSec)}</strong>`,
        `<strong>${plan.segments.length}</strong> 이동 구간`,
        inferredCount ? `<strong>${inferredCount}</strong> 추정 연결` : '',
        ...Object.entries(classes).map(([key, value]) => `${key} ${value}`)
      ].filter(Boolean).join('<span>·</span>');
      status.textContent = `기본 테스트 데이터 준비 완료 · 재생 버튼을 누르세요 · 마지막 ${plan.outroSec.toFixed(1)}초 전체 경로`;
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
