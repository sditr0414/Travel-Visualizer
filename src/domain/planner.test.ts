import { durationLimitsForMovements } from '../camera-planner.js';
import type { Movement } from '../types';
import { buildPlaybackPlan, midpointDurationSeconds } from './planner';
import { buildParsedTrip, parseTimelineJson } from './timeline';

describe('playback planner', () => {
  it('produces 60fps travel frames and a complete-route outro', () => {
    const json = parseTimelineJson(JSON.stringify({ semanticSegments: [{
      startTime: '2026-04-10T09:00:00+09:00',
      endTime: '2026-04-10T10:00:00+09:00',
      activity: {
        start: { latLng: '37.5000°, 127.0000°' }, end: { latLng: '37.6000°, 127.2000°' },
        distanceMeters: 22000, topCandidate: { type: 'IN_TRAIN', probability: 0.95 }, probability: 0.95
      }
    }] }));
    const trip = buildParsedTrip(json, { startDate: '2026-04-10', endDate: '2026-04-10' }, true);
    const plan = buildPlaybackPlan(trip.movements, {
      startDate: '2026-04-10', endDate: '2026-04-10', includeFlights: true,
      targetDurationSec: 60, viewportWidth: 1200, viewportHeight: 700,
      cameraMode: 'AUTO', zoomOffset: 0.3, pacingMode: 'LOCAL_DAYS'
    });
    expect(plan.fps).toBe(60);
    expect(plan.frames.some(frame => frame.kind === 'TRAVEL')).toBe(true);
    expect(plan.frames.at(-1)?.kind).toBe('OUTRO');
    expect(plan.cameraMode).toBe('AUTO');
    expect(plan.zoomOffset).toBe(0.3);
  });

  it('uses the min/max midpoint when no explicit duration is set', () => {
    const json = parseTimelineJson(JSON.stringify({ semanticSegments: [{
      startTime: '2026-04-10T09:00:00+09:00',
      endTime: '2026-04-10T10:00:00+09:00',
      activity: {
        start: { latLng: '37.5000°, 127.0000°' }, end: { latLng: '37.6000°, 127.2000°' },
        distanceMeters: 22000, topCandidate: { type: 'IN_TRAIN', probability: 0.95 }, probability: 0.95
      }
    }] }));
    const trip = buildParsedTrip(json, { startDate: '2026-04-10', endDate: '2026-04-10' }, true);
    const plan = buildPlaybackPlan(trip.movements, {
      startDate: '2026-04-10', endDate: '2026-04-10', includeFlights: true,
      targetDurationSec: 0, viewportWidth: 1200, viewportHeight: 700,
      cameraMode: 'AUTO', zoomOffset: 0.3, pacingMode: 'LOCAL_DAYS'
    });
    expect(plan.durationSec).toBeCloseTo(midpointDurationSeconds(plan.durationLimits), 1);
  });

  it('rounds midpoint duration to the five-second control step without leaving its limits', () => {
    expect(midpointDurationSeconds({ minSeconds: 45, maxSeconds: 300 })).toBe(175);
    expect(midpointDurationSeconds({ minSeconds: 31, maxSeconds: 34 })).toBe(34);
  });

  it('keeps user map zoom out of planned frames so short playback and outro use one final player offset', () => {
    const startMs = Date.parse('2026-04-10T09:00:00+09:00');
    const movements = [movement(startMs, { lat: 37.5, lng: 127 }, { lat: 37.6, lng: 127.2 }, 22_000)];
    const baseOptions = {
      startDate: '2026-04-10', endDate: '2026-04-10', includeFlights: true,
      targetDurationSec: 45, viewportWidth: 1200, viewportHeight: 700,
      cameraMode: 'AUTO' as const, pacingMode: 'LOCAL_DAYS' as const
    };
    const neutral = buildPlaybackPlan(movements, { ...baseOptions, zoomOffset: 0 });
    const zoomed = buildPlaybackPlan(movements, { ...baseOptions, zoomOffset: 1.2 });
    const neutralTravel = neutral.frames.find(frame => frame.kind === 'TRAVEL');
    const zoomedTravel = zoomed.frames.find(frame => frame.kind === 'TRAVEL');
    const neutralOutro = neutral.frames.at(-1);
    const zoomedOutro = zoomed.frames.at(-1);

    expect(zoomed.zoomOffset).toBe(1.2);
    expect(zoomedTravel?.zoom).toBeCloseTo(neutralTravel?.zoom ?? 0, 6);
    expect(zoomedOutro?.zoom).toBeCloseTo(neutralOutro?.zoom ?? 0, 6);
  });

  it('keeps a long but geographically compact trip available at a fast playback length', () => {
    const startMs = Date.parse('2026-07-20T09:00:00+09:00');
    const narrow = durationLimitsForMovements([
      movement(startMs, { lat: 37.50, lng: 126.95 }, { lat: 37.55, lng: 127.00 }, 10_000)
    ], { selectedDays: 17 });
    const wide = durationLimitsForMovements([
      movement(startMs, { lat: 37.50, lng: 126.95 }, { lat: 35.68, lng: 139.76 }, 1_150_000)
    ], { selectedDays: 17 });

    expect(narrow.days).toBe(17);
    expect(narrow.extentKm).toBeLessThan(20);
    expect(narrow.minSeconds).toBeLessThanOrEqual(40);
    expect(narrow.recommendedSeconds).toBeLessThan(wide.recommendedSeconds);
    expect(narrow.maxSeconds).toBeLessThan(wide.maxSeconds);
    expect(wide.extentKm).toBeGreaterThan(800);
  });
});

function movement(startMs: number, start: Movement['start'], end: Movement['end'], distanceMeters: number): Movement {
  const endMs = startMs + 60 * 60 * 1000;
  return {
    startMs,
    endMs,
    start,
    end,
    points: [{ ...start, timeMs: startMs }, { ...end, timeMs: endMs }],
    distanceMeters,
    durationSec: 3600,
    avgSpeedKmh: distanceMeters / 1000,
    googleType: 'IN_VEHICLE',
    googleProbability: 0.95,
    activityProbability: 0.95,
    inferred: false
  };
}
