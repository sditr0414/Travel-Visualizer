import { buildDayMarkerStops, dayMarkerCueFromId, isDayMarkerId } from './day-markers';
import { simplePlan } from '../test/fixtures';

describe('photo journey day markers', () => {
  it('adds the first active day and each later date change in route time', () => {
    const plan = simplePlan();
    const first = plan.segments[0];
    const second = {
      ...first,
      index: 1,
      startMs: Date.parse('2026-04-10T15:10:00Z'),
      endMs: Date.parse('2026-04-10T15:30:00Z'),
      startVideoSec: 1,
      endVideoSec: 2,
      videoSec: 1,
      sceneId: 1
    };
    plan.segments = [
      {
        ...first,
        startMs: Date.parse('2026-04-10T14:30:00Z'),
        endMs: Date.parse('2026-04-10T14:50:00Z'),
        startVideoSec: 0,
        endVideoSec: 1,
        videoSec: 1
      },
      second
    ];
    const travel = plan.frames[0];
    if (travel.kind !== 'TRAVEL') throw new Error('fixture shape changed');
    plan.frames = [
      { ...travel, timeSec: 0, segmentIndex: 0, sceneId: 0, progress: 0 },
      { ...travel, timeSec: 1, segmentIndex: 1, sceneId: 1, progress: 0 },
      { ...travel, timeSec: 2, segmentIndex: 1, sceneId: 1, progress: 1 },
      { kind: 'OUTRO', timeSec: 3, center: travel.center, position: travel.position, zoom: 9 }
    ];

    const stops = buildDayMarkerStops(plan, 1.8);
    expect(stops).toHaveLength(2);
    expect(stops.map(stop => stop.atSec)).toEqual([0, 1]);
    expect(stops.every(stop => stop.durationSec === 1.8)).toBe(true);
    expect(stops.map(stop => dayMarkerCueFromId(stop.id))).toEqual([
      { dayNumber: 1, dayKey: '2026-04-10' },
      { dayNumber: 2, dayKey: '2026-04-11' }
    ]);
    expect(stops.every(stop => isDayMarkerId(stop.id))).toBe(true);
  });

  it('returns no markers when their display duration is disabled', () => {
    expect(buildDayMarkerStops(simplePlan(), 0)).toEqual([]);
  });
});
