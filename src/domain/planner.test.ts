import { buildPlaybackPlan } from './planner';
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
  });

  it('uses the midpoint between minimum and maximum duration when no explicit duration is set', () => {
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
    const expected = Math.round(((plan.durationLimits.minSeconds + plan.durationLimits.maxSeconds) / 2) / 5) * 5;
    expect(plan.durationSec).toBeCloseTo(expected, 1);
  });
});
