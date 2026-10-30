import { clamp, haversineMeters, mercatorProject } from './geo.js';

/** Keep the existing segment clock and path; only ease distance travelled near raw boundaries. */
export function rawMotionProfiles(segments) {
  const rawGround = segment => segment?.inferenceSource === 'raw-position' && segment.inference.mobilityClass !== 'FLIGHT';
  const enabled = segments.map((segment, index) => rawGround(segment)
    || segment.inferenceSource === 'visual-gap' && (rawGround(segments[index - 1]) || rawGround(segments[index + 1])));
  const speeds = segments.map(segment => segment.path.totalMeters / Math.max(segment.videoSec, 1e-6));
  const joins = segments.slice(1).map((segment, index) => {
    const before = segments[index];
    if (!enabled[index] || !enabled[index + 1] || before.sceneId !== segment.sceneId || haversineMeters(before.end, segment.start) > 1) return null;
    const incoming = direction(before.path.points, false), outgoing = direction(segment.path.points, true);
    const alignment = clamp(incoming.x * outgoing.x + incoming.y * outgoing.y, -1, 1);
    // Slow at a genuine turn, rather than reversing the marker at full speed.
    const turnFactor = clamp((alignment - .5) / .5, 0, 1);
    const speed = 2 * speeds[index] * speeds[index + 1] / Math.max(speeds[index] + speeds[index + 1], 1e-6) * turnFactor;
    return { speed, pan: (before.intent.maxPanPxPerSec + segment.intent.maxPanPxPerSec) / 2 };
  });
  return segments.map((segment, index) => {
    if (!enabled[index]) return null;
    const duration = segment.videoSec;
    const before = joins[index - 1], after = joins[index];
    const enter = before ? Math.min(.22, duration * .25) : 0;
    const leave = after ? Math.min(.22, duration * .25) : 0;
    const startSpeed = before?.speed ?? speeds[index], endSpeed = after?.speed ?? speeds[index];
    // Smoothstep velocity has mean 1/2 during each ramp, so this preserves the
    // exact distance, duration, segment boundaries, and source-time mapping.
    const cruiseSpeed = Math.max(0, (segment.path.totalMeters - (startSpeed * enter + endSpeed * leave) / 2)
      / Math.max(duration - (enter + leave) / 2, 1e-6));
    return { duration, distance: segment.path.totalMeters, enter, leave, startSpeed, endSpeed, cruiseSpeed,
      peakSpeed: Math.max(startSpeed, endSpeed, cruiseSpeed), pan: segment.intent.maxPanPxPerSec,
      startPan: before?.pan ?? segment.intent.maxPanPxPerSec, endPan: after?.pan ?? segment.intent.maxPanPxPerSec };
  });
}

export function sampleRawMotion(profile, timeSec) {
  const { duration, enter, leave, startSpeed, endSpeed, cruiseSpeed } = profile;
  const time = clamp(timeSec, 0, duration);
  if (enter > 0 && time < enter) {
    const ratio = time / enter;
    return { distance: startSpeed * time + (cruiseSpeed - startSpeed) * enter * integralSmoothstep(ratio),
      pan: profile.startPan + (profile.pan - profile.startPan) * smoothstep(ratio) };
  }
  const firstDistance = (startSpeed + cruiseSpeed) * enter / 2;
  const middleTime = Math.max(0, Math.min(time, duration - leave) - enter);
  let distance = firstDistance + cruiseSpeed * middleTime;
  if (leave > 0 && time > duration - leave) {
    const elapsed = time - (duration - leave), ratio = elapsed / leave;
    distance += cruiseSpeed * elapsed + (endSpeed - cruiseSpeed) * leave * integralSmoothstep(ratio);
    return { distance: clamp(distance, 0, profile.distance), pan: profile.pan + (profile.endPan - profile.pan) * smoothstep(ratio) };
  }
  return { distance: clamp(distance, 0, profile.distance), pan: profile.pan };
}

function direction(points, atStart) {
  const anchor = mercatorProject(atStart ? points[0] : points.at(-1));
  for (let step = 1; step < points.length; step++) {
    const other = mercatorProject(atStart ? points[step] : points[points.length - 1 - step]);
    const x = atStart ? other.x - anchor.x : anchor.x - other.x;
    const y = atStart ? other.y - anchor.y : anchor.y - other.y;
    const length = Math.hypot(x, y);
    if (length > 1e-12) return { x: x / length, y: y / length };
  }
  return { x: 0, y: 0 };
}
function smoothstep(t) { return t * t * (3 - 2 * t); }
function integralSmoothstep(t) { return t * t * t - t * t * t * t / 2; }
