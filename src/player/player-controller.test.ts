import type { Map } from 'maplibre-gl';
import { PlayerController, mapJourneyTime, photoJourneyZoom, photoStopZoomBoost, remapJourneyTimeForStops, smoothPhotoStopZoomBoost, stabilizeTileZoomBoundary } from './player-controller';
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

  it('keeps photo journeys closer with a continuous distance-based detail boost', () => {
    const short = photoJourneyZoom(12, 1_500, 'WALK');
    const medium = photoJourneyZoom(12, 12_000, 'ROAD');
    const long = photoJourneyZoom(12, 60_000, 'ROAD');

    expect(short).toBeGreaterThan(13.5);
    expect(short).toBeGreaterThan(medium);
    expect(medium).toBeGreaterThan(long);
    expect(long).toBeGreaterThan(12.6);
    expect(photoJourneyZoom(8, 1_500, 'FLIGHT')).toBe(8);
  });

  it('continues easing closer while a short-route photo is on screen', () => {
    const early = photoStopZoomBoost(1_500, 0.25, 'WALK');
    const late = photoStopZoomBoost(1_500, 0.85, 'WALK');
    const longRoute = photoStopZoomBoost(60_000, 0.85, 'ROAD');

    expect(early).toBeGreaterThan(0);
    expect(late).toBeGreaterThan(early);
    expect(late).toBeGreaterThan(longRoute);
    expect(photoStopZoomBoost(1_500, 0.85, 'FLIGHT')).toBe(0);
  });

  it('releases a photo zoom boost slowly instead of snapping out between nearby photos', () => {
    const peak = photoStopZoomBoost(1_500, 1, 'WALK');
    const afterFirstRelease = smoothPhotoStopZoomBoost(peak, 0, 0.1);
    const afterSecondRelease = smoothPhotoStopZoomBoost(afterFirstRelease, 0, 0.1);

    expect(peak - afterFirstRelease).toBeLessThan(0.02);
    expect(afterSecondRelease).toBeLessThan(afterFirstRelease);
    expect(afterSecondRelease).toBeGreaterThan(peak - 0.03);

    const nextPhotoTarget = Math.max(afterSecondRelease, photoStopZoomBoost(1_500, 0.15, 'WALK'));
    const resumed = smoothPhotoStopZoomBoost(afterSecondRelease, nextPhotoTarget, 0.1);
    expect(resumed).toBeGreaterThanOrEqual(afterSecondRelease);
  });

  it('holds a tile zoom level briefly around integer boundaries to avoid repeated tile churn', () => {
    const heldBelow = stabilizeTileZoomBoundary(13.98, 14);
    expect(heldBelow.level).toBe(14);
    expect(heldBelow.zoom).toBeGreaterThanOrEqual(14);

    const releasedDown = stabilizeTileZoomBoundary(13.91, 14);
    expect(releasedDown).toEqual({ zoom: 13.91, level: 13 });

    const heldAbove = stabilizeTileZoomBoundary(14.02, 13);
    expect(heldAbove.level).toBe(13);
    expect(heldAbove.zoom).toBeLessThan(14);

    const releasedUp = stabilizeTileZoomBoundary(14.08, 13);
    expect(releasedUp).toEqual({ zoom: 14.08, level: 14 });
  });

  it('centers current-position tracking on the interpolated route head instead of an offset locked center', () => {
    const plan = simplePlan();
    const first = plan.frames[0];
    const outro = plan.frames[1];
    if (first.kind !== 'TRAVEL' || outro.kind !== 'OUTRO') throw new Error('fixture shape changed');
    plan.fps = 4;
    plan.frames = [
      {
        ...first,
        mobilityClass: 'ROAD',
        position: { lat: 37.5, lng: 127 },
        center: { lat: 37.5, lng: 127 },
        lockedCenter: { lat: 37.8, lng: 127.4 },
        zoom: 11,
        lockedZoom: 11
      },
      {
        ...first,
        timeSec: 0.25,
        progress: 0.5,
        mobilityClass: 'ROAD',
        position: { lat: 37.51, lng: 127.01 },
        center: { lat: 37.51, lng: 127.01 },
        lockedCenter: { lat: 37.81, lng: 127.41 },
        zoom: 11,
        lockedZoom: 11
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
    expect(camera.zoom).toBe(11);
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
