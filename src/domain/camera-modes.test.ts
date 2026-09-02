import { buildPlaybackPlan } from './planner';
import type { AnalysisOptions, Movement } from '../types';

const startMs = Date.parse('2026-03-20T08:00:00+09:00');
const movements: Movement[] = [
  movement(startMs, 30, { lat: 34.69, lng: 135.5 }, { lat: 34.72, lng: 135.55 }, 6, 'IN_SUBWAY'),
  movement(startMs + 60 * 60_000, 20, { lat: 34.72, lng: 135.55 }, { lat: 34.70, lng: 135.48 }, 4, 'WALKING'),
  movement(startMs + 3 * 60 * 60_000, 75, { lat: 34.70, lng: 135.48 }, { lat: 34.40, lng: 132.45 }, 300, 'IN_TRAIN')
];

describe('restored camera modes', () => {
  it('keeps AUTO between day and segment framing variation', () => {
    const day = plan('DAY');
    const auto = plan('AUTO');
    const segment = plan('SEGMENT');
    expect(range(day)).toBeLessThan(range(auto));
    expect(range(auto)).toBeLessThan(range(segment));
  });

  it('clamps zoom offset and keeps automatic zoom velocity controlled', () => {
    const result = plan('AUTO', 9);
    expect(result.zoomOffset).toBe(1.5);
    const frames = result.frames.filter(frame => frame.kind === 'TRAVEL');
    let maxVelocity = 0;
    for (let index = 1; index < frames.length; index += 1) maxVelocity = Math.max(maxVelocity, Math.abs(frames[index].zoom - frames[index - 1].zoom) * result.fps);
    expect(maxVelocity).toBeLessThan(0.8);
    expect(result.autoCloserBias).toBe(0.28);
    expect(result.autoLockedCloserBias).toBe(0.46);
  });

  it('does not repeatedly reverse zoom direction over short intervals', () => {
    const result = plan('AUTO');
    const frames = result.frames.filter(frame => frame.kind === 'TRAVEL');
    const stride = Math.max(1, Math.round(result.fps * 0.25));
    let previousDirection = 0;
    let directionChanges = 0;
    for (let index = stride; index < frames.length; index += stride) {
      const delta = frames[index].zoom - frames[index - stride].zoom;
      if (Math.abs(delta) < 0.015) continue;
      const direction = Math.sign(delta);
      if (previousDirection && direction !== previousDirection) directionChanges += 1;
      previousDirection = direction;
    }
    expect(directionChanges).toBeLessThanOrEqual(2);
  });
});

function plan(cameraMode: AnalysisOptions['cameraMode'], zoomOffset = 0) {
  return buildPlaybackPlan(movements.map(item => ({ ...item, points: item.points.map(point => ({ ...point })) })), {
    startDate: '2026-03-20', endDate: '2026-03-20', includeFlights: true,
    targetDurationSec: 60, viewportWidth: 1100, viewportHeight: 700,
    cameraMode, zoomOffset, pacingMode: 'LOCAL_DAYS'
  });
}

function range(result: ReturnType<typeof plan>): number {
  const values = result.frames.filter(frame => frame.kind === 'TRAVEL').map(frame => frame.modeTargetZoom ?? frame.zoom);
  return Math.max(...values) - Math.min(...values);
}

function movement(start: number, minutes: number, from: Movement['start'], to: Movement['end'], km: number, googleType: string): Movement {
  return {
    startMs: start, endMs: start + minutes * 60_000, start: from, end: to, points: [from, to],
    distanceMeters: km * 1000, durationSec: minutes * 60, avgSpeedKmh: km / (minutes / 60),
    googleType, googleProbability: 0.98, activityProbability: 0.98, inferred: false
  };
}
