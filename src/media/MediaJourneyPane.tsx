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
  | { kind: 'photo'; key: string; item: JourneyMedia; place: string }
  | { kind: 'transit'; key: string; mobilityClass: MobilityClass; movementDate: string; movementSpeed: string; originCity: string | null; destinationCity: string | null }
  | { kind: 'empty'; key: 'empty' };

interface SceneTransitionState {
  previousScene: SceneDescriptor | null;
  transitionMs: number;
}

export function MediaJourneyPane({ media, activeId, videoMode, videoMuted, photoDisplaySec, mobilityClass, movementDate, movementSpeed, originCity, destinationCity, placeName, onFiles }: Props) {
  const active = media.find(item => item.id === activeId) ?? null;
  const scene = useMemo<SceneDescriptor>(() => {
    if (active) {
      return {
        kind: 'photo',
        key: `photo:${active.id}`,
        item: active,
        place: formatPhotoPlace(placeName, originCity, destinationCity, active.positionSource)
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
  }, [active, destinationCity, media.length, mobilityClass, movementDate, movementSpeed, originCity, placeName]);
  const { previousScene, transitionMs } = useSceneTransition(scene, photoDisplaySec);
  const style = { '--scene-transition-ms': `${transitionMs}ms` } as CSSProperties;

  return (
    <aside className="media-journey-pane" aria-label="사진 여정">
      <div className="media-scene-stack" style={style} data-transition-ms={transitionMs} aria-live="polite">
        {previousScene && (
          <div className="media-scene-layer is-previous" aria-hidden="true">
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
    return <PhotoScene item={scene.item} place={scene.place} videoMode={videoMode} videoMuted={videoMuted} />;
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

function PhotoScene({ item, place, videoMode, videoMuted }: { item: JourneyMedia; place: string; videoMode: Props['videoMode']; videoMuted: boolean }) {
  const objectUrl = useMemo(() => item.file ? URL.createObjectURL(item.file) : null, [item]);
  const url = item.sourceUrl ?? objectUrl;
  useEffect(() => () => { if (objectUrl) URL.revokeObjectURL(objectUrl); }, [objectUrl]);

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
    ? <img src={url} alt={item.title} onError={() => setFailed(true)} />
    : <video
        ref={videoRef}
        src={url}
        muted={videoMuted}
        playsInline
        autoPlay={videoMode === 'PLAY'}
        controls={videoMode === 'PLAY' && showControls}
        preload="metadata"
        onPointerEnter={() => setShowControls(true)}
        onPointerLeave={() => setShowControls(false)}
        onFocus={() => setShowControls(true)}
        onBlur={() => setShowControls(false)}
        onError={() => setFailed(true)}
      />;
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
  if (!place) return fallback;

  if (/(구|区)$/u.test(place)) {
    if (city && normalizePlace(city) !== normalizePlace(place)) return `${city} ${place}`;
    return place;
  }
  if (/(특별시|광역시|특별자치시|시|市)$/u.test(place)) return place;
  if (/(동|읍|면|리|가|로|길|町|村|丁目)$/u.test(place)) return fallback;

  return city ?? place;
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
