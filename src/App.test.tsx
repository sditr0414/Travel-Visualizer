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
  jumpTo: vi.fn()
};

vi.mock('./map/MapStage', () => ({
  MapStage: ({ onReady }: { onReady: (map: unknown) => void }) => {
    useEffect(() => onReady(fakeMap), [onReady]);
    return <div data-testid="map-stage" />;
  }
}));

describe('App integration', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve({
      status: url.includes('/api/local-timeline') ? 404 : 200,
      ok: !url.includes('/api/local-timeline'),
      json: () => Promise.resolve({ ready: false, world: false, region: false, worldBytes: 0, regionBytes: 0 }),
      text: () => Promise.resolve(url.includes('timeline') ? '{"semanticSegments":[]}' : '')
    })));
  });

  afterEach(() => vi.unstubAllGlobals());

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

  it('waits for a local Timeline, creates a plan, and enables playback controls', async () => {
    const worker: TimelineWorkerPort = {
      scan: vi.fn().mockResolvedValue({ startDate: '2026-03-01', endDate: '2026-04-11', semanticSegments: 4 }),
      plan: vi.fn().mockResolvedValue({ trip: {}, plan: simplePlan() }),
      cancel: vi.fn(),
      dispose: vi.fn()
    };
    render(<App workerClient={worker} />);
    expect(screen.getByTestId('map-stage')).toBeInTheDocument();
    expect(screen.getByText('내 여행 파일로 시작')).toBeInTheDocument();
    expect(worker.scan).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('시작할 Timeline JSON 선택'), {
      target: { files: [timelineFile()] }
    });
    await waitFor(() => expect(screen.getByRole('button', { name: '재생' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '재생' }));
    expect(screen.getByRole('button', { name: '일시정지' })).toBeInTheDocument();
    expect(worker.scan).toHaveBeenCalled();
    expect(worker.plan).toHaveBeenCalled();
    expect(worker.plan).toHaveBeenCalledWith(expect.objectContaining({ startDate: '2026-03-17', endDate: '2026-03-31', cameraMode: 'AUTO', zoomOffset: 0.3, pacingMode: 'LOCAL_DAYS' }), expect.any(Function));
    expect(fakeMap.setLayoutProperty).toHaveBeenCalledWith('route-all', 'visibility', 'none');
    fireEvent.click(screen.getByRole('button', { name: '일시정지' }));
    await waitFor(() => expect(fakeMap.setLayoutProperty).toHaveBeenCalledWith('route-all', 'visibility', 'visible'));
  });

  it('exposes camera controls and the local photo journey', async () => {
    const worker: TimelineWorkerPort = {
      scan: vi.fn().mockResolvedValue({ startDate: '2026-04-10', endDate: '2026-04-11', semanticSegments: 4 }),
      plan: vi.fn().mockResolvedValue({ trip: {}, plan: simplePlan() }), cancel: vi.fn(), dispose: vi.fn()
    };
    render(<App workerClient={worker} />);
    fireEvent.change(screen.getByLabelText('시작할 사진 폴더 선택'), {
      target: { files: [new File(['image'], 'IMG_20260410_000500.png', { type: 'image/png' })] }
    });
    expect(screen.getByText('선택한 파일 · 1개')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('시작할 Timeline JSON 선택'), {
      target: { files: [timelineFile()] }
    });
    await waitFor(() => expect(screen.getByRole('button', { name: '재생' })).toBeEnabled());
    await waitFor(() => expect(screen.getByLabelText('재생 위치')).toHaveAttribute('max', '4'));
    expect(screen.getByAltText('IMG 20260410 000500')).toBeInTheDocument();
    const separator = screen.getByRole('separator', { name: '경로와 사진 영역 크기 조절' });
    expect(separator).toHaveAttribute('aria-valuenow', '60');
    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(separator).toHaveAttribute('aria-valuenow', '62');
    fireEvent.click(screen.getByText('여행 설정'));
    expect(screen.getByLabelText('화면 구성')).toHaveValue('AUTO');
    expect(screen.getByText('사진과 영상은 이 PC의 로컬 서버에서만 제공되며 외부로 업로드되지 않습니다.')).toBeInTheDocument();
    expect(screen.queryByText('전체 경로 미리 보기')).not.toBeInTheDocument();
    expect(screen.getByLabelText('사진 표시 범위')).toHaveValue('ALL');
    fireEvent.change(screen.getByLabelText('사진 표시 범위'), { target: { value: 'PREVIEW' } });
    expect(screen.getByLabelText('사진 표시 범위')).toHaveValue('PREVIEW');
  });
});

function timelineFile(): File {
  const contents = '{"semanticSegments":[]}';
  const file = new File([contents], 'timeline.json', { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(contents) });
  return file;
}
