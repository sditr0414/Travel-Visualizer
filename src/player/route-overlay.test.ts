import type { Map as MapLibreMap } from 'maplibre-gl';
import type { MobilityClass, PlaybackPlan, TravelFrame } from '../types';
import { simplePlan } from '../test/fixtures';
import { collectRouteTrail, releaseRouteOverlay, updateRouteOverlay } from './route-overlay';

const colors = Object.fromEntries(['WALK', 'BIKE', 'URBAN_TRANSIT', 'FAST_GROUND', 'FERRY', 'FLIGHT', 'ROAD', 'UNKNOWN'].map(mode => [mode, '#ff725d'])) as Record<MobilityClass, string>;
function plan(): PlaybackPlan {
  const result = simplePlan();
  const first = result.frames[0] as TravelFrame;
  result.fps = 60;
  result.durationSec = 10;
  result.frames = Array.from({ length: 601 }, (_, index) => ({ ...first, segmentIndex: 0, sceneId: 0,
    position: { lat: 35, lng: 135 + index / 10000 }, progress: index / 600 }));
  return result;
}
function current(result: PlaybackPlan, position: number): TravelFrame {
  const frame = result.frames[Math.floor(position)] as TravelFrame;
  return { ...frame, position: { lat: 35, lng: 135 + position / 10000 } };
}
function environment() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const baseCanvas = document.createElement('canvas');
  baseCanvas.width = 800; baseCanvas.height = 600;
  Object.defineProperties(baseCanvas, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
  host.appendChild(baseCanvas);
  const context = { setTransform: vi.fn(), clearRect: vi.fn(), beginPath: vi.fn(), stroke: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), arc: vi.fn(), fill: vi.fn() };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  const listeners = new Map<string, () => void>();
  let zoom = 12;
  const map = {
    getCanvasContainer: () => host, getCanvas: () => baseCanvas,
    getCenter: () => ({ lat: 35, lng: 135 }), getZoom: () => zoom, getBearing: () => 0, getPitch: () => 0,
    project: ([lng, lat]: number[]) => ({ x: (lng - 135) * 10000 + 100, y: lat }),
    triggerRepaint: vi.fn(),
    on: (name: string, callback: () => void) => { listeners.set(name, callback); },
    off: (name: string) => { listeners.delete(name); }
  } as unknown as MapLibreMap;
  return { map, host, context, listeners, zoom: (value: number) => { zoom = value; } };
}

afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

describe('frame-synchronous route overlay', () => {
  it('moves the four-second tail fractionally rather than in planner-frame steps', () => {
    const result = plan();
    const a = collectRouteTrail(result, 300.25, current(result, 300.25));
    const b = collectRouteTrail(result, 300.5, current(result, 300.5));
    expect(a.length).toBeLessThanOrEqual(242);
    expect(b[0].position.lng).toBeGreaterThan(a[0].position.lng);
    expect(a.at(-1)?.position.lng).toBeCloseTo(135.030025, 7);
  });
  it('never joins across a hidden flight interval', () => {
    const result = plan();
    result.segments.push({ ...result.segments[0], hideRoute: true });
    for (let index = 270; index <= 280; index += 1) (result.frames[index] as TravelFrame).segmentIndex = 1;
    const points = collectRouteTrail(result, 300, current(result, 300));
    expect(points.some(point => point.position.lng >= 135.027 && point.position.lng <= 135.028)).toBe(false);
    expect(points.find(point => Math.abs(point.position.lng - 135.0281) < 1e-8)?.breakBefore).toBe(true);
  });
  it('keeps intentional scene cuts disconnected', () => {
    const result = plan();
    (result.frames[290] as TravelFrame).sceneId = 1;
    const points = collectRouteTrail(result, 300, current(result, 300));
    expect(points.find(point => Math.abs(point.position.lng - 135.029) < 1e-8)?.breakBefore).toBe(true);
  });
  it.each([60, 120])('updates every map frame at %i Hz without a 30 Hz geometry cap', hz => {
    const env = environment();
    const result = plan();
    const owner = {};
    for (let tick = 1; tick <= hz; tick += 1) {
      const position = tick * 60 / hz;
      expect(updateRouteOverlay(env.map, owner, result, position, current(result, position), colors)).toBe(true);
      env.listeners.get('render')?.();
    }
    expect(env.context.clearRect).toHaveBeenCalledTimes(hz);
    expect(env.context.arc).toHaveBeenCalledTimes(hz);
    const positions = env.context.arc.mock.calls.map(call => call[0] as number);
    expect(new Set(positions).size).toBe(hz);
    releaseRouteOverlay(env.map, owner);
  });
  it('skips duplicate paints while a photo is held but follows camera zoom', () => {
    const env = environment();
    const result = plan();
    const owner = {};
    updateRouteOverlay(env.map, owner, result, 10, current(result, 10), colors);
    env.listeners.get('render')?.();
    env.listeners.get('render')?.();
    expect(env.context.clearRect).toHaveBeenCalledTimes(1);
    env.zoom(12.1);
    env.listeners.get('render')?.();
    expect(env.context.clearRect).toHaveBeenCalledTimes(2);
    releaseRouteOverlay(env.map, owner);
  });
  it('shares one overlay and does not let disposal of an inactive mode remove it', () => {
    const env = environment();
    const result = plan();
    const route = {}, photo = {};
    updateRouteOverlay(env.map, route, result, 1, current(result, 1), colors);
    updateRouteOverlay(env.map, photo, result, 2, current(result, 2), colors);
    releaseRouteOverlay(env.map, route);
    expect(env.host.querySelectorAll('.route-playback-overlay')).toHaveLength(1);
    env.listeners.get('remove')?.();
    expect(env.host.querySelectorAll('.route-playback-overlay')).toHaveLength(0);
    expect(env.listeners.size).toBe(0);
  });
  it('hides its moving head in the outro and restores it on seek', () => {
    const env = environment();
    const result = plan();
    const owner = {};
    const outro = simplePlan().frames.find(frame => frame.kind === 'OUTRO')!;
    updateRouteOverlay(env.map, owner, result, 10, current(result, 10), colors);
    updateRouteOverlay(env.map, owner, result, 600, outro, colors);
    expect(env.host.querySelector('.route-playback-overlay')).toHaveAttribute('hidden');
    updateRouteOverlay(env.map, owner, result, 0, current(result, 0), colors);
    expect(env.host.querySelector('.route-playback-overlay')).not.toHaveAttribute('hidden');
    releaseRouteOverlay(env.map, owner);
  });
  it('retains a safe fallback for maps without an overlay canvas', () => {
    const result = plan();
    expect(updateRouteOverlay({} as MapLibreMap, {}, result, 0, current(result, 0), colors)).toBe(false);
  });
});
