import { Film, ImageOff, ImagePlus, MapPin } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { JourneyMedia, MobilityClass } from '../types';

interface Props {
  media: JourneyMedia[];
  activeId: string | null;
  videoMode: 'THUMBNAIL' | 'PLAY';
  mobilityClass: MobilityClass;
  movementDate: string;
  movementSpeed: string;
  originCity: string | null;
  destinationCity: string | null;
  placeName: string | null;
  onFiles: (files: FileList) => void;
}

export function MediaJourneyPane({ media, activeId, videoMode, mobilityClass, movementDate, movementSpeed, originCity, destinationCity, placeName, onFiles }: Props) {
  const active = media.find(item => item.id === activeId) ?? null;
  const movement = MOVEMENT_VISUALS[mobilityClass];
  const objectUrl = useMemo(() => active?.file ? URL.createObjectURL(active.file) : null, [active]);
  const url = active?.sourceUrl ?? objectUrl;
  useEffect(() => () => { if (objectUrl) URL.revokeObjectURL(objectUrl); }, [objectUrl]);

  return (
    <aside className="media-journey-pane" aria-label="사진 여정">
      {active && url ? (
        <article key={active.id} className="media-card">
          <div className="media-frame">
            <MediaAsset key={active.id} item={active} url={url} videoMode={videoMode} />
            {active.kind === 'video' && videoMode === 'THUMBNAIL' && <span className="video-badge"><Film size={15} /> 대표 장면</span>}
          </div>
          <footer className="media-caption">
            <time className="media-caption-date" dateTime={new Date(active.takenMs).toISOString()}>{formatMediaDate(active.takenMs)}</time>
            <span className="media-caption-divider" aria-hidden="true">·</span>
            <span className="media-caption-place"><MapPin size={15} aria-hidden="true" /> {placeName ?? (active.positionSource === 'gps' ? '촬영 위치' : 'Timeline 위치')}</span>
          </footer>
        </article>
      ) : media.length ? (
        <div key={`${mobilityClass}-${movementDate}`} className="media-transit" aria-live="polite">
          <div className="movement-identity">
            <span className="movement-pictogram" aria-hidden="true">{movement.icon}</span>
            <strong className="movement-mode">{movement.label}</strong>
          </div>
          <div className="movement-details">
            <time className="movement-date">{movementDate}</time>
            <span className="movement-speed">{movementSpeed}</span>
            {originCity && destinationCity && originCity !== destinationCity && (
              <div className="movement-route" aria-label={`출발 ${originCity}, 도착 ${destinationCity}`}>
                <span>{originCity}</span><span aria-hidden="true">→</span><span>{destinationCity}</span>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="media-empty">
          <span><ImagePlus size={24} /></span>
          <strong>사진으로 여정을 이어보세요</strong>
          <p>촬영 시간과 위치를 읽어 이동 경로의 알맞은 장면에 연결합니다.</p>
          <label className="media-import-action">사진·영상 선택<input type="file" accept="image/*,video/*,.heic,.heif" multiple onChange={event => event.currentTarget.files && onFiles(event.currentTarget.files)} /></label>
        </div>
      )}
    </aside>
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

function MediaAsset({ item, url, videoMode }: { item: JourneyMedia; url: string; videoMode: Props['videoMode'] }) {
  const [failed, setFailed] = useState(false);
  const [showControls, setShowControls] = useState(false);
  if (failed) {
    return <div className="media-load-error" role="status"><ImageOff size={24} /><span>이 형식은 브라우저에서 미리 볼 수 없습니다.</span></div>;
  }
  return item.kind === 'image'
    ? <img src={url} alt={item.title} onError={() => setFailed(true)} />
    : <video
        src={url}
        muted
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

function formatMediaDate(value: number): string {
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'Asia/Seoul'
  }).format(value);
}
