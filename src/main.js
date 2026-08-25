import { parseTimeline } from './timeline-parser.js';
import { planPlayback } from './camera-planner.js';
import { RoutePlayer } from './route-player.js';
import { boundsForPoints, toGeoJSONLine } from './geo.js';

const $ = sel => document.querySelector(sel);
const fileInput = $('#timelineFile');
const startDate = $('#startDate');
const endDate = $('#endDate');
const includeFlights = $('#includeFlights');
const lockCameraToPosition = $('#lockCameraToPosition');
const showFullRoute = $('#showFullRoute');
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
let player = null;
let plan = null;
let currentMarker = null;
let currentMarkerElement = null;

const map = new maplibregl.Map({
  container: 'map',
  style: 'https://tiles.openfreemap.org/styles/liberty',
  center: [135.5, 34.7],
  zoom: 4.8,
  attributionControl: true
});
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

map.on('load', () => {
  map.addSource('route-all', { type: 'geojson', data: emptyLine() });
  map.addSource('route-progress', { type: 'geojson', data: emptyLine(), lineMetrics: true });
  map.addLayer({
    id: 'route-all',
    type: 'line',
    source: 'route-all',
    layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
    paint: { 'line-color': '#64748b', 'line-width': 2.2, 'line-opacity': 0.20 }
  });
  map.addLayer({
    id: 'route-progress',
    type: 'line',
    source: 'route-progress',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-width': 4.5,
      'line-opacity': 0.96,
      'line-gradient': ['step', ['line-progress'], 'rgba(239, 68, 68, 0)', 1, 'rgba(239, 68, 68, 0)']
    }
  });

  currentMarkerElement = document.createElement('div');
  currentMarkerElement.className = 'current-location-marker is-hidden';
  currentMarkerElement.innerHTML = '<span class="current-location-dot"></span><span class="current-location-ring"></span>';
  currentMarker = new maplibregl.Marker({ element: currentMarkerElement, anchor: 'center' })
    .setLngLat([135.5, 34.7])
    .addTo(map);

  status.textContent = '타임라인 JSON을 선택하세요.';
});

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  status.textContent = `파일 읽는 중: ${file.name}`;
  try {
    parsedJson = JSON.parse(await file.text());
    status.textContent = `파일 준비 완료: ${file.name}`;
    loadButton.disabled = false;
  } catch (error) {
    parsedJson = null;
    loadButton.disabled = true;
    status.textContent = `JSON 파싱 실패: ${error.message}`;
  }
});

loadButton.addEventListener('click', () => {
  if (!parsedJson) return;
  status.textContent = '이동 구간과 카메라 궤적 계산 중…';
  requestAnimationFrame(() => {
    try {
      const data = parseTimeline(parsedJson, {
        startDate: startDate.value,
        endDate: endDate.value,
        includeFlights: includeFlights.checked
      });
      if (!data.movements.length) throw new Error('선택 기간에 이동 구간이 없습니다.');

      plan = planPlayback(data.movements, {
        fps: 30,
        maxTotalSeconds: 300,
        viewportWidth: map.getCanvas().clientWidth || 1100,
        viewportHeight: map.getCanvas().clientHeight || 700
      });

      const fullRoute = data.movements.flatMap(s => s.points);
      map.getSource('route-all').setData(toGeoJSONLine(fullRoute));
      map.getSource('route-progress').setData(toGeoJSONLine(plan.frames.map(frame => frame.position)));
      map.setLayoutProperty('route-all', 'visibility', showFullRoute.checked ? 'visible' : 'none');
      currentMarkerElement?.classList.add('is-hidden');
      fitRoute(fullRoute);

      player = new RoutePlayer({
        map,
        plan,
        onFrame: updateFrameUi,
        lockToPosition: lockCameraToPosition.checked,
        trailSeconds: 10
      });
      player.reset();

      playButton.disabled = false;
      resetButton.disabled = false;
      seek.disabled = false;
      seek.max = String(plan.durationSec);
      seek.value = '0';

      const classes = countBy(plan.segments, s => s.inference.mobilityClass);
      const inferredCount = data.movements.filter(s => s.inferred).length;
      summary.innerHTML = [
        `<strong>${plan.segments.length}</strong> 이동 구간`,
        `<strong>${formatDuration(plan.durationSec)}</strong> 재생 길이`,
        inferredCount ? `<strong>${inferredCount}</strong> 추정 연결` : '',
        ...Object.entries(classes).map(([k, v]) => `${k} ${v}`)
      ].filter(Boolean).join('<span>·</span>');
      status.textContent = lockCameraToPosition.checked
        ? '현재 위치 고정 · 최근 경로만 표시 · 빈 구간 자동 연결'
        : '시네마틱 카메라 · 최근 경로만 표시 · 빈 구간 자동 연결';
    } catch (error) {
      status.textContent = `계산 실패: ${error.message}`;
    }
  });
});

lockCameraToPosition.addEventListener('change', () => {
  player?.setLockToPosition(lockCameraToPosition.checked);
  status.textContent = lockCameraToPosition.checked
    ? '현재 위치 고정 모드입니다.'
    : '시네마틱 카메라 모드입니다.';
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

function updateFrameUi(frame) {
  if (currentMarker) {
    currentMarker.setLngLat([frame.position.lng, frame.position.lat]);
    currentMarkerElement?.classList.remove('is-hidden');
  }
  const segment = plan.segments[frame.segmentIndex];
  currentMode.textContent = segment.inferred ? `${frame.mobilityClass} · 추정` : frame.mobilityClass;
  currentSpeed.textContent = `${frame.speedKmh.toFixed(1)} km/h`;
  currentZoom.textContent = frame.zoom.toFixed(2);
  const sourceMs = segment.startMs + (segment.endMs - segment.startMs) * frame.progress;
  currentDate.textContent = new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    timeZone: 'Asia/Tokyo'
  }).format(new Date(sourceMs));
  seek.value = String(frame.timeSec);
}

function fitRoute(points) {
  const b = boundsForPoints(points);
  if (!b) return;
  map.fitBounds([[b.minLng, b.minLat], [b.maxLng, b.maxLat]], {
    padding: { top: 70, right: 70, bottom: 70, left: 70 }, duration: 650, maxZoom: 11
  });
}

function countBy(items, fn) {
  return items.reduce((acc, item) => {
    const key = fn(item); acc[key] = (acc[key] || 0) + 1; return acc;
  }, {});
}
function formatDuration(sec) {
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
function emptyLine() { return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } }; }
