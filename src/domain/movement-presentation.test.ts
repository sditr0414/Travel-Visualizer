import { simplePlan } from '../test/fixtures';
import type { MobilityClass, PlaybackSegment } from '../types';
import { formatMovementDistance, movementDistances, movementPresentation, movementSpeed, totalJourneyDistance } from './movement-presentation';
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
  it.each([0, 1, 12 * 3600])('uses neighbouring transport without changing source speed for a gap lasting %s seconds', seconds => {
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

describe('display speed for estimated movements', () => {
  it('preserves the current frame speed for a recorded transport', () => {
    expect(movementSpeed([recorded('ROAD')], 0, 82.4)).toBe('82 km/h');
    expect(movementSpeed([recorded('ROAD')], 0, 0)).toBe('0 km/h');
  });

  it('uses a meaningful time interval without changing the original gap', () => {
    const segments = [gap(1500, 1200)];
    const original = structuredClone(segments);
    expect(movementSpeed(segments, 0, 0)).toBe('5 km/h');
    expect(segments).toEqual(original);
  });

  it.each([0, 1, 12 * 3600])('borrows matching transport speed for an unusable %s-second interval', seconds => {
    const road = recorded('ROAD');
    road.inference.speedKmh = 72;
    expect(movementSpeed([road, gap(10_000, seconds)], 1, 0)).toBe('72 km/h');
  });

  it('borrows from the same neighbour that owns the estimated distance', () => {
    const previous = recorded('WALK'); previous.inference.speedKmh = 4;
    const next = { ...recorded('WALK'), distanceMeters: 300 }; next.inference.speedKmh = 6;
    const segments = [previous, gap(200), next];
    expect(movementDistances(segments)).toEqual(['2 km', '500 m', '500 m']);
    expect(movementSpeed(segments, 1, 0)).toBe('6 km/h');
  });

  it('rejects a gap speed that is implausible for its displayed transport', () => {
    const walk = recorded('WALK'); walk.inference.speedKmh = 4;
    expect(movementSpeed([walk, gap(600, 60), recorded('ROAD')], 1, 0)).toBe('4 km/h');
  });

  it('does not borrow the speed of a different transport', () => {
    const road = recorded('ROAD'); road.inference.speedKmh = 80;
    const walk = recorded('WALK'); walk.inference.speedKmh = 5;
    expect(movementSpeed([road, gap(600), walk], 1, 0)).toBe('5 km/h');
  });

  it('uses the matching movement’s distance and time if its stored speed is missing', () => {
    const road = recorded('ROAD'); road.inference.speedKmh = 0;
    expect(movementSpeed([road, gap(200)], 1, 0)).toBe('12 km/h');
  });

  it('keeps missing and excluded movements from producing invalid speeds', () => {
    expect(movementSpeed([gap(200)], 0, 0)).toBe('—');
    expect(movementSpeed([gap(NaN, 600)], 0, NaN)).toBe('—');
    expect(movementSpeed([recorded('ROAD'), { ...gap(500_000, 3600), hideRoute: true }], 1, 0)).toBe('—');
  });
});

describe('whole journey distance', () => {
  it('includes assigned gaps exactly once while retaining separate movement displays', () => {
    const segments = [recorded('WALK'), gap(200), { ...recorded('WALK'), distanceMeters: 300 }];
    expect(movementDistances(segments)).toEqual(['2 km', '500 m', '500 m']);
    expect(totalJourneyDistance(segments)).toBe('2.5 km');
  });

  it('excludes hidden flights and invalid distances from the whole journey', () => {
    const segments = [recorded('WALK'), { ...recorded('FLIGHT'), hideRoute: true },
      { ...gap(500_000), hideRoute: true },
      ...[NaN, Infinity, -1].map(distanceMeters => ({ ...recorded('ROAD'), distanceMeters }))];
    expect(totalJourneyDistance(segments)).toBe('2 km');
  });

  it('distinguishes missing distance from a known zero distance', () => {
    expect(totalJourneyDistance([])).toBeNull();
    expect(totalJourneyDistance([{ ...recorded('WALK'), distanceMeters: 0 }])).toBe('0 m');
  });
});

describe('individual movement distance', () => {
  it('keeps separate distances for movements of the same mode without changing their records', () => {
    const segments = [recorded('WALK'), recorded('ROAD'), { ...recorded('WALK'), distanceMeters: 650 }];
    const original = structuredClone(segments);
    expect(movementDistances(segments)).toEqual(['2 km', '2 km', '650 m']);
    expect(segments).toEqual(original);
  });

  it('adds an estimated movement to the matching preceding movement', () => {
    const unknown = { ...gap(600), inferenceSource: 'activity' };
    expect(movementDistances([recorded('WALK'), unknown, recorded('ROAD')])).toEqual(['2.6 km', '2.6 km', '2 km']);
  });

  it('adds a visual gap to the matching following movement while keeping recorded speed unchanged', () => {
    const segments = [recorded('ROAD'), gap(600), recorded('WALK')];
    expect(movementDistances(segments)).toEqual(['2 km', '2.6 km', '2.6 km']);
    expect(segments[1].inference.speedKmh).toBe(0);
  });

  it('assigns a gap only once when both neighbours use the same transport', () => {
    expect(movementDistances([recorded('WALK'), gap(200), recorded('WALK')]))
      .toEqual(['2.2 km', '2.2 km', '2 km']);
    expect(movementDistances([recorded('WALK'), gap(200), { ...recorded('WALK'), distanceMeters: 300 }]))
      .toEqual(['2 km', '500 m', '500 m']);
  });

  it('combines estimated gaps on both sides with their individual movement', () => {
    expect(movementDistances([gap(200), recorded('ROAD'), gap(300)]))
      .toEqual(['2.5 km', '2.5 km', '2.5 km']);
  });

  it('keeps a separately inferred movement independent when neither neighbour matches', () => {
    expect(movementDistances([recorded('ROAD'), gap(1500, 1200), recorded('FERRY')]))
      .toEqual(['2 km', '1.5 km', '2 km']);
  });

  it('hides distances for excluded routes and invalid values', () => {
    const segments = [recorded('WALK'), { ...gap(100_000), hideRoute: true }, { ...recorded('FLIGHT'), hideRoute: true },
      ...[NaN, Infinity, -1].map(distanceMeters => ({ ...recorded('ROAD'), distanceMeters }))];
    expect(movementDistances(segments)).toEqual(['2 km', null, null, null, null, null]);
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
    expect(movementDistances(plan.segments)).toEqual(['4.5 km']);
  });

  it('formats short and long distances without splitting numeric units', () => {
    expect([0, 650, 999.9, 2000, 24600, 12345678].map(formatMovementDistance))
      .toEqual(['0 m', '650 m', '1 km', '2 km', '24.6 km', '12,345.7 km']);
  });
});
