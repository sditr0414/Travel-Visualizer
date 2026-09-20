import { buildJourneySummary } from './journey-summary';
import { simplePlan } from '../test/fixtures';
import type { MobilityClass, PlaybackSegment } from '../types';

function movement(mobilityClass: MobilityClass, distanceMeters: number): PlaybackSegment {
  const segment = simplePlan().segments[0];
  return { ...segment, distanceMeters, inference: { ...segment.inference, mobilityClass } };
}

describe('journey summary', () => {
  it('counts each raw distance once, including a gap under its displayed mode', () => {
    const plan = simplePlan();
    plan.segments = [movement('WALK', 1800),
      { ...movement('UNKNOWN', 200), endMs: plan.segments[0].startMs, inferenceSource: 'visual-gap' },
      movement('WALK', 1000), movement('ROAD', 7000)];
    const original = structuredClone(plan);
    const summary = buildJourneySummary(plan);
    expect(summary.distanceMeters).toBe(10000);
    expect(summary.movements).toEqual([
      { mobilityClass: 'ROAD', distanceMeters: 7000, share: 0.7 },
      { mobilityClass: 'WALK', distanceMeters: 3000, share: 0.3 }
    ]);
    expect(plan).toEqual(original);
  });

  it('excludes hidden flights and invalid distances from totals and proportions', () => {
    const plan = simplePlan();
    plan.segments = [movement('WALK', 1800), { ...movement('FLIGHT', 200000), hideRoute: true },
      ...[NaN, Infinity, -1].map(distance => movement('ROAD', distance))];
    expect(buildJourneySummary(plan)).toMatchObject({ distanceMeters: 1800,
      movements: [{ mobilityClass: 'WALK', distanceMeters: 1800, share: 1 }] });
  });

  it('distinguishes absent distances from known zero distances without dividing by zero', () => {
    const plan = simplePlan();
    plan.segments = [];
    expect(buildJourneySummary(plan)).toEqual({ period: null, distanceMeters: null, movements: [] });
    plan.segments = [movement('WALK', 0)];
    expect(buildJourneySummary(plan)).toMatchObject({ distanceMeters: 0,
      movements: [{ mobilityClass: 'WALK', distanceMeters: 0, share: 0 }] });
  });

  it('uses the applied date range, including days without movement and leap days', () => {
    const plan = simplePlan();
    plan.selectedRange = { startDate: '2024-02-28', endDate: '2024-03-01' };
    expect(buildJourneySummary(plan).period).toEqual({ ...plan.selectedRange, days: 3 });
    plan.selectedRange = { startDate: '2026-12-31', endDate: '2027-01-01' };
    expect(buildJourneySummary(plan).period?.days).toBe(2);
  });

  it('falls back to Seoul calendar dates and counts both the first and last day', () => {
    const plan = simplePlan();
    plan.segments[0].startMs = Date.parse('2026-04-10T14:50:00Z');
    plan.segments[0].endMs = Date.parse('2026-04-10T15:10:00Z');
    expect(buildJourneySummary(plan).period).toEqual({ startDate: '2026-04-10', endDate: '2026-04-11', days: 2 });
    plan.segments[0].startMs = Date.parse('2026-04-10T15:00:00Z');
    expect(buildJourneySummary(plan).period?.days).toBe(1);
  });
});
