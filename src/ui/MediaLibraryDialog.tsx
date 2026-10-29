import { useRef, useState } from 'react';
import { Film, Image, ChevronLeft, ChevronRight } from 'lucide-react';
import { Dialog } from './Dialog';
import { gpsAccuracyLabel } from '../media/photo-place-resolver';
import { resolvedCaptureTimeZone, validCaptureTimeZone } from '../media/capture-time';
import { filterLibrary, mediaDay } from '../media/library-search';
import type { JourneyMedia } from '../types';

const PAGE_SIZE = 24;
const SOURCES = { 'takeout-sidecar': 'Takeout', 'embedded-exif': '촬영 정보', 'filename-time': '파일명 추정', 'file-time': '수정 시각' };
export function MediaLibraryDialog({ open, onClose, media, excluded, onToggle, onIncludeAll, captureTimeZone, onTimeZoneChange, onReveal, onVideoCopy }: {
  open: boolean; onClose: () => void; media: JourneyMedia[]; excluded: Set<string>; onToggle: (id: string) => void; onIncludeAll: () => void;
  captureTimeZone: string; onTimeZoneChange: (zone: string, signal: AbortSignal, progress: (message: string) => void) => Promise<void>;
  onReveal: (id: string) => void; onVideoCopy?: (item: JourneyMedia) => void;
}) {
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState('');
  const [day, setDay] = useState('');
  const [inclusion, setInclusion] = useState('ALL');
  const [draftZone, setDraftZone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null);
  const zone = draftZone ?? captureTimeZone;
  const filtered = filterLibrary(media, query, day, inclusion, excluded);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const visible = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const included = media.filter(item => !excluded.has(item.id)).length;
  const days = [...new Set(media.map(mediaDay))].sort();
  const close = () => { abort.current?.abort(); setBusy(false); setMessage(''); setError(''); setDraftZone(null); onClose(); };
  const applyZone = async () => {
    const controller = new AbortController(); abort.current = controller;
    setBusy(true); setError(''); setMessage('촬영 시각을 다시 확인하고 있습니다.');
    try {
      await onTimeZoneChange(zone, controller.signal, next => { if (!controller.signal.aborted) setMessage(next); });
      if (!controller.signal.aborted) { setDraftZone(null); setPage(0); setMessage('촬영 시간대를 적용했습니다.'); }
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '시간대를 적용하지 못했습니다. 기존 사진은 유지됩니다.'); }
    finally { if (abort.current === controller) setBusy(false); }
  };
  return <Dialog open={open} onClose={close} title="사진 목록" subtitle={`${media.length.toLocaleString()}개 중 ${included.toLocaleString()}개 감상에 포함`} footer={<div className="library-footer"><button type="button" className="text-button" title="검색 조건과 관계없이 모든 사진을 포함합니다" disabled={!excluded.size || busy} onClick={onIncludeAll}>모두 포함하기</button><div className="library-pagination"><button className="icon-button" type="button" aria-label="이전 사진 목록" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={18} /></button><span>{currentPage + 1} / {pages}</span><button className="icon-button" type="button" aria-label="다음 사진 목록" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}><ChevronRight size={18} /></button></div></div>}>
    <p className="library-description">체크한 사진만 감상합니다. 원본은 바뀌지 않습니다.</p>
    <div className="library-search">
      <label>파일명 검색<input type="search" aria-label="사진 파일명 검색" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} /></label>
      <label>날짜로 이동<select aria-label="사진 날짜로 이동" value={day} onChange={event => { setDay(event.target.value); setPage(0); }}><option value="">전체 날짜</option>{days.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>포함 상태<select aria-label="사진 포함 상태" value={inclusion} onChange={event => { setInclusion(event.target.value); setPage(0); }}><option value="ALL">전체</option><option value="INCLUDED">감상에 포함</option><option value="EXCLUDED">제외한 사진</option></select></label>
      {(query || day || inclusion !== 'ALL') && <button type="button" className="text-button" onClick={() => { setQuery(''); setDay(''); setInclusion('ALL'); setPage(0); }}>검색 조건 지우기</button>}
    </div>
    <p className="library-description" role="status">{filtered.length.toLocaleString()}개 · 한국 시간(UTC+9)</p>
    <details className="capture-time-settings"><summary>촬영 시간대 조정 · {resolvedCaptureTimeZone(captureTimeZone)}</summary>
      <p className="library-description">촬영 시각이 맞지 않으면 촬영 기기의 시간대를 선택하세요. 시간대가 없는 촬영 정보와 파일명에만 적용합니다.</p>
      <label>촬영 기기의 시간대<input list="capture-time-zones" aria-label="촬영 시간대" value={zone} disabled={busy} onChange={event => setDraftZone(event.target.value)} /></label>
      <datalist id="capture-time-zones"><option value="DEVICE">현재 기기</option><option value="Asia/Seoul">한국</option><option value="Asia/Tokyo">일본</option><option value="UTC" /><option value="America/Los_Angeles" /><option value="Europe/Paris" /><option value="+09:00">고정 UTC+9</option></datalist>
      <p className="library-description">예: Asia/Tokyo, +09:00. 목록은 한국 시간으로 표시합니다.</p>
      <button type="button" className="text-button" disabled={busy || zone === captureTimeZone || !validCaptureTimeZone(zone)} onClick={() => void applyZone()}>촬영 시간대 적용</button>
      {busy && <button type="button" className="text-button" onClick={() => { abort.current?.abort(); setBusy(false); setMessage('시간대 변경을 취소했습니다. 기존 사진은 유지됩니다.'); }}>시간대 변경 취소</button>}
      {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
    </details>
    {!filtered.length && <p className="empty-note">{media.length ? '검색 결과가 없습니다. 검색 조건을 바꿔 주세요.' : '이 기간에 사진이 없습니다. 여행 기간과 촬영 시간대를 확인하세요.'}</p>}
    <div className="library-list">{visible.map(item => <div key={item.id} className={`library-row ${excluded.has(item.id) ? 'is-excluded' : ''}`}>
      <label className="library-selection"><input type="checkbox" disabled={busy} checked={!excluded.has(item.id)} onChange={() => onToggle(item.id)} aria-label={`${item.title} 감상에 포함`} />
      <span className="library-kind" aria-label={item.kind === 'video' ? '영상' : '사진'}>{item.kind === 'video' ? <Film size={19} /> : <Image size={19} />}</span>
      <span className="library-info"><strong>{item.title}</strong><time dateTime={new Date(item.takenMs).toISOString()}>{new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul' }).format(item.takenMs)}</time><span className={item.metadataSource === 'file-time' || item.metadataSource === 'filename-time' ? 'metadata-estimated' : ''}>{SOURCES[item.metadataSource]} · {item.positionSource === 'gps' ? `GPS 위치${gpsAccuracyLabel(item.gpsAccuracyM) ? ` · ${gpsAccuracyLabel(item.gpsAccuracyM)}` : ''}` : '경로 추정 위치'}</span></span></label>
      <button type="button" className="text-button" disabled={busy || excluded.has(item.id)} title="모든 사진 모드에서 보기" aria-label={`${item.title} 장면 보기`} onClick={() => onReveal(item.id)}>장면 보기</button>
      {item.kind === 'video' && onVideoCopy && <button type="button" className="text-button" disabled={busy} aria-label={`${item.title} 호환 사본`} onClick={() => onVideoCopy(item)}>호환 사본</button>}
    </div>)}</div>
    <p className="library-description">선택을 유지하려면 ‘여행 저장·열기’에서 저장하세요.</p>
  </Dialog>;
}
