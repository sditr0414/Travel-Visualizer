from pathlib import Path

def read(path): return Path(path).read_text(encoding='utf-8')
def write(path, text):
    p = Path(path); p.parent.mkdir(parents=True, exist_ok=True); p.write_text(text, encoding='utf-8')
def replace(path, old, new):
    text = read(path); assert text.count(old) == 1, (path, text.count(old), old[:60]); write(path, text.replace(old, new))

p = 'src/App.test.tsx'
replace(p, '''    expect(screen.getByRole('button', { name: /일본/ })).toHaveAttribute('aria-pressed', 'true');
    const gangneung = screen.getByRole('button', { name: /강릉/ });
    fireEvent.click(gangneung);''', '''    const picker = screen.getByRole('combobox', { name: '추천 여행' });
    expect(picker).toHaveValue('japan');
    fireEvent.change(picker, { target: { value: 'gangneung' } });''')
replace(p, "    expect(gangneung).toHaveAttribute('aria-pressed', 'true');", "    expect(picker).toHaveValue('gangneung');\n    expect(screen.queryByRole('button', { name: /강릉/ })).not.toBeInTheDocument();")

p = 'src/media/MediaJourneyPane.tsx'
replace(p, "  const playRequested = playing && videoMode === 'PLAY';", "  const playRequested = playing && videoMode === 'PLAY';\n  const playIntent = useRef(false);")
replace(p, "    let cancelled = false;\n    let requesting = false;", "    let cancelled = false;\n    let requesting = false;\n    playIntent.current = playRequested;")
replace(p, '          if (cancelled) video.pause();', '          if (cancelled && !playIntent.current) video.pause();')
replace(p, "      cancelled = true;\n      video.removeEventListener('loadedmetadata', synchronize);", "      cancelled = true;\n      playIntent.current = false;\n      video.removeEventListener('loadedmetadata', synchronize);")

write('src/ui/SettingHelp.test.tsx', '''import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SettingHelp } from './SettingHelp';

function setup() {
  render(<SettingHelp title="지도 확대" description="확대 설명"><label>지도 확대<input aria-label="지도 확대 값" /></label></SettingHelp>);
  return { title: screen.getByRole('button', { name: '지도 확대 설명' }), field: screen.getByLabelText('지도 확대 값'), tip: screen.getByRole('tooltip', { hidden: true }) };
}

describe('setting-name help', () => {
  it('shows help from the name, not from hovering its input', async () => {
    const { title, field, tip } = setup();
    expect(screen.queryByText('?')).not.toBeInTheDocument();
    fireEvent.mouseEnter(field);
    expect(tip).toHaveAttribute('hidden');
    fireEvent.mouseEnter(title);
    expect(tip).not.toHaveAttribute('hidden');
    fireEvent.mouseLeave(title);
    await waitFor(() => expect(tip).toHaveAttribute('hidden'));
  });
  it('keeps the first tap open even when hover and focus precede click', () => {
    const { title, tip } = setup();
    fireEvent.mouseEnter(title);
    fireEvent.focus(title);
    fireEvent.click(title);
    expect(tip).not.toHaveAttribute('hidden');
    fireEvent.mouseLeave(title);
    expect(tip).not.toHaveAttribute('hidden');
    fireEvent.click(title);
    expect(tip).toHaveAttribute('hidden');
  });
  it('supports keyboard activation and Escape without closing the settings parent', () => {
    const { title, field, tip } = setup();
    expect(field).toHaveAttribute('aria-describedby', tip.id);
    fireEvent.focus(title);
    fireEvent.keyDown(title, { key: 'Enter' });
    expect(tip).not.toHaveAttribute('hidden');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(tip).toHaveAttribute('hidden');
  });
  it('closes pinned help on an outside pointer action', () => {
    const { title, tip } = setup();
    fireEvent.click(title);
    fireEvent.pointerDown(document.body);
    expect(tip).toHaveAttribute('hidden');
  });
});
''')

write('src/media/video-sync.test.ts', '''import { videoTargetTime } from './video-sync';

describe('video elapsed-time synchronization', () => {
  it('seeks backward accurately instead of keeping the later frame', () => {
    expect(videoTargetTime(0.2, 8, 'PLAY', 5)).toBe(0.2);
    expect(videoTargetTime(0, 8, 'PLAY', 5)).toBe(0);
  });
  it('holds a short video at its final frame for the rest of a longer stop', () => {
    expect(videoTargetTime(9, 1.2, 'PLAY', 1.2)).toBeCloseTo(1.19);
    expect(videoTargetTime(10, 0, 'PLAY', 0)).toBe(0);
  });
  it('freezes outgoing scenes and shows the first frame in thumbnail mode', () => {
    expect(videoTargetTime(Number.NaN, 8, 'PLAY', 2)).toBe(2);
    expect(videoTargetTime(4, 8, 'THUMBNAIL', 3)).toBe(0);
    expect(videoTargetTime(4, Infinity, 'PLAY', 0)).toBe(4);
  });
});
''')

write('src/domain/audit-regressions.test.ts', '''import { parseTimeline } from '../timeline-parser.js';
import { inferMobility } from '../mobility.js';
import { applyContinuousAutoBias, buildPlaybackPlan, connectVisualGaps } from './planner';
import { simplePlan } from '../test/fixtures';
import type { AnalysisOptions, TravelFrame } from '../types';

const options: AnalysisOptions = {
  startDate: '2026-04-10', endDate: '2026-04-10', includeFlights: true,
  targetDurationSec: 60, viewportWidth: 1200, viewportHeight: 720,
  cameraMode: 'AUTO', zoomOffset: 0, pacingMode: 'LOCAL_DAYS'
};
function activity(startTime: string, endTime: string, start: string, end: string, type = 'WALKING', distanceMeters = 1000) {
  return { startTime: `2026-04-10T${startTime}+09:00`, endTime: `2026-04-10T${endTime}+09:00`, activity: {
    start: { latLng: start }, end: { latLng: end }, distanceMeters,
    probability: 0.95, topCandidate: { type, probability: 0.95 }
  } };
}

describe('photo journey audit regressions', () => {
  it.each(['09:10:00', '09:10:01'])('does not turn an adjacent small gap at %s into a flight', start => {
    const parsed = parseTimeline({ semanticSegments: [
      activity('09:00:00', '09:10:00', '35.000, 135.000', '35.010, 135.010'),
      activity(start, '09:20:00', '35.012, 135.012', '35.020, 135.020')
    ] }, options);
    const connected = connectVisualGaps(parsed.movements);
    expect(connected).toHaveLength(3);
    expect(connected[1].inferenceSource).toBe('visual-gap');
    expect(inferMobility(connected[1]).mobilityClass).toBe('UNKNOWN');
    expect(inferMobility(connected[1]).speedKmh).toBe(0);
    expect(buildPlaybackPlan(parsed.movements, options).segments.filter(s => s.inference.mobilityClass === 'FLIGHT')).toHaveLength(0);
  });
  it('connects a gap larger than 50 km with finite, continuous travel frames', () => {
    const parsed = parseTimeline({ semanticSegments: [
      activity('09:00:00', '09:10:00', '35.000, 135.000', '35.010, 135.010'),
      activity('09:10:00', '10:20:00', '36.010, 136.010', '36.020, 136.020')
    ] }, options);
    const plan = buildPlaybackPlan(parsed.movements, options);
    expect(plan.segments).toHaveLength(3);
    expect(plan.segments[1].inference.mobilityClass).toBe('UNKNOWN');
    const travel = plan.frames.filter((f): f is TravelFrame => f.kind === 'TRAVEL');
    expect(new Set(travel.map(f => f.sceneId)).size).toBe(1);
    expect(travel.some(f => f.segmentIndex === 1)).toBe(true);
    expect(travel.every(f => Number.isFinite(f.center.lat) && Number.isFinite(f.zoom))).toBe(true);
  });
  it('preserves a recorded flight and does not draw it back when excluded', () => {
    const semanticSegments = [
      activity('09:00:00', '09:10:00', '37.00, 127.00', '37.01, 127.01'),
      activity('09:10:00', '10:30:00', '37.01, 127.01', '34.00, 133.00', 'FLYING', 640000),
      activity('10:30:00', '10:40:00', '34.00, 133.00', '34.01, 133.01')
    ];
    const included = buildPlaybackPlan(parseTimeline({ semanticSegments }, options).movements, options);
    expect(included.segments.filter(s => s.inference.mobilityClass === 'FLIGHT')).toHaveLength(1);
    const without = { ...options, includeFlights: false };
    const excluded = buildPlaybackPlan(parseTimeline({ semanticSegments }, without).movements, without);
    expect(excluded.segments.some(s => s.hideRoute)).toBe(true);
    expect(excluded.segments.filter(s => s.inference.mobilityClass === 'FLIGHT')).toHaveLength(0);
  });
  it('tapers the AUTO bias to zero continuously on both sides of a flight', () => {
    const plan = simplePlan();
    const first = plan.frames[0];
    if (first.kind !== 'TRAVEL') throw new Error('fixture');
    plan.fps = 60;
    plan.frames = Array.from({ length: 240 }, (_, i): TravelFrame => ({ ...first,
      timeSec: i / 60, zoom: 12, lockedZoom: 12,
      mobilityClass: i >= 90 && i < 150 ? 'FLIGHT' : 'WALK'
    }));
    applyContinuousAutoBias(plan);
    const frames = plan.frames as TravelFrame[];
    expect(frames[100].zoom).toBe(12);
    expect(frames[0].zoom).toBeCloseTo(12.28);
    const steps = frames.slice(1).map((f, i) => Math.abs(f.zoom - frames[i].zoom));
    expect(Math.max(...steps)).toBeLessThan(0.01);
    expect(Math.abs(frames[90].zoom - frames[89].zoom)).toBeLessThan(0.001);
    expect(Math.abs(frames[150].zoom - frames[149].zoom)).toBeLessThan(0.001);
  });
});
''')

# Descriptions must match current behavior instead of continuing to promise camera pauses.
p = 'README.md'
text = read(p)
text = text.replace('기록이 끊긴 구간은 선으로 연결하지 않고, 약 2초 동안 지도를 넓게 보여주며 다음 위치로 이동합니다. 이 전환 시간과 기기 지연만큼 실제 감상 시간은 표시된 경로 재생 길이보다 길어질 수 있습니다.', '기록이 끊긴 구간은 이동수단이나 실제 속도를 단정하지 않는 연결 경로로 이어 재생합니다. 연결 시간은 경로 재생 시간에 포함되며 별도 알림으로 재생을 멈추거나 진행선을 지우지 않습니다. 항공 경로를 끄면 해당 비행 선은 다시 그리지 않습니다. 기기 지연이 있으면 실제 감상 시간이 표시 시간보다 길어질 수 있습니다.')
text = text.replace('모바일에서는 옆의 ? 버튼을 누릅니다.', '모바일에서는 설정 이름을 누르면 설명이 열리고, 다시 누르거나 바깥을 누르면 닫힙니다.')
text = text.replace('기록의 전체 기간으로 경로가 준비됩니다.', '기록에서 추천 여행을 찾아 경로를 준비합니다. 추천이 없으면 전체 기간을 사용합니다.')
text = text.replace('**발자취**', '**경로 보기**').replace('**semanticSegments 형식의 Timeline JSON**', '**semanticSegments 형식의 타임라인 JSON 파일**')
text += '\n## 사진 여정 검토 반영\n\n추천 여행은 한 줄 선택 상자에서 고릅니다. 설정 이름의 도움말은 마우스·터치·키보드를 지원합니다. UI는 번들에 포함된 Noto Sans KR Variable과 같은 Lucide SVG 아이콘 계열을 사용하며 폰트 CDN에 접속하지 않습니다. 화면 분할의 기준은 React와 CSS 모두 820px이며, 가로로 짧은 창에서도 재생바와 자막이 화면 안에 유지됩니다.\n\n검증 명령: `npm run verify`, `npm run test:e2e`. 추가 회귀 검사는 짧은 공백의 비행 오분류, 큰 공백 연결, 항공 제외, 줌 보정 경계, 도움말 탭, 추천 여행 선택, 반응형 배치, 영상 탐색과 마지막 프레임 유지를 다룹니다. 실제 개인 사진의 촬영 정보 및 Windows·Android·iOS 실기기 검증과는 구별합니다.\n'
write(p, text)
p = 'AI_PROJECT_CONTEXT.md'
text = read(p).replace('설정 각 항목 아래 짧은 설명을 표시하고 aria-describedby로 연결합니다.', '설정 이름의 hover·키보드 포커스·탭으로 설명을 표시하고 입력과 aria-describedby로 연결합니다. 추천 여행은 native select로 고릅니다.')
text += '\n## 사진 여정 검토 후 유지할 계약\n\n- 출처가 없는 좌표 공백은 `visual-gap`이며 UNKNOWN/속도 0으로 취급합니다. 1초짜리 위치 차이를 항공 증거로 사용하지 않습니다.\n- 공백 연결은 PlaybackPlan 안에서 재생 시간을 배분합니다. controller의 호환용 카메라 보간도 content clock을 멈추거나 경로 source를 비우지 않습니다. 마지막 전체 경로 전환에 별도 2초를 추가하지 않습니다.\n- 명시적으로 제외한 항공 사이의 연결은 `hideRoute`로 표시해 비행 선을 재생성하지 않습니다.\n- AUTO의 확대 bias는 비행 전후에 0.85초 envelope로 연결합니다. 기존 center/zoom 경로에 두 번째 추적 필터를 추가하지 않습니다.\n- UI 분할 기준은 820px, canvas는 100dvh/min-height 0입니다. 열린 설정은 재생바보다 위에 표시합니다.\n- 폰트는 @fontsource-variable/noto-sans-kr의 번들 파일, 픽토그램은 Lucide SVG를 사용합니다. 개인 데이터·폰트 다운로드를 외부 API로 보내지 않습니다.\n'
write(p, text)
p = 'V3_RELEASE_NOTES.md'
text = read(p)
text = text.replace('기록이 끊긴 구간 사이의 순간 이동을 약 2초의 카메라 전환으로 바꿨습니다. 해당 공백은 실제 경로 선으로 연결하지 않습니다.', '기록이 끊긴 구간은 추정 연결 경로로 이어 재생합니다. 기록 없는 구간의 이동수단과 속도는 단정하지 않으며 별도 2초 정지를 추가하지 않습니다.')
text = text.replace('경로 시간에는 카메라 전환과 기기 지연이 포함되지 않으므로 실제 감상은 표시 시간보다 길어질 수 있습니다.', '공백과 마지막 전체 경로 전환은 재생 시간 안에서 진행합니다. 기기 지연이 있으면 실제 감상이 표시 시간보다 길어질 수 있습니다.')
text += '\n## 2026-09-15 사진 여정 검토 수정\n\n짧은 기록 공백의 비행 오분류, AUTO 줌 경계 보정, 큰 공백 및 마지막 전체 경로의 추가 정지, 설정창과 재생바 중첩, 768/820px 분할 불일치, 낮은 가로 화면 잘림을 수정했습니다. 추천 여행은 선택 후 닫히는 native select, 설명은 이름 hover/focus/tap으로 제공합니다. UI 문구를 기능에 맞게 정리하고 번들 한국어 가변 글꼴 및 동일 SVG 계열의 이동수단 아이콘을 적용했습니다. 영상은 일시정지·탐색 위치를 맞추고 짧은 파일의 마지막 화면을 유지하며 첫 화면 모드도 프레임 디코딩을 기다립니다.\n\n검증: 새 회귀 테스트와 기존 전체 verify/Chromium E2E를 실행 대상으로 추가했습니다. 실제 개인 사진·영상 파일 및 실기기 결과는 이 자동 검사에 포함되지 않습니다.\n'
write(p, text)
print('Regression tests and current behavior docs written.')
