import type { Map } from 'maplibre-gl';
import { PlayerController } from './player-controller';
import { simplePlan } from '../test/fixtures';
import type { TravelFrame } from '../types';

function setup() {
  const plan = simplePlan();
  const first = plan.frames[0] as TravelFrame;
  plan.fps = 60;
  plan.durationSec = 3;
  plan.frames = Array.from({ length: 181 }, (_, i): TravelFrame => ({ ...first,
    timeSec: i / 60, progress: i / 180,
    position: { lng: 127 + i * 0.0001, lat: 37.5 }, center: { lng: 127 + i * 0.0001, lat: 37.5 }
  }));
  const progress = vi.fn();
  const sources = { 'route-all': { setData: vi.fn() }, 'route-progress': { setData: progress } };
  const jumpTo = vi.fn();
  const map = { getSource: (id: keyof typeof sources) => sources[id], jumpTo } as unknown as Map;
  let next: FrameRequestCallback = () => undefined;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { next = callback; return 1; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.spyOn(performance, 'now').mockReturnValue(0);
  const player = new PlayerController(map);
  return { plan, player, progress, jumpTo, tick: (ms: number) => next(ms) };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('display-synchronized route geometry', () => {
  it.each([60, 120])('updates one shared trail/head source on every %s Hz display frame', hz => {
    const p = setup();
    p.player.loadPlan(p.plan);
    p.player.play();
    p.progress.mockClear(); p.jumpTo.mockClear();
    for (let i = 1; i <= hz; i += 1) p.tick(i * 1000 / hz);
    expect(p.progress).toHaveBeenCalledTimes(hz);
    expect(p.jumpTo).toHaveBeenCalledTimes(hz);
    for (const [data] of p.progress.mock.calls) {
      const line = data.features.find((f: { geometry: { type: string } }) => f.geometry.type === 'LineString');
      const point = data.features.find((f: { geometry: { type: string } }) => f.geometry.type === 'Point');
      expect(point.geometry.coordinates).toEqual(line.geometry.coordinates.at(-1));
    }
    p.player.dispose();
  });
  it('does not rebuild unchanged geometry on every photo dwell frame', () => {
    const p = setup();
    p.player.loadPlan(p.plan, [{ id: 'photo', atSec: 0, durationSec: 2 }]);
    p.player.play(); p.progress.mockClear();
    for (let i = 1; i <= 60; i += 1) p.tick(i * 1000 / 60);
    expect(p.progress).not.toHaveBeenCalled();
    expect(p.jumpTo.mock.calls.length).toBeGreaterThanOrEqual(60);
    p.player.dispose();
  });
  it('keeps both the route and the head absent in an excluded-flight connector', () => {
    const p = setup(); p.plan.segments[0].hideRoute = true;
    p.player.loadPlan(p.plan);
    expect(p.progress.mock.calls.at(-1)?.[0].features).toEqual([]);
    p.player.dispose();
  });
});
