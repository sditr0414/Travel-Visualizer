import { useEffect } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { vi } from 'vitest';
import { App } from './App';
import { simplePlan } from './test/fixtures';
import type { TimelineWorkerPort } from './services/timeline-worker-client';
import type { MapSourceConfig } from './types';

const maps = {
  online: { getCanvas: () => ({ clientWidth: 1200, clientHeight: 700 }), getSource: () => ({ setData: vi.fn() }), getLayer: () => ({}), setLayoutProperty: vi.fn(), jumpTo: vi.fn() },
  'local-pmtiles': { getCanvas: () => ({ clientWidth: 1200, clientHeight: 700 }), getSource: () => ({ setData: vi.fn() }), getLayer: () => ({}), setLayoutProperty: vi.fn(), jumpTo: vi.fn() }
};
vi.mock('./map/MapStage', () => ({ MapStage: ({ source, onReady }: { source: MapSourceConfig; onReady: (map: unknown) => void }) => {
  useEffect(() => onReady(maps[source.kind]), [onReady, source]);
  return <div data-testid="map-stage" />;
} }));

function worker(): TimelineWorkerPort {
  return { scan: vi.fn().mockResolvedValue({ startDate: '2026-04-10', endDate: '2026-04-11', semanticSegments: 4 }), plan: vi.fn().mockImplementation(() => Promise.resolve({ trip: {}, plan: simplePlan() })), cancel: vi.fn(), dispose: vi.fn() };
}
async function load() {
  const file = new File(['{}'], 'timeline.json', { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: () => Promise.resolve('{}') });
  fireEvent.change(screen.getByLabelText('Timeline JSON 선택'), { target: { files: [file] } });
}
function settings() { fireEvent.click(screen.getByRole('button', { name: '여행 설정' })); return screen.getByRole('dialog', { name: '여행 설정' }); }

describe('v3 application flows', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve({ ok: url === '/api/map-status', status: url === '/api/map-status' ? 200 : 404,
      json: () => Promise.resolve({ ready: true, world: true, region: true, worldBytes: 1, regionBytes: 1 }), text: () => Promise.resolve('') })));
    vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (this: HTMLDialogElement) { this.setAttribute('open', ''); });
    vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (this: HTMLDialogElement) { this.removeAttribute('open'); });
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('provides onboarding, a usable help dialog and a disabled player before import', async () => {
    render(<App workerClient={worker()} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('다시 여행하세요');
    expect(screen.getByRole('button', { name: '재생' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '사용 방법' }));
    expect(await screen.findByRole('dialog', { name: '처음 사용하는 분을 위한 안내' })).toBeVisible();
  });

  it('uses the actual data range and enables playback after import', async () => {
    const client = worker(); render(<App workerClient={client} />); await load();
    await waitFor(() => expect(screen.getByRole('button', { name: '재생' })).toBeEnabled());
    expect(client.plan).toHaveBeenCalledWith(expect.objectContaining({ startDate: '2026-04-10', endDate: '2026-04-11', targetDurationSec: 0 }), expect.any(Function));
    fireEvent.click(screen.getByRole('button', { name: '재생' }));
    expect(screen.getByRole('button', { name: '일시정지' })).toBeInTheDocument();
  });

  it('allows retry after the first plan fails without requiring another file', async () => {
    const client = worker(); vi.mocked(client.plan).mockRejectedValueOnce(new Error('선택 기간에 재생할 이동 구간이 없습니다.'));
    render(<App workerClient={client} />); await load();
    const dialog = await screen.findByRole('dialog', { name: '여행 설정' });
    await waitFor(() => expect(within(dialog).getByRole('button', { name: '경로 만들기' })).toBeEnabled());
    fireEvent.change(within(dialog).getByLabelText('여행 시작'), { target: { value: '2026-04-11' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '경로 만들기' }));
    await waitFor(() => expect(client.plan).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('button', { name: '재생' })).toBeEnabled());
    expect(client.scan).toHaveBeenCalledTimes(1);
  });

  it('explains settings and separates immediate adjustments from route changes', async () => {
    render(<App workerClient={worker()} />); await load();
    await waitFor(() => expect(screen.getByRole('button', { name: '재생' })).toBeEnabled());
    const dialog = settings(); const rebuild = within(dialog).getByRole('button', { name: '경로 다시 만들기' });
    expect(rebuild).toBeDisabled();
    const zoom = within(dialog).getByLabelText('지도 확대');
    expect(zoom).toHaveAccessibleDescription(/왼쪽은 넓게/);
    fireEvent.change(zoom, { target: { value: '1.2' } }); expect(rebuild).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('화면 구성'), { target: { value: 'DAY' } }); expect(rebuild).toBeEnabled();
  });

  it('retains the active cursor and paused state after replacing the map', async () => {
    render(<App workerClient={worker()} />); await load();
    await waitFor(() => expect(screen.getByRole('button', { name: '재생' })).toBeEnabled());
    fireEvent.change(screen.getByLabelText('재생 위치'), { target: { value: '0.4' } });
    const dialog = settings();
    fireEvent.change(within(dialog).getByLabelText('지도 소스'), { target: { value: 'local-pmtiles' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '여행 설정 닫기' }));
    await waitFor(() => expect(screen.getByLabelText('재생 위치')).toHaveValue('0.4'));
    expect(screen.getByRole('button', { name: '재생' })).toBeEnabled();
  });

  it('keeps route and photo cursors independent', async () => {
    render(<App workerClient={worker()} />); await load();
    await waitFor(() => expect(screen.getByRole('button', { name: '재생' })).toBeEnabled());
    const position = screen.getByLabelText('재생 위치');
    fireEvent.change(position, { target: { value: '0.4' } });
    fireEvent.click(screen.getByRole('button', { name: '사진 여정' }));
    fireEvent.change(position, { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: '발자취' }));
    expect(position).toHaveValue('0.4');
    fireEvent.click(screen.getByRole('button', { name: '사진 여정' }));
    expect(position).toHaveValue('1');
  });

  it('persists preferences without storing file names or travel dates', async () => {
    render(<App workerClient={worker()} />); await load();
    await waitFor(() => expect(screen.getByRole('button', { name: '재생' })).toBeEnabled());
    const dialog = settings();
    fireEvent.change(within(dialog).getByLabelText('사진 표시 시간'), { target: { value: '4' } });
    await waitFor(() => expect(JSON.parse(localStorage.getItem('travel-camera.preferences.v3')!).photoDisplaySec).toBe(4));
    expect(localStorage.getItem('travel-camera.preferences.v3')).not.toMatch(/timeline.json|2026-04/);
  });
});
