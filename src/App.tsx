import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Camera, CircleHelp, ChevronDown, FileJson, FolderOpen, Images, Layers3, MapPinned, Pause, Play, RotateCcw, Route, ShieldCheck, Upload } from 'lucide-react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { ONLINE_STYLE_URL } from './map/map-style';
import { resolveCityLabel } from './map/city-label';
import { resolvePhotoPlaceLabel } from './map/photo-place-label';
import { PlayerController } from './player/player-controller';
import { buildDayMarkerStops } from './media/day-markers';
import { loadJourneyMedia, organizeJourneyMedia } from './media/media-library';
import { loadLocalMediaManifest } from './media/local-media-library';
import { MediaJourneyPane } from './media/MediaJourneyPane';
import { loadPhotoPlaceLookupStatus, lookupOnlinePhotoPlace, photoPlaceDecision, type PhotoPlaceLookupStatus } from './media/photo-place-resolver';
import { TimelineWorkerClient, type TimelineWorkerPort } from './services/timeline-worker-client';
import { appReducer, initialAppState } from './state/app-reducer';
import { SettingHelp } from './ui/SettingHelp';
import { HelpDialog } from './ui/HelpDialog';
import { MediaLibraryDialog } from './ui/MediaLibraryDialog';
import { usePreferences } from './settings/preferences';
import { usePlaybackChrome } from './ui/playback-chrome';
import type { CameraMode, PacingMode, JourneyMedia, LocalMediaManifest, MapSourceConfig, MediaImportProgress, MobilityClass, PhotoViewMode, PlaybackFrame, PlaybackPlan, PlaybackStop, TimelineSource, TravelFrame } from './types';
import { movementDistances, movementPresentation } from './domain/movement-presentation';

interface AppProps {
  workerClient?: TimelineWorkerPort;
}

interface HudState {
  timeSec: number;
  date: string;
  mobilityClass: MobilityClass;
  mobility: string;
  speed: string;
  distance: string | null;
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

const PHOTO_MAP_MIN_DESKTOP = 0.38;
const PHOTO_MAP_MIN_MOBILE = 0.34;
const MapStage = lazy(() => import('./map/MapStage').then(module => ({ default: module.MapStage })));

export function App({ workerClient }: AppProps) {
  const [state, dispatch] = useReducer(appReducer, initialAppState);
  const [client] = useState<TimelineWorkerPort>(() => workerClient ?? new TimelineWorkerClient());

  const { preferences, update: updatePreference, reset: resetPreferences } = usePreferences();
  const { includeFlights, cameraMode, zoomOffset, pacingMode, lockToPosition, photoViewMode, photoDisplaySec, photoDetailZoomMode, photoDetailZoomStrength, onlinePlaceLookup, showDayMarkers, dayMarkerSec, videoMode, videoMuted, videoMaxSec } = preferences;
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [excludedMedia, setExcludedMedia] = useState<Set<string>>(() => new Set());
  const [helpOpen, setHelpOpen] = useState(false);
  const [activeStopElapsed, setActiveStopElapsed] = useState(0);
  const [cameraTransition, setCameraTransition] = useState<string | null>(null);
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
  const [placeLookupStatus, setPlaceLookupStatus] = useState<PhotoPlaceLookupStatus>({ available: false, provider: null, cache: true });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [appliedPlanSettings, setAppliedPlanSettings] = useState<AppliedPlanSettings | null>(null);
  const [hud, setHud] = useState<HudState>({ timeSec: 0, date: '—', mobilityClass: 'UNKNOWN', mobility: '여행 준비', speed: '—', distance: null, originCity: null, destinationCity: null });
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
  const allMediaRef = useRef<JourneyMedia[]>([]);
  const activeMediaRef = useRef<string | null>(null);
  const placeLookupOperationRef = useRef(0);
  const onlinePlaceLookupRef = useRef(onlinePlaceLookup);
  const placeLookupStatusRef = useRef(placeLookupStatus);
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
    setCameraTransition(null);
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
      const preferred = preferredTripRange(scan);
      setStartDate(preferred.startDate);
      setEndDate(preferred.endDate);
      durationCustomizedRef.current = false;
      setTargetDurationSec(0);
      autoPlanRef.current = true;
      dispatch({ type: 'SCAN_SUCCESS', scan });
    } catch (error) {
      if (operation !== scanOperationRef.current) return;
      dispatch({ type: 'FAIL', message: error instanceof Error ? error.message : '타임라인을 읽지 못했습니다. 파일을 다시 선택해 주세요.' });
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
    setMediaProgress({ phase: 'PREPARE', processed: 0, total: files.length, message: '사진과 영상을 확인하고 있습니다.' });
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
      setMediaProgress({ phase: 'COMPLETE', processed: loaded.all.length, total: loaded.all.length, message: `${loaded.all.length}개의 사진·영상을 연결했습니다.` });
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
    void loadPhotoPlaceLookupStatus().then(setPlaceLookupStatus);
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
    allMediaRef.current = mediaLibrary.all;
  }, [mediaLibrary.all]);

  useEffect(() => {
    onlinePlaceLookupRef.current = onlinePlaceLookup;
    placeLookupOperationRef.current += 1;
    if (!onlinePlaceLookup && map && activeMediaRef.current) {
      const item = mediaRef.current.find(candidate => candidate.id === activeMediaRef.current);
      if (item) setActivePlaceName(resolvePlaceName(map, item));
    }
  }, [map, onlinePlaceLookup]);

  useEffect(() => {
    placeLookupStatusRef.current = placeLookupStatus;
  }, [placeLookupStatus]);

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
    const distances = movementDistances(state.plan.segments);

    const createController = (mode: JourneyMode, stops: PlaybackStop[]) => {
      const controller = new PlayerController(map, {
        onTransitionChange: message => { if (mode === journeyModeRef.current) setCameraTransition(message); },
        onFrame: (frame, _frameIndex, timeSec, stopId, stopElapsedSec = 0) => {
          playbackPositionsRef.current[mode] = timeSec;
          if (mode !== journeyModeRef.current) return;
          if (stopId !== activeMediaRef.current) {
            activeMediaRef.current = stopId;
            setActiveMediaId(stopId);
            const item = stopId ? mediaRef.current.find(candidate => candidate.id === stopId) : null;
            if (!item) {
              placeLookupOperationRef.current += 1;
              setActivePlaceName(null);
            } else {
              const decision = photoPlaceDecision(item, allMediaRef.current, state.plan!, frame);
              const fallbackPlace = resolvePlaceName(map, item, decision.kind === 'fallback' ? decision.coordinate : undefined);
              if (decision.kind === 'movement') {
                placeLookupOperationRef.current += 1;
                setActivePlaceName(decision.label);
              } else {
                setActivePlaceName(fallbackPlace);
                if (decision.kind === 'lookup' && onlinePlaceLookupRef.current && placeLookupStatusRef.current.available) {
                  const lookupOperation = ++placeLookupOperationRef.current;
                  void lookupOnlinePhotoPlace(decision).then(result => {
                    if (lookupOperation !== placeLookupOperationRef.current || activeMediaRef.current !== stopId || !onlinePlaceLookupRef.current) return;
                    if (result?.found && result.name) setActivePlaceName(result.name);
                  });
                }
              }
            }
          }
          if (playersRef.current[mode]?.isPlaying() && timeSec > 0 && performance.now() - lastHudUpdateRef.current < 90) return;
          lastHudUpdateRef.current = performance.now();
          setActiveStopElapsed(stopElapsedSec);
          const nextHud = hudForFrame(frame, state.plan!, timeSec, distances);
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
  const onMapError = useCallback((message: string | null) => setMapNotice(message), []);

  const onFileSelected = async (file: File | undefined) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.json')) {
      dispatch({ type: 'FAIL', message: 'Google 지도에서 내보낸 타임라인 JSON 파일을 선택해 주세요.' });
      return;
    }
    if (file.size > 250 * 1024 * 1024) { dispatch({ type: 'FAIL', message: '파일이 너무 큽니다. 250 MB 이하의 타임라인 JSON 파일을 선택해 주세요.' }); return; }
    setSettingsOpen(false);
    manualTimelineSelectedRef.current = true;
    pausePlayback();
    setActiveMediaId(null);
    try {
      await scanSource({ kind: 'local-file', name: file.name }, await file.text());
    } catch (error) {
      dispatch({ type: 'FAIL', message: error instanceof Error ? error.message : '타임라인 파일을 읽지 못했습니다. 파일을 다시 선택해 주세요.' });
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
      dispatch({ type: 'NOTICE', message: `${files.length}개의 사진·영상을 선택했습니다. 타임라인을 열면 자동으로 연결합니다.` });
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

  const showRouteOverview = () => {
    if (!map || !state.plan) return;
    pausePlayback();
    const points = state.plan.frames.filter((frame): frame is TravelFrame => frame.kind === 'TRAVEL').map(frame => frame.position);
    if (!points.length) return;
    const bounds = points.reduce((b, p) => [Math.min(b[0], p.lng), Math.min(b[1], p.lat), Math.max(b[2], p.lng), Math.max(b[3], p.lat)], [Infinity, Infinity, -Infinity, -Infinity]);
    map.setLayoutProperty('route-all', 'visibility', 'visible');
    const height = map.getCanvas().clientHeight;
    map.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { padding: Math.min(65, Math.max(20, height * 0.15)), maxZoom: 14, duration: 0 });
  };

  const busy = state.phase === 'loading' || state.phase === 'planning' || mediaLoading;
  const canPlay = Boolean(state.plan && map && !busy && !settingsOpen);
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

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && settingsOpen && !helpOpen && !libraryOpen) {
        setSettingsOpen(false);
        shellRef.current?.querySelector<HTMLElement>('.settings-panel summary')?.focus();
        return;
      }
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

  return (
    <main
      ref={shellRef}
      className={`app-shell ${journeyMode === 'PHOTOS' ? 'photo-mode' : ''} ${state.scan ? 'has-trip' : ''} ${state.phase === 'playing' ? 'playback-active' : ''} ${playbackChromeClass}`}
      data-settings-open={settingsOpen ? 'true' : 'false'}
      data-playback-chrome={playbackChrome.visible ? 'visible' : 'hidden'}
      data-playing-mode={state.phase === 'playing' ? journeyMode : 'NONE'}
      style={{ '--photo-map-share': `${mapShare * 100}%` } as CSSProperties}
    >
      <Suspense fallback={<div className="map-canvas map-loading" aria-label="지도 불러오는 중" />}>
        <MapStage key={`${mapRevision}-${mapKind}`} source={mapSource} onReady={onMapReady} onError={onMapError} />
      </Suspense>
      {journeyMode === 'PHOTOS' && <>
        <MediaJourneyPane
          media={media}
          activeId={state.phase === 'ready' || state.phase === 'planning' ? null : activeMediaId}
          playing={state.phase === 'playing'} elapsedSec={activeStopElapsed}
          videoMode={videoMode}
          videoMuted={videoMuted}
          photoDisplaySec={photoDisplaySec}
          mobilityClass={hud.mobilityClass}
          movementLabel={hud.mobility}
          movementDate={hud.date}
          movementSpeed={hud.speed}
          movementDistance={hud.distance}
          originCity={hud.originCity}
          destinationCity={hud.destinationCity}
          placeName={activePlaceName}
          onFiles={files => void onMediaFiles(files)}
          emptyDescription={!state.plan
            ? '타임라인을 먼저 열어 여행 경로를 준비해 주세요.'
            : mediaLibrary.all.length && !media.length
              ? '모든 사진이 감상에서 제외되어 있습니다.\n사진 목록에서 다시 포함해 주세요.'
              : selectedMediaSummary?.count
                ? '선택한 여행 기간에 맞는 사진이 없습니다.\n여행 기간을 바꾸거나 다른 사진을 선택해 주세요.'
                : '사진과 영상을 선택하면 촬영 시각에 맞춰 여행 경로에 연결합니다.'}
          onOpenLibrary={mediaLibrary.all.length && !media.length ? () => setLibraryOpen(true) : undefined}
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
            <span>지도와 사진으로 다시 보는 여행</span>
          </div>
        </div>
        <div className="topbar-actions">
        <div className="mode-switch" role="group" aria-label="여정 보기 방식">
          <button type="button" className={journeyMode === 'ROUTE' ? 'active' : ''} aria-pressed={journeyMode === 'ROUTE'} onClick={() => changeJourneyMode('ROUTE')}><Route size={14} /> 경로 보기</button>
          <button type="button" className={journeyMode === 'PHOTOS' ? 'active' : ''} aria-pressed={journeyMode === 'PHOTOS'} onClick={() => changeJourneyMode('PHOTOS')}><Images size={14} /> 사진 여정</button>
        </div>
        {state.plan && <button className="import-button overview-button" type="button" aria-label="전체 경로" title="전체 경로 보기" onClick={showRouteOverview} disabled={busy || !map}><MapPinned size={16} /><span>전체 경로</span></button>}
        <label className="import-button media-import-button" title="사진 폴더 선택">
          <FolderOpen size={16} aria-hidden="true" /><span>사진 폴더</span>
          <input type="file" aria-label="사진 폴더 선택" multiple {...{ webkitdirectory: '' }} disabled={mediaLoading} onChange={event => event.currentTarget.files && void onMediaFiles(event.currentTarget.files)} />
        </label>
        <label className="import-button" title="타임라인 파일 열기">
          <Upload size={16} aria-hidden="true" />
          <span>타임라인 파일 열기</span>
          <input
            aria-label="타임라인 파일 열기"
            type="file"
            accept="application/json,.json"
            disabled={busy}

            onChange={event => {
              void onFileSelected(event.currentTarget.files?.[0]);
              event.currentTarget.value = '';
            }}
          />
        </label>
        <button className="import-button help-trigger" type="button" aria-label="사용 안내" title="사용 안내" onClick={() => { pausePlayback(); setHelpOpen(true); }}><CircleHelp size={18} aria-hidden="true" /></button>
        </div>
      </header>

      {state.phase === 'idle' && (
        <section className="local-import-panel" aria-labelledby="local-import-title">
          <div className="local-import-heading">
            <span aria-hidden="true"><Route size={22} /></span>
            <div><h1 id="local-import-title">다녀온 여행을 다시 펼쳐보세요</h1><p>타임라인으로 이동 경로를 따라가고,<br />사진과 영상으로 그 순간을 감상하세요.</p></div>
          </div>
          <div className="local-import-actions">
            <label className="local-import-primary"><FileJson size={18} /><span><strong>타임라인 파일 열기</strong><small>Google 지도에서 내보낸 JSON · <span className="keep-together">최대 250 MB</span></small></span><input type="file" aria-label="시작할 타임라인 파일 열기" accept="application/json,.json"  onChange={event => void onFileSelected(event.currentTarget.files?.[0])} /></label>
            <label className="local-import-secondary"><Images size={18} /><span><strong>사진 폴더 선택</strong><small>{selectedMediaSummary ? `${selectedMediaSummary.name} · ${selectedMediaSummary.count}개` : '선택 사항 · 사진과 영상을 경로에 연결합니다'}</small></span><input type="file" aria-label="시작할 사진 폴더 선택" multiple {...{ webkitdirectory: '' }} onChange={event => event.currentTarget.files && void onMediaFiles(event.currentTarget.files)} /></label>
          </div>
          <button className="settings-help-link" type="button" aria-label="사용 방법" onClick={() => setHelpOpen(true)}>타임라인 준비 방법</button>
          <p className="local-privacy"><ShieldCheck size={13} /><span>파일은 이 기기에서만 읽습니다.<br />온라인 지도는 인터넷이 필요합니다.</span></p>
        </section>
      )}

      {state.plan && journeyMode === 'ROUTE' && <section className="journey-hud route-persistent-hud" aria-label="현재 이동 정보">
        <div className="eyebrow"><MapPinned size={14} /> 현재 장면</div>
        <strong>{hud.mobility}</strong>
        <div className="hud-meta"><span>{hud.date}</span><span className="hud-movement-metrics"><span>{hud.speed}</span>{hud.distance !== null && <span className="movement-distance" title="현재 이동 구간의 거리">{hud.distance}</span>}</span></div>
      </section>}

      {state.scan && <details
        className="settings-panel"
        data-placement="topbar"
        open={settingsOpen}
        onToggle={event => setSettingsOpen(event.currentTarget.open)}
        {...playbackChrome.interactionProps}
      >
        <summary onClick={event => { event.preventDefault(); if (!settingsOpen) pausePlayback(); setSettingsOpen(!settingsOpen); }}><span><Layers3 size={16} /> 여행 설정</span><ChevronDown size={16} className="summary-chevron" /></summary>
        <div className="settings-content">
          <div className="source-summary">
            <FileJson size={18} />
            <div><span>현재 타임라인</span><strong>{state.source?.name ?? '준비 중'}</strong></div>
          </div>

          <button className="settings-help-link" type="button" onClick={() => { pausePlayback(); setHelpOpen(true); }}>사용 안내</button>
          <section className="trip-range-control" aria-labelledby="trip-range-title">
            <div className="trip-range-heading">
              <div><span id="trip-range-title">여행 기간</span><strong>{formatTripRange(startDate, endDate)}</strong></div>
              <div className="trip-range-presets">
                <button type="button" onClick={() => {
                  setStartDate(state.scan!.startDate);
                  setEndDate(state.scan!.endDate);
                }}>전체 기간</button>
              </div>
            </div>
            {!!state.scan.tripCandidates?.length && <label className="select-field trip-candidate-picker">
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
            <div className="trip-range-fields">
              <label><span>시작일</span><input aria-label="여행 시작" type="date" value={startDate} min={state.scan.startDate} max={endDate || state.scan.endDate} onChange={event => setStartDate(event.target.value)} /></label>
              <span className="trip-range-arrow" aria-hidden="true">→</span>
              <label><span>종료일</span><input aria-label="여행 마지막 날" type="date" value={endDate} min={startDate || state.scan.startDate} max={state.scan.endDate} onChange={event => setEndDate(event.target.value)} /></label>
            </div>
          </section>

          <section className="settings-group">
            <div className="settings-group-title"><Camera size={14} /><span>카메라</span></div>
            <SettingHelp title="지도 보기 방식" description={"자동은 이동 거리와 하루 동선을 함께 고려합니다.\n날짜별·구간별 보기는 해당 범위를 중심으로 구성합니다.\n변경 후 경로 다시 만들기를 눌러 적용하세요."}><label className="select-field">지도 보기 방식
              <select aria-description="자동은 이동 거리와 하루 동선을 함께 고려합니다. 날짜별·구간별 보기는 해당 범위를 중심으로 구성합니다. 변경 후 경로 다시 만들기를 눌러 적용하세요." value={cameraMode} onChange={event => updatePreference('cameraMode', event.target.value as CameraMode)}>
                <option value="AUTO">자동 · 추천</option><option value="DAY">날짜별로 보기</option><option value="SEGMENT">이동 구간별로 보기</option>
              </select>
            </label></SettingHelp>
            <SettingHelp title="지도 확대" description={"왼쪽은 넓게, 오른쪽은 자세히 봅니다.\n바로 적용됩니다."}><label className="range-field"><span><span>지도 확대</span><output>{formatSigned(zoomOffset)}</output></span>
              <input aria-description="왼쪽은 넓게, 오른쪽은 자세히 봅니다. 바로 적용됩니다." type="range" min="-1.5" max="1.5" step="0.1" value={zoomOffset} onChange={event => updatePreference('zoomOffset', Number(event.target.value))} />
            </label></SettingHelp>
            <SettingHelp title="구간별 재생 시간" description={"날짜마다 비슷하게: 짧은 여행일도 충분히 보여줍니다.\n이동 거리에 맞게: 긴 이동에 더 많은 시간을 배분합니다.\n변경 후 경로 다시 만들기로 적용합니다."}><label className="select-field">구간별 재생 시간
              <select aria-description="날짜마다 비슷하게: 짧은 여행일도 충분히 보여줍니다. 이동 거리에 맞게: 긴 이동에 더 많은 시간을 배분합니다. 변경 후 경로 다시 만들기로 적용합니다." value={pacingMode} onChange={event => updatePreference('pacingMode', event.target.value as PacingMode)}>
                <option value="LOCAL_DAYS">날짜마다 비슷하게 · 추천</option><option value="GLOBAL">이동 거리에 맞게</option>
              </select>
            </label></SettingHelp>
          </section>

          {journeyMode === 'PHOTOS' && <section className="settings-group">
            <div className="settings-group-title"><Images size={14} /><span>사진 여정</span><output>{media.length}개</output></div>
            <button className="settings-help-link" type="button" onClick={() => { pausePlayback(); setLibraryOpen(true); }}>사진 목록 관리</button>
            <div className="media-import-row">
              <label>파일 선택<input type="file" accept="image/*,video/*,.heic,.heif" multiple onChange={event => event.currentTarget.files && void onMediaFiles(event.currentTarget.files)} /></label>
              <label>폴더 선택<input type="file" multiple {...{ webkitdirectory: '' }} onChange={event => event.currentTarget.files && void onMediaFiles(event.currentTarget.files)} /></label>
            </div>
            {mediaProgress && <div className="media-progress" data-phase={mediaProgress.phase}>
              <div><strong>{mediaProgress.phase === 'COMPLETE' ? '준비 완료' : '사진·영상 확인 중'}</strong><output>{Math.round(mediaProgressValue * 100)}%</output></div>
              <progress max="1" value={mediaProgressValue} />
              <p>{mediaProgress.message}</p>
            </div>}
            <SettingHelp title="표시할 사진" description={"대표 사진만: 비슷한 시간·장소에서 고른 사진을 보여줍니다.\n모든 사진: 연결된 사진을 모두 보여줍니다."}><label className="select-field">표시할 사진
              <select aria-description="대표 사진만: 비슷한 시간·장소에서 고른 사진을 보여줍니다. 모든 사진: 연결된 사진을 모두 보여줍니다." aria-label="표시할 사진" value={photoViewMode} onChange={event => changePhotoViewMode(event.target.value as PhotoViewMode)}>
                <option value="PREVIEW">대표 사진만 · {mediaLibrary.preview.length}개</option>
                <option value="ALL">모든 사진 · {mediaLibrary.all.length}개</option>
              </select>
            </label></SettingHelp>
            <SettingHelp title="사진 표시 시간" description={"사진 한 장을 보여주는 시간입니다.\n감상 중에는 경로 이동이 잠시 멈춥니다."}><label className="range-field"><span><span>사진 표시 시간</span><output>{photoDisplaySec.toFixed(1)}초</output></span>
              <input aria-description="사진 한 장을 보여주는 시간입니다. 감상 중에는 경로 이동이 잠시 멈춥니다." type="range" min="1" max="10" step="0.5" value={photoDisplaySec} onChange={event => updatePreference('photoDisplaySec', Number(event.target.value))} />
            </label></SettingHelp>
            <SettingHelp title="사진을 볼 때 지도 확대" description={"사진 위치 가까이 보기: 사진을 감상하는 장소 주변을 더 자세히 보여줍니다.\n기본 확대만: 추가 확대 없이 재생합니다.\n비행 중에는 추가 확대하지 않으며 바로 적용됩니다."}><label className="select-field">사진을 볼 때 지도 확대
              <select aria-description="사진 위치 가까이 보기: 사진을 감상하는 장소 주변을 더 자세히 보여줍니다. 기본 확대만: 추가 확대 없이 재생합니다. 비행 중에는 추가 확대하지 않으며 바로 적용됩니다." aria-label="사진을 볼 때 지도 확대" value={photoDetailZoomMode} onChange={event => updatePreference('photoDetailZoomMode', event.target.value as 'AUTO' | 'OFF')}>
                <option value="AUTO">사진 위치 가까이 보기 · 추천</option><option value="OFF">기본 확대만</option>
              </select>
            </label></SettingHelp>
            {photoDetailZoomMode === 'AUTO' && <><SettingHelp title="상세 확대 강도" description={"1.0이 기본입니다.\n화면이 너무 가까우면 낮춰 주세요."}><label className="range-field"><span><span>상세 확대 강도</span><output>{photoDetailZoomStrength.toFixed(1)}×</output></span>
              <input aria-description="1.0이 기본입니다. 화면이 너무 가까우면 낮춰 주세요." aria-label="상세 확대 강도" type="range" min="0.5" max="1.5" step="0.1" value={photoDetailZoomStrength} onChange={event => updatePreference('photoDetailZoomStrength', Number(event.target.value))} />
            </label></SettingHelp></>}
            <div className="toggle-list">
              <SettingHelp title="정확한 장소 온라인 확인" description={placeLookupStatus.available
                ? `GPS가 충분히 신뢰되는 사진만 ${placeLookupStatus.provider ?? '설정된 장소 서비스'}에 좌표를 보내 정확한 장소명을 확인합니다.\n사진 원본과 타임라인은 보내지 않으며 확인한 장소는 이 PC에 저장합니다.`
                : '별도의 장소 서비스 연결이 필요합니다.\n연결하지 않아도 사진과 여행 경로를 감상할 수 있습니다.\n연결 방법은 사용 안내에서 확인하세요.'}>
                <div className="setting-checkbox"><input
                  type="checkbox"
                  aria-label="정확한 장소 온라인 확인"
                  checked={placeLookupStatus.available && onlinePlaceLookup}
                  disabled={!placeLookupStatus.available}
                  onChange={event => updatePreference('onlinePlaceLookup', event.target.checked)}
                /><span>정확한 장소 온라인 확인{placeLookupStatus.available && placeLookupStatus.provider ? ` · ${placeLookupStatus.provider}` : ' · 설정 필요'}</span></div>
              </SettingHelp>
            </div>
            <div className="toggle-list photo-day-toggle">
              <SettingHelp title="날짜 변경 표시" description={"여행 첫날과 날짜가 바뀌는 지점에서 날짜 카드를 보여줍니다.\n끄면 날짜 카드 없이 감상합니다.\n바로 적용됩니다."}><div className="setting-checkbox"><input type="checkbox" aria-description="여행 첫날과 날짜가 바뀌는 지점에서 날짜 카드를 보여줍니다. 끄면 날짜 카드 없이 감상합니다. 바로 적용됩니다." aria-label="날짜 변경 표시" checked={showDayMarkers} onChange={event => updatePreference('showDayMarkers', event.target.checked)} /><span>날짜 변경 표시</span></div></SettingHelp>
            </div>
            {showDayMarkers && <><SettingHelp title="날짜 표시 시간" description="여행 첫날과 날짜가 바뀌는 지점의 날짜 카드 표시 시간입니다."><label className="range-field"><span><span>날짜 표시 시간</span><output>{dayMarkerSec.toFixed(1)}초</output></span>
              <input aria-description="여행 첫날과 날짜가 바뀌는 지점의 날짜 카드 표시 시간입니다." aria-label="날짜 표시 시간" type="range" min="1" max="5" step="0.5" value={dayMarkerSec} onChange={event => updatePreference('dayMarkerSec', Number(event.target.value))} />
            </label></SettingHelp></>}
            <SettingHelp title="영상 재생" description={"자동 재생은 앱의 재생·일시정지와 함께 동작합니다.\n첫 화면만 표시를 선택하면 영상의 첫 화면만 보여줍니다."}><label className="select-field">영상 재생
              <select aria-description="자동 재생은 앱의 재생·일시정지와 함께 동작합니다. 첫 화면만 표시를 선택하면 영상의 첫 화면만 보여줍니다." aria-label="영상 재생" value={videoMode} onChange={event => updatePreference('videoMode', event.target.value as 'THUMBNAIL' | 'PLAY')}>
                <option value="PLAY">자동 재생</option><option value="THUMBNAIL">첫 화면만 표시</option>
              </select>
            </label></SettingHelp>
            {videoMode === 'PLAY' && <>
              <div className="toggle-list">
                <SettingHelp title="영상 소리 재생" description={"영상의 원래 소리를 함께 재생합니다.\n브라우저가 소리 재생을 막으면 영상 위의 재생 버튼을 눌러 주세요."}><div className="setting-checkbox"><input type="checkbox" aria-description="영상의 원래 소리를 함께 재생합니다. 브라우저가 소리 재생을 막으면 영상 위의 재생 버튼을 눌러 주세요." aria-label="영상 소리 재생" checked={!videoMuted} onChange={event => updatePreference('videoMuted', !event.target.checked)} /><span>영상 소리 재생</span></div></SettingHelp>
              </div>
              <SettingHelp title="영상 최대 재생" description={"긴 영상은 이 시간까지만 재생합니다.\n짧은 영상은 마지막 화면을 유지합니다."}><label className="range-field"><span><span>영상 최대 재생</span><output>{videoMaxSec.toFixed(1)}초</output></span>
                <input aria-description="긴 영상은 이 시간까지만 재생합니다. 짧은 영상은 마지막 화면을 유지합니다." type="range" min="2" max="15" step="0.5" value={videoMaxSec} onChange={event => updatePreference('videoMaxSec', Number(event.target.value))} />
              </label></SettingHelp>
            </>}
            <p className="privacy-note">사진과 영상 원본은 외부로 업로드하지 않습니다.<br />‘정확한 장소 온라인 확인’을 직접 켠 경우에만 신뢰 가능한 GPS 좌표가 설정한 장소 서비스로 전송됩니다.</p>
          </section>}


          <SettingHelp title="경로 재생 시간" description={"실제 이동을 이 시간으로 압축합니다.\n사진과 날짜 카드의 감상 시간은 별도로 더해집니다."}><label className="range-field">
            <span><span>경로 재생 시간</span><output>{targetDurationSec > 0 ? formatDuration(targetDurationSec) : '자동'}</output></span>
            <input aria-description="실제 이동을 이 시간으로 압축합니다. 사진과 날짜 카드의 감상 시간은 별도로 더해집니다."
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
          </label></SettingHelp>

          <SettingHelp title="배경 지도" description={"온라인 지도는 인터넷을 사용합니다.\n설치형 지도는 설치한 지역을 자세히 보여줍니다.\n아직 저장되지 않은 지명 글꼴을 처음 표시할 때는 인터넷이 필요할 수 있습니다."}><label className="select-field">배경 지도
            <select aria-description="온라인 지도는 인터넷을 사용합니다. 설치형 지도는 설치한 지역을 자세히 보여줍니다. 아직 저장되지 않은 지명 글꼴을 처음 표시할 때는 인터넷이 필요할 수 있습니다." value={mapKind} onChange={event => changeMapKind(event.target.value as 'online' | 'local-pmtiles')}>
              <option value="online">온라인 지도</option>
              <option value="local-pmtiles" disabled={!state.mapStatus?.ready}>설치형 지도{!state.mapStatus?.ready ? " · 설치 필요" : ""}</option>
            </select>
          </label></SettingHelp>

          <div className="toggle-list">
            <SettingHelp title="항공 경로 포함" description={"비행 구간을 경로에 포함합니다.\n변경 후 경로 다시 만들기를 눌러 적용하세요."}><div className="setting-checkbox"><input type="checkbox" aria-label="항공 경로 포함" aria-description="비행 구간을 경로에 포함합니다. 변경 후 경로 다시 만들기를 눌러 적용하세요." checked={includeFlights} onChange={event => updatePreference('includeFlights', event.target.checked)} /><span>항공 경로 포함</span></div></SettingHelp>
            <SettingHelp title="현재 위치 따라가기" description={"켜면 이동 위치를 지도 중앙에 둡니다.\n끄면 진행 방향과 주변 경로가 보이도록 카메라가 이동합니다.\n바로 적용됩니다."}><div className="setting-checkbox"><input type="checkbox" aria-label="현재 위치 따라가기" aria-description="켜면 이동 위치를 지도 중앙에 둡니다. 끄면 진행 방향과 주변 경로가 보이도록 카메라가 이동합니다. 바로 적용됩니다." checked={lockToPosition} onChange={event => updatePreference('lockToPosition', event.target.checked)} /><span>현재 위치 따라가기</span></div></SettingHelp>
          </div>

          <div className="settings-footer">
            <p className="settings-apply-note" role="status">{planNeedsRebuild ? '변경한 기간과 재생 구성을 경로에 적용하세요.' : '지도 확대와 사진 설정은 바로 적용됩니다.'}</p>
            <button className="plan-button" type="button" onClick={() => void createPlan()} disabled={busy || !state.scan || !map || !planNeedsRebuild || !startDate || !endDate || startDate > endDate}>
              <Route size={16} /> {state.plan ? '경로 다시 만들기' : '경로 만들기'}
            </button>
            <button className="settings-help-link" type="button" onClick={() => { resetPreferences(); setTargetDurationSec(0); durationCustomizedRef.current = false; }}>기본 설정으로 되돌리기</button>
          </div>
        </div>
      </details>}

      {(busy || state.phase === 'error') && (
        <section className={`status-card ${state.phase === 'error' ? 'error' : ''}`} role={state.phase === 'error' ? 'alert' : 'status'}>
          {busy && <span className="progress-orbit" aria-hidden="true" />}
          <div><strong>{state.phase === 'error' ? '여행을 준비하지 못했습니다' : mediaLoading ? mediaProgress?.message : state.statusMessage}</strong>
            {busy && <progress max="1" value={mediaLoading ? mediaProgressValue : state.progress} />}
            {state.error && <p>{state.error}</p>}
          </div>
          {state.phase === 'error' && state.scan && <button className="error-file-action" onClick={() => setSettingsOpen(true)}>여행 기간 확인</button>}
          {state.phase === 'error' && <label className="error-file-action">다른 타임라인 선택<input type="file" accept="application/json,.json"  onChange={event => void onFileSelected(event.currentTarget.files?.[0])} /></label>}
        </section>
      )}

      {state.plan && state.phase === 'playing' && <div className="player-reveal-zone" aria-hidden="true" {...playbackChrome.revealZoneProps} />}
      {state.plan && <footer className="player-dock" aria-label="재생 컨트롤" {...playbackChrome.interactionProps}>
        <button className="secondary-control" type="button" onClick={resetPlayback} disabled={!canPlay} aria-label="처음부터 보기" title="처음부터 보기"><RotateCcw size={17} /></button>
        <button className="play-control" type="button" onClick={togglePlayback} disabled={!canPlay}
          aria-label={state.phase === 'playing' ? '일시정지' : '재생'} title={state.phase === 'playing' ? '일시정지' : '재생'}>
          {state.phase === 'playing' ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
        </button>
        <div className="timeline-control">
          <input
            aria-label="재생 위치"
            aria-valuetext={`${formatClock(hud.timeSec)} / ${formatClock(duration)}`}
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
      {cameraTransition && <div className="camera-transition" role="status">{cameraTransition}</div>}
      {mapNotice && <aside className="map-recovery" role="status"><p>{mapNotice}</p><button type="button" onClick={() => { pausePlayback(); setMap(null); setMapNotice(null); setMapRevision(value => value + 1); }}>지도 다시 연결</button><button type="button" onClick={() => setMapNotice(null)} aria-label="지도 안내 닫기">닫기</button></aside>}
      <MediaLibraryDialog open={libraryOpen} onClose={() => setLibraryOpen(false)} media={mediaLibrary.all} excluded={excludedMedia}
        onToggle={id => setExcludedMedia(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; })} onIncludeAll={() => setExcludedMedia(new Set())} />
      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
    </main>
  );
}

function hudForFrame(frame: PlaybackFrame, plan: PlaybackPlan, timeSec: number, distances: Array<string | null>): HudState {
  if (frame.kind === 'OUTRO') return { timeSec, date: '여행 전체', mobilityClass: 'UNKNOWN', mobility: '전체 경로', speed: '—', distance: null, originCity: null, destinationCity: null };
  const travel = frame as TravelFrame;
  const segment = plan.segments[travel.segmentIndex];
  const movement = movementPresentation(plan.segments, travel.segmentIndex);
  const sourceMs = segment.startMs + (segment.endMs - segment.startMs) * travel.progress;
  return {
    timeSec,
    date: new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Seoul' }).format(sourceMs),
    mobilityClass: movement.mobilityClass,
    mobility: movement.label,
    speed: segment.inferenceSource === 'visual-gap' ? '—' : `${travel.speedKmh.toFixed(0)} km/h`,
    distance: distances[travel.segmentIndex],
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

function preferredTripRange(scan: import('./types').TimelineScanResult): { startDate: string; endDate: string } {
  const candidate = scan.tripCandidates?.[0] ?? scan.recommendedRange;
  if (
    candidate &&
    candidate.startDate >= scan.startDate &&
    candidate.endDate <= scan.endDate &&
    candidate.startDate <= candidate.endDate
  ) return { startDate: candidate.startDate, endDate: candidate.endDate };
  return { startDate: scan.startDate, endDate: scan.endDate };
}

function formatTripCandidateSummary(candidate: import('./types').TimelineTripCandidate): string {
  const start = Date.parse(candidate.startDate + 'T00:00:00Z');
  const end = Date.parse(candidate.endDate + 'T00:00:00Z');
  const days = Number.isFinite(start) && Number.isFinite(end) ? Math.max(1, Math.round((end - start) / 86_400_000) + 1) : Math.max(1, candidate.activeDays);
  const distanceKm = candidate.distanceMeters / 1_000;
  const distance = distanceKm >= 10 ? Math.round(distanceKm) + 'km' : distanceKm.toFixed(1) + 'km';
  return days + '일 · 이동 약 ' + distance;
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

function resolvePlaceName(map: MapLibreMap, item: JourneyMedia, coordinate?: { lat: number; lng: number }): string {
  const label = resolvePhotoPlaceLabel(map, coordinate ?? { lat: item.matchedLat, lng: item.matchedLng });
  if (label) return label;
  if (coordinate) return 'Timeline 위치';
  return item.positionSource === 'gps' ? '촬영 위치' : 'Timeline 위치';
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}초`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return rest ? `${minutes}분 ${rest}초` : `${minutes}분`;
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
