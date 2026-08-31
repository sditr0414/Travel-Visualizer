import { Film, ImageOff, ImagePlus, MapPin } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { JourneyMedia, MobilityClass } from '../types';

interface Props {
  media: JourneyMedia[];
  activeId: string | null;
  videoMode: 'THUMBNAIL' | 'PLAY';
  mobilityClass: MobilityClass;
  placeName: string | null;
  onFiles: (files: FileList) => void;
}

export function MediaJourneyPane({ media, activeId, videoMode, mobilityClass, placeName, onFiles }: Props) {
  const active = media.find(item => item.id === activeId) ?? null;
  const movement = MOVEMENT_VISUALS[mobilityClass];
  const objectUrl = useMemo(() => active?.file ? URL.createObjectURL(active.file) : null, [active]);
  const url = active?.sourceUrl ?? objectUrl;
  useEffect(() => () => { if (objectUrl) URL.revokeObjectURL(objectUrl); }, [objectUrl]);

  return (
    <aside className="media-journey-pane" aria-label="사진 여정">
      {active && url ? (
        <article className="media-card">
          <div className="media-frame">
            <MediaAsset key={active.id} item={active} url={url} videoMode={videoMode} />
            {active.kind === 'video' && videoMode === 'THUMBNAIL' && <span className="video-badge"><Film size={15} /> 대표 장면</span>}
          </div>
          <footer>
            <div>
              <strong>{active.title}</strong>
              <span>{formatMediaDate(active.takenMs)} · {metadataLabel(active)}</span>
              {active.groupCount > 1 && <span className="media-sequence">장면 {active.groupIndex + 1} / {active.groupCount}{active.sourceCount > active.groupCount ? ` · 외 ${active.sourceCount - active.groupCount}개` : ''}</span>}
            </div>
            <span className="location-chip"><MapPin size={12} /> {placeName ?? (active.positionSource === 'gps' ? '촬영 위치' : 'Timeline 위치')}</span>
          </footer>
        </article>
      ) : media.length ? (
        <div className="media-transit" aria-live="polite">
          <span className="movement-pictogram" aria-hidden="true">{movement.icon}</span>
          <strong>{movement.label}</strong>
          <p>{media.length}개의 사진·영상이 경로에 연결되었습니다.</p>
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
  WALK: { icon: '🚶', label: '도보 이동' },
  BIKE: { icon: '🚲', label: '자전거 이동' },
  URBAN_TRANSIT: { icon: '🚇', label: '도시교통 이동' },
  FAST_GROUND: { icon: '🚆', label: '철도 이동' },
  FERRY: { icon: '⛴', label: '페리 이동' },
  FLIGHT: { icon: '✈', label: '항공 이동' },
  ROAD: { icon: '🚗', label: '도로 이동' },
  UNKNOWN: { icon: '●', label: '이동 중' }
};

function MediaAsset({ item, url, videoMode }: { item: JourneyMedia; url: string; videoMode: Props['videoMode'] }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <div className="media-load-error" role="status"><ImageOff size={24} /><span>이 형식은 브라우저에서 미리 볼 수 없습니다.</span></div>;
  }
  return item.kind === 'image'
    ? <img src={url} alt={item.title} onError={() => setFailed(true)} />
    : <video src={url} muted playsInline autoPlay={videoMode === 'PLAY'} controls={videoMode === 'PLAY'} preload="metadata" onError={() => setFailed(true)} />;
}

function formatMediaDate(value: number): string {
  return new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(value);
}

function metadataLabel(item: JourneyMedia): string {
  const labels: Record<JourneyMedia['metadataSource'], string> = {
    'takeout-sidecar': '로컬 Takeout 정보',
    'embedded-exif': '사진 EXIF',
    'filename-time': '파일명 시간',
    'file-time': '파일 수정 시간'
  };
  return labels[item.metadataSource];
}
