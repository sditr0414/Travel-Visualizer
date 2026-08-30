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
  it('scans the available date range and segment count', () => {
    const result = scanTimeline(parseTimelineJson(validTimeline));
    expect(result).toEqual({ startDate: '2026-04-10', endDate: '2026-04-10', semanticSegments: 1 });
  });

  it('keeps the existing parser behavior behind the typed boundary', () => {
    const json = parseTimelineJson(validTimeline);
    const trip = buildParsedTrip(json, { startDate: '2026-04-10', endDate: '2026-04-10' }, true);
    expect(trip.movements).toHaveLength(1);
    expect(trip.movements[0].googleType).toBe('WALKING');
    expect(trip.routePoints.length).toBeGreaterThan(1);
  });

  it.each(['not json', '{}', '{"semanticSegments":[]}'])(
    'rejects invalid or empty Timeline input',
    value => expect(() => parseTimelineJson(value)).toThrow()
  );
});
