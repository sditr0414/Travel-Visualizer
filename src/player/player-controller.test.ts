import type { Map } from 'maplibre-gl';
import { PlayerController, applyUserZoomOffset, mapJourneyTime, photoJourneyDetailZoomBoost, photoJourneyZoom, photoStopZoomBoost, remapJourneyTimeForStops, smoothPhotoStopZoomBoost, stabilizeTileZoomBoundary } from './player-controller';
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

  it('adds adjustable detail zoom when photo dwell time is long and the trip extent is small', () => {
    const smallArea = photoJourneyDetailZoomBoost(3, 120, 120, 1, 'WALK');
    const wideArea = photoJourneyDetailZoomBoost(60, 120, 120, 1, 'WALK');
    const shortDwell = photoJourneyDetailZoomBoost(3, 120, 20, 1, 'WALK');

    expect(smallArea).toBeGreaterThan(0.9);
    expect(smallArea).toBeGreaterThan(wideArea);
    expect(smallArea).toBeGreaterThan(shortDwell);
    expect(photoJourneyDetailZoomBoost(3, 120, 120, 0, 'WALK')).toBe(0);
    expect(photoJourneyDetailZoomBoost(3, 120, 120, 1.5, 'WALK')).toBeGreaterThan(smallArea);
    expect(photoJourneyDetailZoomBoost(3, 120, 120, 1.5, 'FLIGHT')).toBe(0);
  });

  it('applies photo detail zoom live without changing the base route controller behavior', () => {
    const jumpTo = vi.fn();
    const map = { getSource: () => ({ setData: vi.fn() }), jumpTo } as unknown as Map;
    const plan = simplePlan();
    plan.durationSec = 60;
    plan.durationLimits.extentKm = 2;
    const controller = new PlayerController(map);
    controller.setPhotoDetailZoomStrength(1);
    controller.loadPlan(plan, [{ id: 'photo', atSec: 0, durationSec: 60 }]);
    const detailed = (jumpTo.mock.calls.at(-1)?.[0] as { zoom: number }).zoom;

    controller.setPhotoDetailZoomStrength(0);
    const base = (jumpTo.mock.calls.at(-1)?.[0] as { zoom: number }).zoom;
    expect(detailed).toBeGreaterThan(base + 0.8);
  });

  it('keeps photo detail strength effective in unlocked cinematic mode without saturating at the legacy boost cap', () => {
    const plan = simplePlan();
    plan.durationSec = 60;
    plan.durationLimits.extentKm = 2;
    const jumpTo = vi.fn();
    const map = { getSource: () => ({ setData: vi.fn() }), jumpTo } as unknown as Map;
    const controller = new PlayerController(map);
    controller.setLockToPosition(false);
    controller.setPhotoDetailZoomStrength(0.5);
    controller.loadPlan(plan, [{ id: 'photo', atSec: 0, durationSec: 60 }]);
    const low = (jumpTo.mock.calls.at(-1)?.[0] as { zoom: number }).zoom;

    controller.setPhotoDetailZoomStrength(1.5);
    const high = (jumpTo.mock.calls.at(-1)?.[0] as { zoom: number }).zoom;
    expect(high).toBeGreaterThan(low + 0.6);
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

  it('applies the user zoom offset as an absolute final camera adjustment', () => {
    expect(applyUserZoomOffset(11, 1.2)).toBeCloseTo(12.2, 5);
    expect(applyUserZoomOffset(11, -1.2)).toBeCloseTo(9.8, 5);
    expect(applyUserZoomOffset(8, 1.2)).toBeCloseTo(9.2, 5);
  });

  it('applies user zoom to current-position travel, stable flight, and outro map cameras', () => {
    const jumpTo = vi.fn();
    const map = {
      getSource: () => ({ setData: vi.fn() }),
      jumpTo
    } as unknown as Map;
    const plan = simplePlan();
    plan.zoomOffset = 1.2;
    const first = plan.frames[0];
    const outro = plan.frames[1];
    if (first.kind !== 'TRAVEL' || outro.kind !== 'OUTRO') throw new Error('fixture shape changed');

    const controller = new PlayerController(map);
    controller.setZoomOffset(1.2);
    controller.loadPlan(plan);
    let camera = jumpTo.mock.calls.at(-1)?.[0] as { zoom: number };
    expect(camera.zoom).toBeCloseTo(first.zoom + 1.2, 5);

    controller.seek(plan.durationSec);
    camera = jumpTo.mock.calls.at(-1)?.[0] as { zoom: number };
    expect(camera.zoom).toBeCloseTo(outro.zoom + 1.2, 5);

    const flightPlan = simplePlan();
    const flight = flightPlan.frames[0];
    if (flight.kind !== 'TRAVEL') throw new Error('fixture shape changed');
    flight.mobilityClass = 'FLIGHT';
    flight.zoom = 8;
    flight.lockedZoom = 8;
    const flightController = new PlayerController(map);
    flightController.setZoomOffset(1.2);
    flightController.loadPlan(flightPlan);
    camera = jumpTo.mock.calls.at(-1)?.[0] as { zoom: number };
    expect(camera.zoom).toBeCloseTo(9.2, 5);
  });

  it('applies zoom-out after photo journey boosts so lower clamping does not cancel the user setting', () => {
    const jumpTo = vi.fn();
    const map = {
      getSource: () => ({ setData: vi.fn() }),
      jumpTo
    } as unknown as Map;
    const plan = simplePlan();
    const first = plan.frames[0];
    if (first.kind !== 'TRAVEL') throw new Error('fixture shape changed');
    first.zoom = 4.2;
    first.lockedZoom = 4.2;

    const controller = new PlayerController(map);
    controller.setZoomOffset(-1.5);
    controller.loadPlan(plan, [{ id: 'photo', atSec: 0, durationSec: 1 }]);

    const camera = jumpTo.mock.calls.at(-1)?.[0] as { zoom: number };
    const photoBaseZoom = photoJourneyZoom(4.2, plan.segments[0].distanceMeters, first.mobilityClass);
    expect(camera.zoom).toBeCloseTo(applyUserZoomOffset(photoBaseZoom, -1.5), 5);
  });

  it('does not let an inactive journey controller overwrite the shared map on zoom preference changes', () => {
    const jumpTo = vi.fn();
    const map = {
      getSource: () => ({ setData: vi.fn() }),
      jumpTo
    } as unknown as Map;
    const routeController = new PlayerController(map);
    const photoController = new PlayerController(map);
    routeController.loadPlan(simplePlan());
    photoController.loadPlan(simplePlan(), [{ id: 'photo', atSec: 0, durationSec: 1 }]);
    routeController.seek(0);
    jumpTo.mockClear();

    routeController.setZoomOffset(1);
    const activeCamera = jumpTo.mock.calls.at(-1)?.[0] as { zoom: number };
    expect(activeCamera.zoom).toBeCloseTo(13, 5);
    expect(jumpTo).toHaveBeenCalledTimes(1);

    photoController.setZoomOffset(1);
    expect(jumpTo).toHaveBeenCalledTimes(1);
  });


  it('uses the planned cinematic center directly when current-position tracking is disabled', () => {
    const plan = simplePlan();
    const first = plan.frames[0];
    const outro = plan.frames[1];
    if (first.kind !== 'TRAVEL' || outro.kind !== 'OUTRO') throw new Error('fixture shape changed');
    plan.fps = 4;
    plan.frames = [
      {
        ...first,
        position: { lat: 37.5, lng: 127 },
        center: { lat: 37.7, lng: 127.3 },
        zoom: 11
      },
      {
        ...first,
        timeSec: 0.25,
        progress: 0.5,
        position: { lat: 37.51, lng: 127.01 },
        center: { lat: 37.71, lng: 127.31 },
        zoom: 11
      },
      outro
    ];

    const jumpTo = vi.fn();
    const map = { getSource: () => ({ setData: vi.fn() }), jumpTo } as unknown as Map;
    const controller = new PlayerController(map);
    controller.setLockToPosition(false);
    controller.loadPlan(plan);
    controller.seek(0.125);

    const camera = jumpTo.mock.calls.at(-1)?.[0] as { center: [number, number] };
    expect(camera.center[0]).toBeCloseTo(127.305, 3);
    expect(camera.center[1]).toBeCloseTo(37.705, 3);
  });

  it('replays planned free-camera zoom without a second runtime lag filter', () => {
    const plan = simplePlan();
    const first = plan.frames[0];
    const outro = plan.frames[1];
    if (first.kind !== 'TRAVEL' || outro.kind !== 'OUTRO') throw new Error('fixture shape changed');
    plan.fps = 4;
    plan.durationSec = 0.5;
    plan.frames = [
      { ...first, sceneId: 0, zoom: 10, lockedZoom: 10 },
      { ...first, timeSec: 0.25, progress: 0.5, sceneId: 0, zoom: 14, lockedZoom: 14 },
      { ...outro, timeSec: 0.5 }
    ];

    const jumpTo = vi.fn();
    const map = { getSource: () => ({ setData: vi.fn() }), jumpTo } as unknown as Map;
    let scheduled: FrameRequestCallback | null = null;
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      scheduled = callback;
      return 1;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    const controller = new PlayerController(map);
    try {
      controller.setLockToPosition(false);
      controller.loadPlan(plan);
      controller.play();
      expect(scheduled).not.toBeNull();
      for (let ms = 25; ms <= 125; ms += 25) (scheduled as unknown as FrameRequestCallback)(ms);
      const camera = jumpTo.mock.calls.at(-1)?.[0] as { zoom: number };
      // The existing tile-level hysteresis may hold 0.001 below the boundary.
      expect(Math.abs(camera.zoom - 12)).toBeLessThanOrEqual(0.0011);
    } finally {
      controller.pause();
      now.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('keeps unlocked flight on the planned cinematic zoom while locked flight stays stable', () => {
    const plan = simplePlan();
    const first = plan.frames[0];
    const outro = plan.frames[1];
    if (first.kind !== 'TRAVEL' || outro.kind !== 'OUTRO') throw new Error('fixture shape changed');
    plan.fps = 4;
    plan.frames = [
      { ...first, mobilityClass: 'FLIGHT', sceneId: 0, zoom: 8, lockedZoom: 8 },
      { ...first, timeSec: 0.25, progress: 0.5, mobilityClass: 'FLIGHT', sceneId: 0, zoom: 10, lockedZoom: 10 },
      outro
    ];

    const unlockedJumpTo = vi.fn();
    const unlockedMap = { getSource: () => ({ setData: vi.fn() }), jumpTo: unlockedJumpTo } as unknown as Map;
    const unlocked = new PlayerController(unlockedMap);
    unlocked.setLockToPosition(false);
    unlocked.loadPlan(plan);
    unlocked.seek(0.125);
    expect((unlockedJumpTo.mock.calls.at(-1)?.[0] as { zoom: number }).zoom).toBeCloseTo(9, 5);

    const lockedJumpTo = vi.fn();
    const lockedMap = { getSource: () => ({ setData: vi.fn() }), jumpTo: lockedJumpTo } as unknown as Map;
    const locked = new PlayerController(lockedMap);
    locked.loadPlan(plan);
    locked.seek(0.125);
    expect((lockedJumpTo.mock.calls.at(-1)?.[0] as { zoom: number }).zoom).toBeCloseTo(8, 5);
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
describe('playback continuity', () => {
  function playback() {
    const jumpTo = vi.fn();
    const setData = vi.fn();
    const map = { getSource: () => ({ setData }), jumpTo } as unknown as Map;
    let next: FrameRequestCallback = () => undefined;
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { next = callback; return 1; }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const onFrame = vi.fn();
    const onTransitionChange = vi.fn();
    const player = new PlayerController(map, { onFrame, onTransitionChange });
    return { player, jumpTo, setData, onFrame, onTransitionChange, tick: (ms: number) => next(ms) };
  }
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('does not skip seconds of route after a blocked animation frame', () => {
    const p = playback();
    p.player.loadPlan(simplePlan());
    p.player.play();
    p.tick(16);
    p.tick(2016);
    expect(p.onFrame.mock.calls.at(-1)?.[2]).toBeCloseTo(0.066, 6);
    expect(p.player.isPlaying()).toBe(true);
    p.player.dispose();
  });

  it.each([0, 1])('keeps the content clock and route visible across old-plan gaps in scene %s', sceneId => {
    const p = playback();
    const plan = simplePlan();
    const first = plan.frames[0];
    if (first.kind !== 'TRAVEL') throw new Error('fixture');
    plan.fps = 10;
    plan.durationSec = 1;
    plan.segments.push({ ...plan.segments[0], index: 1, sceneId: 1, start: { lng: 129, lat: 35 } });
    plan.frames = [first, { ...first, sceneId, segmentIndex: 1, position: { lng: 129, lat: 35 }, center: { lng: 129, lat: 35 } }];
    p.player.loadPlan(plan);
    p.player.play();
    p.tick(50); p.tick(100);
    expect(p.onTransitionChange).not.toHaveBeenCalled();
    expect(p.onFrame.mock.calls.at(-1)?.[2]).toBeCloseTo(0.1, 6);
    p.setData.mockClear();
    p.tick(150); p.tick(200);
    expect(p.onFrame.mock.calls.at(-1)?.[2]).toBeCloseTo(0.2, 6);
    expect(p.jumpTo.mock.calls.at(-1)?.[0].center[0]).toBeGreaterThan(127);
    expect(p.jumpTo.mock.calls.at(-1)?.[0].center[0]).toBeLessThan(129);
    expect(p.setData.mock.calls.every(call => call[0].features.length > 0)).toBe(true);
    for (let ms = 250; ms <= 1050; ms += 50) p.tick(ms);
    expect(p.player.isPlaying()).toBe(false);
    expect(p.onFrame.mock.calls.at(-1)?.[2]).toBeCloseTo(1, 6);
    p.player.seek(0);
    expect(p.jumpTo.mock.calls.at(-1)?.[0].center).toEqual([127, 37.5]);
    p.player.dispose();
  });

  it('interpolates across the date line using the nearby world copy', () => {
    const p = playback();
    const plan = simplePlan();
    const first = plan.frames[0];
    if (first.kind !== 'TRAVEL') throw new Error('fixture');
    plan.frames = [{ ...first, position: { lng: 179, lat: 30 } }, { ...first, position: { lng: -179, lat: 30 } }];
    p.player.loadPlan(plan);
    p.player.seek(0.25);
    expect(p.jumpTo.mock.calls.at(-1)?.[0].center[0]).toBeCloseTo(180, 6);
    p.player.dispose();
  });
});
