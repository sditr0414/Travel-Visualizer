import { clamp, mercatorProject, mercatorUnproject, pointAlongPath } from './geo.js';
import { inferMobility, cameraIntentForMovement } from './mobility.js';

export function planPlayback(movements, { fps = 30, maxTotalSeconds = 150 } = {}) {
  if (!movements.length) return { frames: [], segments: [], fps, durationSec: 0 };

  const enriched = movements.map((movement, index) => {
    const inference = inferMobility(movement);
    const intent = cameraIntentForMovement(movement, inference);
    const naturalVideoSec = videoDurationFor(movement, inference);
    return { ...movement, index, inference, intent, naturalVideoSec };
  });

  const naturalTotal = enriched.reduce((sum, s) => sum + s.naturalVideoSec, 0);
  const scale = naturalTotal > maxTotalSeconds ? maxTotalSeconds / naturalTotal : 1;
  let cursor = 0;
  const segments = enriched.map(segment => {
    const videoSec = Math.max(0.65, segment.naturalVideoSec * scale);
    const result = { ...segment, videoStartSec: cursor, videoEndSec: cursor + videoSec, videoSec };
    cursor += videoSec;
    return result;
  });

  const frameCount = Math.max(2, Math.ceil(cursor * fps));
  const raw = new Array(frameCount);
  let segmentIndex = 0;

  for (let i = 0; i < frameCount; i += 1) {
    const timeSec = i / fps;
    while (segmentIndex < segments.length - 1 && timeSec > segments[segmentIndex].videoEndSec) segmentIndex += 1;
    const segment = segments[segmentIndex];
    const local = clamp((timeSec - segment.videoStartSec) / Math.max(segment.videoSec, 0.001), 0, 1);
    const position = pointAlongPath(segment.points, local) || segment.end;
    const lookT = clamp(local + segment.intent.lookAhead * (1 - local), 0, 1);
    const center = pointAlongPath(segment.points, lookT) || position;
    const projected = mercatorProject(center);
    raw[i] = {
      timeSec,
      segmentIndex,
      progress: local,
      position,
      centerX: projected.x,
      centerY: projected.y,
      zoom: segment.intent.targetZoom,
      tauSec: segment.intent.smoothingTauSec,
      mobilityClass: segment.inference.mobilityClass,
      speedKmh: segment.inference.speedKmh
    };
  }

  let zoom = raw.map(f => f.zoom);
  let x = raw.map(f => f.centerX);
  let y = raw.map(f => f.centerY);
  const tau = raw.map(f => f.tauSec);

  for (let pass = 0; pass < 2; pass += 1) {
    zoom = bidirectionalAdaptiveEma(zoom, tau, fps);
    x = bidirectionalAdaptiveEma(x, tau.map(v => v * 0.75), fps);
    y = bidirectionalAdaptiveEma(y, tau.map(v => v * 0.75), fps);
  }

  zoom = limitKinematics(zoom, fps, { maxVelocity: 2.2, maxAcceleration: 2.8 });
  zoom = bidirectionalAdaptiveEma(zoom, tau.map(v => v * 0.35), fps);

  const frames = raw.map((frame, i) => ({
    ...frame,
    zoom: clamp(zoom[i], 4.0, 17.5),
    center: mercatorUnproject({ x: x[i], y: y[i] })
  }));

  return { frames, segments, fps, durationSec: cursor };
}

export function bidirectionalAdaptiveEma(values, tauSec, fps) {
  if (values.length < 2) return [...values];
  const forward = adaptiveEma(values, tauSec, fps, false);
  return adaptiveEma(forward, tauSec, fps, true);
}

function adaptiveEma(values, tauSec, fps, reverse) {
  const out = [...values];
  const dt = 1 / fps;
  const start = reverse ? values.length - 1 : 0;
  const end = reverse ? -1 : values.length;
  const step = reverse ? -1 : 1;
  let state = values[start];
  for (let i = start; i !== end; i += step) {
    const tau = Math.max(0.05, tauSec[i] || 1);
    const alpha = 1 - Math.exp(-dt / tau);
    state += alpha * (values[i] - state);
    out[i] = state;
  }
  return out;
}

function limitKinematics(values, fps, { maxVelocity, maxAcceleration }) {
  if (values.length < 3) return [...values];
  const dt = 1 / fps;
  const out = [...values];
  let velocity = 0;
  for (let i = 1; i < out.length; i += 1) {
    const desiredV = clamp((out[i] - out[i - 1]) / dt, -maxVelocity, maxVelocity);
    const dv = clamp(desiredV - velocity, -maxAcceleration * dt, maxAcceleration * dt);
    velocity += dv;
    out[i] = out[i - 1] + velocity * dt;
  }
  velocity = 0;
  for (let i = out.length - 2; i >= 0; i -= 1) {
    const desiredV = clamp((out[i] - out[i + 1]) / dt, -maxVelocity, maxVelocity);
    const dv = clamp(desiredV - velocity, -maxAcceleration * dt, maxAcceleration * dt);
    velocity += dv;
    out[i] = out[i + 1] + velocity * dt;
  }
  return out;
}

function videoDurationFor(segment, inference) {
  const distance = Math.max(0.05, inference.distanceKm);
  const speed = Math.max(1, inference.speedKmh);
  const complexity = Math.log2(1 + distance) * 1.2;
  const speedCompression = clamp(Math.log2(1 + speed / 12) * 0.28, 0, 1.3);
  return clamp(1.8 + complexity - speedCompression, 1.25, 6.5);
}
