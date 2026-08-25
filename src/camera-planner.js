import { clamp, haversineMeters, mercatorProject, mercatorUnproject } from './geo.js';
import { inferMobility, cameraIntentForMovement } from './mobility.js';

const EARTH_CIRCUMFERENCE_M = 40075016.686;
const TILE_SIZE = 512;

export function planPlayback(movements, {
  fps = 30,
  maxTotalSeconds = 300,
  viewportWidth = 1100,
  viewportHeight = 700
} = {}) {
  if (!movements.length) return { frames: [], segments: [], fps, durationSec: 0 };

  const width = clamp(Number(viewportWidth) || 1100, 320, 3840);
  const height = clamp(Number(viewportHeight) || 700, 240, 2160);

  const enriched = movements.map((movement, index) => {
    const path = buildPathMetrics(movement.points?.length ? movement.points : [movement.start, movement.end]);
    const inference = inferMobility({
      ...movement,
      distanceMeters: Math.max(movement.distanceMeters || 0, path.totalMeters || 0)
    });
    const intent = cameraIntentForMovement(movement, inference);
    const naturalVideoSec = videoDurationFor(movement, inference, path.totalMeters);
    return { ...movement, index, path, inference, intent, naturalVideoSec };
  });

  const naturalTotal = enriched.reduce((sum, s) => sum + s.naturalVideoSec, 0);
  const scale = naturalTotal > maxTotalSeconds ? maxTotalSeconds / naturalTotal : 1;
  let cursor = 0;
  let sceneId = 0;

  const segments = enriched.map((segment, index) => {
    const videoSec = Math.max(minimumVideoSecFor(segment), segment.naturalVideoSec * scale);
    const previous = index > 0 ? enriched[index - 1] : null;
    const gapKm = previous ? haversineMeters(previous.end, segment.start) / 1000 : 0;
    const sceneBreakBefore = !!previous && isSceneBreak(previous, segment, gapKm);
    if (sceneBreakBefore) sceneId += 1;
    const result = {
      ...segment,
      videoStartSec: cursor,
      videoEndSec: cursor + videoSec,
      videoSec,
      gapKm,
      sceneBreakBefore,
      sceneId
    };
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
    const distanceAlongM = segment.path.totalMeters * local;
    const position = pointAtPathDistance(segment.path, distanceAlongM) || segment.end;

    const videoGroundSpeedKmSec = (segment.path.totalMeters / 1000) / Math.max(segment.videoSec, 0.001);
    const compressionSpanKm = videoGroundSpeedKmSec * width / Math.max(segment.intent.targetTraversalPxPerSec, 80);
    const viewSpanKm = Math.max(segment.intent.viewSpanKm, compressionSpanKm * 1.08);
    const targetZoom = zoomForViewSpan(viewSpanKm, position.lat, width);

    const lookAheadM = Math.min(
      Math.max(0, segment.path.totalMeters - distanceAlongM),
      viewSpanKm * 1000 * segment.intent.lookAheadViewRatio
    );
    const targetCenter = pointAtPathDistance(segment.path, distanceAlongM + lookAheadM) || position;
    const projected = mercatorProject(targetCenter);

    raw[i] = {
      timeSec,
      segmentIndex,
      sceneId: segment.sceneId,
      sceneBreak: i === 0 || (i > 0 && raw[i - 1]?.sceneId !== segment.sceneId),
      progress: local,
      position,
      targetCenterX: projected.x,
      targetCenterY: projected.y,
      targetZoom,
      viewSpanKm,
      maxPanPxPerSec: segment.intent.maxPanPxPerSec,
      mobilityClass: segment.inference.mobilityClass,
      speedKmh: segment.inference.speedKmh
    };
  }

  const zoom = new Array(frameCount);
  const centerX = new Array(frameCount);
  const centerY = new Array(frameCount);

  for (const [start, end] of sceneRanges(raw)) {
    const sceneRawZoom = raw.slice(start, end).map(f => f.targetZoom);
    let sceneZoom = anticipateZoomOut(sceneRawZoom, fps, 1.8, 0.28);
    sceneZoom = asymmetricSmooth(sceneZoom, fps, { zoomOutTau: 0.85, zoomInTau: 2.35 });
    sceneZoom = limitKinematics(sceneZoom, fps, { maxVelocity: 0.92, maxAcceleration: 0.92 });
    sceneZoom = smoothEma(sceneZoom, 0.22, fps);

    for (let i = start; i < end; i += 1) zoom[i] = clamp(sceneZoom[i - start], 4.0, 17.3);

    solveCenterScene(raw, zoom, centerX, centerY, start, end, width, height, fps);
  }

  const frames = raw.map((frame, i) => ({
    ...frame,
    zoom: zoom[i],
    center: mercatorUnproject({ x: centerX[i], y: centerY[i] })
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

export function screenDistancePx(a, b, zoom) {
  const pa = mercatorProject(a);
  const pb = mercatorProject(b);
  const scale = TILE_SIZE * 2 ** zoom;
  return Math.hypot((pb.x - pa.x) * scale, (pb.y - pa.y) * scale);
}

export function anticipateZoomOut(values, fps, seconds = 1.8, allowance = 0.28) {
  if (values.length < 2) return [...values];
  const radius = Math.max(1, Math.round(seconds * fps));
  const out = [...values];
  const deque = [];
  for (let i = values.length - 1; i >= 0; i -= 1) {
    while (deque.length && deque[0] > i + radius) deque.shift();
    while (deque.length && values[deque[deque.length - 1]] >= values[i]) deque.pop();
    deque.push(i);
    const futureMin = values[deque[0]];
    out[i] = Math.min(values[i], futureMin + allowance);
  }
  return out;
}

export function asymmetricSmooth(values, fps, { zoomOutTau = 0.85, zoomInTau = 2.35 } = {}) {
  if (values.length < 2) return [...values];
  const dt = 1 / fps;
  const out = new Array(values.length);
  let state = values[0];
  out[0] = state;
  for (let i = 1; i < values.length; i += 1) {
    const target = values[i];
    const tau = target < state ? zoomOutTau : zoomInTau;
    const alpha = 1 - Math.exp(-dt / Math.max(0.05, tau));
    state += alpha * (target - state);
    out[i] = state;
  }
  return out;
}

function solveCenterScene(raw, zoom, outX, outY, start, end, width, height, fps) {
  if (start >= end) return;
  outX[start] = raw[start].targetCenterX;
  outY[start] = raw[start].targetCenterY;

  for (let i = start + 1; i < end; i += 1) {
    const scale = TILE_SIZE * 2 ** zoom[i];
    const previousX = outX[i - 1];
    const previousY = outY[i - 1];
    const errorPxX = (raw[i].targetCenterX - previousX) * scale;
    const errorPxY = (raw[i].targetCenterY - previousY) * scale;
    const errorPx = Math.hypot(errorPxX, errorPxY);
    const maxStepPx = raw[i].maxPanPxPerSec / fps;
    const deadZonePx = 8;

    let nextX = previousX;
    let nextY = previousY;
    if (errorPx > deadZonePx) {
      const movePx = Math.min(Math.max(0, errorPx - deadZonePx), maxStepPx);
      const ratio = movePx / Math.max(errorPx, 1e-9);
      nextX += errorPxX * ratio / scale;
      nextY += errorPxY * ratio / scale;
    }

    const marker = mercatorProject(raw[i].position);
    const safeX = width * 0.36;
    const safeY = height * 0.34;
    let markerPxX = (marker.x - nextX) * scale;
    let markerPxY = (marker.y - nextY) * scale;
    const correctionLimitPx = maxStepPx * 1.65;

    let correctionX = 0;
    let correctionY = 0;
    if (Math.abs(markerPxX) > safeX) correctionX = markerPxX - Math.sign(markerPxX) * safeX;
    if (Math.abs(markerPxY) > safeY) correctionY = markerPxY - Math.sign(markerPxY) * safeY;
    const correctionLength = Math.hypot(correctionX, correctionY);
    if (correctionLength > 0) {
      const ratio = Math.min(1, correctionLimitPx / correctionLength);
      nextX += correctionX * ratio / scale;
      nextY += correctionY * ratio / scale;
    }

    outX[i] = nextX;
    outY[i] = nextY;
  }
}

function sceneRanges(raw) {
  const ranges = [];
  let start = 0;
  for (let i = 1; i <= raw.length; i += 1) {
    if (i === raw.length || raw[i].sceneId !== raw[start].sceneId) {
      ranges.push([start, i]);
      start = i;
    }
  }
  return ranges;
}

function isSceneBreak(previous, current, gapKm) {
  return gapKm > 10;
}

function buildPathMetrics(points) {
  const clean = (points || []).filter(p => Number.isFinite(p?.lat) && Number.isFinite(p?.lng));
  if (!clean.length) return { points: [], cumulative: [], totalMeters: 0 };
  const cumulative = new Array(clean.length).fill(0);
  let totalMeters = 0;
  for (let i = 1; i < clean.length; i += 1) {
    totalMeters += haversineMeters(clean[i - 1], clean[i]);
    cumulative[i] = totalMeters;
  }
  return { points: clean, cumulative, totalMeters };
}

function pointAtPathDistance(path, distanceMeters) {
  if (!path.points.length) return null;
  if (path.points.length === 1 || path.totalMeters <= 0) return { ...path.points[path.points.length - 1] };
  const target = clamp(distanceMeters, 0, path.totalMeters);
  let lo = 1;
  let hi = path.cumulative.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (path.cumulative[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  const i = lo;
  const before = path.cumulative[i - 1];
  const span = Math.max(1e-9, path.cumulative[i] - before);
  const t = clamp((target - before) / span, 0, 1);
  const a = path.points[i - 1];
  const b = path.points[i];
  return {
    lat: a.lat + (b.lat - a.lat) * t,
    lng: a.lng + (b.lng - a.lng) * t,
    timeMs: Number.isFinite(a.timeMs) && Number.isFinite(b.timeMs)
      ? a.timeMs + (b.timeMs - a.timeMs) * t
      : undefined
  };
}

function limitKinematics(values, fps, { maxVelocity, maxAcceleration }) {
  if (values.length < 3) return [...values];
  const dt = 1 / fps;
  const out = [...values];
  let velocity = 0;
  for (let i = 1; i < out.length; i += 1) {
    const desiredV = clamp((values[i] - out[i - 1]) / dt, -maxVelocity, maxVelocity);
    velocity += clamp(desiredV - velocity, -maxAcceleration * dt, maxAcceleration * dt);
    out[i] = out[i - 1] + velocity * dt;
  }
  return out;
}

function smoothEma(values, tauSec, fps) {
  if (values.length < 2) return [...values];
  const alpha = 1 - Math.exp(-(1 / fps) / Math.max(0.01, tauSec));
  const out = new Array(values.length);
  let state = values[0];
  out[0] = state;
  for (let i = 1; i < values.length; i += 1) {
    state += alpha * (values[i] - state);
    out[i] = state;
  }
  return out;
}

function addRouteProgress(frames) {
  if (!frames.length) return;
  const cumulative = new Array(frames.length).fill(0);
  let total = 0;
  for (let i = 1; i < frames.length; i += 1) {
    if (frames[i].sceneId !== frames[i - 1].sceneId) {
      cumulative[i] = total;
      continue;
    }
    total += haversineMeters(frames[i - 1].position, frames[i].position);
    cumulative[i] = total;
  }
  const denominator = Math.max(total, 1);
  for (let i = 0; i < frames.length; i += 1) frames[i].routeProgress = cumulative[i] / denominator;
}

function minimumVideoSecFor(segment) {
  const distanceKm = Math.max(segment.inference.distanceKm, segment.path.totalMeters / 1000);
  switch (segment.inference.mobilityClass) {
    case 'FLIGHT':
      return clamp(8.5 + Math.log2(1 + distanceKm / 300) * 1.0, 9, 11.5);
    case 'FAST_GROUND':
      return clamp(1.35 + Math.log2(1 + distanceKm / 20) * 1.45, 1.5, 8.8);
    case 'FERRY':
      return clamp(1.6 + Math.log2(1 + distanceKm / 15) * 1.0, 1.8, 6.5);
    case 'ROAD':
      return clamp(0.95 + Math.log2(1 + distanceKm / 10) * 0.72, 1.0, 3.8);
    case 'URBAN_TRANSIT':
      return clamp(0.82 + Math.log2(1 + distanceKm / 7) * 0.58, 0.9, 3.0);
    case 'BIKE':
      return clamp(0.78 + Math.log2(1 + distanceKm / 4) * 0.45, 0.85, 2.6);
    case 'WALK':
      return clamp(0.62 + Math.log2(1 + distanceKm / 1.0) * 0.34, 0.65, 2.0);
    default:
      return 1.0;
  }
}

function videoDurationFor(segment, inference, pathDistanceMeters) {
  const distance = Math.max(0.05, Math.max(inference.distanceKm, pathDistanceMeters / 1000));
  const speed = Math.max(1, inference.speedKmh);
  const complexity = Math.log2(1 + distance) * 1.25;
  const speedCompression = clamp(Math.log2(1 + speed / 18) * 0.18, 0, 0.9);
  return clamp(2.1 + complexity - speedCompression, 1.6, 8.5);
}
