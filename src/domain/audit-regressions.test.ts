import { parseTimeline } from '../timeline-parser.js';
import { inferMobility } from '../mobility.js';
import { applyContinuousAutoBias, buildPlaybackPlan, connectVisualGaps } from './planner';
import { simplePlan } from '../test/fixtures';
import type { AnalysisOptions, TravelFrame } from '../types';

const options: AnalysisOptions = {
  startDate: '2026-04-10', endDate: '2026-04-10', includeFlights: true,
  targetDurationSec: 60, viewportWidth: 1200, viewportHeight: 720,
  cameraMode: 'AUTO', zoomOffset: 0, pacingMode: 'LOCAL_DAYS'
};
function activity(startTime: string, endTime: string, start: string, end: string, type = 'WALKING', distanceMeters = 1000) {
  return { startTime: `2026-04-10T${startTime}+09:00`, endTime: `2026-04-10T${endTime}+09:00`, activity: {
    start: { latLng: start }, end: { latLng: end }, distanceMeters,
    probability: 0.95, topCandidate: { type, probability: 0.95 }
  } };
}

describe('photo journey audit regressions', () => {
  it.each(['09:10:00', '09:10:01'])('does not turn an adjacent small gap at %s into a flight', start => {
    const parsed = parseTimeline({ semanticSegments: [
      activity('09:00:00', '09:10:00', '35.000, 135.000', '35.010, 135.010'),
      activity(start, '09:20:00', '35.012, 135.012', '35.020, 135.020')
    ] }, options);
    const connected = connectVisualGaps(parsed.movements);
    expect(connected).toHaveLength(3);
    expect(connected[1].inferenceSource).toBe('visual-gap');
    expect(inferMobility(connected[1]).mobilityClass).toBe('UNKNOWN');
    expect(inferMobility(connected[1]).speedKmh).toBe(0);
    expect(buildPlaybackPlan(parsed.movements, options).segments.filter(s => s.inference.mobilityClass === 'FLIGHT')).toHaveLength(0);
  });
  it('connects a gap larger than 50 km with finite, continuous travel frames', () => {
    const parsed = parseTimeline({ semanticSegments: [
      activity('09:00:00', '09:10:00', '35.000, 135.000', '35.010, 135.010'),
      activity('09:10:00', '10:20:00', '36.010, 136.010', '36.020, 136.020')
    ] }, options);
    const plan = buildPlaybackPlan(parsed.movements, options);
    expect(plan.segments).toHaveLength(3);
    expect(plan.segments[1].inference.mobilityClass).toBe('UNKNOWN');
    const travel = plan.frames.filter((f): f is TravelFrame => f.kind === 'TRAVEL');
    expect(new Set(travel.map(f => f.sceneId)).size).toBe(1);
    expect(travel.some(f => f.segmentIndex === 1)).toBe(true);
    expect(travel.every(f => Number.isFinite(f.center.lat) && Number.isFinite(f.zoom))).toBe(true);
  });
  it('preserves a recorded flight and does not draw it back when excluded', () => {
    const semanticSegments = [
      activity('09:00:00', '09:10:00', '37.00, 127.00', '37.01, 127.01'),
      activity('09:10:00', '10:30:00', '37.01, 127.01', '34.00, 133.00', 'FLYING', 640000),
      activity('10:30:00', '10:40:00', '34.00, 133.00', '34.01, 133.01')
    ];
    const included = buildPlaybackPlan(parseTimeline({ semanticSegments }, options).movements, options);
    expect(included.segments.filter(s => s.inference.mobilityClass === 'FLIGHT')).toHaveLength(1);
    const without = { ...options, includeFlights: false };
    const excluded = buildPlaybackPlan(parseTimeline({ semanticSegments }, without).movements, without);
    expect(excluded.segments.some(s => s.hideRoute)).toBe(true);
    expect(excluded.segments.filter(s => s.inference.mobilityClass === 'FLIGHT')).toHaveLength(0);
  });
  it('tapers the AUTO bias to zero continuously on both sides of a flight', () => {
    const plan = simplePlan();
    const first = plan.frames[0];
    if (first.kind !== 'TRAVEL') throw new Error('fixture');
    plan.fps = 60;
    plan.frames = Array.from({ length: 240 }, (_, i): TravelFrame => ({ ...first,
      timeSec: i / 60, zoom: 12, lockedZoom: 12,
      mobilityClass: i >= 90 && i < 150 ? 'FLIGHT' : 'WALK'
    }));
    applyContinuousAutoBias(plan);
    const frames = plan.frames as TravelFrame[];
    expect(frames[100].zoom).toBe(12);
    expect(frames[0].zoom).toBeCloseTo(12.28);
    const steps = frames.slice(1).map((f, i) => Math.abs(f.zoom - frames[i].zoom));
    expect(Math.max(...steps)).toBeLessThan(0.01);
    expect(Math.abs(frames[90].zoom - frames[89].zoom)).toBeLessThan(0.001);
    expect(Math.abs(frames[150].zoom - frames[149].zoom)).toBeLessThan(0.001);
  });
});
