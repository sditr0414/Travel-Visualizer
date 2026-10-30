import { parseTimelineJson, scanTimeline, buildParsedTrip } from './timeline';
import { buildPlaybackPlan, connectVisualGaps } from './planner';
import { visibleDistanceMeters } from './movement-presentation';
import type { AnalysisOptions, PlaybackSegment } from '../types';

const range = { startDate: '2026-04-10', endDate: '2026-04-10' };
const options: AnalysisOptions = { ...range, includeFlights: true, targetDurationSec: 30, viewportWidth: 1280, viewportHeight: 720, cameraMode: 'AUTO', zoomOffset: 0, pacingMode: 'LOCAL_DAYS' };
const time = (minutes: number) => new Date(Date.parse('2026-04-10T09:00:00+09:00') + minutes * 60_000).toISOString();
const position = (minutes: number, lat = 37.5 + minutes * .001, lng = 127, accuracyMeters = 10) => ({ position: { LatLng: `${lat}°, ${lng}°`, timestamp: time(minutes), accuracyMeters } });
const parse = (rawSignals: unknown[], extra = {}) => parseTimelineJson(JSON.stringify({ rawSignals, ...extra }));
const trip = (rawSignals: unknown[]) => buildParsedTrip(parse(rawSignals), range, true);

describe('raw position Timeline imports', () => {
  it('opens raw-only files, ignores non-position signals, sorts samples and builds finite playback frames', () => {
    const json = parse([position(10), { wifiScan: {} }, position(0), { activityRecord: { timestamp: time(5), probableActivities: [{ type: 'FLYING', confidence: 1 }] } }, position(5)]);
    expect(scanTimeline(json)).toMatchObject({ ...range, semanticSegments: 0, rawPositions: 3 });
    const parsed = buildParsedTrip(json, range, true);
    expect(parsed.movements).toHaveLength(1);
    expect(parsed.movements[0]).toMatchObject({ googleType: 'UNKNOWN', googleProbability: 0, inferred: true, inferenceSource: 'raw-position' });
    expect(parsed.movements[0].startMs).toBe(Date.parse(time(0)));
    expect(parsed.movements[0].endMs).toBe(Date.parse(time(10)));
    const plan = buildPlaybackPlan(parsed.movements, options);
    expect(plan.frames.some(frame => frame.kind === 'TRAVEL')).toBe(true);
    expect(plan.frames.every(frame => Number.isFinite(frame.zoom))).toBe(true);
  });

  it('prefers semantic activities in mixed files and falls back for an empty semantic array', () => {
    const semanticSegments = [{ startTime: time(0), endTime: time(10), activity: { start: { latLng: '37.5, 127' }, end: { latLng: '37.51, 127' }, topCandidate: { type: 'WALKING', probability: .95 } } }];
    const mixed = parse([position(0, 1), position(10, 2)], { semanticSegments });
    expect(mixed.semanticSegments).toEqual(semanticSegments);
    expect(scanTimeline(mixed).rawPositions).toBeUndefined();
    expect(buildParsedTrip(mixed, range, true).movements[0].googleType).toBe('WALKING');
    expect(scanTimeline(parse([position(0), position(10)], { semanticSegments: [] })).rawPositions).toBe(2);
  });

  it('rejects bad coordinates, dates and accuracy, and chooses the best same-time fix', () => {
    const json = parse([null, {}, position(0), position(5, 37.505, 127, 150), position(5, 37.506, 127, 5),
      position(6, 91), { position: { LatLng: '37.5, 127', timestamp: 'invalid' } }, position(7, 37.5, 127, -1), position(8, 37.5, 127, 201), position(10)]);
    expect(scanTimeline(json).rawPositions).toBe(3);
    expect(buildParsedTrip(json, range, true).movements[0].points.some(p => Math.abs(p.lat - 37.506) < .00001)).toBe(true);
  });

  it('removes an isolated impossible jump without losing the valid samples after it', () => {
    const json = parse([position(0), position(5, 0, 0), position(10), position(15)]);
    expect(scanTimeline(json).rawPositions).toBe(3);
    const parsed = buildParsedTrip(json, range, true);
    expect(parsed.movements).toHaveLength(1);
    expect(parsed.movements[0].distanceMeters).toBeLessThan(2000);
  });

  it('does not paint or count long gaps and implausible adjacent jumps as recorded paths', () => {
    for (const samples of [
      [position(0), position(5), position(90, 38), position(95, 38.01)],
      [position(0), position(5), position(5.1, 0, 0), position(10, .01, 0)]
    ]) {
      const parsed = trip(samples);
      expect(parsed.movements).toHaveLength(2);
      const connected = connectVisualGaps(parsed.movements);
      expect(connected).toHaveLength(3);
      expect(connected[1]).toMatchObject({ hideRoute: true, inferenceSource: 'visual-gap' });
      expect(visibleDistanceMeters(connected[1] as PlaybackSegment)).toBeNull();
      expect(parsed.movements.reduce((sum, m) => sum + m.distanceMeters, 0)).toBeLessThan(3000);
    }
  });

  it('ignores stationary jitter and gives a useful error for unusable recordings', () => {
    expect(() => parse([position(0), position(5, 37.500001)])).toThrow('재생할 이동 경로가 없습니다');
    expect(() => parse([{ wifiScan: {} }, position(0)])).toThrow('두 개 이상');
    expect(() => parse([position(0, 91), position(10, 92)])).toThrow('위치·시각 기록이 부족');
  });

  it('clips ranges in Korean time and retains source time for photo matching', () => {
    const json = parse([position(895, 37.5), position(905, 37.51)]); // 23:55–00:05 KST
    const parsed = buildParsedTrip(json, range, true);
    expect(scanTimeline(json)).toMatchObject({ startDate: range.startDate, endDate: '2026-04-11' });
    expect(parsed.movements[0].endMs).toBe(Date.parse('2026-04-11T00:00:00+09:00'));
    expect(parsed.movements[0].distanceMeters).toBeGreaterThan(500);
    expect(parsed.movements[0].distanceMeters).toBeLessThan(600);
    expect(parsed.movements[0].points.at(-1)?.timeMs).toBe(parsed.movements[0].endMs);
    expect(buildParsedTrip(json, { startDate: '2027-01-01', endDate: '2027-01-01' }, true).movements).toEqual([]);
  });

  it('keeps dateline paths short and continuous between raw segments', () => {
    const parsed = trip([position(0, 0, 179.9), position(15, 0, -179.9), position(30, 0, -179.8), position(45, 0, -179.7)]);
    expect(parsed.movements.length).toBeGreaterThan(1);
    expect(parsed.movements.reduce((sum, m) => sum + m.distanceMeters, 0)).toBeLessThan(50_000);
    expect(parsed.routePoints.every(p => p.lng > 179 && p.lng < 181)).toBe(true);
  });

  it('honours flight exclusion for strongly flight-like measured tracks', () => {
    const json = parse([position(0, 0, 0), position(15, 0, 2), position(30, 0, 4)]);
    expect(buildParsedTrip(json, range, true).movements).toHaveLength(1);
    expect(buildParsedTrip(json, range, false).movements).toEqual([]);
  });

  it('keeps flight exclusion when the selected day contains only a short tail of the flight', () => {
    const json = parse([position(871, 0, 0), position(901, 0, 4)]);
    const nextDay = { startDate: '2026-04-11', endDate: '2026-04-11' };
    expect(buildParsedTrip(json, nextDay, true).movements).toHaveLength(1);
    expect(buildParsedTrip(json, nextDay, false).movements).toEqual([]);
  });

  it('accepts an optional UTF-8 BOM', () => {
    expect(scanTimeline(parseTimelineJson('\uFEFF' + JSON.stringify({ rawSignals: [position(0), position(5)] }))).rawPositions).toBe(2);
  });
});
