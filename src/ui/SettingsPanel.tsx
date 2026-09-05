import { useId, type ReactNode } from 'react';
import { RotateCcw, Route, Check } from 'lucide-react';
import { Dialog } from './Dialog';
import type { Preferences } from '../settings/preferences';
import type { DurationLimits, TimelineScanResult } from '../types';

interface Props {
  open: boolean; onClose: () => void; preferences: Preferences;
  update: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void;
  reset: () => void; startDate: string; endDate: string;
  setStartDate: (value: string) => void; setEndDate: (value: string) => void;
  scan: TimelineScanResult | null; sourceName: string; busy: boolean;
  duration: number; limits?: DurationLimits; setDuration: (value: number) => void;
  autoDuration: () => void; customDuration: boolean;
  mapKind: string; localMapReady: boolean; setMapKind: (value: 'online' | 'local-pmtiles') => void;
  onLibrary: () => void; onTimeline: () => void; onMedia: () => void; onMediaFiles: () => void; error: string | null; mediaSummary: string;
  needsPlan: boolean; hasPlan: boolean; mapReady: boolean; onPlan: () => void;
}

function Field({ label, hint, children }: { label: string; hint: string; children: (id: string, hintId: string) => ReactNode }) {
  const id = useId();
  return <div className="setting-field"><label htmlFor={id}>{label}</label>{children(id, `${id}-hint`)}<p id={`${id}-hint`} className="field-hint">{hint}</p></div>;
}
function RangeField({ label, hint, value, min, max, step = 0.5, display, onChange }: { label: string; hint: string; value: number; min: number; max: number; step?: number; display: string; onChange: (value: number) => void }) {
  return <Field label={label} hint={hint}>{(id, hintId) => <div className="range-control"><input id={id} aria-describedby={hintId} aria-valuetext={display} type="range" min={min} max={max} step={step} value={value} onChange={event => onChange(Number(event.target.value))} /><output htmlFor={id}>{display}</output></div>}</Field>;
}
function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (value: boolean) => void }) {
  const id = useId();
  return <div className="toggle-field"><label><input type="checkbox" checked={checked} aria-describedby={id} onChange={event => onChange(event.target.checked)} /><span>{label}</span></label><p id={id} className="field-hint">{hint}</p></div>;
}
export function SettingsPanel(p: Props) {
  const { preferences: s, update } = p;
  const datesValid = Boolean(p.scan && p.startDate && p.endDate && p.startDate <= p.endDate && p.startDate >= p.scan.startDate && p.endDate <= p.scan.endDate);
  return <Dialog open={p.open} onClose={p.onClose} title="여행 설정" subtitle="날짜와 경로 설정은 적용 후, 감상 설정은 바로 반영돼요." sheet footer={<>
    <p className="field-hint">{p.needsPlan ? '변경한 경로 설정을 적용해 주세요.' : p.hasPlan ? '경로 설정이 모두 적용되었습니다.' : 'Timeline과 여행 기간을 먼저 선택해 주세요.'}</p>
    <button className="primary-button" type="button" disabled={p.busy || !datesValid || !p.mapReady || !p.needsPlan} onClick={p.onPlan}>{p.needsPlan ? <Route size={18} /> : <Check size={18} />}{p.busy ? '준비 중…' : p.hasPlan ? '경로 다시 만들기' : '경로 만들기'}</button>
  </>}>
    <div className="settings-files"><strong>여행 파일</strong><div><button className="secondary-button" type="button" disabled={p.busy} onClick={p.onTimeline}>Timeline 선택</button><button className="secondary-button" type="button" disabled={p.busy} onClick={p.onMedia}>사진 폴더</button><button className="text-button" type="button" disabled={p.busy} onClick={p.onMediaFiles}>사진·영상 개별 선택</button></div>{p.mediaSummary && <p className="field-hint">{p.mediaSummary}</p>}</div>
    {p.error && <p className="settings-error" role="alert">{p.error}</p>}
    <fieldset disabled={p.busy} className="settings-section"><legend>01 · 여행 기간</legend>
      <p className="section-description">보고 싶은 여행의 시작과 마지막 날을 선택하세요.</p>
      {p.scan ? <><p className="source-note">{p.sourceName}<span>{p.scan.startDate} – {p.scan.endDate}</span></p>
        <div className="date-fields"><Field label="여행 시작" hint="한국 시간 기준">{(id, hintId) => <input id={id} type="date" aria-describedby={hintId} min={p.scan!.startDate} max={p.endDate || p.scan!.endDate} value={p.startDate} onChange={e => p.setStartDate(e.target.value)} />}</Field>
        <Field label="여행 마지막 날" hint="이 날짜까지 포함합니다">{(id, hintId) => <input id={id} type="date" aria-describedby={hintId} min={p.startDate || p.scan!.startDate} max={p.scan!.endDate} value={p.endDate} onChange={e => p.setEndDate(e.target.value)} />}</Field></div>
        <button className="text-button" type="button" onClick={() => { p.setStartDate(p.scan!.startDate); p.setEndDate(p.scan!.endDate); }}>전체 기간 선택</button>
        {!datesValid && <p className="inline-error" role="status">기록 범위 안에서 시작일과 마지막 날을 확인해 주세요.</p>}
      </> : <p className="empty-note">Timeline을 선택하면 날짜를 설정할 수 있어요.</p>}
      <RangeField label="경로 재생 길이" hint="실제 여행 시간을 이 길이로 압축합니다. 사진·영상 감상 시간은 별도로 더해집니다." min={p.limits?.minSeconds ?? 45} max={p.limits?.maxSeconds ?? 300} step={5} value={p.duration} display={`${Math.round(p.duration)}초`} onChange={p.setDuration} />
      <button className="text-button" type="button" onClick={p.autoDuration}>{p.customDuration ? '여행에 맞는 자동 길이 사용' : '자동 길이 사용 중'}</button>
      <Toggle label="항공 경로 포함" hint="비행 이동도 여행에 포함합니다. 변경 후 경로를 다시 만들어 주세요." checked={s.includeFlights} onChange={v => update('includeFlights', v)} />
    </fieldset>
    <fieldset disabled={p.busy} className="settings-section"><legend>02 · 카메라와 지도</legend>
      <Field label="화면 구성" hint={s.cameraMode === 'AUTO' ? '이동 거리와 하루 동선을 함께 고려해 화면을 구성합니다. 처음에는 자동을 권장합니다.' : s.cameraMode === 'DAY' ? '하루의 주요 활동 범위를 기준으로 보여줍니다. 날짜별 여행 흐름을 감상하기 좋습니다.' : '각 이동 구간에 맞춰 화면을 조절합니다. 이동수단별 경로를 자세히 볼 때 선택하세요.'}>{(id, hintId) => <select id={id} aria-describedby={hintId} value={s.cameraMode} onChange={e => update('cameraMode', e.target.value as Preferences['cameraMode'])}><option value="AUTO">자동 · 추천</option><option value="DAY">날짜별로 보기</option><option value="SEGMENT">이동 구간별로 보기</option></select>}</Field>
      <Toggle label="현재 위치 따라가기" hint="켜면 현재 이동 위치가 지도 중앙에 머뭅니다. 끄면 이동 방향을 미리 보여주는 카메라로 감상합니다. 바로 적용됩니다." checked={s.lockToPosition} onChange={v => update('lockToPosition', v)} />
      <RangeField label="지도 확대" hint="왼쪽은 넓게, 오른쪽은 자세히 봅니다. 재생 중에도 바로 적용됩니다." value={s.zoomOffset} min={-1.5} max={1.5} step={0.1} display={s.zoomOffset === 0 ? '기본' : `${s.zoomOffset > 0 ? '+' : ''}${s.zoomOffset.toFixed(1)}`} onChange={v => update('zoomOffset', v)} />
      <Field label="지도 소스" hint={p.mapKind === 'online' ? '인터넷으로 배경 지도를 받습니다. 개인 Timeline과 사진 원본은 업로드하지 않습니다.' : '설치된 지역 지도를 사용합니다. 상세 범위는 설치 파일에 따라 다르며 일부 지명 글꼴에는 인터넷이 필요합니다.'}>{(id, hintId) => <select id={id} aria-describedby={hintId} value={p.mapKind} onChange={e => p.setMapKind(e.target.value as 'online' | 'local-pmtiles')}><option value="online">온라인 지도 · 기본</option><option value="local-pmtiles" disabled={!p.localMapReady}>이 PC에 설치된 지도{!p.localMapReady ? ' · 설치 필요' : ''}</option></select>}</Field>
      <details className="advanced-settings"><summary>구간별 시간 배분</summary><Field label="시간 배분 방식" hint="날짜별 균형은 짧은 여행일도 충분히 보여줍니다. 전체 이동량 기준은 긴 이동에 더 많은 시간을 배분합니다. 경로 재생성 후 적용됩니다.">{(id, hintId) => <select id={id} aria-describedby={hintId} value={s.pacingMode} onChange={e => update('pacingMode', e.target.value as Preferences['pacingMode'])}><option value="LOCAL_DAYS">날짜별 균형 · 추천</option><option value="GLOBAL">전체 이동량 기준</option></select>}</Field></details>
    </fieldset>
    <fieldset disabled={p.busy} className="settings-section"><legend>03 · 사진과 영상</legend><button className="text-button" type="button" onClick={p.onLibrary}>사진 목록 확인 · 감상에서 제외하기</button><p className="section-description">사진 여정에 바로 적용됩니다. 사진 없이도 경로는 재생할 수 있어요.</p>
      <Field label="사진 표시 범위" hint="대표 사진은 비슷한 시간과 장소의 사진 중 일부를 골라 보여줍니다. 모두 보기를 선택하면 연결된 사진 전체를 감상합니다.">{(id, hintId) => <select id={id} aria-describedby={hintId} value={s.photoViewMode} onChange={e => update('photoViewMode', e.target.value as Preferences['photoViewMode'])}><option value="PREVIEW">대표 사진 · 추천</option><option value="ALL">모두 보기</option></select>}</Field>
      <RangeField label="사진 표시 시간" hint="사진 한 장을 감상하는 시간입니다. 그동안 경로 이동은 잠시 멈춥니다." value={s.photoDisplaySec} min={1} max={10} display={`${s.photoDisplaySec.toFixed(1)}초`} onChange={v => update('photoDisplaySec', v)} />
      <Toggle label="날짜 변경 표시" hint="여행 첫날과 날짜가 바뀌는 지점에 날짜 카드를 보여줍니다." checked={s.showDayMarkers} onChange={v => update('showDayMarkers', v)} />
      {s.showDayMarkers && <RangeField label="날짜 표시 시간" hint="날짜 카드 한 장의 표시 시간입니다." value={s.dayMarkerSec} min={1} max={5} display={`${s.dayMarkerSec.toFixed(1)}초`} onChange={v => update('dayMarkerSec', v)} />}
      <Field label="영상 재생" hint="자동 재생은 영상의 처음부터 설정한 최대 시간까지 보여줍니다. 정지 화면은 영상 재생 없이 첫 장면만 보여줍니다.">{(id, hintId) => <select id={id} aria-describedby={hintId} value={s.videoMode} onChange={e => update('videoMode', e.target.value as Preferences['videoMode'])}><option value="PLAY">자동 재생</option><option value="THUMBNAIL">정지 화면</option></select>}</Field>
      {s.videoMode === 'PLAY' && <><Toggle label="영상 소리 재생" hint="기본은 음소거입니다. 브라우저가 소리 재생을 막으면 영상 안의 재생 버튼을 눌러 주세요." checked={!s.videoMuted} onChange={v => update('videoMuted', !v)} /><RangeField label="영상 최대 재생" hint="긴 영상은 이 시간까지만 보여줍니다. 짧은 영상은 남은 시간 동안 마지막 장면을 유지합니다." value={s.videoMaxSec} min={2} max={15} display={`${s.videoMaxSec.toFixed(1)}초`} onChange={v => update('videoMaxSec', v)} /></>}
      <details className="advanced-settings"><summary>사진 여정의 상세 확대</summary><Toggle label="좁은 지역 상세 확대" hint="한 지역에서 사진을 오래 감상할 때 지도를 더 자세히 보여줍니다. 비행 구간에는 적용하지 않습니다." checked={s.photoDetailZoomMode === 'AUTO'} onChange={v => update('photoDetailZoomMode', v ? 'AUTO' : 'OFF')} />{s.photoDetailZoomMode === 'AUTO' && <RangeField label="상세 확대 강도" hint="기본 1.0을 권장합니다. 화면이 너무 가까우면 강도를 낮춰 주세요." value={s.photoDetailZoomStrength} min={0.5} max={1.5} step={0.1} display={`${s.photoDetailZoomStrength.toFixed(1)}×`} onChange={v => update('photoDetailZoomStrength', v)} />}</details>
    </fieldset>
    <div className="settings-reset"><p className="field-hint">감상 설정은 이 브라우저에 자동 저장됩니다. 날짜와 개인 파일은 저장하지 않습니다.</p><button className="text-button" type="button" disabled={p.busy} onClick={p.reset}><RotateCcw size={15} /> 기본 설정으로 되돌리기</button></div>
  </Dialog>;
}
