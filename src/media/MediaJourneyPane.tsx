import { Film, ImageOff, ImagePlus } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { dayMarkerCueFromId } from './day-markers';
import { sceneTransitionDurationMs, transitSceneTransitionDurationMs } from './scene-transition';
import type { JourneyMedia, MobilityClass } from '../types';

interface Props {
  media: JourneyMedia[];
  activeId: string | null;
  videoMode: 'THUMBNAIL' | 'PLAY';
  videoMuted: boolean;
  photoDisplaySec: number;
  mobilityClass: MobilityClass;
  movementDate: string;
  movementSpeed: string;
  originCity: string | null;
  destinationCity: string | null;
  placeName: string | null;
  onFiles: (files: FileList) => void;
}

type SceneDescriptor =
  | { kind: 'photo'; key: string; item: JourneyMedia; place: string; url: string | null }
  | { kind: 'day'; key: string; dayKey: string; dayNumber: number }
  | { kind: 'transit'; key: string; mobilityClass: MobilityClass; movementDate: string; movementSpeed: string; originCity: string | null; destinationCity: string | null }
  | { kind: 'empty'; key: 'empty' };

type AssetPreloadStatus = 'loading' | 'ready' | 'error';

interface PreloadedAsset {
  status: AssetPreloadStatus;
  url: string;
}

interface SceneTransitionState {
  currentScene: SceneDescriptor;
  previousScene: SceneDescriptor | null;
  transitionMs: number;
}

interface PreloadHandle {
  signature: string;
  cleanup: () => void;
}

const MEDIA_PRELOAD_AHEAD = 4;
const MEDIA_PRELOAD_TIMEOUT_MS = 6000;

export function MediaJourneyPane({ media, activeId, videoMode, videoMuted, photoDisplaySec, mobilityClass, movementDate, movementSpeed, originCity, destinationCity, placeName, onFiles }: Props) {
  const dayCue = useMemo(() => dayMarkerCueFromId(activeId), [activeId]);
  const active = dayCue ? null : media.find(item => item.id === activeId) ?? null;
  const preloadedAssets = useMediaPreload(media, activeId, videoMode);
  const activeAsset = active ? preloadedAssets[active.id] : undefined;
  const desiredScene = useMemo<SceneDescriptor>(() => {
    if (dayCue && activeId) {
      return {
        kind: 'day',
        key: activeId,
        dayKey: dayCue.dayKey,
        dayNumber: dayCue.dayNumber
      };
    }
    if (active) {
      return {
        kind: 'photo',
        key: `photo:${active.id}`,
        item: active,
        place: formatPhotoPlace(placeName, originCity, destinationCity),
        url: activeAsset?.url ?? active.sourceUrl ?? null
      };
    }
    if (media.length) {
      return {
        kind: 'transit',
        key: `transit:${mobilityClass}`,
        mobilityClass,
        movementDate,
        movementSpeed,
        originCity,
        destinationCity
      };
    }
    return { kind: 'empty', key: 'empty' };
  }, [active, activeAsset?.url, activeId, dayCue, destinationCity, media.length, mobilityClass, movementDate, movementSpeed, originCity, placeName]);
  const canEnterScene = desiredScene.kind !== 'photo' || !activeAsset || activeAsset.status !== 'loading';
  const { currentScene, previousScene, transitionMs } = useSceneTransition(desiredScene, photoDisplaySec, canEnterScene);
  const style = { '--scene-transition-ms': `${transitionMs}ms` } as CSSProperties;
  const buffering = desiredScene.kind === 'photo' && desiredScene.key !== currentScene.key;

  return (
    <aside className="media-journey-pane" aria-label="사진 여정">
      <div
        className="media-scene-stack"
        style={style}
        data-transition-ms={transitionMs}
        data-media-buffering={buffering ? 'true' : 'false'}
        aria-live="polite"
      >
        {previousScene && (
          <div key={previousScene.key} className="media-scene-layer is-previous" aria-hidden="true">
            <SceneContent scene={previousScene} videoMode={videoMode} videoMuted onFiles={onFiles} />
          </div>
        )}
        <div key={currentScene.key} className="media-scene-layer is-current">
          <SceneContent scene={currentScene} videoMode={videoMode} videoMuted={videoMuted} onFiles={onFiles} />
        </div>
      </div>
    </aside>
  );
}

function SceneContent({ scene, videoMode, videoMuted, onFiles }: { scene: SceneDescriptor; videoMode: Props['videoMode']; videoMuted: boolean; onFiles: Props['onFiles'] }) {
  if (scene.kind === 'photo') {
    return <PhotoScene item={scene.item} place={scene.place} preloadedUrl={scene.url} videoMode={videoMode} videoMuted={videoMuted} />;
  }
  if (scene.kind === 'day') {
    const formatted = formatDayMarker(scene.dayKey);
    return (
      <div className="media-day-marker" data-day-number={scene.dayNumber}>
        <span>여행 {scene.dayNumber}일차</span>
        <time dateTime={scene.dayKey}>{formatted.date}</time>
        <strong>{formatted.weekday}</strong>
      </div>
    );
  }
  if (scene.kind === 'transit') {
    const movement = MOVEMENT_VISUALS[scene.mobilityClass];
    return (
      <div className="media-transit">
        <span className="movement-pictogram" aria-hidden="true">{movement.icon}</span>
        <div className="movement-primary">
          <time className="movement-date">{scene.movementDate}</time>
          <span className="movement-speed">{scene.movementSpeed}</span>
        </div>
        <strong className="movement-mode">{movement.label}</strong>
        {scene.originCity && scene.destinationCity && scene.originCity !== scene.destinationCity && (
          <div className="movement-route" aria-label={`출발 ${scene.originCity}, 도착 ${scene.destinationCity}`}>
            <span>{scene.originCity}</span><span aria-hidden="true">→</span><span>{scene.destinationCity}</span>
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="media-empty">
      <span><ImagePlus size={24} /></span>
      <strong>사진으로 여정을 이어보세요</strong>
      <p>촬영 시간과 위치를 읽어 이동 경로의 알맞은 장면에 연결합니다.</p>
      <label className="media-import-action">사진·영상 선택<input type="file" accept="image/*,video/*,.heic,.heif" multiple onChange={event => event.currentTarget.files && onFiles(event.currentTarget.files)} /></label>
    </div>
  );
}

function PhotoScene({ item, place, preloadedUrl, videoMode, videoMuted }: { item: JourneyMedia; place: string; preloadedUrl: string | null; videoMode: Props['videoMode']; videoMuted: boolean }) {
  const fallbackObjectUrl = useMemo(() => {
    if (preloadedUrl || item.sourceUrl || !item.file || typeof URL.createObjectURL !== 'function') return null;
    return URL.createObjectURL(item.file);
  }, [item.file, item.sourceUrl, preloadedUrl]);
  const url = preloadedUrl ?? item.sourceUrl ?? fallbackObjectUrl;

  useEffect(() => () => {
    if (fallbackObjectUrl) URL.revokeObjectURL(fallbackObjectUrl);
  }, [fallbackObjectUrl]);

  return (
    <article className="media-card">
      <div className="media-frame">
        {url && <MediaAsset item={item} url={url} videoMode={videoMode} videoMuted={videoMuted} />}
        {item.kind === 'video' && videoMode === 'THUMBNAIL' && <span className="video-badge"><Film size={15} /> 대표 장면</span>}
      </div>
      <footer className="media-caption">
        <span className="media-caption-place">{place}</span>
        <time className="media-caption-date" dateTime={new Date(item.takenMs).toISOString()}>{formatMediaDate(item.takenMs)}</time>
      </footer>
    </article>
  );
}

const MOVEMENT_VISUALS: Record<MobilityClass, { icon: string; label: string }> = {
  WALK: { icon: '🚶', label: '도보' },
  BIKE: { icon: '🚲', label: '자전거' },
  URBAN_TRANSIT: { icon: '🚇', label: '대중교통' },
  FAST_GROUND: { icon: '🚆', label: '기차' },
  FERRY: { icon: '⛴', label: '페리' },
  FLIGHT: { icon: '✈', label: '비행기' },
  ROAD: { icon: '🚗', label: '차량' },
  UNKNOWN: { icon: '●', label: '기타' }
};

function MediaAsset({ item, url, videoMode, videoMuted }: { item: JourneyMedia; url: string; videoMode: Props['videoMode']; videoMuted: boolean }) {
  const [failed, setFailed] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (item.kind !== 'video' || videoMode !== 'PLAY') return;
    const playback = videoRef.current?.play();
    if (playback) void playback.catch(() => undefined);
  }, [item.kind, url, videoMode, videoMuted]);

  if (failed) {
    return <div className="media-load-error" role="status"><ImageOff size={24} /><span>이 형식은 브라우저에서 미리 볼 수 없습니다.</span></div>;
  }
  return item.kind === 'image'
    ? <img src={url} alt={item.title} decoding="async" onError={() => setFailed(true)} />
    : <video
        ref={videoRef}
        src={url}
        muted={videoMuted}
        playsInline
        autoPlay={videoMode === 'PLAY'}
        controls={videoMode === 'PLAY' && showControls}
        preload="auto"
        onPointerEnter={() => setShowControls(true)}
        onPointerLeave={() => setShowControls(false)}
        onFocus={() => setShowControls(true)}
        onBlur={() => setShowControls(false)}
        onError={() => setFailed(true)}
      />;
}

function useMediaPreload(
  media: JourneyMedia[],
  activeId: string | null,
  videoMode: Props['videoMode']
): Record<string, PreloadedAsset> {
  const [assets, setAssets] = useState<Record<string, PreloadedAsset>>({});
  const handlesRef = useRef(new Map<string, PreloadHandle>());
  const lastActiveIdRef = useRef<string | null>(null);

  useEffect(() => {
    const ordered = [...media].sort((left, right) => left.playbackSec - right.playbackSec || left.takenMs - right.takenMs);
    const activeIndex = activeId ? ordered.findIndex(item => item.id === activeId) : -1;
    if (activeIndex >= 0) lastActiveIdRef.current = activeId;
    const lastActiveIndex = lastActiveIdRef.current
      ? ordered.findIndex(item => item.id === lastActiveIdRef.current)
      : -1;
    if (lastActiveIdRef.current && lastActiveIndex < 0) lastActiveIdRef.current = null;

    const startIndex = activeIndex >= 0
      ? activeIndex
      : lastActiveIndex >= 0 ? lastActiveIndex + 1 : 0;
    const candidates = ordered.slice(startIndex, startIndex + MEDIA_PRELOAD_AHEAD + 1);
    const keepIds = new Set(candidates.map(item => item.id));

    for (const [id, handle] of handlesRef.current) {
      if (keepIds.has(id)) continue;
      handle.cleanup();
      handlesRef.current.delete(id);
    }
    queueMicrotask(() => {
      setAssets(current => {
        const entries = Object.entries(current).filter(([id]) => keepIds.has(id));
        return entries.length === Object.keys(current).length
          ? current
          : Object.fromEntries(entries) as Record<string, PreloadedAsset>;
      });
    });

    for (const item of candidates) {
      const signature = mediaAssetSignature(item, videoMode);
      const existing = handlesRef.current.get(item.id);
      if (existing?.signature === signature) continue;
      existing?.cleanup();

      const resolved = mediaAssetUrl(item);
      if (!resolved) continue;
      queueMicrotask(() => {
        setAssets(current => ({ ...current, [item.id]: { status: 'loading', url: resolved.url } }));
      });
      const preloadCleanup = preloadMediaAsset(item, resolved.url, videoMode, status => {
        setAssets(current => ({ ...current, [item.id]: { status, url: resolved.url } }));
      });
      handlesRef.current.set(item.id, {
        signature,
        cleanup: () => {
          preloadCleanup();
          if (resolved.owned && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(resolved.url);
        }
      });
    }
  }, [activeId, media, videoMode]);

  useEffect(() => () => {
    for (const handle of handlesRef.current.values()) handle.cleanup();
    handlesRef.current.clear();
  }, []);

  return assets;
}

function mediaAssetSignature(item: JourneyMedia, videoMode: Props['videoMode']): string {
  if (item.sourceUrl) return `${item.id}\0${item.sourceUrl}\0${item.kind}\0${videoMode}`;
  if (item.file) return `${item.id}\0${item.file.name}\0${item.file.size}\0${item.file.lastModified}\0${item.kind}\0${videoMode}`;
  return `${item.id}\0missing\0${item.kind}\0${videoMode}`;
}

function mediaAssetUrl(item: JourneyMedia): { url: string; owned: boolean } | null {
  if (item.sourceUrl) return { url: item.sourceUrl, owned: false };
  if (item.file && typeof URL.createObjectURL === 'function') return { url: URL.createObjectURL(item.file), owned: true };
  return null;
}

function preloadMediaAsset(
  item: JourneyMedia,
  url: string,
  videoMode: Props['videoMode'],
  onStatus: (status: AssetPreloadStatus) => void
): () => void {
  let cancelled = false;
  let settled = false;
  let timeout = 0;
  const settle = (status: AssetPreloadStatus) => {
    if (cancelled || settled) return;
    settled = true;
    window.clearTimeout(timeout);
    onStatus(status);
  };
  timeout = window.setTimeout(() => settle('error'), MEDIA_PRELOAD_TIMEOUT_MS);

  if (item.kind === 'image') {
    const image = new Image();
    image.decoding = 'async';
    const ready = () => {
      const decode = typeof image.decode === 'function' ? image.decode() : Promise.resolve();
      void decode.catch(() => undefined).then(() => settle('ready'));
    };
    image.onload = ready;
    image.onerror = () => settle('error');
    image.src = url;
    if (image.complete && image.naturalWidth > 0) ready();
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      image.src = '';
    };
  }

  const video = document.createElement('video');
  const readyState = videoMode === 'PLAY' ? 2 : 1;
  const readyEvent = videoMode === 'PLAY' ? 'loadeddata' : 'loadedmetadata';
  const ready = () => settle('ready');
  const failed = () => settle('error');
  video.muted = true;
  video.playsInline = true;
  video.preload = videoMode === 'PLAY' ? 'auto' : 'metadata';
  video.addEventListener(readyEvent, ready, { once: true });
  video.addEventListener('error', failed, { once: true });
  video.src = url;
  if (video.readyState >= readyState) ready();
  return () => {
    cancelled = true;
    window.clearTimeout(timeout);
    video.removeEventListener(readyEvent, ready);
    video.removeEventListener('error', failed);
    video.removeAttribute('src');
  };
}

function useSceneTransition(desiredScene: SceneDescriptor, photoDisplaySec: number, canEnterScene: boolean): SceneTransitionState {
  const latestSceneRef = useRef(desiredScene);
  const enteredAtRef = useRef<number | null>(null);
  const initialTransitionMs = desiredScene.kind === 'transit'
    ? transitSceneTransitionDurationMs(1)
    : sceneTransitionDurationMs(photoDisplaySec);
  const [transition, setTransition] = useState<SceneTransitionState>({
    currentScene: desiredScene,
    previousScene: null,
    transitionMs: initialTransitionMs
  });

  useLayoutEffect(() => {
    if (!canEnterScene) return;
    const prior = latestSceneRef.current;
    if (prior.key === desiredScene.key) {
      latestSceneRef.current = desiredScene;
      const updateFrame = window.requestAnimationFrame(() => {
        setTransition(current => current.currentScene === desiredScene
          ? current
          : { ...current, currentScene: desiredScene });
      });
      return () => window.cancelAnimationFrame(updateFrame);
    }

    const now = performance.now();
    const enteredAt = enteredAtRef.current;
    const measuredDwellSec = enteredAt === null ? 0 : Math.max(0, (now - enteredAt) / 1000);
    const transitionMs = prior.kind === 'transit'
      ? transitSceneTransitionDurationMs(measuredDwellSec)
      : sceneTransitionDurationMs(measuredDwellSec > 0.05 ? measuredDwellSec : photoDisplaySec);
    enteredAtRef.current = now;
    latestSceneRef.current = desiredScene;

    const showFrame = window.requestAnimationFrame(() => {
      setTransition({ currentScene: desiredScene, previousScene: prior, transitionMs });
    });
    const hideTimer = window.setTimeout(() => {
      setTransition(current => current.previousScene?.key === prior.key
        ? { ...current, previousScene: null }
        : current);
    }, transitionMs + 60);

    return () => {
      window.cancelAnimationFrame(showFrame);
      window.clearTimeout(hideTimer);
    };
  }, [canEnterScene, desiredScene, photoDisplaySec]);

  useLayoutEffect(() => {
    if (enteredAtRef.current === null) enteredAtRef.current = performance.now();
  }, []);

  return transition;
}

function formatDayMarker(dayKey: string): { date: string; weekday: string } {
  const [year, month, day] = dayKey.split('-').map(Number);
  const value = Date.UTC(year, Math.max(0, month - 1), day, 12);
  const date = new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'Asia/Seoul'
  }).format(value);
  const weekday = new Intl.DateTimeFormat('ko-KR', {
    weekday: 'long',
    timeZone: 'Asia/Seoul'
  }).format(value);
  return { date, weekday };
}

function formatPhotoPlace(placeName: string | null, originCity: string | null, destinationCity: string | null): string {
  const city = originCity && destinationCity
    ? originCity === destinationCity ? originCity : null
    : originCity ?? destinationCity;
  const place = placeName?.trim() ?? '';
  const unknown = '알 수 없음';

  if (!place || place === '촬영 위치' || place === 'Timeline 위치' || place === unknown || looksLikeCoordinates(place)) return unknown;

  if (/(구|区)$/u.test(place)) {
    if (/\s/u.test(place)) return place;
    if (city && normalizePlace(city) !== normalizePlace(place)) return `${city} ${place}`;
    return place;
  }
  if (/(특별시|광역시|특별자치시|시|市)$/u.test(place)) return place;
  if (/(동|읍|면|리|가|로|길|町|村|丁目)$/u.test(place)) return unknown;

  return place;
}

function looksLikeCoordinates(value: string): boolean {
  return /^-?\d{1,3}(?:\.\d+)?\s*,\s*-?\d{1,3}(?:\.\d+)?$/.test(value);
}

function normalizePlace(value: string): string {
  return value.replace(/\s+/g, '').toLocaleLowerCase('ko-KR');
}

function formatMediaDate(value: number): string {
  const parts = new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'Asia/Seoul'
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(candidate => candidate.type === type)?.value ?? '';
  return `${part('year')}년 ${part('month')}월 ${part('day')}일 ${part('hour')}시 ${part('minute')}분`;
}
