import { buildParsedTrip, parseTimelineJson, scanTimeline } from './timeline';

const validTimeline = JSON.stringify({
  semanticSegments: [{
    startTime: '2026-04-10T09:00:00+09:00',
    endTime: '2026-04-10T09:30:00+09:00',
    activity: {
      start: { latLng: '37.5000°, 127.0000°' },
      end: { latLng: '37.5100°, 127.0100°' },
      distanceMeters: 1800,
      topCandidate: { type: 'WALKING', probability: 0.9 },
      probability: 0.9
    }
  }]
});

function visit(startTime: string, endTime: string, latLng: string) {
  return {
    startTime,
    endTime,
    visit: { topCandidate: { placeLocation: { latLng } } }
  };
}

function activity(startTime: string, endTime: string, from: string, to: string, distanceMeters: number) {
  return {
    startTime,
    endTime,
    activity: {
      start: { latLng: from },
      end: { latLng: to },
      distanceMeters
    }
  };
}

describe('Timeline domain', () => {
  it('scans the available date range and keeps the full range when no travel candidate is clear', () => {
    const result = scanTimeline(parseTimelineJson(validTimeline));
    expect(result).toEqual({
      startDate: '2026-04-10', endDate: '2026-04-10', semanticSegments: 1,
      recommendedRange: { startDate: '2026-04-10', endDate: '2026-04-10' },
      tripCandidates: []
    });
  });

  it('detects multiple trips away from the inferred home area and adds broad destination hints', () => {
    const seoul = '37.5665°, 126.9780°';
    const jeju = '33.3617°, 126.5292°';
    const gangneung = '37.7519°, 128.8761°';
    const tokyo = '35.6762°, 139.6503°';
    const json = parseTimelineJson(JSON.stringify({ semanticSegments: [
      visit('2026-01-01T20:00:00+09:00', '2026-01-02T07:00:00+09:00', seoul),
      visit('2026-01-05T20:00:00+09:00', '2026-01-06T07:00:00+09:00', seoul),
      visit('2026-01-10T20:00:00+09:00', '2026-01-11T07:00:00+09:00', seoul),

      activity('2026-04-10T08:00:00+09:00', '2026-04-10T10:00:00+09:00', seoul, jeju, 460000),
      visit('2026-04-10T11:00:00+09:00', '2026-04-10T20:00:00+09:00', jeju),
      visit('2026-04-11T09:00:00+09:00', '2026-04-11T20:00:00+09:00', jeju),
      activity('2026-04-12T17:00:00+09:00', '2026-04-12T19:00:00+09:00', jeju, seoul, 460000),

      activity('2026-05-02T08:00:00+09:00', '2026-05-02T11:00:00+09:00', seoul, gangneung, 190000),
      visit('2026-05-02T12:00:00+09:00', '2026-05-02T21:00:00+09:00', gangneung),
      visit('2026-05-03T09:00:00+09:00', '2026-05-03T20:00:00+09:00', gangneung),
      activity('2026-05-04T15:00:00+09:00', '2026-05-04T18:00:00+09:00', gangneung, seoul, 190000),

      activity('2026-07-01T07:00:00+09:00', '2026-07-01T11:00:00+09:00', seoul, tokyo, 1150000),
      visit('2026-07-01T12:00:00+09:00', '2026-07-01T21:00:00+09:00', tokyo),
      visit('2026-07-02T09:00:00+09:00', '2026-07-02T21:00:00+09:00', tokyo),
      activity('2026-07-03T14:00:00+09:00', '2026-07-03T18:00:00+09:00', tokyo, seoul, 1150000)
    ] }));

    const result = scanTimeline(json);
    expect(result.tripCandidates).toHaveLength(3);
    expect(result.tripCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ startDate: '2026-04-10', endDate: '2026-04-12', destinationHint: '제주도' }),
      expect.objectContaining({ startDate: '2026-05-02', endDate: '2026-05-04', destinationHint: '강릉' }),
      expect.objectContaining({ startDate: '2026-07-01', endDate: '2026-07-03', destinationHint: '일본' })
    ]));
    expect(result.recommendedRange).toEqual({ startDate: '2026-07-01', endDate: '2026-07-03' });
    expect(result.tripCandidates?.every(candidate => candidate.representativeCoordinate)).toBe(true);
  });

  it('falls back to the full range when local movement does not look like a trip', () => {
    const json = parseTimelineJson(JSON.stringify({ semanticSegments: [
      { startTime: '2026-03-01T09:00:00+09:00', endTime: '2026-03-01T10:00:00+09:00', activity: { distanceMeters: 200 } },
      { startTime: '2026-03-05T09:00:00+09:00', endTime: '2026-03-05T10:00:00+09:00', visit: {} }
    ] }));
    const result = scanTimeline(json);
    expect(result.recommendedRange).toEqual({ startDate: '2026-03-01', endDate: '2026-03-05' });
    expect(result.tripCandidates).toEqual([]);
  });

  it('keeps the existing parser behavior behind the typed boundary', () => {
    const json = parseTimelineJson(validTimeline);
    const trip = buildParsedTrip(json, { startDate: '2026-04-10', endDate: '2026-04-10' }, true);
    expect(trip.movements).toHaveLength(1);
    expect(trip.movements[0].googleType).toBe('WALKING');
    expect(trip.routePoints.length).toBeGreaterThan(1);
  });

  it('keeps the full data range separate from the selected trip range', () => {
    const json = parseTimelineJson(validTimeline);
    const trip = buildParsedTrip(
      json,
      { startDate: '2026-04-10', endDate: '2026-04-10' },
      true,
      { startDate: '2026-03-01', endDate: '2026-05-01' }
    );
    expect(trip.availableRange).toEqual({ startDate: '2026-03-01', endDate: '2026-05-01' });
  });

  it.each(['not json', '{}', '{"semanticSegments":[]}'])(
    'rejects invalid or empty Timeline input',
    value => expect(() => parseTimelineJson(value)).toThrow()
  );
});
