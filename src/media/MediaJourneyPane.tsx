import { Film, ImagePlus, MapPin, MoveRight } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import type { JourneyMedia } from '../types';

interface Props {
  media: JourneyMedia[];
  activeId: string | null;
  videoMode: 'THUMBNAIL' | 'PLAY';
  placeName: string | null;
  onFiles: (files: FileList) => void;
}

export function MediaJourneyPane({ media, activeId, videoMode, placeName, onFiles }: Props) {
  const active = media.find(item => item.id === activeId) ?? null;
  const objectUrl = useMemo(() => active?.file ? URL.createObjectURL(active.file) : null, [active]);
  const url = active?.sourceUrl ?? objectUrl;
  useEffect(() => () => { if (objectUrl) URL.revokeObjectURL(objectUrl); }, [objectUrl]);

  return (
    <aside className="media-journey-pane" aria-label="사진 여정">
      {active && url ? (
        <article className="media-card">
          <div className="media-frame">
            {active.kind === 'image'
              ? <img src={url} alt={active.title} />
              : <video src={url} muted playsInline autoPlay={videoMode === 'PLAY'} controls={videoMode === 'PLAY'} preload="metadata" />}
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
          <span><MoveRight size={22} /></span>
          <strong>다음 장면으로 이동 중</strong>
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
