import { simplePlan } from '../test/fixtures';
import type { MobilityClass, PlaybackSegment } from '../types';
import { movementPresentation } from './movement-presentation';

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
