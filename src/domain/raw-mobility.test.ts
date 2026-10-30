import { parseTimelineJson, buildParsedTrip } from './timeline';
import { readRawActivities } from './raw-mobility';
import { inferMobility } from '../mobility.js';
import { pathDistanceMeters } from '../geo.js';

const range = { startDate: '2026-04-10', endDate: '2026-04-10' };
const time = (minutes: number) => new Date(Date.parse('2026-04-10T09:00:00+09:00') + minutes * 60_000).toISOString();
const activity = (minute: number, type: string, confidence = .95, other: Array<{ type: string; confidence: number }> = []) => ({ activityRecord: {
  timestamp: time(minute), probableActivities: [{ type, confidence }, ...other]
} });
const track = (minutes: number, kmh: number, offset = 0) => Array.from({ length: minutes + 1 }, (_, minute) => ({ position: {
  LatLng: `${37.5 + minute * kmh / 60 / 111.195}, 127`, timestamp: time(minute + offset), accuracyMeters: 5
} }));
const sensors = (minutes: number, type: string, offset = 0) => Array.from({ length: minutes * 2 + 1 }, (_, i) => activity(i / 2 + offset, type));
const trip = (rawSignals: unknown[]) => buildParsedTrip(parseTimelineJson(JSON.stringify({ rawSignals })), range, true);
const modes = (rawSignals: unknown[]) => trip(rawSignals).movements.map(m => inferMobility(m).mobilityClass);
const uniqueRuns = (values: string[]) => values.filter((value, index) => !index || value !== values[index - 1]);

describe('raw transport evidence', () => {
  it('uses specific rail/road candidates without counting overlapping parent labels or repeated candidates', () => {
    const evidence = readRawActivities([
      activity(0, 'IN_VEHICLE', .95, [{ type: 'IN_RAIL_VEHICLE', confidence: .95 }, ...Array(10).fill({ type: 'IN_ROAD_VEHICLE', confidence: .2 })]),
      activity(1, 'ON_FOOT', .9, [{ type: 'WALKING', confidence: .9 }]),
      activity(2, 'IN_ROAD_VEHICLE', .9),
      activity(3, 'IN_RAIL_VEHICLE', .9, [{ type: 'IN_ROAD_VEHICLE', confidence: .9 }]),
      activity(4, 'IN_RAIL_VEHICLE', 2), activity(5, 'ON_BICYCLE', .4)
    ]);
    expect(evidence.map(a => a.mode)).toEqual(['FAST_GROUND', 'WALK', 'ROAD']);
  });

  it('keeps slow rail and stop-heavy road travel out of the bicycle category', () => {
    for (const [sensor, expected] of [['IN_RAIL_VEHICLE', 'FAST_GROUND'], ['IN_ROAD_VEHICLE', 'ROAD']]) {
      const parsed = trip([...track(25, 12), ...sensors(25, sensor)]);
      expect(new Set(parsed.movements.map(m => inferMobility(m).mobilityClass))).toEqual(new Set([expected]));
      expect(parsed.movements.every(m => m.googleType === 'UNKNOWN' && m.googleProbability === 0 && m.inferred)).toBe(true);
    }
    expect(new Set(modes([...track(15, 16), ...sensors(15, 'ON_BICYCLE')]))).toEqual(new Set(['BIKE']));
  });

  it('splits sustained walk → rail → road → walk transfers while preserving distance and source time', () => {
    const signals: unknown[] = [];
    let latitude = 37.5;
    for (let minute = 0; minute <= 28; minute++) {
      const mode = minute < 6 ? 'WALKING' : minute < 15 ? 'IN_RAIL_VEHICLE' : minute < 23 ? 'IN_ROAD_VEHICLE' : 'WALKING';
      const speed = minute < 6 || minute >= 23 ? 5 : minute < 15 ? 45 : 25;
      if (minute) latitude += speed / 60 / 111.195;
      signals.push({ position: { LatLng: `${latitude}, 127`, timestamp: time(minute), accuracyMeters: 5 } });
      signals.push(activity(minute, mode), activity(minute + .5, mode));
    }
    const parsed = trip(signals);
    expect(uniqueRuns(parsed.movements.map(m => inferMobility(m).mobilityClass))).toEqual(['WALK', 'FAST_GROUND', 'ROAD', 'WALK']);
    expect(parsed.movements[0].startMs).toBe(Date.parse(time(0)));
    expect(parsed.movements.at(-1)!.endMs).toBe(Date.parse(time(28)));
    for (let i = 1; i < parsed.movements.length; i++) {
      expect(parsed.movements[i].startMs).toBe(parsed.movements[i - 1].endMs);
      expect(parsed.movements[i].start.lat).toBeCloseTo(parsed.movements[i - 1].end.lat, 10);
      expect(parsed.movements[i].start.lng).toBeCloseTo(parsed.movements[i - 1].end.lng, 10);
    }
    const withoutSensors = trip(signals.filter(s => 'position' in (s as object)));
    expect(parsed.movements.reduce((sum, m) => sum + m.distanceMeters, 0)).toBeCloseTo(withoutSensors.movements[0].distanceMeters, 4);
    expect(pathDistanceMeters(parsed.routePoints)).toBeGreaterThan(0);
  });

  it('does not flicker for a short false bicycle signal or duplicated sensor packet', () => {
    const reports = sensors(20, 'IN_RAIL_VEHICLE').filter(s => s.activityRecord.timestamp !== time(10));
    reports.push(...Array(100).fill(activity(10, 'ON_BICYCLE')));
    expect(new Set(modes([...track(20, 16), ...reports]))).toEqual(new Set(['FAST_GROUND']));
    const duplicate = Array(100).fill(activity(10, 'ON_BICYCLE'));
    expect(new Set(modes([...track(20, 16), ...duplicate]))).toEqual(new Set(['ROAD']));
  });

  it('does not carry transport evidence through a long recording gap or invent bicycles without sensors', () => {
    expect(new Set(modes(track(20, 16)))).toEqual(new Set(['ROAD']));
    const parsed = trip([...track(15, 16), ...sensors(15, 'IN_RAIL_VEHICLE'), ...track(15, 16, 90)]);
    expect(inferMobility(parsed.movements[0]).mobilityClass).toBe('FAST_GROUND');
    expect(inferMobility(parsed.movements.at(-1)!).mobilityClass).toBe('ROAD');
  });

  it('rejects sensor modes that contradict measured speed and preserves flight exclusion', () => {
    const signals = [...track(15, 700), ...sensors(15, 'WALKING')];
    const json = parseTimelineJson(JSON.stringify({ rawSignals: signals }));
    expect(new Set(buildParsedTrip(json, range, true).movements.map(m => inferMobility(m).mobilityClass))).toEqual(new Set(['FLIGHT']));
    expect(buildParsedTrip(json, range, false).movements).toEqual([]);
  });

  it('preserves sensor evidence when clipping a journey to a selected day', () => {
    const signals = [...track(20, 12, 890), ...sensors(20, 'IN_RAIL_VEHICLE', 890)];
    const parsed = trip(signals);
    expect(parsed.movements.at(-1)!.endMs).toBe(Date.parse('2026-04-11T00:00:00+09:00'));
    expect(new Set(parsed.movements.map(m => inferMobility(m).mobilityClass))).toEqual(new Set(['FAST_GROUND']));
  });
});
