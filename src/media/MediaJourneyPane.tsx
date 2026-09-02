import { Film, ImageOff, ImagePlus } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
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
  | { kind: 'transit'; key: string; mobilityClass: MobilityClass; movementDate: string; movementSpeed: string; originCity: string | null; destinationCity: string | null }
  | { kind: 'empty'; key: 'empty' };

type AssetPreloadStatus = 'loading' | 'ready' | 'error';

interface SceneTransitionState {
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
  const active = media.find(item => item.id === activeId) ?? null;
  const assetUrls = useMediaAssetUrls(media);
  const preloadStatus = useMediaPreload(media, activeId, assetUrls, videoMode);
  const desiredScene = useMemo<SceneDescriptor>(() => {
    if (active) {
      return {
        kind: 'photo',
        key: `photo:${active.id}`,
        item: active,
        place: formatPhotoPlace(placeName, originCity, destinationCity, active.positionSource),
        url: assetUrls.get(active.id) ?? null
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
  }, [active, assetUrls, destinationCity, media.length, mobilityClass, movementDate, movementSpeed, originCity, placeName]);
  const scene = usePreparedScene(desiredScene, preloadStatus);
  const { previousScene, transitionMs } = useSceneTransition(scene, photoDisplaySec);
  const style = { '--scene-transition-ms': `${transitionMs}ms` } as CSSProperties;
  const buffering = desiredScene.kind === 'photo' && desiredScene.key !== scene.key;

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
        <div key={scene.key} className="media-scene-layer is-current">
          <SceneContent scene={scene} videoMode={videoMode} videoMuted={videoMuted} onFiles={onFiles} />
        </div>
      </div>
    </aside>
  );
}

function SceneContent({ scene, videoMode, videoMuted, onFiles }: { scene: SceneDescriptor; videoMode: Props['videoMode']; videoMuted: boolean; onFiles: Props['onFiles'] }) {
  if (scene.kind === 'photo') {
    return <PhotoScene item={scene.item} place={scene.place} url={scene.url} videoMode={videoMode} videoMuted={videoMuted} />;
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

function PhotoScene({ item, place, url, videoMode, videoMuted }: { item: JourneyMedia; place: string; url: string | null; videoMode: Props['videoMode']; videoMuted: boolean }) {
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

function useMediaAssetUrls(media: JourneyMedia[]): Map<string, string> {
  const [fileUrls, setFileUrls] = useState<Map<string, string>>(() => new Map());

  useEffect(() => {
    if (typeof URL.createObjectURL !== 'function') {
      setFileUrls(new Map());
      return;
    }
    const created = new Map<string, string>();
    for (const item of media) {
      if (!item.sourceUrl && item.file) created.set(item.id, URL.createObjectURL(item.file));
    }
    setFileUrls(created);
    return () => {
      for (const url of created.values()) URL.revokeObjectURL(url);
    };
  }, [media]);

  return useMemo(() => {
    const urls = new Map<string, string>();
    for (const item of media) {
      const url = item.sourceUrl ?? fileUrls.get(item.id);
      if (url) urls.set(item.id, url);
    }
    return urls;
  }, [fileUrls, media]);
}

function useMediaPreload(
  media: JourneyMedia[],
  activeId: string | null,
  assetUrls: Map<string, string>,
  videoMode: Props['videoMode']
): Record<string, AssetPreloadStatus> {
  const [statuses, setStatuses] = useState<Record<string, AssetPreloadStatus>>({});
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
    setStatuses(current => {
      const entries = Object.entries(current).filter(([id]) => keepIds.has(id));
      if (entries.length === Object.keys(current).length) return current;
      return Object.fromEntries(entries) as Record<string, AssetPreloadStatus>;
    });

    for (const item of candidates) {
      const url = assetUrls.get(item.id);
      if (!url) continue;
      const signature = `${url}\0${item.kind}\0${videoMode}`;
      const existing = handlesRef.current.get(item.id);
      if (existing?.signature === signature) continue;
      existing?.cleanup();
      setAssetPreloadStatus(setStatuses, item.id, 'loading');
      const cleanup = preloadMediaAsset(item, url, videoMode, status => {
        setAssetPreloadStatus(setStatuses, item.id, status);
      });
      handlesRef.current.set(item.id, { signature, cleanup });
    }
  }, [activeId, assetUrls, media, videoMode]);

  useEffect(() => () => {
    for (const handle of handlesRef.current.values()) handle.cleanup();
    handlesRef.current.clear();
  }, []);

  return statuses;
}

function setAssetPreloadStatus(
  setStatuses: React.Dispatch<React.SetStateAction<Record<string, AssetPreloadStatus>>>,
  id: string,
  status: AssetPreloadStatus
): void {
  setStatuses(current => current[id] === status ? current : { ...current, [id]: status });
}

function preloadMediaAsset(
  item: JourneyMedia,
  url: string,
  videoMode: Props['videoMode'],
  onStatus: (status: AssetPreloadStatus) => void
): () => void {
  let cancelled = false;
  let settled = false;
  const settle = (status: AssetPreloadStatus) => {
    if (cancelled || settled) return;
    settled = true;
    onStatus(status);
  };
  const timeout = window.setTimeout(() => settle('error'), MEDIA_PRELOAD_TIMEOUT_MS);

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

function usePreparedScene(desiredScene: SceneDescriptor, statuses: Record<string, AssetPreloadStatus>): SceneDescriptor {
  const [scene, setScene] = useState(desiredScene);

  useEffect(() => {
    if (desiredScene.kind !== 'photo') {
      setScene(desiredScene);
      return;
    }
    if (!desiredScene.url) {
      setScene(desiredScene);
      return;
    }
    const status = statuses[desiredScene.item.id];
    if (status === 'ready' || status === 'error') setScene(desiredScene);
  }, [desiredScene, statuses]);

  return scene;
}

function useSceneTransition(scene: SceneDescriptor, photoDisplaySec: number): SceneTransitionState {
  const latestSceneRef = useRef(scene);
  const enteredAtRef = useRef<number | null>(null);
  const initialTransitionMs = scene.kind === 'transit'
    ? transitSceneTransitionDurationMs(1)
    : sceneTransitionDurationMs(photoDisplaySec);
  const [transition, setTransition] = useState<SceneTransitionState>({ previousScene: null, transitionMs: initialTransitionMs });

  useLayoutEffect(() => {
    const prior = latestSceneRef.current;
    if (prior.key === scene.key) return;

    const now = performance.now();
    const enteredAt = enteredAtRef.current;
    const measuredDwellSec = enteredAt === null ? 0 : Math.max(0, (now - enteredAt) / 1000);
    const transitionMs = prior.kind === 'transit'
      ? transitSceneTransitionDurationMs(measuredDwellSec)
      : sceneTransitionDurationMs(measuredDwellSec > 0.05 ? measuredDwellSec : photoDisplaySec);
    enteredAtRef.current = now;

    const showFrame = window.requestAnimationFrame(() => {
      setTransition({ previousScene: prior, transitionMs });
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
  }, [photoDisplaySec, scene.key]);

  useLayoutEffect(() => {
    latestSceneRef.current = scene;
    if (enteredAtRef.current === null) enteredAtRef.current = performance.now();
  }, [scene]);

  return transition;
}

function formatPhotoPlace(placeName: string | null, originCity: string | null, destinationCity: string | null, positionSource: JourneyMedia['positionSource']): string {
  const city = originCity && destinationCity
    ? originCity === destinationCity ? originCity : null
    : originCity ?? destinationCity;
  const place = placeName?.trim() ?? '';
  const fallback = city ?? (positionSource === 'gps' ? '촬영 위치' : 'Timeline 위치');
  if (!place || looksLikeCoordinates(place)) return fallback;

  if (/(구|区)$/u.test(place)) {
    if (/\s/u.test(place)) return place;
    if (city && normalizePlace(city) !== normalizePlace(place)) return `${city} ${place}`;
    return place;
  }
  if (/(특별시|광역시|특별자치시|시|市)$/u.test(place)) return place;
  if (/(동|읍|면|리|가|로|길|町|村|丁目)$/u.test(place)) return fallback;

  return city ?? place;
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
