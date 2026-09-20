import { useEffect } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { App } from './App';
import { simplePlan } from './test/fixtures';
import type { TimelineWorkerPort } from './services/timeline-worker-client';

const fakeMap = {
  getCanvas: () => ({ clientWidth: 1200, clientHeight: 700 }),
  getSource: () => ({ setData: vi.fn() }),
  getLayer: () => ({}),
  setLayoutProperty: vi.fn(),
  jumpTo: vi.fn(),
  fitBounds: vi.fn()
};

vi.mock('./map/MapStage', () => ({
  MapStage: ({ onReady }: { onReady: (map: unknown) => void }) => {
    useEffect(() => onReady(fakeMap), [onReady]);
    return <div data-testid="map-stage" />;
  }
}));

describe('App integration', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve({
      status: url.includes('/api/local-timeline') ? 404 : 200,
      ok: !url.includes('/api/local-timeline'),
      json: () => Promise.resolve({ ready: false, world: false, region: false, worldBytes: 0, regionBytes: 0 }),
      text: () => Promise.resolve(url.includes('timeline') ? '{"semanticSegments":[]}' : '')
    })));
  });

  afterEach(() => vi.unstubAllGlobals());

  it('changes checkbox settings only from the checkbox, never its row or help name', async () => {
    const worker: TimelineWorkerPort = {
      scan: vi.fn().mockResolvedValue({ startDate: '2026-03-01', endDate: '2026-04-11', semanticSegments: 4 }),
      plan: vi.fn().mockResolvedValue({ trip: {}, plan: simplePlan() }),
      cancel: vi.fn(), dispose: vi.fn()
    };
    render(<App workerClient={worker} />);
    fireEvent.change(screen.getByLabelText('시작할 타임라인 파일 열기'), { target: { files: [timelineFile()] } });
    await waitFor(() => expect(screen.getByRole('button', { name: '재생' })).toBeEnabled());
    fireEvent.click(screen.getByText('여행 설정'));
    for (const name of ['항공 경로 포함', '현재 위치 따라가기']) {
      const checkbox = screen.getByRole('checkbox', { name }) as HTMLInputElement;
      const initial = checkbox.checked;
      fireEvent.click(checkbox.parentElement!);
      expect(checkbox.checked).toBe(initial);
      fireEvent.click(screen.getByRole('button', { name: `${name} 설명` }));
      expect(checkbox.checked).toBe(initial);
      expect(checkbox.closest('label')).toBeNull();
      fireEvent.click(checkbox);
      expect(checkbox.checked).toBe(!initial);
    }
  });

  it('automatically loads the configured local Timeline', async () => {
    const contents = '{"semanticSegments":[]}';
    vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve({
      status: 200,
      ok: true,
      json: () => Promise.resolve({ ready: false, world: false, region: false, worldBytes: 0, regionBytes: 0 }),
      text: () => Promise.resolve(url.includes('/api/local-timeline') ? contents : '')
    })));
    const worker: TimelineWorkerPort = {
      scan: vi.fn().mockResolvedValue({ startDate: '2026-03-01', endDate: '2026-04-11', semanticSegments: 4 }),
      plan: vi.fn().mockResolvedValue({ trip: {}, plan: simplePlan() }),
      cancel: vi.fn(),
      dispose: vi.fn()
    };

    render(<App workerClient={worker} />);

    await waitFor(() => expect(screen.getByRole('button', { name: '재생' })).toBeEnabled());
    expect(worker.scan).toHaveBeenCalledWith(
      { kind: 'local-file', name: '타임라인.json' },
      contents,
      expect.any(Function)
    );
  });

  it('waits for a local Timeline, creates a midpoint-duration plan, and enables playback controls', async () => {
    const worker: TimelineWorkerPort = {
      scan: vi.fn().mockResolvedValue({ startDate: '2026-03-01', endDate: '2026-04-11', semanticSegments: 4 }),
      plan: vi.fn().mockResolvedValue({ trip: {}, plan: simplePlan() }),
      cancel: vi.fn(),
      dispose: vi.fn()
    };
    render(<App workerClient={worker} />);
    expect(screen.getByTestId('map-stage')).toBeInTheDocument();
    expect(screen.getByText('다녀온 여행을 다시 펼쳐보세요')).toBeInTheDocument();
    expect(worker.scan).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('시작할 타임라인 파일 열기'), {
      target: { files: [timelineFile()] }
    });
    await waitFor(() => expect(screen.getByRole('button', { name: '재생' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '재생' }));
    expect(screen.getByRole('button', { name: '일시정지' })).toBeInTheDocument();
    expect(worker.scan).toHaveBeenCalled();
    expect(worker.plan).toHaveBeenCalledWith(expect.objectContaining({
      startDate: '2026-03-01', endDate: '2026-04-11', cameraMode: 'AUTO', zoomOffset: 0,
      pacingMode: 'LOCAL_DAYS', targetDurationSec: 0
    }), expect.any(Function));
    expect(fakeMap.setLayoutProperty).toHaveBeenCalledWith('route-all', 'visibility', 'none');
    fireEvent.click(screen.getByRole('button', { name: '일시정지' }));
    await waitFor(() => expect(fakeMap.setLayoutProperty).toHaveBeenCalledWith('route-all', 'visibility', 'visible'));

    fireEvent.click(screen.getByText('여행 설정'));
    expect(screen.getByText('여행 기간')).toBeInTheDocument();
    const rebuildButton = screen.getByRole('button', { name: '경로 다시 만들기' });
    expect(rebuildButton).toBeDisabled();
    const zoomSlider = screen.getAllByRole('slider').find(element => element.getAttribute('min') === '-1.5');
    expect(zoomSlider).toHaveValue('0');
    expect(screen.getByLabelText('여행 시작')).toHaveValue('2026-03-01');
    expect(screen.getByLabelText('여행 마지막 날')).toHaveValue('2026-04-11');
    const followCurrentPosition = screen.getByLabelText('현재 위치 따라가기');
    fireEvent.click(followCurrentPosition);
    expect(screen.queryByText('따라가기 반응 속도')).not.toBeInTheDocument();
    expect(rebuildButton).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '전체 기간' }));
    expect(screen.getByLabelText('여행 시작')).toHaveValue('2026-03-01');
    expect(screen.getByLabelText('여행 마지막 날')).toHaveValue('2026-04-11');
    expect(rebuildButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText('여행 시작'), { target: { value: '2026-03-02' } });
    expect(rebuildButton).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '전체 기간' }));
    expect(screen.getByLabelText('여행 시작')).toHaveValue('2026-03-01');
    expect(screen.getByLabelText('여행 마지막 날')).toHaveValue('2026-04-11');
    expect(rebuildButton).toBeDisabled();
  });


  it('offers multiple recommended trips with destination hints and lets the user select one', async () => {
    const worker: TimelineWorkerPort = {
      scan: vi.fn().mockResolvedValue({
        startDate: '2026-03-01', endDate: '2026-07-03', semanticSegments: 40,
        recommendedRange: { startDate: '2026-07-01', endDate: '2026-07-03' },
        tripCandidates: [
          { id: 'japan', startDate: '2026-07-01', endDate: '2026-07-03', activeDays: 3, distanceMeters: 2300000, destinationHint: '일본', representativeCoordinate: { lat: 35.67, lng: 139.65 } },
          { id: 'gangneung', startDate: '2026-05-02', endDate: '2026-05-04', activeDays: 3, distanceMeters: 380000, destinationHint: '강릉', representativeCoordinate: { lat: 37.75, lng: 128.88 } }
        ]
      }),
      plan: vi.fn().mockResolvedValue({ trip: {}, plan: simplePlan() }),
      cancel: vi.fn(),
      dispose: vi.fn()
    };
    render(<App workerClient={worker} />);
    fireEvent.change(screen.getByLabelText('시작할 타임라인 파일 열기'), { target: { files: [timelineFile()] } });
    await waitFor(() => expect(screen.getByRole('button', { name: '재생' })).toBeEnabled());
    expect(worker.plan).toHaveBeenCalledWith(expect.objectContaining({ startDate: '2026-07-01', endDate: '2026-07-03' }), expect.any(Function));

    fireEvent.click(screen.getByText('여행 설정'));
    const picker = screen.getByRole('combobox', { name: '추천 여행' });
    expect(picker).toHaveValue('japan');
    fireEvent.change(picker, { target: { value: 'gangneung' } });
    expect(screen.getByLabelText('여행 시작')).toHaveValue('2026-05-02');
    expect(screen.getByLabelText('여행 마지막 날')).toHaveValue('2026-05-04');
    expect(picker).toHaveValue('gangneung');
    expect(screen.queryByRole('button', { name: /강릉/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '경로 다시 만들기' })).toBeEnabled();
  });

  it('keeps live camera settings out of rebuild state and rebuilds only after a planned camera change', async () => {
    const worker: TimelineWorkerPort = {
      scan: vi.fn().mockResolvedValue({ startDate: '2026-03-01', endDate: '2026-04-11', semanticSegments: 4 }),
      plan: vi.fn().mockImplementation(() => Promise.resolve({ trip: {}, plan: simplePlan() })),
      cancel: vi.fn(),
      dispose: vi.fn()
    };
    fakeMap.jumpTo.mockClear();
    render(<App workerClient={worker} />);
    fireEvent.change(screen.getByLabelText('시작할 타임라인 파일 열기'), {
      target: { files: [timelineFile()] }
    });
    await waitFor(() => expect(screen.getByRole('button', { name: '재생' })).toBeEnabled());

    fireEvent.click(screen.getByText('여행 설정'));
    const zoomSlider = screen.getAllByRole('slider').find(element => element.getAttribute('min') === '-1.5');
    if (!zoomSlider) throw new Error('map zoom slider missing');
    fireEvent.change(zoomSlider, { target: { value: '1.2' } });
    await waitFor(() => expect(fakeMap.jumpTo).toHaveBeenCalledWith(expect.objectContaining({ zoom: 13.2 })));

    const rebuildButton = screen.getByRole('button', { name: '경로 다시 만들기' });
    expect(rebuildButton).toBeDisabled();
    expect(worker.plan).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText('지도 보기 방식'), { target: { value: 'DAY' } });
    expect(rebuildButton).toBeEnabled();
    fireEvent.click(rebuildButton);
    await waitFor(() => expect(worker.plan).toHaveBeenCalledTimes(2));
    expect(worker.plan).toHaveBeenLastCalledWith(expect.objectContaining({ cameraMode: 'DAY', zoomOffset: 1.2 }), expect.any(Function));
    await waitFor(() => expect(rebuildButton).toBeDisabled());
    await waitFor(() => expect(fakeMap.jumpTo).toHaveBeenCalledWith(expect.objectContaining({ zoom: 13.2 })));
  });

  it('keeps exact online place lookup opt-in live and out of rebuild state', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve({
      status: url.includes('/api/local-timeline') ? 404 : 200,
      ok: !url.includes('/api/local-timeline'),
      json: () => Promise.resolve(url.includes('/api/photo-place-status')
        ? { available: true, provider: '테스트 장소 서비스', cache: true }
        : { ready: false, world: false, region: false, worldBytes: 0, regionBytes: 0 }),
      text: () => Promise.resolve('')
    })));
    const worker: TimelineWorkerPort = {
      scan: vi.fn().mockResolvedValue({ startDate: '2026-03-01', endDate: '2026-04-11', semanticSegments: 4 }),
      plan: vi.fn().mockResolvedValue({ trip: {}, plan: simplePlan() }),
      cancel: vi.fn(),
      dispose: vi.fn()
    };
    render(<App workerClient={worker} />);
    fireEvent.change(screen.getByLabelText('시작할 타임라인 파일 열기'), { target: { files: [timelineFile()] } });
    await waitFor(() => expect(screen.getByRole('button', { name: '재생' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '사진 여정' }));
    fireEvent.click(screen.getByText('여행 설정'));

    const exactPlace = await screen.findByLabelText('정확한 장소 온라인 확인');
    await waitFor(() => expect(exactPlace).toBeEnabled());
    const rebuildButton = screen.getByRole('button', { name: '경로 다시 만들기' });
    expect(rebuildButton).toBeDisabled();
    fireEvent.click(exactPlace);
    expect(exactPlace).toBeChecked();
    expect(rebuildButton).toBeDisabled();
  });

  it('pauses playback whenever the journey presentation mode changes', async () => {
    const worker: TimelineWorkerPort = {
      scan: vi.fn().mockResolvedValue({ startDate: '2026-03-01', endDate: '2026-04-11', semanticSegments: 4 }),
      plan: vi.fn().mockResolvedValue({ trip: {}, plan: simplePlan() }),
      cancel: vi.fn(),
      dispose: vi.fn()
    };
    render(<App workerClient={worker} />);
    fireEvent.change(screen.getByLabelText('시작할 타임라인 파일 열기'), {
      target: { files: [timelineFile()] }
    });
    await waitFor(() => expect(screen.getByRole('button', { name: '재생' })).toBeEnabled());

    fireEvent.click(screen.getByRole('button', { name: '사진 여정' }));
    fireEvent.click(screen.getByRole('button', { name: '재생' }));
    expect(screen.getByRole('button', { name: '일시정지' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '경로 보기' }));
    expect(screen.getByRole('button', { name: '재생' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '재생' }));
    expect(screen.getByRole('button', { name: '일시정지' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '사진 여정' }));
    expect(screen.getByRole('button', { name: '재생' })).toBeInTheDocument();
  });

  it('keeps route and photo playback cursors independent', async () => {
    const worker: TimelineWorkerPort = {
      scan: vi.fn().mockResolvedValue({ startDate: '2026-03-01', endDate: '2026-04-11', semanticSegments: 4 }),
      plan: vi.fn().mockResolvedValue({ trip: {}, plan: simplePlan() }),
      cancel: vi.fn(),
      dispose: vi.fn()
    };
    render(<App workerClient={worker} />);
    fireEvent.change(screen.getByLabelText('시작할 타임라인 파일 열기'), {
      target: { files: [timelineFile()] }
    });
    await waitFor(() => expect(screen.getByRole('button', { name: '재생' })).toBeEnabled());

    const position = screen.getByLabelText('재생 위치');
    fireEvent.change(position, { target: { value: '0.5' } });
    expect(position).toHaveValue('0.5');

    fireEvent.click(screen.getByRole('button', { name: '사진 여정' }));
    await waitFor(() => expect(position).toHaveValue('0'));
    fireEvent.change(position, { target: { value: '1' } });
    expect(position).toHaveValue('1');

    fireEvent.click(screen.getByRole('button', { name: '경로 보기' }));
    await waitFor(() => expect(position).toHaveValue('0.5'));
    fireEvent.click(screen.getByRole('button', { name: '사진 여정' }));
    await waitFor(() => expect(position).toHaveValue('1'));
  });

  it('starts photo journeys with preview media and keeps the route tab after replanning', async () => {
    const worker: TimelineWorkerPort = {
      scan: vi.fn().mockResolvedValue({ startDate: '2026-04-10', endDate: '2026-04-11', semanticSegments: 4 }),
      plan: vi.fn().mockImplementation(() => Promise.resolve({ trip: {}, plan: simplePlan() })), cancel: vi.fn(), dispose: vi.fn()
    };
    render(<App workerClient={worker} />);
    fireEvent.change(screen.getByLabelText('시작할 사진 폴더 선택'), {
      target: { files: [new File(['image'], 'IMG_trip.png', { type: 'image/png', lastModified: Date.parse('2026-04-10T00:00:00Z') })] }
    });
    expect(screen.getByText('선택한 파일 · 1개')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('시작할 타임라인 파일 열기'), {
      target: { files: [timelineFile()] }
    });
    await waitFor(() => expect(screen.getByRole('button', { name: '재생' })).toBeEnabled());
    await waitFor(() => expect(screen.getByLabelText('재생 위치')).toHaveAttribute('max', '6.5'));
    expect(screen.queryByAltText('IMG trip')).not.toBeInTheDocument();
    expect(screen.getByText('도보')).toBeInTheDocument();
    expect(screen.getByText('12 km/h')).toBeInTheDocument();
    expect(screen.queryByText(/개의 사진·영상이 경로에 연결되었습니다/)).not.toBeInTheDocument();
    expect(screen.queryByText('현재 장면')).not.toBeInTheDocument();
    const playerStatus = screen.getByLabelText('재생 컨트롤').querySelector('.player-status');
    expect(playerStatus).toBeEmptyDOMElement();
    expect(playerStatus?.previousElementSibling).toHaveTextContent('0:00');
    expect(playerStatus?.nextElementSibling).toHaveTextContent('0:07');
    const separator = screen.getByRole('separator', { name: '경로와 사진 영역 크기 조절' });
    expect(separator).toHaveAttribute('aria-valuenow', '38');
    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(separator).toHaveAttribute('aria-valuenow', '40');
    fireEvent.click(screen.getByText('여행 설정'));
    expect(screen.getByText('여행 설정').closest('.settings-panel')).toHaveAttribute('data-placement', 'topbar');
    expect(screen.getByLabelText('지도 보기 방식')).toHaveValue('AUTO');
    expect(screen.getByText(/사진과 영상 원본은 외부로 업로드하지 않습니다/)).toBeInTheDocument();
    expect(screen.getByLabelText('정확한 장소 온라인 확인')).toBeDisabled();
    expect(screen.queryByText('전체 경로 미리 보기')).not.toBeInTheDocument();
    expect(screen.getByLabelText('표시할 사진')).toHaveValue('PREVIEW');
    expect(screen.getByLabelText('사진을 볼 때 지도 확대')).toHaveValue('AUTO');
    expect(screen.getByRole('slider', { name: '상세 확대 강도' })).toHaveValue('1');
    fireEvent.change(screen.getByLabelText('사진을 볼 때 지도 확대'), { target: { value: 'OFF' } });
    expect(screen.queryByRole('slider', { name: '상세 확대 강도' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('사진을 볼 때 지도 확대'), { target: { value: 'AUTO' } });
    fireEvent.change(screen.getByRole('slider', { name: '상세 확대 강도' }), { target: { value: '1.4' } });
    expect(screen.getByRole('slider', { name: '상세 확대 강도' })).toHaveValue('1.4');
    expect(screen.getByLabelText('날짜 변경 표시')).toBeChecked();
    expect(screen.getByRole('slider', { name: '날짜 표시 시간' })).toHaveValue('2.5');
    expect(screen.getByRole('slider', { name: '날짜 표시 시간' })).toHaveAttribute('min', '1');
    expect(screen.getByRole('slider', { name: '날짜 표시 시간' })).toHaveAttribute('max', '5');
    expect(screen.getByRole('slider', { name: '날짜 표시 시간' })).toHaveAttribute('step', '0.5');
    expect(screen.getByLabelText('영상 재생')).toHaveValue('PLAY');
    expect(screen.getByLabelText('영상 소리 재생')).not.toBeChecked();
    fireEvent.change(screen.getByLabelText('표시할 사진'), { target: { value: 'ALL' } });
    expect(screen.getByLabelText('표시할 사진')).toHaveValue('ALL');

    const rebuildButton = screen.getByRole('button', { name: '경로 다시 만들기' });
    expect(rebuildButton).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '경로 보기' }));
    expect(screen.getByRole('button', { name: '경로 보기' })).toHaveClass('active');
    fireEvent.change(screen.getByLabelText('지도 보기 방식'), { target: { value: 'SEGMENT' } });
    expect(rebuildButton).toBeEnabled();
    fireEvent.click(rebuildButton);
    await waitFor(() => expect(worker.plan).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('button', { name: '재생' })).toBeEnabled());
    expect(screen.getByRole('button', { name: '경로 보기' })).toHaveClass('active');
  });
});

function timelineFile(): File {
  const contents = '{"semanticSegments":[]}';
  const file = new File([contents], 'timeline.json', { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(contents) });
  return file;
}
