import { useState } from 'react';
import { Film, Image, ChevronLeft, ChevronRight } from 'lucide-react';
import { Dialog } from './Dialog';
import { gpsAccuracyLabel } from '../media/photo-place-resolver';
import type { JourneyMedia } from '../types';

const PAGE_SIZE = 24;
const SOURCES = { 'takeout-sidecar': 'Takeout 촬영 정보', 'embedded-exif': '파일의 촬영 정보', 'filename-time': '파일명에서 추정', 'file-time': '파일 수정 시각 사용' };
export function MediaLibraryDialog({ open, onClose, media, excluded, onToggle, onIncludeAll }: {
  open: boolean; onClose: () => void; media: JourneyMedia[]; excluded: Set<string>; onToggle: (id: string) => void; onIncludeAll: () => void;
}) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(media.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const visible = media.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const included = media.filter(item => !excluded.has(item.id)).length;
  return <Dialog open={open} onClose={onClose} title="사진 목록" subtitle={`${media.length.toLocaleString()}개 중 ${included.toLocaleString()}개 감상에 포함 · 원본 파일은 변경하지 않습니다.`} footer={<div className="library-footer"><button type="button" className="text-button" disabled={!excluded.size} onClick={onIncludeAll}>모두 포함하기</button><div className="library-pagination"><button className="icon-button" type="button" aria-label="이전 사진 목록" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={18} /></button><span>{currentPage + 1} / {pages}</span><button className="icon-button" type="button" aria-label="다음 사진 목록" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}><ChevronRight size={18} /></button></div></div>}>
    <p className="library-description">체크를 해제하면 감상에서 제외됩니다. 새로고침하면 다시 포함됩니다. ‘대표 사진만’에서는 선택된 사진 중 일부를 보여줍니다.</p>
    {!media.length && <p className="empty-note">선택한 여행 기간에 사진이 없습니다. 촬영 날짜와 여행 기간을 확인하거나 다른 사진을 선택해 주세요.</p>}
    <div className="library-list">{visible.map(item => <label key={item.id} className={`library-row ${excluded.has(item.id) ? 'is-excluded' : ''}`}><input type="checkbox" checked={!excluded.has(item.id)} onChange={() => onToggle(item.id)} aria-label={`${item.title} 감상에 포함`} />
      <span className="library-kind" aria-label={item.kind === 'video' ? '영상' : '사진'}>{item.kind === 'video' ? <Film size={19} /> : <Image size={19} />}</span>
      <span className="library-info"><strong>{item.title}</strong><time dateTime={new Date(item.takenMs).toISOString()}>{new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul' }).format(item.takenMs)}</time><span className={item.metadataSource === 'file-time' || item.metadataSource === 'filename-time' ? 'metadata-estimated' : ''}>{SOURCES[item.metadataSource]} · {item.positionSource === 'gps' ? `GPS 위치${gpsAccuracyLabel(item.gpsAccuracyM) ? ` · ${gpsAccuracyLabel(item.gpsAccuracyM)}` : ''}` : '타임라인에서 추정한 위치'}</span></span>
    </label>)}</div>
  </Dialog>;
}
