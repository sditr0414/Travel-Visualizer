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

describe('Timeline domain', () => {
  it('scans the available date range, recommendation and segment count', () => {
    const result = scanTimeline(parseTimelineJson(validTimeline));
    expect(result).toEqual({
      startDate: '2026-04-10', endDate: '2026-04-10', semanticSegments: 1,
      recommendedRange: { startDate: '2026-04-10', endDate: '2026-04-10' }
    });
  });

  it('recommends the up-to-30-day period with the most meaningful movement', () => {
    const json = parseTimelineJson(JSON.stringify({ semanticSegments: [
      { startTime: '2026-03-01T09:00:00+09:00', endTime: '2026-03-01T10:00:00+09:00', visit: {} },
      { startTime: '2026-03-10T09:00:00+09:00', endTime: '2026-03-10T10:00:00+09:00', activity: { distanceMeters: 3000 } },
      { startTime: '2026-03-11T09:00:00+09:00', endTime: '2026-03-11T10:00:00+09:00', activity: { distanceMeters: 4000 } },
      { startTime: '2026-04-10T09:00:00+09:00', endTime: '2026-04-10T10:00:00+09:00', activity: { distanceMeters: 20000 } },
      { startTime: '2026-04-20T09:00:00+09:00', endTime: '2026-04-20T10:00:00+09:00', activity: { distanceMeters: 22000 } },
      { startTime: '2026-05-01T09:00:00+09:00', endTime: '2026-05-01T10:00:00+09:00', activity: { distanceMeters: 200 } }
    ] }));
    const result = scanTimeline(json);
    expect(result.startDate).toBe('2026-03-01');
    expect(result.endDate).toBe('2026-05-01');
    expect(result.recommendedRange).toEqual({ startDate: '2026-04-10', endDate: '2026-04-20' });
  });

  it('falls back to the full range when no movement clears the noise threshold', () => {
    const json = parseTimelineJson(JSON.stringify({ semanticSegments: [
      { startTime: '2026-03-01T09:00:00+09:00', endTime: '2026-03-01T10:00:00+09:00', activity: { distanceMeters: 200 } },
      { startTime: '2026-03-05T09:00:00+09:00', endTime: '2026-03-05T10:00:00+09:00', visit: {} }
    ] }));
    const result = scanTimeline(json);
    expect(result.recommendedRange).toEqual({ startDate: '2026-03-01', endDate: '2026-03-05' });
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
