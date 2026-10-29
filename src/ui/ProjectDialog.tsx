import { useRef, useState } from 'react';
import { Dialog } from './Dialog';
import { canUseLocalApi } from '../services/local-api';
import { parseProject, PROJECT_MAX_BYTES, type TravelProject } from '../projects/travel-project';

export function ProjectDialog({ open, onClose, canSave, onSave, onRestore }: {
  open: boolean; onClose: () => void; canSave: boolean;
  onSave: (name: string) => void;
  onRestore: (project: TravelProject, timeline: File | null, media: File[] | null, signal: AbortSignal, progress: (message: string) => void) => Promise<void>;
}) {
  const [name, setName] = useState('나의 여행');
  const [project, setProject] = useState<TravelProject | null>(null);
  const [timeline, setTimeline] = useState<File | null>(null);
  const [media, setMedia] = useState<File[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const operation = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const close = () => {
    operation.current += 1;
    abort.current?.abort();
    setBusy(false); setProject(null); setTimeline(null); setMedia(null); setError(''); setMessage('');
    onClose();
  };
  const readProject = async (file: File | undefined) => {
    if (!file) return;
    const current = ++operation.current;
    setError(''); setMessage(''); setProject(null); setTimeline(null); setMedia(null);
    try {
      if (file.size > PROJECT_MAX_BYTES) throw new Error('프로젝트 파일은 10 MB 이하여야 합니다.');
      const parsed = parseProject(await file.text());
      if (current !== operation.current) return;
      setProject(parsed); setName(parsed.name);
    } catch (cause) { if (current === operation.current) setError(cause instanceof Error ? cause.message : '프로젝트를 읽지 못했습니다.'); }
  };
  const restore = async () => {
    if (!project || busy) return;
    const current = ++operation.current;
    const controller = new AbortController(); abort.current = controller;
    setBusy(true); setError(''); setMessage('원본을 확인하고 있습니다.');
    try {
      await onRestore(project, timeline, media, controller.signal, next => { if (current === operation.current) setMessage(next); });
      if (current === operation.current) close();
    } catch (cause) {
      if (current === operation.current) setError(cause instanceof Error ? cause.message : '복원하지 못했습니다. 기존 여행은 유지됩니다.');
    } finally { if (current === operation.current) setBusy(false); }
  };
  return <Dialog open={open} onClose={close} title="여행 저장·열기">
    <div className="project-controls">
      {canSave && <section>
        <h3>현재 여행 저장</h3>
        <p>설정과 재생 위치를 저장합니다. 원본 파일도 보관해 주세요.</p>
        <label>여행 이름<input aria-label="저장할 여행 이름" value={name} maxLength={100} disabled={busy} onChange={event => setName(event.target.value)} /></label>
        <details className="help-details project-file-details"><summary>저장 파일에 포함되는 정보</summary><p className="project-privacy">여행 날짜, 원본 파일명·상대 폴더명·크기·수정 시각과 타임라인 확인용 해시가 포함됩니다. GPS 좌표와 절대 경로는 넣지 않습니다. 공유 전 파일명에 개인 정보가 있는지 확인하세요.</p></details>
        <button type="button" className="plan-button" disabled={!canSave || busy || !name.trim()} onClick={() => {
          try { onSave(name.trim()); setError(''); setMessage('다운로드 폴더에서 저장 파일을 확인하세요.'); }
          catch (cause) { setError(cause instanceof Error ? cause.message : '저장하지 못했습니다.'); }
        }}>프로젝트 파일 저장</button>
      </section>}
      <section>
        <h3>저장한 여행 열기</h3>
        <label>프로젝트 파일<input aria-label="여행 프로젝트 파일 열기" type="file" accept="application/json,.json" disabled={busy} onChange={event => { void readProject(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }} /></label>
        {project && <>
          <p><strong>{project.name}</strong><br />{project.range.startDate} → {project.range.endDate}<br />사진·영상 {project.media.length.toLocaleString()}개 · 제외 {project.media.filter(item => item.excluded).length.toLocaleString()}개</p>
          <p>원본이 연결되지 않았다면 다시 선택하세요.</p>
          <label>타임라인 원본: {project.timeline.name}<input aria-label="프로젝트 타임라인 원본 선택" type="file" accept="application/json,.json" disabled={busy} onChange={event => { const file = event.currentTarget.files?.[0]; if (file) setTimeline(file); event.currentTarget.value = ''; }} /></label>
          {timeline && <p>선택: {timeline.name}</p>}
          {project.media.length > 0 && <>
            <label>사진·영상 폴더<input aria-label="프로젝트 사진 폴더 선택" type="file" multiple {...{ webkitdirectory: '' }} disabled={busy} onChange={event => { if (event.currentTarget.files?.length) setMedia(Array.from(event.currentTarget.files)); event.currentTarget.value = ''; }} /></label>
            <label>사진·영상 개별 파일<input aria-label="프로젝트 사진 파일 선택" type="file" multiple accept="image/*,video/*,.json,.heic,.heif" disabled={busy} onChange={event => { if (event.currentTarget.files?.length) setMedia(Array.from(event.currentTarget.files)); event.currentTarget.value = ''; }} /></label>
            {media && <p>{media.length.toLocaleString()}개 파일 선택됨</p>}
          </>}
          <p>촬영 시간대: {project.captureTimeZone}.{canUseLocalApi() && ' 정확한 장소 온라인 확인은 복원 시 꺼집니다.'}</p>
          <button type="button" className="plan-button" disabled={busy} onClick={() => void restore()}>이 여행 복원</button>
        </>}
      </section>
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}<br />기존 여행은 변경하지 않았습니다.</p>}
      {busy && <button type="button" className="text-button" onClick={close}>복원 취소</button>}
    </div>
  </Dialog>;
}
