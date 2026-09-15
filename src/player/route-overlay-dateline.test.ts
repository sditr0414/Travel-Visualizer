import type { Map as MapLibreMap } from 'maplibre-gl';
import type { MobilityClass, TravelFrame } from '../types';
import { simplePlan } from '../test/fixtures';
import { releaseRouteOverlay, updateRouteOverlay } from './route-overlay';

it.each([-179, 181])('projects both sides of the date line next to camera longitude %s', centerLng => {
  const host = document.createElement('div');
  const baseCanvas = document.createElement('canvas');
  baseCanvas.width = 800;
  Object.defineProperties(baseCanvas, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
  const context = { setTransform: vi.fn(), clearRect: vi.fn(), beginPath: vi.fn(), stroke: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), arc: vi.fn(), fill: vi.fn() };
  const contextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  const project = vi.fn(([lng, lat]: number[]) => ({ x: lng, y: lat }));
  let draw = () => undefined;
  const map = {
    getCanvasContainer: () => host, getCanvas: () => baseCanvas,
    getCenter: () => ({ lat: 35, lng: centerLng }), getZoom: () => 8,
    getBearing: () => 0, getPitch: () => 0, project, triggerRepaint: vi.fn(),
    on: (event: string, callback: () => undefined) => { if (event === 'render') draw = callback; }, off: vi.fn()
  } as unknown as MapLibreMap;
  const plan = simplePlan();
  const first = plan.frames[0] as TravelFrame;
  const longitudes = [179.8, -179.9, -179.6];
  plan.frames = longitudes.map(lng => ({ ...first, position: { lng, lat: 35 } }));
  const current = plan.frames[2] as TravelFrame;
  const colors = { [current.mobilityClass]: '#ff725d' } as Record<MobilityClass, string>;
  const owner = {};
  try {
    expect(updateRouteOverlay(map, owner, plan, 2, current, colors)).toBe(true);
    draw();
    const projected = project.mock.calls.map(([coordinate]) => coordinate[0]);
    expect(projected).toHaveLength(4);
    const expected = centerLng < 0 ? [-180.2, -179.9, -179.6, -179.6] : [179.8, 180.1, 180.4, 180.4];
    projected.forEach((longitude, index) => expect(longitude).toBeCloseTo(expected[index], 7));
    expect(Math.max(...projected) - Math.min(...projected)).toBeLessThan(1);
  } finally {
    releaseRouteOverlay(map, owner);
    contextSpy.mockRestore();
  }
});
