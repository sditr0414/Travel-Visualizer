import { rawMotionProfiles, sampleRawMotion } from '../raw-playback-motion.js';
import { haversineMeters } from '../geo.js';
import { buildPlaybackPlan, connectVisualGaps } from './planner';
import type { Movement, TravelFrame } from '../types';

function segment(start: {lat: number; lng: number}, end: {lat: number; lng: number}, seconds: number, mode = 'ROAD', source = 'raw-position') {
  const distance = haversineMeters(start, end);
  return { start, end, path: { points: [start, end], totalMeters: distance }, videoSec: seconds, sceneId: 0,
    inferenceSource: source, inference: { mobilityClass: mode }, intent: { maxPanPxPerSec: mode === 'WALK' ? 175 : 245 } };
}
const a = { lat: 37.5, lng: 127 }, b = { lat: 37.5, lng: 127.1 }, c = { lat: 37.5, lng: 127.102 };

describe('raw playback boundary motion', () => {
  it('matches speed and pan limits across a fast vehicle to walking boundary without changing endpoints or duration', () => {
    const profiles = rawMotionProfiles([segment(a, b, 3), segment(b, c, 1, 'WALK')]);
    const [before, after] = profiles;
    const epsilon = 1e-5;
    const endSpeed = (sampleRawMotion(before, 3).distance - sampleRawMotion(before, 3 - epsilon).distance) / epsilon;
    const startSpeed = sampleRawMotion(after, epsilon).distance / epsilon;
    expect(endSpeed).toBeCloseTo(startSpeed, 2);
    expect(sampleRawMotion(before, 3).pan).toBe(sampleRawMotion(after, 0).pan);
    for (const profile of profiles) {
      expect(sampleRawMotion(profile, 0).distance).toBe(0);
      expect(sampleRawMotion(profile, profile.duration).distance).toBeCloseTo(profile.distance, 6);
      const samples = Array.from({length: 101}, (_, i) => sampleRawMotion(profile, profile.duration * i / 100).distance);
      expect(samples.every((value, i) => !i || value >= samples[i - 1])).toBe(true);
    }
  });

  it('slows down at a reversal rather than changing direction at cruising speed', () => {
    const [before, after] = rawMotionProfiles([segment(a, b, 3), segment(b, a, 3)]);
    expect(before.endSpeed).toBe(0);
    expect(after.startSpeed).toBe(0);
    expect(sampleRawMotion(before, 3).distance).toBeCloseTo(before.distance, 6);
  });

  it('keeps semantic and flight trajectories unchanged and does not join disconnected endpoints', () => {
    expect(rawMotionProfiles([segment(a, b, 3, 'ROAD', 'semantic')])).toEqual([null]);
    expect(rawMotionProfiles([segment(a, b, 3, 'FLIGHT')])).toEqual([null]);
    const [before, after] = rawMotionProfiles([segment(a, b, 3), segment(c, a, 3)]);
    expect(before.leave).toBe(0);
    expect(after.enter).toBe(0);
  });

  it('gives sub-30m raw gaps camera time while excluding them from the recorded route', () => {
    const raw = (start: typeof a, end: typeof a, index: number): Movement => ({ start, end, points: [start, end],
      startMs: index * 60_000, endMs: (index + 1) * 60_000, durationSec: 60, distanceMeters: haversineMeters(start,end),
      avgSpeedKmh: 10, inferred: true, inferenceSource: 'raw-position', connectionBefore: 'missing-recording',
      googleType: 'UNKNOWN', googleProbability: 0, activityProbability: 0 });
    const nearby = { ...b, lng: b.lng + .00015 };
    const source = [raw(a,b,0), raw(nearby,c,1)];
    const connected = connectVisualGaps(source);
    expect(connected).toHaveLength(3);
    expect(connected[1]).toMatchObject({ hideRoute: true, inferenceSource: 'visual-gap', start: b, end: nearby });
    const plan = buildPlaybackPlan(source, { startDate:'2026-04-10',endDate:'2026-04-10',includeFlights:true,targetDurationSec:45,
      viewportWidth:1440,viewportHeight:900,cameraMode:'AUTO',zoomOffset:0,pacingMode:'LOCAL_DAYS' });
    const travel = plan.frames.filter((f): f is TravelFrame => f.kind === 'TRAVEL');
    expect(travel.some(f => f.segmentIndex === 1)).toBe(true);
    expect(travel.every(f => Number.isFinite(f.zoom) && Number.isFinite(f.position.lng))).toBe(true);
    expect(plan.durationSec).toBeCloseTo(45);
    expect(connectVisualGaps(source.map(m => ({...m, inferenceSource: undefined})))).toHaveLength(2);
  });

  it('preserves monotonic motion for very short raw segments', () => {
    const profiles = rawMotionProfiles([segment(a,b,.04),segment(b,c,.04,'WALK')]);
    for(const profile of profiles) {
      let previous = 0;
      for(let i=0;i<=100;i++) {
        const distance=sampleRawMotion(profile,profile.duration*i/100).distance;
        expect(distance).toBeGreaterThanOrEqual(previous);
        previous=distance;
      }
      expect(previous).toBeCloseTo(profile.distance,6);
    }
  });
});
