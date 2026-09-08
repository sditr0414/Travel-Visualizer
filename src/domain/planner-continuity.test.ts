import { buildPlaybackPlan, connectVisualGaps } from './planner';
import type { AnalysisOptions, Movement, TravelFrame } from '../types';

function movement(startMs: number, endMs: number, start: { lat: number; lng: number }, end: { lat: number; lng: number }): Movement {
  const durationSec = Math.max(1, (endMs - startMs) / 1000);
  return {
    startMs,
    endMs,
    start,
    end,
    points: [start, end],
    distanceMeters: 1_000,
    durationSec,
    avgSpeedKmh: 10,
    googleType: 'WALKING',
    googleProbability: 0.9,
    activityProbability: 0.9,
    inferred: false
  };
}

const options: AnalysisOptions = {
  startDate: '2026-03-20',
  endDate: '2026-03-20',
  includeFlights: true,
  targetDurationSec: 60,
  viewportWidth: 1200,
  viewportHeight: 720,
  cameraMode: 'AUTO',
  zoomOffset: 0,
  pacingMode: 'LOCAL_DAYS'
};

describe('planner recording-gap continuity', () => {
  it('adds an inferred bridge for nearby consecutive coordinate disagreement', () => {
    const first = movement(
      Date.parse('2026-03-20T10:00:00+09:00'),
      Date.parse('2026-03-20T10:10:00+09:00'),
      { lat: 35.0, lng: 135.0 },
      { lat: 35.01, lng: 135.01 }
    );
    const second = movement(
      first.endMs,
      Date.parse('2026-03-20T10:20:00+09:00'),
      { lat: 35.02, lng: 135.02 },
      { lat: 35.03, lng: 135.03 }
    );

    const connected = connectVisualGaps([first, second]);
    expect(connected).toHaveLength(3);
    expect(connected[1]).toMatchObject({
      inferred: true,
      inferenceSource: 'visual-gap',
      start: first.end,
      end: second.start
    });
    expect(connected[1].points.length).toBeGreaterThan(2);
    expect(connected[1].durationSec).toBeGreaterThan(0);
  });

  it('plans a continuous travel scene through a bridged recording gap', () => {
    const first = movement(
      Date.parse('2026-03-20T10:00:00+09:00'),
      Date.parse('2026-03-20T10:10:00+09:00'),
      { lat: 35.0, lng: 135.0 },
      { lat: 35.01, lng: 135.01 }
    );
    const second = movement(
      first.endMs,
      Date.parse('2026-03-20T10:20:00+09:00'),
      { lat: 35.02, lng: 135.02 },
      { lat: 35.03, lng: 135.03 }
    );

    const plan = buildPlaybackPlan([first, second], options);
    expect(plan.segments).toHaveLength(3);
    expect(plan.segments[1].inferenceSource).toBe('visual-gap');
    expect(plan.segments[0].end).toEqual(plan.segments[1].start);
    expect(plan.segments[1].end).toEqual(plan.segments[2].start);

    const travel = plan.frames.filter((frame): frame is TravelFrame => frame.kind === 'TRAVEL');
    const sceneIds = new Set(travel.map(frame => frame.sceneId));
    expect(sceneIds.size).toBe(1);
    expect(travel.some(frame => frame.segmentIndex === 1)).toBe(true);
  });

  it('does not fabricate a nearby bridge for a very large discontinuity', () => {
    const first = movement(0, 60_000, { lat: 35, lng: 135 }, { lat: 35.01, lng: 135.01 });
    const second = movement(60_000, 120_000, { lat: 36, lng: 136 }, { lat: 36.01, lng: 136.01 });
    expect(connectVisualGaps([first, second])).toHaveLength(2);
  });
});
