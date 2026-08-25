import { clamp, haversineMeters, mercatorProject, mercatorUnproject, pointAlongPath } from './geo.js';
import { inferMobility, cameraIntentForMovement } from './mobility.js';

const EARTH_CIRCUMFERENCE_M = 40075016.686;
const TILE_SIZE = 512;

export function planPlayback(movements, {
  fps = 30,
  maxTotalSeconds = 210,
  viewportWidth = 1100
} = {}) {
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
    const videoSec = Math.max(0.8, segment.naturalVideoSec * scale);
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
      zoom: zoomForViewSpan(segment.intent.viewSpanKm, position.lat, viewportWidth),
      tauSec: segment.intent.smoothingTauSec,
      mobilityClass: segment.inference.mobilityClass,
      speedKmh: segment.inference.speedKmh
    };
  }

  let zoom = raw.map(f => f.zoom);
  let x = raw.map(f => f.centerX);
  let y = raw.map(f => f.centerY);
  const tau = raw.map(f => f.tauSec);

  zoom = bidirectionalAdaptiveEma(zoom, tau, fps);
  zoom = limitKinematics(zoom, fps, { maxVelocity: 1.55, maxAcceleration: 2.3 });
  zoom = bidirectionalAdaptiveEma(zoom, tau.map(v => v * 0.30), fps);

  x = bidirectionalAdaptiveEma(x, tau.map(v => v * 0.32), fps);
  y = bidirectionalAdaptiveEma(y, tau.map(v => v * 0.32), fps);

  const frames = raw.map((frame, i) => ({
    ...frame,
    zoom: clamp(zoom[i], 4.0, 17.3),
    center: mercatorUnproject({ x: x[i], y: y[i] })
  }));

  addRouteProgress(frames);
  return { frames, segments, fps, durationSec: cursor };
}

export function zoomForViewSpan(viewSpanKm, latitude, viewportWidth = 1100) {
  const spanMeters = Math.max(250, viewSpanKm * 1000);
  const widthPx = clamp(Number(viewportWidth) || 1100, 320, 3840);
  const lat = clamp(Number(latitude) || 0, -80, 80) * Math.PI / 180;
  const groundCircumference = EARTH_CIRCUMFERENCE_M * Math.max(0.15, Math.cos(lat));
  return clamp(Math.log2((groundCircumference * widthPx) / (TILE_SIZE * spanMeters)), 4, 17.3);
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
  const forward = [...values];
  let velocity = 0;
  for (let i = 1; i < forward.length; i += 1) {
    const desiredV = clamp((values[i] - forward[i - 1]) / dt, -maxVelocity, maxVelocity);
    const dv = clamp(desiredV - velocity, -maxAcceleration * dt, maxAcceleration * dt);
    velocity += dv;
    forward[i] = forward[i - 1] + velocity * dt;
  }

  const out = [...forward];
  velocity = 0;
  for (let i = out.length - 2; i >= 0; i -= 1) {
    const desiredV = clamp((forward[i] - out[i + 1]) / dt, -maxVelocity, maxVelocity);
    const dv = clamp(desiredV - velocity, -maxAcceleration * dt, maxAcceleration * dt);
    velocity += dv;
    out[i] = out[i + 1] + velocity * dt;
  }
  return out;
}

function addRouteProgress(frames) {
  if (!frames.length) return;
  const cumulative = new Array(frames.length).fill(0);
  let total = 0;
  for (let i = 1; i < frames.length; i += 1) {
    total += haversineMeters(frames[i - 1].position, frames[i].position);
    cumulative[i] = total;
  }
  const denominator = Math.max(total, 1);
  for (let i = 0; i < frames.length; i += 1) frames[i].routeProgress = cumulative[i] / denominator;
}

function videoDurationFor(segment, inference) {
  const distance = Math.max(0.05, inference.distanceKm);
  const speed = Math.max(1, inference.speedKmh);
  const complexity = Math.log2(1 + distance) * 1.15;
  const speedCompression = clamp(Math.log2(1 + speed / 15) * 0.24, 0, 1.1);
  return clamp(1.9 + complexity - speedCompression, 1.35, 6.5);
}
