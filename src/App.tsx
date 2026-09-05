import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { AlertCircle, ArrowRight, Check, FileJson, FolderOpen, HelpCircle, Images, Pause, Play, RotateCcw, Route, Settings2, ShieldCheck, Upload, X } from 'lucide-react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { ONLINE_STYLE_URL } from './map/map-style';
import { resolveCityLabel } from './map/city-label';
import { resolvePhotoPlaceLabel } from './map/photo-place-label';
import { PlayerController } from './player/player-controller';
import { buildDayMarkerStops } from './media/day-markers';
import { loadJourneyMedia, organizeJourneyMedia } from './media/media-library';
import { loadLocalMediaManifest } from './media/local-media-library';
import { MediaJourneyPane } from './media/MediaJourneyPane';
import { TimelineWorkerClient, type TimelineWorkerPort } from './services/timeline-worker-client';
import { appReducer, initialAppState } from './state/app-reducer';
import { SettingsPanel } from './ui/SettingsPanel';
import { HelpDialog } from './ui/HelpDialog';
import { MediaLibraryDialog } from './ui/MediaLibraryDialog';
import { usePreferences } from './settings/preferences';
import { usePlaybackChrome } from './ui/playback-chrome';
import type { CameraMode, PacingMode, JourneyMedia, LocalMediaManifest, MapSourceConfig, MediaImportProgress, MobilityClass, PhotoViewMode, PlaybackFrame, PlaybackPlan, PlaybackStop, TimelineSource, TravelFrame } from './types';

interface AppProps {
  workerClient?: TimelineWorkerPort;
}

interface HudState {
  timeSec: number;
  date: string;
  mobilityClass: MobilityClass;
  mobility: string;
  speed: string;
  originCity: string | null;
  destinationCity: string | null;
}

interface AppliedPlanSettings {
  startDate: string;
  endDate: string;
  includeFlights: boolean;
  cameraMode: CameraMode;
  pacingMode: PacingMode;
  durationSec: number;
}

type JourneyMode = 'ROUTE' | 'PHOTOS';

const MOBILITY_LABELS: Record<string, string> = {
  WALK: '도보', BIKE: '자전거', URBAN_TRANSIT: '대중교통', FAST_GROUND: '기차',
  FERRY: '페리', FLIGHT: '비행기', ROAD: '차량', UNKNOWN: '기타'
};

const PHOTO_MAP_MIN_DESKTOP = 0.38;
const PHOTO_MAP_MIN_MOBILE = 0.34;
const MapStage = lazy(() => import('./map/MapStage').then(module => ({ default: module.MapStage })));

export function App({ workerClient }: AppProps) {
  const [state, dispatch] = useReducer(appReducer, initialAppState);
  const [client] = useState<TimelineWorkerPort>(() => workerClient ?? new TimelineWorkerClient());

  const { preferences, update: updatePreference, reset: resetPreferences } = usePreferences();
  const { includeFlights, cameraMode, zoomOffset, pacingMode, lockToPosition, photoViewMode, photoDisplaySec, photoDetailZoomMode, photoDetailZoomStrength, showDayMarkers, dayMarkerSec, videoMode, videoMuted, videoMaxSec } = preferences;
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [excludedMedia, setExcludedMedia] = useState<Set<string>>(() => new Set());
  const [helpOpen, setHelpOpen] = useState(false);
  const [dismissedNotice, setDismissedNotice] = useState('');
  const [activeStopElapsed, setActiveStopElapsed] = useState(0);
  const [mapNotice, setMapNotice] = useState<string | null>(null);
  const lastLoadedPlanRef = useRef<PlaybackPlan | null>(null);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [mapRevision, setMapRevision] = useState(0);
  const [mapKind, setMapKind] = useState<'online' | 'local-pmtiles'>('online');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [targetDurationSec, setTargetDurationSec] = useState(0);
  const [journeyMode, setJourneyMode] = useState<JourneyMode>('ROUTE');
  const [mediaLibrary, setMediaLibrary] = useState<{ preview: JourneyMedia[]; all: JourneyMedia[] }>({ preview: [], all: [] });
  const [activeMediaId, setActiveMediaId] = useState<string | null>(null);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [mediaProgress, setMediaProgress] = useState<MediaImportProgress | null>(null);
  const [localMediaManifest, setLocalMediaManifest] = useState<LocalMediaManifest | null>(null);
  const [splitNarrow, setSplitNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth <= 820);
  const [desktopMapShare, setDesktopMapShare] = useState(PHOTO_MAP_MIN_DESKTOP);
  const [mobileMapShare, setMobileMapShare] = useState(PHOTO_MAP_MIN_MOBILE);
  const [activePlaceName, setActivePlaceName] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [appliedPlanSettings, setAppliedPlanSettings] = useState<AppliedPlanSettings | null>(null);
  const [hud, setHud] = useState<HudState>({ timeSec: 0, date: '—', mobilityClass: 'UNKNOWN', mobility: '여행 준비', speed: '—', originCity: null, destinationCity: null });
  const playersRef = useRef<Record<JourneyMode, PlayerController | null>>({ ROUTE: null, PHOTOS: null });
  const journeyModeRef = useRef<JourneyMode>('ROUTE');
  const playbackPositionsRef = useRef<Record<JourneyMode, number>>({ ROUTE: 0, PHOTOS: 0 });
  const photoPlaybackStopsRef = useRef<PlaybackStop[]>([]);
  const autoPlanRef = useRef(false);
  const durationCustomizedRef = useRef(false);
  const [durationCustomized, setDurationCustomized] = useState(false);
  const scanOperationRef = useRef(0);
  const mediaOperationRef = useRef(0);
  const manualTimelineSelectedRef = useRef(false);
  const manualMediaSelectedRef = useRef(false);
  const selectedMediaFilesRef = useRef<File[]>([]);
  const lastLocalMediaPlanRef = useRef<PlaybackPlan | null>(null);
  const mediaLibraryLoadedRef = useRef(false);
  const mediaRef = useRef<JourneyMedia[]>([]);
  const activeMediaRef = useRef<string | null>(null);
  const shellRef = useRef<HTMLElement>(null);
  const lastHudUpdateRef = useRef(0);
  const cityRouteCacheRef = useRef(new Map<number, { originCity: string | null; destinationCity: string | null; lastAttemptMs: number }>());
  const [selectedMediaSummary, setSelectedMediaSummary] = useState<{ name: string; count: number } | null>(null);
  const media = useMemo(() => state.plan ? organizeJourneyMedia(mediaLibrary.all.filter(item => !excludedMedia.has(item.id)), state.plan, photoViewMode) : [], [excludedMedia, mediaLibrary, photoViewMode, state.plan]);
  const playbackChrome = usePlaybackChrome({ playing: state.phase === 'playing', keepVisible: settingsOpen });

  const mapSource = useMemo<MapSourceConfig>(() => mapKind === 'online'
    ? { kind: 'online', styleUrl: ONLINE_STYLE_URL }
    : {
        kind: 'local-pmtiles',
        worldUrl: `${location.origin}/maps/world-z5.pmtiles`,
        regionUrl: `${location.origin}/maps/korea-japan-z14.pmtiles`
      }, [mapKind]);

  const reportProgress = useCallback((progress: number, message: string) => {
    dispatch({ type: 'PROGRESS', progress, message });
  }, []);

  const minimizePhotoRoute = useCallback(() => {
    setDesktopMapShare(PHOTO_MAP_MIN_DESKTOP);
    setMobileMapShare(PHOTO_MAP_MIN_MOBILE);
  }, []);

  const pausePlayback = useCallback((mode: JourneyMode = journeyModeRef.current) => {
    const player = playersRef.current[mode];
    if (!player) return;
    const wasPlaying = player.isPlaying();
    player.pause();
    if (wasPlaying && mode === journeyModeRef.current) dispatch({ type: 'PAUSE' });
  }, []);

  const changeJourneyMode = useCallback((mode: JourneyMode, resetTarget = false) => {
    const currentMode = journeyModeRef.current;
    if (mode === currentMode && !resetTarget) return;
    pausePlayback(currentMode);
    if (resetTarget) playbackPositionsRef.current[mode] = 0;
    let targetTimeSec = playbackPositionsRef.current[mode];
    journeyModeRef.current = mode;
    if (mode === 'PHOTOS' && resetTarget) minimizePhotoRoute();
    setJourneyMode(mode);
    activeMediaRef.current = null;
    setActiveMediaId(null);
    setActivePlaceName(null);
    const targetPlayer = playersRef.current[mode];
    if (targetPlayer) {
      if (mode === 'PHOTOS') {
        targetPlayer.setStops(photoPlaybackStopsRef.current);
        targetTimeSec = resetTarget ? 0 : playbackPositionsRef.current[mode];
      }
      targetPlayer.seek(targetTimeSec);
    }
    if (state.plan) dispatch(targetTimeSec > 0 ? { type: 'PAUSE' } : { type: 'RESET' });
  }, [minimizePhotoRoute, pausePlayback, state.plan]);

  const scanSource = useCallback(async (source: TimelineSource, text: string) => {
    const operation = ++scanOperationRef.current;
    setAppliedPlanSettings(null);
    setMediaLibrary({ preview: [], all: [] });
    setActiveMediaId(null);
    mediaLibraryLoadedRef.current = false;
    lastLocalMediaPlanRef.current = null;
    dispatch({ type: 'LOAD_START', source });
    try {
      const scan = await client.scan(source, text, reportProgress);
      if (operation !== scanOperationRef.current) return;
      const preferred = preferredTripRange(scan.startDate, scan.endDate);
      setStartDate(preferred.startDate);
      setEndDate(preferred.endDate);
      durationCustomizedRef.current = false; setDurationCustomized(false);
      setTargetDurationSec(0);
      autoPlanRef.current = true;
      dispatch({ type: 'SCAN_SUCCESS', scan });
    } catch (error) {
      if (operation !== scanOperationRef.current) return;
      dispatch({ type: 'FAIL', message: error instanceof Error ? error.message : 'Timeline을 읽지 못했습니다.' });
    }
  }, [client, reportProgress]);

  const createPlan = useCallback(async () => {
    if (!map || !startDate || !endDate) return;
    if (startDate > endDate || (state.scan && (startDate < state.scan.startDate || endDate > state.scan.endDate))) {
      dispatch({ type: 'FAIL', message: '기록 범위 안에서 여행 시작일과 마지막 날을 확인해 주세요.' });
      return;
    }
    pausePlayback();
    const operation = scanOperationRef.current;
    dispatch({ type: 'PLAN_START' });
    try {
      const canvas = map.getCanvas();
      const requestedDurationSec = durationCustomizedRef.current ? targetDurationSec : 0;
      const result = await client.plan({
        startDate,
        endDate,
        includeFlights,
        targetDurationSec: requestedDurationSec,
        viewportWidth: canvas.clientWidth || 1280,
        viewportHeight: canvas.clientHeight || 720,
        cameraMode,
        zoomOffset,
        pacingMode
      }, reportProgress);
      if (operation !== scanOperationRef.current) return;
      const roundedDuration = roundDurationStep(result.plan.durationSec);
      const limits = result.plan.durationLimits;
      if (!durationCustomizedRef.current || targetDurationSec < limits.minSeconds || targetDurationSec > limits.maxSeconds) {
        setTargetDurationSec(roundedDuration);
      }
      setAppliedPlanSettings({
        startDate,
        endDate,
        includeFlights,
        cameraMode,
        pacingMode,
        durationSec: roundedDuration
      });
      dispatch({ type: 'PLAN_SUCCESS', plan: result.plan });
      setSettingsOpen(false);
    } catch (error) {
      if (operation !== scanOperationRef.current) return;
      dispatch({ type: 'FAIL', message: error instanceof Error ? error.message : '경로를 계산하지 못했습니다.' });
      setSettingsOpen(true);
    }
  }, [cameraMode, client, endDate, includeFlights, map, pacingMode, reportProgress, startDate, targetDurationSec, zoomOffset, pausePlayback, state.scan]);

  const dayMarkerStops = useMemo<PlaybackStop[]>(() => showDayMarkers && state.plan
    ? buildDayMarkerStops(state.plan, dayMarkerSec)
    : [], [dayMarkerSec, showDayMarkers, state.plan]);

  const photoPlaybackStops = useMemo<PlaybackStop[]>(() => [
    ...dayMarkerStops,
    ...media.map(item => ({
      id: item.id,
      atSec: item.playbackSec,
      durationSec: item.kind === 'video' && videoMode === 'PLAY' ? videoMaxSec : photoDisplaySec
    }))
  ], [dayMarkerStops, media, photoDisplaySec, videoMaxSec, videoMode]);

  const photoDetailZoom = photoDetailZoomMode === 'AUTO' ? photoDetailZoomStrength : 0;

  const attachMediaFiles = useCallback(async (files: File[], plan: PlaybackPlan, activatePhotoJourney = true) => {
    const operation = ++mediaOperationRef.current;
    setMediaLoading(true);
    setMediaProgress({ phase: 'PREPARE', processed: 0, total: files.length, message: '미디어 파일을 준비하고 있습니다.' });
    pausePlayback();
    try {
      const loaded = await loadJourneyMedia(files, plan, progress => {
        if (operation === mediaOperationRef.current) setMediaProgress(progress);
      });
      if (operation !== mediaOperationRef.current) return;
      setMediaLibrary(loaded);
      mediaLibraryLoadedRef.current = true;
      if (activatePhotoJourney) changeJourneyMode('PHOTOS', true);
      dispatch({ type: 'NOTICE', message: `${loaded.all.length}개의 사진·영상을 여행 경로에 연결했습니다.` });
    } catch (error) {
      if (operation !== mediaOperationRef.current) return;
      dispatch({ type: 'FAIL', message: error instanceof Error ? error.message : '사진·영상을 읽지 못했습니다.' });
    } finally {
      if (operation === mediaOperationRef.current) setMediaLoading(false);
    }
  }, [changeJourneyMode, pausePlayback]);

  const attachLocalMedia = useCallback(async (manifest: LocalMediaManifest, plan: PlaybackPlan, activatePhotoJourney = true) => {
    if (lastLocalMediaPlanRef.current === plan) return;
    lastLocalMediaPlanRef.current = plan;
    const operation = ++mediaOperationRef.current;
    setMediaLoading(true);
    setMediaProgress({ phase: 'BUILD', processed: 0, total: manifest.count, message: '기본 사진 폴더를 여행 경로에 연결하고 있습니다.' });
    pausePlayback();
    try {
      const loaded = await loadLocalMediaManifest(manifest, plan, progress => {
        if (operation === mediaOperationRef.current) setMediaProgress(progress);
      });
      if (operation !== mediaOperationRef.current) return;
      setMediaLibrary(loaded);
      mediaLibraryLoadedRef.current = true;
      if (activatePhotoJourney) changeJourneyMode('PHOTOS', true);
      setMediaProgress({ phase: 'COMPLETE', processed: loaded.all.length, total: loaded.all.length, message: `${loaded.all.length}개의 로컬 사진·영상을 연결했습니다.` });
      dispatch({ type: 'NOTICE', message: `${manifest.rootName}에서 ${loaded.all.length}개의 사진·영상을 여행 경로에 연결했습니다.` });
    } catch (error) {
      if (operation !== mediaOperationRef.current) return;
      lastLocalMediaPlanRef.current = null;
      dispatch({ type: 'FAIL', message: error instanceof Error ? error.message : '기본 사진 폴더를 읽지 못했습니다.' });
    } finally {
      if (operation === mediaOperationRef.current) setMediaLoading(false);
    }
  }, [changeJourneyMode, pausePlayback]);

  const mapShare = splitNarrow ? mobileMapShare : desktopMapShare;
  const mediaProgressValue = progressValue(mediaProgress);

  useEffect(() => {
    fetch('/api/map-status', { cache: 'no-store' })
      .then(response => response.json())
      .then(status => dispatch({ type: 'MAP_STATUS', status }))
      .catch(() => dispatch({ type: 'MAP_STATUS', status: { ready: false, world: false, region: false, worldBytes: 0, regionBytes: 0 } }));
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/local-timeline', { cache: 'no-store' })
      .then(async response => {
        if (!response.ok || cancelled || manualTimelineSelectedRef.current) return;
        const contents = await response.text();
        if (!cancelled && !manualTimelineSelectedRef.current) await scanSource({ kind: 'local-file', name: '타임라인.json' }, contents);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [scanSource]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/local-media-manifest', { cache: 'no-store' })
      .then(async response => {
        if (!response.ok || cancelled) return;
        const manifest = await response.json() as LocalMediaManifest;
        if (!cancelled && !manualMediaSelectedRef.current && manifest.available && Array.isArray(manifest.items)) {
          setLocalMediaManifest(manifest);
          setSelectedMediaSummary({ name: manifest.rootName, count: manifest.count });
        }
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => () => {
    scanOperationRef.current += 1;
    mediaOperationRef.current += 1;
    client.dispose();
  }, [client]);

  useEffect(() => {
    mediaRef.current = media;
  }, [media]);

  useEffect(() => {
    photoPlaybackStopsRef.current = photoPlaybackStops;
    if (journeyModeRef.current === 'PHOTOS') playersRef.current.PHOTOS?.setStops(photoPlaybackStops);
  }, [photoPlaybackStops]);

  useEffect(() => {
    if (!map || state.phase !== 'ready' || !state.scan || !autoPlanRef.current) return;
    autoPlanRef.current = false;
    void createPlan();
  }, [createPlan, map, state.phase, state.scan]);

  useEffect(() => {
    if (!state.plan) return;
    const activatePhotoJourney = !mediaLibraryLoadedRef.current;
    if (selectedMediaFilesRef.current.length) void attachMediaFiles(selectedMediaFilesRef.current, state.plan, activatePhotoJourney);
    else if (localMediaManifest) void attachLocalMedia(localMediaManifest, state.plan, activatePhotoJourney);
  }, [attachLocalMedia, attachMediaFiles, localMediaManifest, state.plan]);

  useLayoutEffect(() => {
    playersRef.current.ROUTE?.dispose();
    playersRef.current.PHOTOS?.dispose();
    playersRef.current = { ROUTE: null, PHOTOS: null };
    if (lastLoadedPlanRef.current !== state.plan) playbackPositionsRef.current = { ROUTE: 0, PHOTOS: 0 };
    lastLoadedPlanRef.current = state.plan;
    activeMediaRef.current = '__controller-reset__';
    cityRouteCacheRef.current.clear();
    if (!map || !state.plan) return;

    const createController = (mode: JourneyMode, stops: PlaybackStop[]) => {
      const controller = new PlayerController(map, {
        onFrame: (frame, _frameIndex, timeSec, stopId, stopElapsedSec = 0) => {
          playbackPositionsRef.current[mode] = timeSec;
          if (mode !== journeyModeRef.current) return;
          if (stopId !== activeMediaRef.current) {
            activeMediaRef.current = stopId;
            setActiveMediaId(stopId);
            const item = stopId ? mediaRef.current.find(candidate => candidate.id === stopId) : null;
            setActivePlaceName(item ? resolvePlaceName(map, item) : null);
          }
          if (playersRef.current[mode]?.isPlaying() && timeSec > 0 && performance.now() - lastHudUpdateRef.current < 90) return;
          lastHudUpdateRef.current = performance.now();
          setActiveStopElapsed(stopElapsedSec);
          const nextHud = hudForFrame(frame, state.plan!, timeSec);
          if (frame.kind === 'TRAVEL') {
            const segment = state.plan!.segments[frame.segmentIndex];
            const cached = cityRouteCacheRef.current.get(frame.segmentIndex);
            const now = performance.now();
            if (!cached || ((!cached.originCity || !cached.destinationCity) && now - cached.lastAttemptMs >= 1000)) {
              cityRouteCacheRef.current.set(frame.segmentIndex, {
                originCity: cached?.originCity ?? resolveCityLabel(map, segment.start),
                destinationCity: cached?.destinationCity ?? resolveCityLabel(map, segment.end),
                lastAttemptMs: now
              });
            }
            const route = cityRouteCacheRef.current.get(frame.segmentIndex);
            if (route) {
              nextHud.originCity = route.originCity;
              nextHud.destinationCity = route.destinationCity;
            }
          }
          setHud(nextHud);
        },
        onComplete: () => {
          if (mode !== journeyModeRef.current) return;
          setActiveMediaId(null);
          dispatch({ type: 'COMPLETE' });
        }
      });
      controller.setLockToPosition(lockToPosition);
      controller.setZoomOffset(zoomOffset);
      controller.setPhotoDetailZoomStrength(mode === 'PHOTOS' ? photoDetailZoom : 0);
      controller.loadPlan(state.plan!, stops);
      return controller;
    };

    const savedPositions = { ...playbackPositionsRef.current };
    const routeController = createController('ROUTE', []);
    const photoController = createController('PHOTOS', photoPlaybackStopsRef.current);
    playersRef.current = { ROUTE: routeController, PHOTOS: photoController };
    playbackPositionsRef.current = savedPositions;
    playersRef.current[journeyModeRef.current]?.seek(playbackPositionsRef.current[journeyModeRef.current]);

    return () => {
      routeController.dispose();
      photoController.dispose();
    };
  // Plan replacement owns both playback-session lifecycles. Live preferences are applied below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, state.plan]);

  useEffect(() => {
    playersRef.current.ROUTE?.setLockToPosition(lockToPosition);
    playersRef.current.PHOTOS?.setLockToPosition(lockToPosition);
  }, [lockToPosition]);

  useEffect(() => {
    playersRef.current.ROUTE?.setZoomOffset(zoomOffset);
    playersRef.current.PHOTOS?.setZoomOffset(zoomOffset);
  }, [zoomOffset]);

  useEffect(() => {
    playersRef.current.PHOTOS?.setPhotoDetailZoomStrength(photoDetailZoom);
  }, [photoDetailZoom]);

  useEffect(() => {
    if (!map?.scrollZoom) return;
    if (state.phase === 'playing') map.scrollZoom.disable();
    else map.scrollZoom.enable();
  }, [map, state.phase]);

  useEffect(() => {
    const onResize = () => setSplitNarrow(window.innerWidth <= 820);
    window.addEventListener('resize', onResize, { passive: true });
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (!map) return;
    const timer = window.setTimeout(() => (map as MapLibreMap & { resize?: () => void }).resize?.(), 220);
    return () => window.clearTimeout(timer);
  }, [journeyMode, map, mapShare]);

  useEffect(() => {
    if (!map?.getLayer('route-all')) return;
    map.setLayoutProperty('route-all', 'visibility', state.phase === 'playing' ? 'none' : 'visible');
  }, [map, state.phase, state.plan]);

  const onMapReady = useCallback((nextMap: MapLibreMap) => setMap(nextMap), []);
  const onMapError = useCallback((message: string) => {
    setMapNotice(message.includes('브라우저') ? message : message.includes('기본 배경') ? '배경 지도를 불러오지 못했습니다. 경로는 계속 사용할 수 있어요. 인터넷 연결을 확인한 뒤 지도를 다시 불러오세요.' : '일부 지도 정보를 불러오지 못했습니다. 연결을 확인하거나 설치된 지도로 변경해 주세요.');
  }, []);

  const onFileSelected = async (file: File | undefined) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.json')) {
      dispatch({ type: 'FAIL', message: 'Google Timeline JSON 파일을 선택해 주세요.' });
      return;
    }
    if (file.size > 250 * 1024 * 1024) { dispatch({ type: 'FAIL', message: '파일이 너무 큽니다. 250MB 이하의 Timeline JSON을 선택해 주세요.' }); return; }
    setSettingsOpen(false);
    manualTimelineSelectedRef.current = true;
    pausePlayback();
    setActiveMediaId(null);
    try {
      await scanSource({ kind: 'local-file', name: file.name }, await file.text());
    } catch (error) {
      dispatch({ type: 'FAIL', message: error instanceof Error ? error.message : 'Timeline 파일을 읽지 못했습니다.' });
    }
  };

  const onMediaFiles = async (fileList: FileList) => {
    const files = Array.from(fileList);
    if (!files.length) return;
    setSettingsOpen(false);
    manualMediaSelectedRef.current = true;
    selectedMediaFilesRef.current = files;
    setExcludedMedia(new Set());
    lastLocalMediaPlanRef.current = null;
    const relativePath = files[0].webkitRelativePath;
    setSelectedMediaSummary({ name: relativePath?.split('/')[0] || '선택한 파일', count: files.length });
    if (!state.plan) {
      dispatch({ type: 'NOTICE', message: `${files.length}개의 사진·영상을 선택했습니다. Timeline을 선택하면 자동으로 연결합니다.` });
      return;
    }
    await attachMediaFiles(files, state.plan);
  };

  const togglePlayback = () => {
    const mode = journeyModeRef.current;
    const player = playersRef.current[mode];
    if (!player) return;
    const otherMode: JourneyMode = mode === 'ROUTE' ? 'PHOTOS' : 'ROUTE';
    playersRef.current[otherMode]?.pause();
    if (player.isPlaying()) {
      player.pause();
      dispatch({ type: 'PAUSE' });
    } else {
      if (mode === 'PHOTOS') player.setStops(photoPlaybackStopsRef.current);
      player.seek(playbackPositionsRef.current[mode]);
      player.play();
      dispatch({ type: 'PLAY' });
    }
  };

  const changePhotoViewMode = (mode: PhotoViewMode) => {
    pausePlayback();
    activeMediaRef.current = null;
    setActiveMediaId(null);
    setActivePlaceName(null);
    updatePreference('photoViewMode', mode);
  };

  const resetPlayback = () => {
    const mode = journeyModeRef.current;
    playbackPositionsRef.current[mode] = 0;
    playersRef.current[mode]?.reset();
    dispatch({ type: 'RESET' });
  };

  const changeMapKind = (kind: 'online' | 'local-pmtiles') => {
    if (kind === 'local-pmtiles' && !state.mapStatus?.ready) {
      dispatch({ type: 'NOTICE', message: '로컬 지도 파일이 없습니다. npm run map:setup 후 다시 선택해 주세요.' });
      return;
    }
    pausePlayback();
    dispatch({ type: 'PAUSE' });
    setMapNotice(null);
    playersRef.current.ROUTE?.dispose();
    playersRef.current.PHOTOS?.dispose();
    playersRef.current = { ROUTE: null, PHOTOS: null };
    setMap(null);
    setMapKind(kind);
  };

  const setMapShare = (value: number) => {
    const limits = splitNarrow ? { min: PHOTO_MAP_MIN_MOBILE, max: 0.72 } : { min: PHOTO_MAP_MIN_DESKTOP, max: 0.78 };
    const next = Math.min(limits.max, Math.max(limits.min, value));
    if (splitNarrow) setMobileMapShare(next);
    else setDesktopMapShare(next);
  };

  const resizeSplitFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const rect = shellRef.current?.querySelector('.workspace')?.getBoundingClientRect();
    if (!rect) return;
    setMapShare(splitNarrow ? (event.clientY - rect.top) / rect.height : (event.clientX - rect.left) / rect.width);
  };

  const resizeSplitFromKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 0.05 : 0.02;
    let next = mapShare;
    if ((!splitNarrow && event.key === 'ArrowLeft') || (splitNarrow && event.key === 'ArrowUp')) next -= step;
    else if ((!splitNarrow && event.key === 'ArrowRight') || (splitNarrow && event.key === 'ArrowDown')) next += step;
    else if (event.key === 'Home') next = splitNarrow ? PHOTO_MAP_MIN_MOBILE : PHOTO_MAP_MIN_DESKTOP;
    else if (event.key === 'End') next = splitNarrow ? 0.72 : 0.78;
    else return;
    event.preventDefault();
    setMapShare(next);
  };

  const busy = state.phase === 'loading' || state.phase === 'planning' || mediaLoading;
  const canPlay = Boolean(state.plan && map && !busy);
  const planNeedsRebuild = Boolean(state.scan && (!state.plan || !appliedPlanSettings || (
    startDate !== appliedPlanSettings.startDate
    || endDate !== appliedPlanSettings.endDate
    || includeFlights !== appliedPlanSettings.includeFlights
    || cameraMode !== appliedPlanSettings.cameraMode
    || pacingMode !== appliedPlanSettings.pacingMode
    || targetDurationSec !== appliedPlanSettings.durationSec
  )));
  const duration = state.plan
    ? state.plan.durationSec + (journeyMode === 'PHOTOS'
      ? photoPlaybackStops.reduce((sum, stop) => sum + Math.max(0, stop.durationSec), 0)
      : 0)
    : Math.max(0, targetDurationSec);
  const durationControlValue = targetDurationSec > 0
    ? targetDurationSec
    : state.plan
      ? midpointDurationControlValue(state.plan.durationLimits.minSeconds, state.plan.durationLimits.maxSeconds)
      : midpointDurationControlValue(45, 300);
  const playbackChromeClass = state.phase === 'playing'
    ? playbackChrome.visible ? 'playback-chrome-visible' : 'playback-chrome-hidden'
    : 'playback-chrome-visible';

  const timelineInputRef = useRef<HTMLInputElement>(null);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const individualMediaRef = useRef<HTMLInputElement>(null);
  const openSettings = () => { pausePlayback(); setSettingsOpen(true); };
  const updateSettings = <K extends keyof typeof preferences>(key: K, value: (typeof preferences)[K]) => {
    if (key === 'photoViewMode') changePhotoViewMode(value as PhotoViewMode);
    else updatePreference(key, value);
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.repeat || settingsOpen || helpOpen || libraryOpen || busy) return;
      const target = event.target as HTMLElement;
      if (target.closest('input, select, textarea, button, summary, a, [contenteditable="true"], [role="separator"]')) return;
      const player = playersRef.current[journeyModeRef.current];
      if (!player || !state.plan || !map) return;
      if (event.code === 'Space') {
        event.preventDefault();
        if (player.isPlaying()) { player.pause(); dispatch({ type: 'PAUSE' }); }
        else { player.play(); dispatch({ type: 'PLAY' }); }
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault(); player.pause();
        player.seek(playbackPositionsRef.current[journeyModeRef.current] + (event.key === 'ArrowRight' ? 5 : -5));
        dispatch({ type: 'PAUSE' });
      } else if (event.key === 'Home') {
        event.preventDefault(); player.reset(); dispatch({ type: 'RESET' });
      }
    };
    window.addEventListener('keydown', onKey);
    const onHidden = () => { if (document.hidden) pausePlayback(); };
    document.addEventListener('visibilitychange', onHidden);
    return () => { window.removeEventListener('keydown', onKey); document.removeEventListener('visibilitychange', onHidden); };
  }, [busy, helpOpen, libraryOpen, map, pausePlayback, settingsOpen, state.plan]);

  const importing = state.phase === 'loading' || state.phase === 'planning' || mediaLoading;
  const notice = !importing && state.phase !== 'error' && state.statusMessage !== dismissedNotice
    && !['idle', 'playing', 'complete'].includes(state.phase) && /연결|선택했습니다|되돌렸/.test(state.statusMessage)
    ? state.statusMessage : null;

  return <main ref={shellRef} className={`app-shell ${journeyMode === 'PHOTOS' ? 'photo-mode' : ''} ${state.scan ? 'has-trip' : ''} ${state.phase === 'playing' ? 'playback-active' : ''} ${playbackChromeClass}`}
    data-playback-chrome={playbackChrome.visible ? 'visible' : 'hidden'} data-playing-mode={state.phase === 'playing' ? journeyMode : 'NONE'}
    style={{ '--photo-map-share': `${mapShare * 100}%` } as CSSProperties}>
    <a href="#main-controls" className="skip-link">재생 컨트롤로 건너뛰기</a>
    <input ref={timelineInputRef} className="sr-only" tabIndex={-1} aria-label="Timeline JSON 선택" type="file" accept="application/json,.json" disabled={busy}
      onChange={event => { void onFileSelected(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }} />
    <input ref={mediaInputRef} className="sr-only" tabIndex={-1} aria-label="사진 폴더 선택" type="file" multiple {...{ webkitdirectory: '' }} disabled={busy}
      onChange={event => { if (event.currentTarget.files) void onMediaFiles(event.currentTarget.files); event.currentTarget.value = ''; }} />
    <input ref={individualMediaRef} className="sr-only" tabIndex={-1} aria-label="사진·영상 개별 선택" type="file" accept="image/*,video/*,.json" multiple disabled={busy}
      onChange={event => { if (event.currentTarget.files) void onMediaFiles(event.currentTarget.files); event.currentTarget.value = ''; }} />
    <header className="topbar" {...playbackChrome.interactionProps}>
      <div className="brand-lockup"><span className="brand-mark"><Route size={21} /></span><strong>Travel Camera<span className="version-label">3</span></strong></div>
      <nav className="mode-switch" aria-label="여정 보기 방식">
        <button type="button" aria-pressed={journeyMode === 'ROUTE'} disabled={busy} className={journeyMode === 'ROUTE' ? 'active' : ''} onClick={() => changeJourneyMode('ROUTE')}><Route size={17} />발자취</button>
        <button type="button" aria-pressed={journeyMode === 'PHOTOS'} disabled={busy} className={journeyMode === 'PHOTOS' ? 'active' : ''} onClick={() => changeJourneyMode('PHOTOS')}><Images size={17} />사진 여정</button>
      </nav>
      <div className="topbar-actions">
        <button className="toolbar-button file-action" disabled={busy} onClick={() => timelineInputRef.current?.click()}><Upload size={17} /><span>Timeline 선택</span></button>
        <button className="toolbar-button file-action" disabled={busy} onClick={() => mediaInputRef.current?.click()}><FolderOpen size={17} /><span>사진 폴더</span></button>
        <button className="icon-button help-button" aria-label="사용 방법" onClick={() => { pausePlayback(); setHelpOpen(true); }}><HelpCircle size={20} /></button>
        <button className={`toolbar-button settings-trigger ${planNeedsRebuild && state.plan ? 'has-changes' : ''}`} onClick={openSettings} aria-haspopup="dialog"><Settings2 size={18} /><span>여행 설정</span></button>
      </div>
    </header>
    <div className="workspace">
      <Suspense fallback={<div className="map-canvas map-loading" role="status">지도 준비 중…</div>}><MapStage key={mapRevision} source={mapSource} onReady={onMapReady} onError={onMapError} /></Suspense>
      {state.plan && <div className="trip-context" {...playbackChrome.interactionProps}>
        <span className="context-dot" /><span>{appliedPlanSettings?.startDate} — {appliedPlanSettings?.endDate}</span>
        <span className="context-distance">{Math.round(state.plan.durationLimits.distanceKm).toLocaleString()} km</span>
        {journeyMode === 'PHOTOS' && <button className="text-button" type="button" onClick={() => { pausePlayback(); setLibraryOpen(true); }}>사진 목록 · {media.length}개 장면</button>}
        {planNeedsRebuild && <button type="button" className="text-button" onClick={openSettings}>설정 적용 필요</button>}
      </div>}
      {journeyMode === 'PHOTOS' && <><MediaJourneyPane media={media} activeId={state.phase === 'ready' || state.phase === 'planning' ? null : activeMediaId}
        playing={state.phase === 'playing'} elapsedSec={activeStopElapsed} videoMode={videoMode} videoMuted={videoMuted} photoDisplaySec={photoDisplaySec}
        mobilityClass={hud.mobilityClass} movementDate={hud.date} movementSpeed={hud.speed} originCity={hud.originCity} destinationCity={hud.destinationCity} placeName={activePlaceName}
        onFiles={files => void onMediaFiles(files)} />
        <div className="photo-split-handle" role="separator" tabIndex={0} aria-label="경로와 사진 영역 크기 조절" aria-orientation={splitNarrow ? 'horizontal' : 'vertical'}
          aria-valuemin={splitNarrow ? 34 : 38} aria-valuemax={splitNarrow ? 72 : 78} aria-valuenow={Math.round(mapShare * 100)} aria-valuetext={`경로 ${Math.round(mapShare * 100)}%, 사진 ${100 - Math.round(mapShare * 100)}%`}
          onPointerDown={event => event.currentTarget.setPointerCapture(event.pointerId)} onPointerMove={resizeSplitFromPointer} onKeyDown={resizeSplitFromKeyboard} />
      </>}
      {!state.scan && !importing && state.phase !== 'error' && <section className="welcome-panel" aria-labelledby="welcome-title">
        <div className="welcome-eyebrow"><span /> 내 파일로 시작하는 여행</div>
        <h1 id="welcome-title">지나온 길을,<br />다시 여행하세요.</h1>
        <p className="welcome-intro">Google Timeline을 지도 위에서 재생하고,<br className="desktop-break" /> 사진과 영상으로 그날의 순간을 함께 감상하세요.</p>
        <div className="welcome-flow"><span><b>1</b> Timeline 선택</span><ArrowRight size={15} /><span><b>2</b> 기간 확인</span><ArrowRight size={15} /><span><b>3</b> 여행 재생</span></div>
        <button className="primary-button welcome-primary" onClick={() => timelineInputRef.current?.click()}><FileJson size={20} />Timeline JSON 선택<ArrowRight size={18} /></button>
        <button className="secondary-button" onClick={() => mediaInputRef.current?.click()}><FolderOpen size={18} />{selectedMediaSummary ? `${selectedMediaSummary.count}개 파일 선택됨` : '사진 폴더도 선택하기'}<span className="optional-label">선택 사항</span></button>
        <button className="text-button welcome-help" onClick={() => setHelpOpen(true)}>Timeline 파일은 어떻게 준비하나요?<ArrowRight size={14} /></button>
        <p className="local-privacy"><ShieldCheck size={16} /> 개인 파일은 외부로 업로드하지 않습니다.</p>
      </section>}
      {state.plan && journeyMode === 'ROUTE' && <section className="journey-hud route-persistent-hud" aria-label="현재 이동 정보"><span className="hud-caption">현재 이동</span><strong>{hud.mobility}</strong><div className="hud-meta"><span>{hud.date}</span><span>{hud.speed}</span></div></section>}
      {mapNotice && <aside className="map-notice" role="status"><AlertCircle size={17} /><p>{mapNotice}</p><button className="text-button" type="button" onClick={() => { pausePlayback(); setMap(null); setMapNotice(null); setMapRevision(value => value + 1); }}>다시 연결</button><button className="icon-button" aria-label="지도 알림 닫기" onClick={() => setMapNotice(null)}><X size={16} /></button></aside>}
      {importing && <section className="status-card" role="status" aria-live="polite" aria-busy="true"><span className="progress-orbit" /><div><strong>{mediaLoading ? mediaProgress?.message : state.statusMessage}</strong><progress aria-label="준비 진행률" max={1} value={mediaLoading ? mediaProgressValue : state.progress} /><p>파일 크기에 따라 잠시 걸릴 수 있어요. 이 창을 그대로 두세요.</p></div></section>}
      {state.phase === 'error' && !mediaLoading && <section className="status-card error" role="alert"><AlertCircle size={26} /><div><strong>여행을 준비하지 못했어요</strong><p>{state.error}</p><div className="error-actions">{state.scan && <button className="primary-button" onClick={openSettings}>기간 확인하고 다시 시도</button>}<button className="secondary-button" onClick={() => timelineInputRef.current?.click()}>다른 Timeline 선택</button></div>{state.plan && <button className="text-button" onClick={() => dispatch({ type: 'PAUSE' })}>기존 경로로 돌아가기</button>}</div></section>}
      {notice && <div className="toast" role="status"><Check size={18} /><p>{notice}</p><button className="icon-button" aria-label="안내 닫기" onClick={() => setDismissedNotice(notice)}><X size={16} /></button></div>}
      {state.plan && state.phase === 'playing' && <div className="player-reveal-zone" aria-hidden="true" {...playbackChrome.revealZoneProps} />}
      <footer id="main-controls" tabIndex={-1} className={`player-dock ${!state.plan ? 'is-empty' : ''}`} aria-label="재생 컨트롤" {...playbackChrome.interactionProps}>
        <button className="icon-button reset-control" type="button" onClick={resetPlayback} disabled={!canPlay} aria-label="처음부터 보기" title="처음부터 보기 (Home)"><RotateCcw size={20} /></button>
        <button className="play-control" type="button" onClick={togglePlayback} disabled={!canPlay} aria-label={state.phase === 'playing' ? '일시정지' : state.phase === 'complete' ? '다시 재생' : '재생'} title="재생 / 일시정지 (Space)">{state.phase === 'playing' ? <Pause size={21} fill="currentColor" /> : <Play size={21} fill="currentColor" />}<span>{state.phase === 'playing' ? '일시정지' : state.phase === 'complete' ? '다시 재생' : '재생'}</span></button>
        <div className="timeline-control"><div className="timeline-meta"><span>{formatClock(hud.timeSec)}</span><span className="player-status">{!state.plan ? 'Timeline을 선택해 주세요' : state.phase === 'complete' ? '여행 재생이 끝났어요' : journeyMode === 'PHOTOS' ? '사진과 함께 감상' : '이동 경로 감상'}</span><span>{formatClock(duration)}</span></div><input aria-label="재생 위치" aria-valuetext={`${formatClock(hud.timeSec)} / ${formatClock(duration)}`} type="range" min={0} max={Math.max(1, duration)} step={state.plan ? 1 / state.plan.fps : 0.1} value={Math.min(hud.timeSec, duration)} disabled={!canPlay} onChange={event => { const player = playersRef.current[journeyModeRef.current]; player?.pause(); player?.seek(Number(event.target.value)); dispatch({ type: 'PAUSE' }); }} /></div>
      </footer>
    </div>
    <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} preferences={preferences} update={updateSettings} reset={() => { resetPreferences(); durationCustomizedRef.current = false; setDurationCustomized(false); setTargetDurationSec(0); }}
      onLibrary={() => { setSettingsOpen(false); setLibraryOpen(true); }} onTimeline={() => timelineInputRef.current?.click()} onMedia={() => mediaInputRef.current?.click()} onMediaFiles={() => individualMediaRef.current?.click()} error={state.phase === 'error' ? state.error : null}
      mediaSummary={selectedMediaSummary ? `${selectedMediaSummary.name} · 선택 ${selectedMediaSummary.count}개 / 기간에 연결 ${mediaLibrary.all.length}개` : ''}
      startDate={startDate} endDate={endDate} setStartDate={setStartDate} setEndDate={setEndDate} scan={state.scan} sourceName={state.source?.name ?? ''} busy={busy}
      duration={durationControlValue} limits={state.plan?.durationLimits} setDuration={value => { durationCustomizedRef.current = true; setDurationCustomized(true); setTargetDurationSec(value); }} customDuration={durationCustomized}
      autoDuration={() => { durationCustomizedRef.current = false; setDurationCustomized(false); setTargetDurationSec(state.plan ? midpointDurationControlValue(state.plan.durationLimits.minSeconds, state.plan.durationLimits.maxSeconds) : 0); }}
      mapKind={mapKind} localMapReady={Boolean(state.mapStatus?.ready)} setMapKind={changeMapKind} needsPlan={planNeedsRebuild} hasPlan={Boolean(state.plan)} mapReady={Boolean(map)} onPlan={() => { void createPlan(); }} />
    <MediaLibraryDialog open={libraryOpen} onClose={() => setLibraryOpen(false)} media={mediaLibrary.all} excluded={excludedMedia}
      onToggle={id => { pausePlayback(); setExcludedMedia(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }} onIncludeAll={() => setExcludedMedia(new Set())} />
    <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
  </main>;

}

function hudForFrame(frame: PlaybackFrame, plan: PlaybackPlan, timeSec: number): HudState {
  if (frame.kind === 'OUTRO') return { timeSec, date: '여행 전체', mobilityClass: 'UNKNOWN', mobility: '전체 경로', speed: '—', originCity: null, destinationCity: null };
  const travel = frame as TravelFrame;
  const segment = plan.segments[travel.segmentIndex];
  const sourceMs = segment.startMs + (segment.endMs - segment.startMs) * travel.progress;
  return {
    timeSec,
    date: new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Seoul' }).format(sourceMs),
    mobilityClass: travel.mobilityClass,
    mobility: `${MOBILITY_LABELS[travel.mobilityClass] ?? '기타'}${segment.inferred ? ' · 추정' : ''}`,
    speed: `${travel.speedKmh.toFixed(0)} km/h`,
    originCity: null,
    destinationCity: null
  };
}

function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

function roundDurationStep(seconds: number): number {
  return Math.max(5, Math.round((Number(seconds) || 0) / 5) * 5);
}

function midpointDurationControlValue(minSeconds: number, maxSeconds: number): number {
  const min = Math.max(5, Number(minSeconds) || 5);
  const max = Math.max(min, Number(maxSeconds) || min);
  return Math.min(max, Math.max(min, roundDurationStep((min + max) / 2)));
}

function preferredTripRange(availableStart: string, availableEnd: string): { startDate: string; endDate: string } {
  return { startDate: availableStart, endDate: availableEnd };
}

function progressValue(progress: MediaImportProgress | null): number {
  if (!progress) return 0;
  const ranges: Record<MediaImportProgress['phase'], [number, number]> = {
    PREPARE: [0, 0.08],
    METADATA: [0.08, 0.62],
    SIDECAR: [0.62, 0.76],
    MATCH: [0.76, 0.9],
    BUILD: [0.9, 0.98],
    COMPLETE: [1, 1]
  };
  const [start, end] = ranges[progress.phase];
  const ratio = progress.total > 0 ? Math.min(1, progress.processed / progress.total) : 0;
  return start + (end - start) * ratio;
}

function resolvePlaceName(map: MapLibreMap, item: JourneyMedia): string {
  const label = resolvePhotoPlaceLabel(map, { lat: item.matchedLat, lng: item.matchedLng });
  if (label) return label;
  return item.positionSource === 'gps' ? '촬영 위치' : 'Timeline 위치';
}
