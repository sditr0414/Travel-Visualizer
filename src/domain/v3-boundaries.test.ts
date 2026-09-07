import { describe, it, expect } from 'vitest';
import { parseTimeline } from '../timeline-parser.js';
import { smoothPath, pathDistanceMeters, haversineMeters } from '../geo.js';
import { organizeJourneyMedia } from '../media/media-library';
import { simplePlan } from '../test/fixtures';
import type { JourneyMedia } from '../types';

describe('v3 geographic and calendar boundaries', () => {
  it('clips a midnight crossing to the selected calendar day', () => {
    const trip = parseTimeline({ semanticSegments: [{ startTime: '2026-04-10T23:30:00+09:00', endTime: '2026-04-11T00:30:00+09:00', activity: { start: { latLng: '37.5, 127.0' }, end: { latLng: '37.5, 127.1' }, distanceMeters: 9000, topCandidate: { type: 'IN_PASSENGER_VEHICLE' } } }] }, { startDate: '2026-04-11', endDate: '2026-04-11' });
    expect(trip.movements).toHaveLength(1);
    expect(trip.movements[0].startMs).toBe(Date.parse('2026-04-11T00:00:00+09:00'));
    expect(trip.movements[0].durationSec).toBe(1800);
    expect(trip.movements[0].start.lng).toBeCloseTo(127.05, 3);
  });
  it('interpolates across the dateline without crossing the prime meridian', () => {
    const start = { lat: 30, lng: 179 }; const end = { lat: 30, lng: -179 };
    const points = smoothPath([start, end], { maxSegmentMeters: 12000 });
    expect(points.every((point: { lng: number }) => point.lng >= 179 && point.lng <= 181)).toBe(true);
    expect(pathDistanceMeters(points)).toBeLessThan(haversineMeters(start, end) * 1.01);
  });
  it('excludes photos outside the chosen day while retaining early same-day photos', () => {
    const plan = simplePlan(); plan.selectedRange = { startDate: '2026-04-10', endDate: '2026-04-10' };
    const base = { id: 'a', file: null, kind: 'image', title: 'Photo', takenMs: 0, lat: null, lng: null, gpsAccuracyM: null, metadataSource: 'file-time', playbackSec: 0, matchedLat: 37.5, matchedLng: 127, positionSource: 'timeline', groupId: '', groupIndex: 0, groupCount: 1, sourceCount: 1 } as JourneyMedia;
    const items = ['2026-04-09T23:59:00+09:00', '2026-04-10T01:00:00+09:00', '2026-04-11T00:00:00+09:00'].map((date, i) => ({ ...base, id: String(i), takenMs: Date.parse(date) }));
    expect(organizeJourneyMedia(items, plan, 'ALL').map(item => item.id)).toEqual(['1']);
  });
});
