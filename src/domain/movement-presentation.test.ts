import { simplePlan } from '../test/fixtures';
import type { MobilityClass, PlaybackSegment } from '../types';
import { formatMovementDistance, movementDistanceTotals, movementPresentation } from './movement-presentation';
import { parseTimeline } from '../timeline-parser.js';
import { buildPlaybackPlan } from './planner';

function recorded(mobilityClass: MobilityClass): PlaybackSegment {
  const segment = simplePlan().segments[0];
  return { ...segment, inference: { ...segment.inference, mobilityClass } };
}

function gap(distanceMeters = 200, seconds = 0): PlaybackSegment {
  const segment = recorded('UNKNOWN');
  return { ...segment, startMs: 0, endMs: seconds * 1000, distanceMeters, durationSec: seconds,
    avgSpeedKmh: 0, inferred: true, inferenceSource: 'visual-gap', googleType: 'UNKNOWN',
    googleProbability: 0, activityProbability: 0,
    inference: { ...segment.inference, speedKmh: 0, distanceKm: distanceMeters / 1000 } };
}

describe('movement presentation', () => {
  it.each(['WALK', 'BIKE', 'URBAN_TRANSIT', 'ROAD', 'FAST_GROUND', 'FERRY'] as const)(
    'uses matching %s neighbours across a short coordinate gap without changing the plan', mode => {
      const segments = [recorded(mode), gap(), recorded(mode)];
      const original = structuredClone(segments);
      expect(movementPresentation(segments, 1)).toMatchObject({ mobilityClass: mode });
      expect(segments).toEqual(original);
      expect(segments[1].inference.speedKmh).toBe(0);
    }
  );
  it('estimates walking for a nearby transfer between walking and transport', () => {
    expect(movementPresentation([recorded('WALK'), gap(600), recorded('ROAD')], 1))
      .toEqual({ mobilityClass: 'WALK', label: '도보' });
  });
  it('uses time and distance when a gap has a meaningful duration', () => {
    expect(movementPresentation([gap(1500, 1200)], 0))
      .toEqual({ mobilityClass: 'WALK', label: '도보' });
  });
  it.each([0, 1, 12 * 3600])('uses neighbouring transport without inventing speed for a gap lasting %s seconds', seconds => {
    expect(movementPresentation([recorded('WALK'), gap(100_000, seconds), recorded('WALK')], 1))
      .toEqual({ mobilityClass: 'WALK', label: '도보' });
    expect(movementPresentation([gap(100_000, seconds)], 0)).toEqual({ mobilityClass: 'UNKNOWN', label: '이동 중' });
  });
  it.each([false, true])('selects the more similar direction whether it comes before or after (reverse=%s)', reverse => {
    const north = { ...recorded('WALK'), start: { lat: 35, lng: 135 }, end: { lat: 36, lng: 135 } };
    const east = { ...recorded('ROAD'), start: { lat: 35, lng: 135 }, end: { lat: 35, lng: 136 } };
    const connection = { ...gap(10_000), start: east.start, end: east.end };
    expect(movementPresentation(reverse ? [east, connection, north] : [north, connection, east], 1))
      .toEqual({ mobilityClass: 'ROAD', label: '차량' });
  });
  it('falls back to the only known neighbour at a recording boundary', () => {
    expect(movementPresentation([gap(10_000), recorded('FAST_GROUND')], 0).label).toBe('기차');
    expect(movementPresentation([recorded('ROAD'), gap(10_000)], 1).label).toBe('차량');
  });
  it('chooses one of the adjacent transport modes for an ambiguous short transfer', () => {
    const result = movementPresentation([recorded('ROAD'), gap(200), recorded('FAST_GROUND')], 1);
    expect(['ROAD', 'FAST_GROUND']).toContain(result.mobilityClass);
  });
  it('does not restore a flight excluded by the user', () => {
    const segment = { ...gap(500_000, 3600), hideRoute: true };
    expect(movementPresentation([segment], 0)).toEqual({ mobilityClass: 'UNKNOWN', label: '이동 중' });
    expect(movementPresentation([recorded('FLIGHT'), segment, recorded('ROAD')], 1).label).toBe('차량');
  });
  it('shows the transport name without an estimation suffix', () => {
    const segment = recorded('ROAD');
    expect(movementPresentation([segment], 0).label).toBe('차량');
    expect(movementPresentation([{ ...segment, googleType: 'UNKNOWN', inferred: true }], 0).label)
      .toBe('차량');
  });
});

describe('total distance by displayed transport', () => {
  it('combines non-adjacent movements of the same mode without changing their records', () => {
    const segments = [recorded('WALK'), recorded('ROAD'), { ...recorded('WALK'), distanceMeters: 650 }];
    const original = structuredClone(segments);
    expect(movementDistanceTotals(segments)).toEqual(new Map([['WALK', 2650], ['ROAD', 2000]]));
    expect(segments).toEqual(original);
  });

  it('uses the displayed transport for an unclassified movement with usable distance', () => {
    const unknown = { ...gap(600), inferenceSource: 'activity' };
    expect(movementDistanceTotals([recorded('WALK'), unknown, recorded('ROAD')]))
      .toEqual(new Map([['WALK', 2600], ['ROAD', 2000]]));
  });

  it('does not count visual connections, excluded routes or invalid distances', () => {
    const segments = [recorded('WALK'), gap(100_000), { ...recorded('FLIGHT'), hideRoute: true },
      ...[NaN, Infinity, -1].map(distanceMeters => ({ ...recorded('ROAD'), distanceMeters }))];
    expect(movementDistanceTotals(segments)).toEqual(new Map([['WALK', 2000]]));
    expect(movementDistanceTotals([]).size).toBe(0);
  });

  it('counts only the part of a recorded movement inside the selected trip dates', () => {
    const options = { startDate: '2026-04-11', endDate: '2026-04-11', includeFlights: true,
      targetDurationSec: 45, viewportWidth: 1280, viewportHeight: 720,
      cameraMode: 'AUTO' as const, zoomOffset: 0, pacingMode: 'LOCAL_DAYS' as const };
    const trip = parseTimeline({ semanticSegments: [{
      startTime: '2026-04-10T23:30:00+09:00', endTime: '2026-04-11T00:30:00+09:00',
      activity: { start: { latLng: '37.5, 127.0' }, end: { latLng: '37.5, 127.1' },
        distanceMeters: 9000, topCandidate: { type: 'IN_PASSENGER_VEHICLE', probability: 0.95 } }
    }] }, options);
    const plan = buildPlaybackPlan(trip.movements, options);
    expect(movementDistanceTotals(plan.segments).get('ROAD')).toBeCloseTo(4500);
  });

  it('formats short and long distances without splitting numeric units', () => {
    expect([0, 650, 999.9, 2000, 24600, 12345678].map(formatMovementDistance))
      .toEqual(['0 m', '650 m', '1 km', '2 km', '24.6 km', '12,345.7 km']);
  });
});
