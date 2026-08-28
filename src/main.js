import { durationLimitsForMovements, planPlayback, PlaybackPacing } from './camera-planner.js';
import { parseTimeline } from './timeline-parser.js';
import { applyCameraMode, CameraMode } from './camera-modes.js';
import { RoutePlayer } from './route-player.js';
import { toGeoJSONLine } from './geo.js';
import { bundledTimelineMeta, loadBundledTimeline } from './bundled-timeline.js';
import { resolveBasemap } from './local-map.js';
import {
  buildPhotoJourneyBeats,
  JourneyMode,
  loadGooglePhotosTakeout,
  PhotoJourneyController
} from './photo-journey.js';

const $ = sel => document.querySelector(sel);
const fileInput = $('#timelineFile');
const currentDataSourceName = $('#currentDataSourceName');
const currentDataSourceType = $('#currentDataSourceType');
const startDate = $('#startDate');
const endDate = $('#endDate');
const includeFlights = $('#includeFlights');
const journeyMode = $('#journeyMode');
const journeyModeHint = $('#journeyModeHint');
const photoImportBlock = $('#photoImportBlock');
const photoFolderInput = $('#photoFolderInput');
const photoImportCount = $('#photoImportCount');
const photoImportHint = $('#photoImportHint');
const cameraMode = $('#cameraMode');
const cameraModeHint = $('#cameraModeHint');
const cameraZoomOffset = $('#cameraZoomOffset');
const cameraZoomOffsetLabel = $('#cameraZoomOffsetLabel');
const playbackPacing = $('#playbackPacing');
const playbackPacingHint = $('#playbackPacingHint');
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
const stage = $('.stage');
const photoJourneyLayer = $('#photoJourneyLayer');
const photoCard = $('#photoCard');
const photoImages = $('#photoImages');
const photoPlace = $('#photoPlace');
const photoTime = $('#photoTime');
const photoMeta = $('#photoMeta');
const photoLeader = $('#photoLeader');
const photoLeaderDot = $('#photoLeaderDot');

let parsedJson = null;
let currentData = null;
let currentSourceLabel = '타임라인.json';
let player = null;
let plan = null;
let photoController = null;
let photoLibrary = [];
let photoBeats = [];

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

const JOURNEY_MODE_LABELS = {
  [JourneyMode.ROUTE]: '발자취',
  [JourneyMode.PHOTOS]: '사진 여정'
};

const JOURNEY_MODE_HINTS = {
  [JourneyMode.ROUTE]: '전체 이동 경로를 중심으로 여행의 흐름을 보여줍니다.',
  [JourneyMode.PHOTOS]: '지도·경로와 미디어 영역을 같은 구도로 유지하면서 촬영 시각과 위치가 맞는 사진·동영상을 순서대로 보여줍니다.'
};

const PACING_LABELS = {
  [PlaybackPacing.LOCAL_DAYS]: '현지 여행일 균형',
  [PlaybackPacing.GLOBAL]: '전체 이동 균형'
};

const PACING_HINTS = {
  [PlaybackPacing.LOCAL_DAYS]: '항공편의 비중은 유지하고 현지 이동을 날짜별로 나눕니다. 장거리 당일치기와 왕복 이동에는 추가 시간을 확보합니다.',
  [PlaybackPacing.GLOBAL]: '모든 이동구간이 전체 영상 시간을 직접 나눕니다. 긴 여행에서는 특정 현지 날짜가 매우 빠르게 지나갈 수 있습니다.'
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
  year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Tokyo'
});
const TRAVEL_MINUTE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
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
  map.addSource('photo-anchor', { type: 'geojson', data: emptyFeatureCollection() });

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
  map.addLayer({
    id: 'photo-anchor',
    type: 'circle',
    source: 'photo-anchor',
    paint: {
      'circle-radius': 7,
      'circle-color': '#ffffff',
      'circle-stroke-width': 3,
      'circle-stroke-color': '#0f172a',
      'circle-opacity': 0.96
    }
  });

  photoController = new PhotoJourneyController({
    map,
    stage,
    layer: photoJourneyLayer,
    card: photoCard,
    images: photoImages,
    place: photoPlace,
    time: photoTime,
    meta: photoMeta,
    leader: photoLeader,
    leaderDot: photoLeaderDot
  });

  updateJourneyModeUi();
  updateCameraModeHint();
  updateZoomOffsetLabel();
  updatePlaybackPacingHint();
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
    photoController?.clear();
    videoDate.hidden = true;
    status.textContent = `JSON 파싱 실패: ${error.message}`;
  }
});

photoFolderInput.addEventListener('change', async () => {
  const files = photoFolderInput.files;
  if (!files?.length) return;
  player?.pause();
  playButton.textContent = '재생';
  photoImportCount.textContent = '읽는 중…';
  photoImportHint.textContent = 'Google Photos Takeout의 미디어 메타데이터와 sidecar JSON을 분석하는 중입니다.';
  status.textContent = `Google Photos 데이터 읽는 중 · ${files.length.toLocaleString()}개 파일`;

  try {
    const result = await loadGooglePhotosTakeout(files, {
      onProgress: progress => {
        if (progress.total) photoImportCount.textContent = `${progress.found.toLocaleString()}개 찾음`;
      }
    });
    photoLibrary = result.photos;
    const stats = result.stats;
    const imageCount = Number(stats.images) || 0;
    const videoCount = Number(stats.videos) || 0;
    photoImportCount.textContent = `사진 ${imageCount.toLocaleString()}장 · 영상 ${videoCount.toLocaleString()}개 · GPS ${stats.gpsPhotos.toLocaleString()}개`;
    photoImportHint.textContent = stats.photos
      ? `미디어 ${stats.photos.toLocaleString()}개 중 GPS ${stats.gpsPhotos.toLocaleString()}개를 직접 사용합니다. 나머지는 촬영 시각에 맞는 Timeline 위치로 보완합니다.`
      : '사용 가능한 사진·동영상을 찾지 못했습니다. Takeout 폴더에서 미디어 파일과 JSON sidecar가 함께 선택됐는지 확인하세요.';
    status.textContent = `Google Photos 데이터 준비 완료 · 사진 ${imageCount.toLocaleString()}장 · 영상 ${videoCount.toLocaleString()}개`;
    if (currentData && journeyMode.value === JourneyMode.PHOTOS) rebuildPlan('사진 데이터 변경');
  } catch (error) {
    photoLibrary = [];
    photoBeats = [];
    photoImportCount.textContent = '가져오기 실패';
    photoImportHint.textContent = error.message;
    photoController?.clear();
    status.textContent = `사진 데이터 처리 실패: ${error.message}`;
  }
});

loadButton.addEventListener('click', () => {
  if (parsedJson) analyzeParsedTimeline(currentSourceLabel, { preserveVideoDuration: true });
});

function analyzeParsedTimeline(sourceLabel, { preserveVideoDuration = false } = {}) {
  player?.pause();
  playButton.textContent = '재생';
  photoController?.clearActive();
  videoDate.hidden = true;
  status.textContent = `${sourceLabel} 분석 중…`;
  const previousDuration = Number(videoDuration.value);

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
    const nextDuration = preserveVideoDuration && Number.isFinite(previousDuration)
      ? Math.min(limits.maxSeconds, Math.max(limits.minSeconds, previousDuration))
      : limits.minSeconds;
    videoDuration.value = String(nextDuration);
    videoDuration.disabled = false;
    updateDurationLabel(nextDuration);
    durationHint.textContent = `${limits.days}일 · 약 ${Math.round(limits.distanceKm).toLocaleString()}km · 경로 ${formatDuration(limits.minSeconds)} ~ ${formatDuration(limits.maxSeconds)} · 권장 ${formatDuration(limits.recommendedSeconds)}`;

    rebuildPlan(sourceLabel);
  } catch (error) {
    currentData = null;
    player = null;
    plan = null;
    photoBeats = [];
    photoController?.clear();
    stage?.classList.remove('photo-journey-layout-active');
    videoDuration.disabled = true;
    playButton.disabled = true;
    resetButton.disabled = true;
    seek.disabled = true;
    seek.value = '0';
    summary.replaceChildren();
    map.getSource('route-all')?.setData(emptyLine());
    map.getSource('route-progress')?.setData(emptyFeatureCollection());
    map.getSource('route-head')?.setData(emptyFeatureCollection());
    map.getSource('photo-anchor')?.setData(emptyFeatureCollection());
    videoDate.hidden = true;
    status.textContent = `계산 실패: ${error.message}`;
  }
}

videoDuration.addEventListener('input', () => updateDurationLabel(Number(videoDuration.value)));
videoDuration.addEventListener('change', () => {
  if (currentData) rebuildPlan('영상 길이 변경');
});

journeyMode.addEventListener('change', () => {
  updateJourneyModeUi();
  if (currentData) rebuildPlan('영상 모드 변경');
});

cameraMode.addEventListener('change', () => {
  updateCameraModeHint();
  if (currentData) rebuildPlan('카메라 전략 변경');
});

cameraZoomOffset.addEventListener('input', updateZoomOffsetLabel);
cameraZoomOffset.addEventListener('change', () => {
  if (currentData) rebuildPlan('현지 줌 변경');
});

playbackPacing.addEventListener('change', () => {
  updatePlaybackPacingHint();
  if (currentData) rebuildPlan('시간 배분 변경');
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
    status.textContent = `${currentSourceLabel} · ${JOURNEY_MODE_LABELS[journeyMode.value]} · 재생 중 · ${CAMERA_MODE_LABELS[plan.cameraMode]} · ${PACING_LABELS[plan.pacingMode]} · ${formatDuration(plan.durationSec)}`;
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
  photoController?.clearActive();
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
        viewportHeight,
        pacingMode: playbackPacing.value
      });
      plan = applyCameraMode(plan, {
        mode: cameraMode.value,
        zoomOffset: Number(cameraZoomOffset.value),
        viewportWidth,
        viewportHeight
      });

      const photoMode = journeyMode.value === JourneyMode.PHOTOS;
      photoBeats = photoMode ? buildPhotoJourneyBeats(photoLibrary, plan) : [];
      photoController?.setEnabled(photoMode);
      photoController?.setJourney(plan, photoBeats);

      const fullRoute = currentData.movements.flatMap(segment => segment.points || []);
      map.getSource('route-all').setData(toGeoJSONLine(fullRoute));
      map.getSource('route-progress').setData(emptyFeatureCollection());
      map.getSource('route-head').setData(emptyFeatureCollection());
      map.getSource('photo-anchor').setData(emptyFeatureCollection());
      map.setLayoutProperty('route-all', 'visibility', showFullRoute.checked ? 'visible' : 'none');

      player = new RoutePlayer({
        map,
        plan,
        onFrame: updateFrameUi,
        onComplete: handlePlaybackComplete,
        lockToPosition: lockCameraToPosition.checked,
        trackingSpeed: Number(cameraTrackingSpeed.value),
        trailSeconds: photoMode ? 4.8 : 3.2
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
        `<strong>${JOURNEY_MODE_LABELS[journeyMode.value]}</strong>`,
        photoMode ? `<strong>사진 장면 ${photoBeats.length}</strong>` : '',
        '<strong>60 FPS</strong>',
        `<strong>${PACING_LABELS[plan.pacingMode]}</strong>`,
        `<strong>현지 줌 ${formatZoomOffset(plan.zoomOffset)}</strong>`,
        `<strong>${basemap.label}</strong>`,
        `<strong>${formatDuration(plan.durationSec)}</strong>`,
        `<strong>${plan.segments.length}</strong> 구간`,
        inferredCount ? `<strong>${inferredCount}</strong> 추정 연결` : '',
        ...Object.entries(classes).map(([key, value]) => `${mobilityLabel(key)} ${value}`)
      ].filter(Boolean).join('<span>·</span>');

      status.textContent = photoMode && !photoBeats.length
        ? `${currentSourceLabel} · 사진 여정 준비 · 현재 Timeline에 매칭된 미디어 장면이 없습니다`
        : `${currentSourceLabel} · 준비 완료 · 재생을 눌러 시작`;
    } catch (error) {
      photoController?.clear();
      stage?.classList.remove('photo-journey-layout-active');
      videoDate.hidden = true;
      status.textContent = `카메라 계산 실패: ${error.message}`;
    }
  });
}

function updateFrameUi(frame, frameIndex) {
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
    const dateLabel = journeyMode.value === JourneyMode.PHOTOS
      ? formatTravelMinute(sourceMs)
      : formatTravelDate(sourceMs);
    currentDate.textContent = dateLabel;
    if (videoDate.textContent !== dateLabel) videoDate.textContent = dateLabel;
    videoDate.hidden = false;
  }
  photoController?.render(frame, frameIndex);
  seek.value = String(Math.min(frame.timeSec, plan.durationSec));
}

function handlePlaybackComplete() {
  photoController?.clearActive();
  playButton.textContent = '재생';
  seek.value = String(plan?.durationSec || 0);
  status.textContent = `${currentSourceLabel} · 재생 완료 · 재생을 누르면 처음부터 다시 시작`;
}

function formatTravelDate(ms) {
  return formatDateParts(TRAVEL_DATE_FORMATTER, ms, false);
}

function formatTravelMinute(ms) {
  return formatDateParts(TRAVEL_MINUTE_FORMATTER, ms, true);
}

function formatDateParts(formatter, ms, includeTime) {
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(ms))
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value])
  );
  const date = `${parts.year}.${parts.month}.${parts.day}`;
  return includeTime ? `${date} ${parts.hour}:${parts.minute}` : date;
}

function mobilityLabel(value) {
  return MOBILITY_LABELS[value] || value || '기타';
}

function setCurrentDataSource(name, type) {
  currentDataSourceName.textContent = name || '—';
  currentDataSourceName.title = name || '';
  currentDataSourceType.textContent = type || '';
}

function updateJourneyModeUi() {
  const photoMode = journeyMode.value === JourneyMode.PHOTOS;
  photoImportBlock.hidden = !photoMode;
  journeyModeHint.textContent = JOURNEY_MODE_HINTS[journeyMode.value] || JOURNEY_MODE_HINTS[JourneyMode.ROUTE];
  photoController?.setEnabled(photoMode);
}

function updateCameraModeHint() {
  cameraModeHint.textContent = CAMERA_MODE_HINTS[cameraMode.value] || CAMERA_MODE_HINTS[CameraMode.AUTO];
}

function updateZoomOffsetLabel() {
  cameraZoomOffsetLabel.textContent = formatZoomOffset(Number(cameraZoomOffset.value) || 0);
}

function formatZoomOffset(value) {
  const safe = Number(value) || 0;
  return `${safe > 0 ? '+' : ''}${safe.toFixed(1)}`;
}

function updatePlaybackPacingHint() {
  playbackPacingHint.textContent = PACING_HINTS[playbackPacing.value] || PACING_HINTS[PlaybackPacing.LOCAL_DAYS];
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
