import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Camera, ChevronDown, FileJson, FolderOpen, Images, Layers3, MapPinned, Pause, Play, RotateCcw, Route, ShieldCheck, Upload } from 'lucide-react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { ONLINE_STYLE_URL } from './map/map-style';
import { resolveCityLabel } from './map/city-label';
import { resolvePhotoPlaceLabel } from './map/photo-place-label';
import { PlayerController } from './player/player-controller';
import { buildDayMarkerStops } from './media/day-markers';
import { loadJourneyMedia } from './media/media-library';
import { loadLocalMediaManifest } from './media/local-media-library';
import { MediaJourneyPane } from './media/MediaJourneyPane';
import { TimelineWorkerClient, type TimelineWorkerPort } from './services/timeline-worker-client';
import { appReducer, initialAppState } from './state/app-reducer';
import { usePlaybackChrome } from './ui/playback-chrome';
import type { CameraMode, JourneyMedia, LocalMediaManifest, MapSourceConfig, MediaImportProgress, MobilityClass, PacingMode, PhotoViewMode, PlaybackFrame, PlaybackPlan, PlaybackStop, TimelineSource, TravelFrame } from './types';

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

type JourneyMode = 'ROUTE' | 'PHOTOS';

const MOBILITY_LABELS: Record<string, string> = {
  WALK: '도보', BIKE: '자전거', URBAN_TRANSIT: '대중교통', FAST_GROUND: '기차',
  FERRY: '페리', FLIGHT: '비행기', ROAD: '차량', UNKNOWN: '기타'
};

const DEFAULT_TRIP_START = '2026-03-17';
const DEFAULT_TRIP_END = '2026-03-31';
const PHOTO_MAP_MIN_DESKTOP = 0.38;
const PHOTO_MAP_MIN_MOBILE = 0.34;
const MapStage = lazy(() => import('./map/MapStage').then(module => ({ default: module.MapStage })));

interface TimelineFileHandle {
  getFile(): Promise<File>;
}

type TimelineFilePicker = (options: {
  id: string;
  startIn: 'documents';
  multiple: false;
  types: Array<{ description: string; accept: Record<string, string[]> }>;
}) => Promise<TimelineFileHandle[]>;

export function App({ workerClient }: AppProps) {
  const [state, dispatch] = useReducer(appReducer, initialAppState);
  const [client] = useState<TimelineWorkerPort>(() => workerClient ?? new TimelineWorkerClient());

  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [mapKind, setMapKind] = useState<'online' | 'local-pmtiles'>('online');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [includeFlights, setIncludeFlights] = useState(true);
  const [targetDurationSec, setTargetDurationSec] = useState(0);
  const [cameraMode, setCameraMode] = useState<CameraMode>('AUTO');
  const [zoomOffset, setZoomOffset] = useState(0);
  const [pacingMode, setPacingMode] = useState<PacingMode>('LOCAL_DAYS');
  const [lockToPosition, setLockToPosition] = useState(true);
  const [journeyMode, setJourneyMode] = useState<JourneyMode>('ROUTE');
  const [mediaLibrary, setMediaLibrary] = useState<{ preview: JourneyMedia[]; all: JourneyMedia[] }>({ preview: [], all: [] });
  const [photoViewMode, setPhotoViewMode] = useState<PhotoViewMode>('PREVIEW');
  const [activeMediaId, setActiveMediaId] = useState<string | null>(null);
  const [photoDisplaySec, setPhotoDisplaySec] = useState(3);
  const [showDayMarkers, setShowDayMarkers] = useState(true);
  const [dayMarkerSec, setDayMarkerSec] = useState(1.8);
  const [videoMode, setVideoMode] = useState<'THUMBNAIL' | 'PLAY'>('PLAY');
  const [videoMuted, setVideoMuted] = useState(true);
  const [videoMaxSec, setVideoMaxSec] = useState(5);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [mediaProgress, setMediaProgress] = useState<MediaImportProgress | null>(null);
  const [localMediaManifest, setLocalMediaManifest] = useState<LocalMediaManifest | null>(null);
  const [splitNarrow, setSplitNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth <= 820);
  const [desktopMapShare, setDesktopMapShare] = useState(PHOTO_MAP_MIN_DESKTOP);
  const [mobileMapShare, setMobileMapShare] = useState(PHOTO_MAP_MIN_MOBILE);
  const [activePlaceName, setActivePlaceName] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hud, setHud] = useState<HudState>({ timeSec: 0, date: '—', mobilityClass: 'UNKNOWN', mobility: '여행 준비', speed: '—', originCity: null, destinationCity: null });
  const playersRef = useRef<Record<JourneyMode, PlayerController | null>>({ ROUTE: null, PHOTOS: null });
  const journeyModeRef = useRef<JourneyMode>('ROUTE');
  const playbackPositionsRef = useRef<Record<JourneyMode, number>>({ ROUTE: 0, PHOTOS: 0 });
  const photoPlaybackStopsRef = useRef<PlaybackStop[]>([]);
  const autoPlanRef = useRef(false);
  const durationCustomizedRef = useRef(false);
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
  const media = photoViewMode === 'ALL' ? mediaLibrary.all : mediaLibrary.preview;
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
    const targetTimeSec = playbackPositionsRef.current[mode];
    journeyModeRef.current = mode;
    if (mode === 'PHOTOS') minimizePhotoRoute();
    setJourneyMode(mode);
    activeMediaRef.current = null;
    setActiveMediaId(null);
    setActivePlaceName(null);
    const targetPlayer = playersRef.current[mode];
    if (targetPlayer) {
      if (mode === 'PHOTOS') targetPlayer.setStops(photoPlaybackStopsRef.current);
      targetPlayer.seek(targetTimeSec);
    }
    if (state.plan) dispatch(targetTimeSec > 0 ? { type: 'PAUSE' } : { type: 'RESET' });
  }, [minimizePhotoRoute, pausePlayback, state.plan]);

  const scanSource = useCallback(async (source: TimelineSource, text: string) => {
    const operation = ++scanOperationRef.current;
    dispatch({ type: 'LOAD_START', source });
    try {
      const scan = await client.scan(source, text, reportProgress);
      if (operation !== scanOperationRef.current) return;
      const preferred = preferredTripRange(scan.startDate, scan.endDate);
      setStartDate(preferred.startDate);
      setEndDate(preferred.endDate);
      durationCustomizedRef.current = false;
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
    if (startDate > endDate) {
      dispatch({ type: 'FAIL', message: '여행 시작일은 마지막 날보다 늦을 수 없습니다.' });
      return;
    }
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
      const roundedDuration = roundDurationStep(result.plan.durationSec);
      const limits = result.plan.durationLimits;
      if (!durationCustomizedRef.current || targetDurationSec < limits.minSeconds || targetDurationSec > limits.maxSeconds) {
        setTargetDurationSec(roundedDuration);
      }
      dispatch({ type: 'PLAN_SUCCESS', plan: result.plan });
    } catch (error) {
      dispatch({ type: 'FAIL', message: error instanceof Error ? error.message : '경로를 계산하지 못했습니다.' });
    }
  }, [cameraMode, client, endDate, includeFlights, map, pacingMode, reportProgress, startDate, targetDurationSec, zoomOffset]);

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
    playbackPositionsRef.current = { ROUTE: 0, PHOTOS: 0 };
    activeMediaRef.current = '__controller-reset__';
    cityRouteCacheRef.current.clear();
    if (!map || !state.plan) return;

    const createController = (mode: JourneyMode, stops: PlaybackStop[]) => {
      const controller = new PlayerController(map, {
        onFrame: (frame, _frameIndex, timeSec, stopId) => {
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
      controller.loadPlan(state.plan!, stops);
      return controller;
    };

    const routeController = createController('ROUTE', []);
    const photoController = createController('PHOTOS', photoPlaybackStopsRef.current);
    playersRef.current = { ROUTE: routeController, PHOTOS: photoController };
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
    dispatch({ type: 'NOTICE', message: `지도 알림 · ${message}` });
  }, []);

  const onFileSelected = async (file: File | undefined) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.json')) {
      dispatch({ type: 'FAIL', message: 'Google Timeline JSON 파일을 선택해 주세요.' });
      return;
    }
    manualTimelineSelectedRef.current = true;
    pausePlayback();
    setActiveMediaId(null);
    try {
      await scanSource({ kind: 'local-file', name: file.name }, await file.text());
    } catch (error) {
      dispatch({ type: 'FAIL', message: error instanceof Error ? error.message : 'Timeline 파일을 읽지 못했습니다.' });
    }
  };

  const openTimelinePicker = async () => {
    const picker = (window as Window & { showOpenFilePicker?: TimelineFilePicker }).showOpenFilePicker;
    if (!picker) return;
    try {
      const [handle] = await picker.call(window, {
        id: 'travel-camera-timeline',
        startIn: 'documents',
        multiple: false,
        types: [{ description: 'Google Timeline JSON', accept: { 'application/json': ['.json'] } }]
      });
      await onFileSelected(await handle?.getFile());
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      dispatch({ type: 'NOTICE', message: 'Timeline 선택 창을 열지 못했습니다. 기본 파일 선택을 사용해 주세요.' });
    }
  };

  const onTimelineInputClick = (event: ReactMouseEvent<HTMLInputElement>) => {
    if (!(window as Window & { showOpenFilePicker?: TimelineFilePicker }).showOpenFilePicker) return;
    event.preventDefault();
    void openTimelinePicker();
  };

  const onMediaFiles = async (fileList: FileList) => {
    const files = Array.from(fileList);
    if (!files.length) return;
    manualMediaSelectedRef.current = true;
    selectedMediaFilesRef.current = files;
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
    setPhotoViewMode(mode);
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
    const rect = shellRef.current?.getBoundingClientRect();
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

  return (
    <main
      ref={shellRef}
      className={`app-shell ${journeyMode === 'PHOTOS' ? 'photo-mode' : ''} ${state.scan ? 'has-trip' : ''} ${state.phase === 'playing' ? 'playback-active' : ''} ${playbackChromeClass}`}
      data-playback-chrome={playbackChrome.visible ? 'visible' : 'hidden'}
      data-playing-mode={state.phase === 'playing' ? journeyMode : 'NONE'}
      style={{ '--photo-map-share': `${mapShare * 100}%` } as CSSProperties}
    >
      <Suspense fallback={<div className="map-canvas map-loading" aria-label="지도 불러오는 중" />}>
        <MapStage source={mapSource} onReady={onMapReady} onError={onMapError} />
      </Suspense>
      {journeyMode === 'PHOTOS' && <>
        <MediaJourneyPane
          media={media}
          activeId={state.phase === 'ready' || state.phase === 'planning' ? null : activeMediaId}
          videoMode={videoMode}
          videoMuted={videoMuted}
          photoDisplaySec={photoDisplaySec}
          mobilityClass={hud.mobilityClass}
          movementDate={hud.date}
          movementSpeed={hud.speed}
          originCity={hud.originCity}
          destinationCity={hud.destinationCity}
          placeName={activePlaceName}
          onFiles={files => void onMediaFiles(files)}
        />
        <div
          className="photo-split-handle"
          role="separator"
          tabIndex={0}
          aria-label="경로와 사진 영역 크기 조절"
          aria-orientation={splitNarrow ? 'horizontal' : 'vertical'}
          aria-valuemin={splitNarrow ? 34 : 38}
          aria-valuemax={splitNarrow ? 72 : 78}
          aria-valuenow={Math.round(mapShare * 100)}
          aria-valuetext={`경로 ${Math.round(mapShare * 100)}%, 사진 ${100 - Math.round(mapShare * 100)}%`}
          onPointerDown={event => event.currentTarget.setPointerCapture(event.pointerId)}
          onPointerMove={resizeSplitFromPointer}
          onDoubleClick={() => setMapShare(splitNarrow ? 0.52 : 0.60)}
          onKeyDown={resizeSplitFromKeyboard}
        />
      </>}

      {state.plan && state.phase === 'playing' && <div className="topbar-reveal-zone" aria-hidden="true" {...playbackChrome.revealZoneProps} />}
      <header className="topbar" {...playbackChrome.interactionProps}>
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true"><Route size={18} /></span>
          <div>
            <strong>Travel Camera</strong>
            <span>나의 이동을 한 편의 장면으로</span>
          </div>
        </div>
        <div className="topbar-actions">
        <div className="mode-switch" role="group" aria-label="여정 보기 방식">
          <button type="button" className={journeyMode === 'ROUTE' ? 'active' : ''} onClick={() => changeJourneyMode('ROUTE')}><Route size={14} /> 발자취</button>
          <button type="button" className={journeyMode === 'PHOTOS' ? 'active' : ''} onClick={() => changeJourneyMode('PHOTOS')}><Images size={14} /> 사진 여정</button>
        </div>
        <label className="import-button media-import-button">
          <FolderOpen size={16} aria-hidden="true" /><span>사진 폴더</span>
          <input type="file" aria-label="사진 폴더 선택" multiple {...{ webkitdirectory: '' }} disabled={mediaLoading} onChange={event => event.currentTarget.files && void onMediaFiles(event.currentTarget.files)} />
        </label>
        <label className="import-button">
          <Upload size={16} aria-hidden="true" />
          <span>Timeline 선택</span>
          <input
            aria-label="Timeline JSON 선택"
            type="file"
            accept="application/json,.json"
            disabled={busy}
            onClick={onTimelineInputClick}
            onChange={event => {
              void onFileSelected(event.currentTarget.files?.[0]);
              event.currentTarget.value = '';
            }}
          />
        </label>
        </div>
      </header>

      {state.phase === 'idle' && (
        <section className="local-import-panel" aria-labelledby="local-import-title">
          <div className="local-import-heading">
            <span><FolderOpen size={20} /></span>
            <div><strong id="local-import-title">내 여행 파일로 시작</strong><p>기본 Timeline과 사진 폴더를 이 PC에서 바로 불러옵니다.</p></div>
          </div>
          <div className="local-import-actions">
            <label className="local-import-primary"><FileJson size={18} /><span><strong>Timeline JSON 선택</strong><small>문서 폴더에서 시작 · 마지막 위치 기억</small></span><input type="file" aria-label="시작할 Timeline JSON 선택" accept="application/json,.json" onClick={onTimelineInputClick} onChange={event => void onFileSelected(event.currentTarget.files?.[0])} /></label>
            <label className="local-import-secondary"><Images size={18} /><span><strong>사진 폴더 선택</strong><small>{selectedMediaSummary ? `${selectedMediaSummary.name} · ${selectedMediaSummary.count}개` : '선택 사항 · Takeout 정보도 함께 읽습니다'}</small></span><input type="file" aria-label="시작할 사진 폴더 선택" multiple {...{ webkitdirectory: '' }} onChange={event => event.currentTarget.files && void onMediaFiles(event.currentTarget.files)} /></label>
          </div>
          <p className="local-privacy"><ShieldCheck size={13} /> 외부 전송 없이 이 PC에서만 사용합니다.</p>
        </section>
      )}

      {state.plan && journeyMode === 'ROUTE' && <section className="journey-hud route-persistent-hud" aria-live="polite">
        <div className="eyebrow"><MapPinned size={14} /> 현재 장면</div>
        <strong>{hud.mobility}</strong>
        <div className="hud-meta"><span>{hud.date}</span><span>{hud.speed}</span></div>
      </section>}

      {state.scan && <details
        className="settings-panel"
        data-placement="topbar"
        onToggle={event => setSettingsOpen(event.currentTarget.open)}
        {...playbackChrome.interactionProps}
      >
        <summary><span><Layers3 size={16} /> 여행 설정</span><ChevronDown size={16} className="summary-chevron" /></summary>
        <div className="settings-content">
          <div className="source-summary">
            <FileJson size={18} />
            <div><span>현재 Timeline</span><strong>{state.source?.name ?? '준비 중'}</strong></div>
          </div>

          <section className="settings-group">
            <div className="settings-group-title"><Camera size={14} /><span>카메라</span></div>
            <label className="select-field">화면 구성
              <select value={cameraMode} onChange={event => setCameraMode(event.target.value as CameraMode)}>
                <option value="AUTO">자동 · 추천</option><option value="DAY">날짜별로 보기</option><option value="SEGMENT">이동 구간별로 보기</option>
              </select>
            </label>
            <label className="range-field"><span><span>지도 확대</span><output>{formatSigned(zoomOffset)}</output></span>
              <input type="range" min="-1.5" max="1.5" step="0.1" value={zoomOffset} onChange={event => setZoomOffset(Number(event.target.value))} />
            </label>
            <label className="select-field">구간별 재생 시간
              <select value={pacingMode} onChange={event => setPacingMode(event.target.value as PacingMode)}>
                <option value="LOCAL_DAYS">날짜마다 비슷하게 · 추천</option><option value="GLOBAL">이동 거리에 맞게</option>
              </select>
            </label>
          </section>

          {journeyMode === 'PHOTOS' && <section className="settings-group">
            <div className="settings-group-title"><Images size={14} /><span>사진 여정</span><output>{media.length}개</output></div>
            <div className="media-import-row">
              <label>파일 선택<input type="file" accept="image/*,video/*,.heic,.heif" multiple onChange={event => event.currentTarget.files && void onMediaFiles(event.currentTarget.files)} /></label>
              <label>폴더 선택<input type="file" multiple {...{ webkitdirectory: '' }} onChange={event => event.currentTarget.files && void onMediaFiles(event.currentTarget.files)} /></label>
            </div>
            {mediaProgress && <div className="media-progress" data-phase={mediaProgress.phase}>
              <div><strong>{mediaProgress.phase === 'COMPLETE' ? '준비 완료' : '로컬 미디어 분석'}</strong><output>{Math.round(mediaProgressValue * 100)}%</output></div>
              <progress max="1" value={mediaProgressValue} />
              <p>{mediaProgress.message}</p>
            </div>}
            <label className="select-field">사진 표시 범위
              <select aria-label="사진 표시 범위" value={photoViewMode} onChange={event => changePhotoViewMode(event.target.value as PhotoViewMode)}>
                <option value="PREVIEW">미리보기 · 대표 {mediaLibrary.preview.length}개</option>
                <option value="ALL">전체 보기 · {mediaLibrary.all.length}개</option>
              </select>
            </label>
            <label className="range-field"><span><span>사진 표시 시간</span><output>{photoDisplaySec.toFixed(1)}초</output></span>
              <input type="range" min="1.5" max="8" step="0.5" value={photoDisplaySec} onChange={event => setPhotoDisplaySec(Number(event.target.value))} />
            </label>
            <div className="toggle-list photo-day-toggle">
              <label><input type="checkbox" aria-label="날짜 변경 표시" checked={showDayMarkers} onChange={event => setShowDayMarkers(event.target.checked)} /><span>날짜 변경 표시</span></label>
            </div>
            {showDayMarkers && <label className="range-field"><span><span>날짜 표시 시간</span><output>{dayMarkerSec.toFixed(1)}초</output></span>
              <input aria-label="날짜 표시 시간" type="range" min="1" max="3.5" step="0.2" value={dayMarkerSec} onChange={event => setDayMarkerSec(Number(event.target.value))} />
            </label>}
            <label className="select-field">영상 재생
              <select aria-label="영상 재생" value={videoMode} onChange={event => setVideoMode(event.target.value as 'THUMBNAIL' | 'PLAY')}>
                <option value="PLAY">자동 재생</option><option value="THUMBNAIL">대표 장면만</option>
              </select>
            </label>
            {videoMode === 'PLAY' && <>
              <div className="toggle-list">
                <label><input type="checkbox" aria-label="영상 소리 재생" checked={!videoMuted} onChange={event => setVideoMuted(!event.target.checked)} /><span>영상 소리 재생</span></label>
              </div>
              <label className="range-field"><span><span>영상 최대 재생</span><output>{videoMaxSec.toFixed(1)}초</output></span>
                <input type="range" min="2" max="15" step="0.5" value={videoMaxSec} onChange={event => setVideoMaxSec(Number(event.target.value))} />
              </label>
            </>}
            <p className="privacy-note">사진과 영상은 이 PC의 로컬 서버에서만 제공되며 외부로 업로드되지 않습니다.</p>
          </section>}

          <section className="trip-range-control" aria-labelledby="trip-range-title">
            <div className="trip-range-heading">
              <div><span id="trip-range-title">여행 기간</span><strong>{formatTripRange(startDate, endDate)}</strong></div>
              <div className="trip-range-presets">
                <button type="button" onClick={() => {
                  const recommended = preferredTripRange(state.scan!.startDate, state.scan!.endDate);
                  setStartDate(recommended.startDate);
                  setEndDate(recommended.endDate);
                }}>추천 기간</button>
                <button type="button" onClick={() => {
                  setStartDate(state.scan!.startDate);
                  setEndDate(state.scan!.endDate);
                }}>전체 기간</button>
              </div>
            </div>
            <div className="trip-range-fields">
              <label><span>시작</span><input aria-label="여행 시작" type="date" value={startDate} min={state.scan.startDate} max={endDate || state.scan.endDate} onChange={event => setStartDate(event.target.value)} /></label>
              <span className="trip-range-arrow" aria-hidden="true">→</span>
              <label><span>마지막</span><input aria-label="여행 마지막 날" type="date" value={endDate} min={startDate || state.scan.startDate} max={state.scan.endDate} onChange={event => setEndDate(event.target.value)} /></label>
            </div>
          </section>

          <label className="range-field">
            <span><span>경로 재생 길이</span><output>{targetDurationSec > 0 ? formatDuration(targetDurationSec) : '중앙값'}</output></span>
            <input
              type="range"
              min={state.plan?.durationLimits.minSeconds ?? 45}
              max={state.plan?.durationLimits.maxSeconds ?? 300}
              step="5"
              value={durationControlValue}
              onChange={event => {
                durationCustomizedRef.current = true;
                setTargetDurationSec(Number(event.target.value));
              }}
            />
          </label>

          <label className="select-field">지도 소스
            <select value={mapKind} onChange={event => changeMapKind(event.target.value as 'online' | 'local-pmtiles')}>
              <option value="online">온라인 지도</option>
              <option value="local-pmtiles" disabled={!state.mapStatus?.ready}>로컬 PMTiles</option>
            </select>
          </label>

          <div className="toggle-list">
            <label><input type="checkbox" checked={includeFlights} onChange={event => setIncludeFlights(event.target.checked)} /><span>항공 경로 포함</span></label>
            <label><input type="checkbox" checked={lockToPosition} onChange={event => setLockToPosition(event.target.checked)} /><span>현재 위치 따라가기</span></label>
          </div>

          <button className="plan-button" type="button" onClick={() => void createPlan()} disabled={busy || !state.scan || !map}>
            <Route size={16} /> 경로 다시 만들기
          </button>
        </div>
      </details>}

      {(busy || state.phase === 'error') && (
        <section className={`status-card ${state.phase === 'error' ? 'error' : ''}`} role={state.phase === 'error' ? 'alert' : 'status'}>
          {busy && <span className="progress-orbit" aria-hidden="true" />}
          <div><strong>{state.phase === 'error' ? '확인이 필요해요' : mediaLoading ? mediaProgress?.message : state.statusMessage}</strong>
            {busy && <progress max="1" value={mediaLoading ? mediaProgressValue : state.progress} />}
            {state.error && <p>{state.error}</p>}
          </div>
          {state.phase === 'error' && <label className="error-file-action">Timeline 다시 선택<input type="file" accept="application/json,.json" onClick={onTimelineInputClick} onChange={event => void onFileSelected(event.currentTarget.files?.[0])} /></label>}
        </section>
      )}

      {state.plan && state.phase === 'playing' && <div className="player-reveal-zone" aria-hidden="true" {...playbackChrome.revealZoneProps} />}
      {state.plan && <footer className="player-dock" aria-label="재생 컨트롤" {...playbackChrome.interactionProps}>
        <button className="secondary-control" type="button" onClick={resetPlayback} disabled={!canPlay} aria-label="처음부터 보기"><RotateCcw size={17} /></button>
        <button className="play-control" type="button" onClick={togglePlayback} disabled={!canPlay}>
          {state.phase === 'playing' ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
          <span>{state.phase === 'playing' ? '일시정지' : '재생'}</span>
        </button>
        <div className="timeline-control">
          <input
            aria-label="재생 위치"
            type="range"
            min="0"
            max={duration}
            step={state.plan ? 1 / state.plan.fps : 0.1}
            value={Math.min(hud.timeSec, duration)}
            disabled={!canPlay}
            onChange={event => {
              const mode = journeyModeRef.current;
              const player = playersRef.current[mode];
              player?.pause();
              player?.seek(Number(event.target.value));
              dispatch({ type: 'PAUSE' });
            }}
          />
          <div className="timeline-meta">
            <span>{formatClock(hud.timeSec)}</span>
            <p className="player-status">{journeyMode === 'PHOTOS' && (state.phase === 'ready' || state.phase === 'planning' || !activeMediaId) ? '' : state.statusMessage}</p>
            <span>{formatClock(duration)}</span>
          </div>
        </div>
      </footer>}
    </main>
  );
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

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}초`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return rest ? `${minutes}분 ${rest}초` : `${minutes}분`;
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

function formatSigned(value: number): string {
  if (Math.abs(value) < 0.05) return '기본';
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}`;
}

function formatTripRange(startDate: string, endDate: string): string {
  if (!startDate || !endDate) return '기간을 선택하세요';
  return `${formatTripDay(startDate)} → ${formatTripDay(endDate)}`;
}

function formatTripDay(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  return `${year}. ${month}. ${day}.`;
}

function preferredTripRange(availableStart: string, availableEnd: string): { startDate: string; endDate: string } {
  const containsPreviousTrip = availableStart <= DEFAULT_TRIP_START && availableEnd >= DEFAULT_TRIP_END;
  return containsPreviousTrip
    ? { startDate: DEFAULT_TRIP_START, endDate: DEFAULT_TRIP_END }
    : { startDate: availableStart, endDate: availableEnd };
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
