import type { Map } from 'maplibre-gl';
import { PlayerController, mapJourneyTime, photoJourneyZoom, remapJourneyTimeForStops } from './player-controller';
import { simplePlan } from '../test/fixtures';

describe('photo journey stops', () => {
  const stops = [{ id: 'a', atSec: 10, durationSec: 3 }, { id: 'b', atSec: 20, durationSec: 5 }];

  it('holds route time while a media stop is active', () => {
    expect(mapJourneyTime(11, stops, 60)).toEqual({ routeTimeSec: 10, activeStopId: 'a' });
    expect(mapJourneyTime(15, stops, 60)).toEqual({ routeTimeSec: 12, activeStopId: null });
    expect(mapJourneyTime(25, stops, 60)).toEqual({ routeTimeSec: 20, activeStopId: 'b' });
    expect(mapJourneyTime(31, stops, 60)).toEqual({ routeTimeSec: 23, activeStopId: null });
  });

  it('preserves route progress when photo stops are added or removed', () => {
    const photoStops = [{ id: 'photo', atSec: 10, durationSec: 4 }];
    expect(remapJourneyTimeForStops(18, photoStops, [], 60)).toBe(14);
    expect(remapJourneyTimeForStops(14, [], photoStops, 60)).toBe(18);
  });

  it('preserves progress inside the same media stop when its duration changes', () => {
    expect(remapJourneyTimeForStops(
      12,
      [{ id: 'photo', atSec: 10, durationSec: 4 }],
      [{ id: 'photo', atSec: 10, durationSec: 8 }],
      60
    )).toBe(14);
  });

  it('caches the total stop duration when stops change', () => {
    const map = {
      getSource: () => ({ setData: vi.fn() }),
      jumpTo: vi.fn()
    } as unknown as Map;
    const controller = new PlayerController(map);
    const plan = simplePlan();
    controller.loadPlan(plan, stops);
    expect(controller.getDuration()).toBe(plan.durationSec + 8);
    controller.setStops([{ id: 'only', atSec: 1, durationSec: 2 }]);
    expect(controller.getDuration()).toBe(plan.durationSec + 2);
  });

  it('keeps photo journeys closer and gives short routes more detail', () => {
    expect(photoJourneyZoom(12, 1_500, 'WALK')).toBeCloseTo(12.9);
    expect(photoJourneyZoom(12, 12_000, 'ROAD')).toBeCloseTo(12.52);
    expect(photoJourneyZoom(8, 1_500, 'FLIGHT')).toBe(8);
  });

  it('interpolates camera position between planned frames and keeps one flight zoom stable', () => {
    const plan = simplePlan();
    const first = plan.frames[0];
    const outro = plan.frames[1];
    if (first.kind !== 'TRAVEL' || outro.kind !== 'OUTRO') throw new Error('fixture shape changed');
    plan.fps = 4;
    plan.frames = [
      {
        ...first,
        mobilityClass: 'FLIGHT',
        position: { lat: 37.5, lng: 127 },
        center: { lat: 37.5, lng: 127 },
        lockedCenter: { lat: 37.5, lng: 127 },
        zoom: 8,
        lockedZoom: 8
      },
      {
        ...first,
        timeSec: 0.25,
        progress: 0.5,
        mobilityClass: 'FLIGHT',
        position: { lat: 37.51, lng: 127.01 },
        center: { lat: 37.51, lng: 127.01 },
        lockedCenter: { lat: 37.51, lng: 127.01 },
        zoom: 10,
        lockedZoom: 10
      },
      outro
    ];

    const jumpTo = vi.fn();
    const map = {
      getSource: () => ({ setData: vi.fn() }),
      jumpTo
    } as unknown as Map;
    const controller = new PlayerController(map);
    controller.loadPlan(plan);
    controller.seek(0.125);

    const camera = jumpTo.mock.calls.at(-1)?.[0] as { center: [number, number]; zoom: number };
    expect(camera.center[0]).toBeCloseTo(127.005, 3);
    expect(camera.center[1]).toBeCloseTo(37.505, 3);
    expect(camera.zoom).toBe(8);
  });
});
