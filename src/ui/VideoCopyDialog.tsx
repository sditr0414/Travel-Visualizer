import { useEffect, useRef, useState } from 'react';
import { Dialog } from './Dialog';
import type { JourneyMedia } from '../types';

interface CopyJob { id: string; state: 'preparing' | 'running' | 'verifying' | 'complete' | 'failed' | 'cancelled'; progress: number; name: string; preview: boolean; error: string | null }
const terminal = (job: CopyJob | null) => !job || ['complete','failed','cancelled'].includes(job.state);
export function VideoCopyDialog({ item, onClose }: { item: JourneyMedia; onClose: () => void }) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [preview, setPreview] = useState(true);
  const [job, setJob] = useState<CopyJob | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const active = useRef<CopyJob | null>(null);
  const closed = useRef(false);
  const local = item.id.startsWith('local-') && item.sourceUrl?.startsWith('/api/local-media/');
  const busy = starting || !terminal(job);
  const cancel = async () => {
    if (!active.current || terminal(active.current)) return;
    try { await fetch(`/api/video-copy/${active.current.id}`, { method: 'DELETE' }); }
    catch { if (!closed.current) setError('취소 요청을 전달하지 못했습니다. 로컬 서버 연결을 확인해 주세요.'); }
  };
  useEffect(() => {
    closed.current = false;
    if (local) void fetch('/api/video-copy').then(response => response.ok ? response.json() : { available: false }).then(value => { if (!closed.current) setAvailable(value.available === true); }).catch(() => { if (!closed.current) setAvailable(false); });
    return () => { closed.current = true; const current = active.current; if (current && !terminal(current)) void fetch(`/api/video-copy/${current.id}`, { method: 'DELETE' }).catch(() => undefined); };
  }, [local]);
  useEffect(() => {
    if (!job || terminal(job)) return;
    let disposed = false;
    const poll = async () => {
      try {
        const response = await fetch(`/api/video-copy/${job.id}`, { cache: 'no-store' });
        if (!response.ok) throw new Error('사본 작업 상태를 읽지 못했습니다. 서버가 종료되었는지 확인해 주세요.');
        const next = await response.json() as CopyJob;
        if (!disposed) { active.current = next; setJob(next); }
      } catch (cause) { if (!disposed) setError(cause instanceof Error ? cause.message : '상태를 읽지 못했습니다.'); }
    };
    const timer = window.setInterval(() => void poll(), 500);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [job]);
  const start = async () => {
    setStarting(true); setError('');
    try {
      const response = await fetch('/api/video-copy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: item.id.slice(6), takenMs: item.takenMs, lat: item.lat, lng: item.lng, preview }) });
      const next = await response.json() as CopyJob & { error?: string };
      if (!response.ok) throw new Error(next.error || '사본을 시작하지 못했습니다.');
      active.current = next;
      if (closed.current) { await fetch(`/api/video-copy/${next.id}`, { method: 'DELETE' }); return; }
      setJob(next);
    } catch (cause) { if (!closed.current) setError(cause instanceof Error ? cause.message : '사본을 시작하지 못했습니다.'); }
    finally { if (!closed.current) setStarting(false); }
  };
  return <Dialog open onClose={() => { closed.current = true; void cancel(); onClose(); }} title="호환 영상 사본" subtitle={item.title}>
    <div className="video-copy-controls">
      <p>선택한 영상 한 개를 이 컴퓨터에서 H.264 사본으로 만듭니다. 원본과 현재 여행의 사진 목록은 유지합니다.</p>
      {!local ? <p>로컬 서버의 기본 사진 폴더에 연결된 영상만 지원합니다. 직접 선택한 파일은 기본 폴더로 연결한 뒤 다시 열어 주세요.</p> : <>
        <p>사본과 촬영 정보 파일은 별도 폴더에 저장됩니다. 원본 메타데이터를 복사하고 촬영 시각·GPS는 보조 JSON에도 보관합니다. 촬영 정보 파일도 개인 자료로 보관하세요.</p>
        {available === null ? <p role="status">변환 도구를 확인하고 있습니다.</p> : !available ? <p role="alert">이 컴퓨터에 FFmpeg와 ffprobe가 필요합니다. 설치 후 앱 서버를 다시 실행해 주세요.</p> : <>
          <label>사본 범위<select aria-label="영상 사본 범위" disabled={busy} value={preview ? 'preview' : 'full'} onChange={event => setPreview(event.target.value === 'preview')}><option value="preview">첫 5초만 호환성 확인</option><option value="full">선택한 영상 전체</option></select></label>
          <button type="button" className="plan-button" disabled={busy} onClick={() => void start()}>H.264 사본 만들기</button>
        </>}
        {busy && <><progress aria-label="영상 사본 진행률" max={1} value={job?.progress ?? 0} /><p role="status">{job?.state === 'verifying' ? '사본의 형식과 길이를 확인하고 있습니다.' : `사본 만드는 중 · ${Math.round((job?.progress ?? 0) * 100)}%`}</p><button type="button" className="text-button" disabled={starting} onClick={() => void cancel()}>사본 만들기 취소</button><p>진행 중 창을 닫아도 취소합니다. 미완성 사본은 삭제됩니다.</p></>}
        {job?.state === 'complete' && <>
          <p role="status">{job.preview ? '첫 5초 이내 확인용 사본' : '전체 영상 사본'}을 만들었습니다.</p>
          <video controls playsInline preload="metadata" aria-label="호환 영상 사본 미리보기" src={`/api/video-copy/${job.id}/video`} />
          <a href={`/api/video-copy/${job.id}/video?download=1`} download>영상 사본 저장</a>
          <a href={`/api/video-copy/${job.id}/sidecar?download=1`} download>촬영 정보 JSON 저장</a>
          <p>두 파일을 같은 폴더에 보관하세요. 감상할 때 사본과 JSON을 함께 선택하면 촬영 시각과 위치를 유지합니다. 현재 사진 목록은 자동으로 교체하지 않습니다.</p>
        </>}
        {job?.state === 'cancelled' && <p role="status">사본 만들기를 취소했습니다. 원본은 유지됩니다.</p>}
        {job?.error && <p role="alert">{job.error}</p>}
      </>}
      {error && <p role="alert">{error}</p>}
    </div>
  </Dialog>;
}
