from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f'missing marker: {label}')
    return text.replace(old, new, 1)

app_path = Path('src/App.tsx')
app = app_path.read_text()

app = replace_once(app, """interface HudState {
  timeSec: number;
  date: string;
  mobilityClass: MobilityClass;
  mobility: string;
  speed: string;
  originCity: string | null;
  destinationCity: string | null;
}

type JourneyMode = 'ROUTE' | 'PHOTOS';
""", """interface HudState {
  timeSec: number;
  date: string;
  mobilityClass: MobilityClass;
  mobility: string;
  speed: string;
  originCity: string | null;
  destinationCity: string | null;
}

interface AppliedPlanSettings {
  startDate: string;
  endDate: string;
  includeFlights: boolean;
  cameraMode: CameraMode;
  pacingMode: PacingMode;
  durationSec: number;
}

type JourneyMode = 'ROUTE' | 'PHOTOS';
""", 'applied plan settings interface')

app = replace_once(app, """  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hud, setHud] = useState<HudState>({ timeSec: 0, date: '—', mobilityClass: 'UNKNOWN', mobility: '여행 준비', speed: '—', originCity: null, destinationCity: null });
""", """  const [settingsOpen, setSettingsOpen] = useState(false);
  const [appliedPlanSettings, setAppliedPlanSettings] = useState<AppliedPlanSettings | null>(null);
  const [hud, setHud] = useState<HudState>({ timeSec: 0, date: '—', mobilityClass: 'UNKNOWN', mobility: '여행 준비', speed: '—', originCity: null, destinationCity: null });
""", 'applied plan settings state')

app = replace_once(app, """  const scanSource = useCallback(async (source: TimelineSource, text: string) => {
    const operation = ++scanOperationRef.current;
    dispatch({ type: 'LOAD_START', source });
""", """  const scanSource = useCallback(async (source: TimelineSource, text: string) => {
    const operation = ++scanOperationRef.current;
    setAppliedPlanSettings(null);
    dispatch({ type: 'LOAD_START', source });
""", 'clear plan settings on new scan')

app = replace_once(app, """      if (!durationCustomizedRef.current || targetDurationSec < limits.minSeconds || targetDurationSec > limits.maxSeconds) {
        setTargetDurationSec(roundedDuration);
      }
      dispatch({ type: 'PLAN_SUCCESS', plan: result.plan });
""", """      if (!durationCustomizedRef.current || targetDurationSec < limits.minSeconds || targetDurationSec > limits.maxSeconds) {
        setTargetDurationSec(roundedDuration);
      }
      setAppliedPlanSettings({
        startDate,
        endDate,
        includeFlights,
        cameraMode,
        pacingMode,
        durationSec: roundedDuration
      });
      dispatch({ type: 'PLAN_SUCCESS', plan: result.plan });
""", 'capture applied plan settings')

app = replace_once(app, """  const busy = state.phase === 'loading' || state.phase === 'planning' || mediaLoading;
  const canPlay = Boolean(state.plan && map && !busy);
""", """  const busy = state.phase === 'loading' || state.phase === 'planning' || mediaLoading;
  const canPlay = Boolean(state.plan && map && !busy);
  const planNeedsRebuild = Boolean(state.plan && appliedPlanSettings && (
    startDate !== appliedPlanSettings.startDate
    || endDate !== appliedPlanSettings.endDate
    || includeFlights !== appliedPlanSettings.includeFlights
    || cameraMode !== appliedPlanSettings.cameraMode
    || pacingMode !== appliedPlanSettings.pacingMode
    || targetDurationSec !== appliedPlanSettings.durationSec
  ));
""", 'plan needs rebuild derivation')

app = replace_once(app, """          <button className=\"plan-button\" type=\"button\" onClick={() => void createPlan()} disabled={busy || !state.scan || !map}>
            <Route size={16} /> 경로 다시 만들기
          </button>
""", """          <button className=\"plan-button\" type=\"button\" onClick={() => void createPlan()} disabled={busy || !state.scan || !map || !planNeedsRebuild}>
            <Route size={16} /> 경로 다시 만들기
          </button>
""", 'rebuild button disabled state')

app_path.write_text(app)

test_path = Path('src/App.test.tsx')
test = test_path.read_text()

test = replace_once(test, """    fireEvent.click(screen.getByText('여행 설정'));
    expect(screen.getByText('여행 기간')).toBeInTheDocument();
    const zoomSlider = screen.getAllByRole('slider').find(element => element.getAttribute('min') === '-1.5');
""", """    fireEvent.click(screen.getByText('여행 설정'));
    expect(screen.getByText('여행 기간')).toBeInTheDocument();
    const rebuildButton = screen.getByRole('button', { name: '경로 다시 만들기' });
    expect(rebuildButton).toBeDisabled();
    const zoomSlider = screen.getAllByRole('slider').find(element => element.getAttribute('min') === '-1.5');
""", 'initial rebuild disabled assertion')

test = replace_once(test, """    const followCurrentPosition = screen.getByLabelText('현재 위치 따라가기');
    fireEvent.click(followCurrentPosition);
    expect(screen.queryByText('따라가기 반응 속도')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '전체 기간' }));
    expect(screen.getByLabelText('여행 시작')).toHaveValue('2026-03-01');
    expect(screen.getByLabelText('여행 마지막 날')).toHaveValue('2026-04-11');
    fireEvent.click(screen.getByRole('button', { name: '추천 기간' }));
    expect(screen.getByLabelText('여행 시작')).toHaveValue('2026-03-17');
    expect(screen.getByLabelText('여행 마지막 날')).toHaveValue('2026-03-31');
""", """    const followCurrentPosition = screen.getByLabelText('현재 위치 따라가기');
    fireEvent.click(followCurrentPosition);
    expect(screen.queryByText('따라가기 반응 속도')).not.toBeInTheDocument();
    expect(rebuildButton).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '전체 기간' }));
    expect(screen.getByLabelText('여행 시작')).toHaveValue('2026-03-01');
    expect(screen.getByLabelText('여행 마지막 날')).toHaveValue('2026-04-11');
    expect(rebuildButton).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '추천 기간' }));
    expect(screen.getByLabelText('여행 시작')).toHaveValue('2026-03-17');
    expect(screen.getByLabelText('여행 마지막 날')).toHaveValue('2026-03-31');
    expect(rebuildButton).toBeDisabled();
""", 'live and reverted settings rebuild assertions')

test = replace_once(test, """  it('applies changed map zoom immediately and preserves it when rebuilding the route', async () => {
""", """  it('keeps live camera settings out of rebuild state and rebuilds only after a planned camera change', async () => {
""", 'zoom test title')

test = replace_once(test, """    fireEvent.change(zoomSlider, { target: { value: '1.2' } });
    await waitFor(() => expect(fakeMap.jumpTo).toHaveBeenCalledWith(expect.objectContaining({ zoom: 13.2 })));

    fireEvent.click(screen.getByRole('button', { name: '경로 다시 만들기' }));
    await waitFor(() => expect(worker.plan).toHaveBeenCalledTimes(2));
    expect(worker.plan).toHaveBeenLastCalledWith(expect.objectContaining({ zoomOffset: 1.2 }), expect.any(Function));
    await waitFor(() => expect(fakeMap.jumpTo).toHaveBeenCalledWith(expect.objectContaining({ zoom: 13.2 })));
""", """    fireEvent.change(zoomSlider, { target: { value: '1.2' } });
    await waitFor(() => expect(fakeMap.jumpTo).toHaveBeenCalledWith(expect.objectContaining({ zoom: 13.2 })));

    const rebuildButton = screen.getByRole('button', { name: '경로 다시 만들기' });
    expect(rebuildButton).toBeDisabled();
    expect(worker.plan).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText('화면 구성'), { target: { value: 'DAY' } });
    expect(rebuildButton).toBeEnabled();
    fireEvent.click(rebuildButton);
    await waitFor(() => expect(worker.plan).toHaveBeenCalledTimes(2));
    expect(worker.plan).toHaveBeenLastCalledWith(expect.objectContaining({ cameraMode: 'DAY', zoomOffset: 1.2 }), expect.any(Function));
    await waitFor(() => expect(rebuildButton).toBeDisabled());
    await waitFor(() => expect(fakeMap.jumpTo).toHaveBeenCalledWith(expect.objectContaining({ zoom: 13.2 })));
""", 'zoom live versus planned rebuild behavior')

test = replace_once(test, """    fireEvent.click(screen.getByRole('button', { name: '발자취' }));
    expect(screen.getByRole('button', { name: '발자취' })).toHaveClass('active');
    fireEvent.click(screen.getByRole('button', { name: '경로 다시 만들기' }));
    await waitFor(() => expect(worker.plan).toHaveBeenCalledTimes(2));
""", """    const rebuildButton = screen.getByRole('button', { name: '경로 다시 만들기' });
    expect(rebuildButton).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '발자취' }));
    expect(screen.getByRole('button', { name: '발자취' })).toHaveClass('active');
    fireEvent.change(screen.getByLabelText('화면 구성'), { target: { value: 'SEGMENT' } });
    expect(rebuildButton).toBeEnabled();
    fireEvent.click(rebuildButton);
    await waitFor(() => expect(worker.plan).toHaveBeenCalledTimes(2));
""", 'photo live settings do not require rebuild')

test_path.write_text(test)

doc_path = Path('AI_PROJECT_CONTEXT.md')
doc = doc_path.read_text()
marker = """- 발자취와 사진 여정은 같은 지도와 계획 데이터를 공유하지만 **서로 다른 `PlayerController` 재생 세션**이다."""
insert = """- `경로 다시 만들기` 버튼은 현재 설정이 마지막으로 성공한 `PlaybackPlan`의 계획 입력과 실제로 다를 때만 활성화한다. 재계획 입력은 여행 시작/마지막 날, 항공 경로 포함 여부, 화면 구성(camera mode), 구간별 재생 시간(pacing), 경로 재생 길이이며 값을 원래 적용값으로 되돌리면 버튼도 다시 비활성화한다. `지도 확대`, `현재 위치 따라가기`, 사진 경로 상세 확대/강도와 사진·영상 표시 설정처럼 `PlayerController` 또는 stop schedule에 즉시 반영되는 live 설정은 경로 재계획 사유로 취급하지 않는다. 새 Timeline을 읽을 때 이전 적용 스냅샷은 폐기하고 자동 계획 성공 시 새 기준값을 저장한다.\n"""
if marker not in doc:
    raise SystemExit('missing marker: context rebuild invariant')
doc = doc.replace(marker, insert + marker, 1)
doc_path.write_text(doc)
