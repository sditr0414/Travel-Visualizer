import { clamp, haversineMeters, mercatorProject, mercatorUnproject } from './geo.js';
import { inferMobility, cameraIntentForMovement } from './mobility.js';

const EARTH_CIRCUMFERENCE_M = 40075016.686;
const TILE_SIZE = 512;
const DAY_MS = 86_400_000;

export function durationLimitsForMovements(movements) {
  if (!movements?.length) {
    return { minSeconds: 60, recommendedSeconds: 120, maxSeconds: 300, days: 1, distanceKm: 0 };
  }

  const enriched = movements.map(movement => {
    const path = buildPathMetrics(movement.points?.length ? movement.points : [movement.start, movement.end]);
    const inference = inferMobility({
      ...movement,
      distanceMeters: Math.max(movement.distanceMeters || 0, path.totalMeters || 0)
    });
    return {
      movement,
      path,
      inference,
      minimumSec: minimumVideoSecFor({ ...movement, path, inference })
    };
  });

  const startMs = Math.min(...movements.map(m => m.startMs).filter(Number.isFinite));
  const endMs = Math.max(...movements.map(m => m.endMs).filter(Number.isFinite));
  const days = Number.isFinite(startMs) && Number.isFinite(endMs)
    ? Math.max(1, Math.ceil((endMs - startMs) / DAY_MS))
    : 1;
  const distanceKm = enriched.reduce((sum, item) => (
    sum + Math.max(item.inference.distanceKm, item.path.totalMeters / 1000)
  ), 0);
  const minimumSegmentsSec = enriched.reduce((sum, item) => sum + item.minimumSec, 0);
  const complexityFloor = 22 + days * 3.2 + Math.log2(1 + distanceKm) * 5.0;
  const minSeconds = round5(Math.max(minimumSegmentsSec + 8, complexityFloor));
  const recommendedSeconds = round5(Math.max(
    minSeconds * 1.32,
    55 + days * 8.5 + Math.log2(1 + distanceKm) * 8.5
  ));
  const maxSeconds = round5(clamp(
    Math.max(recommendedSeconds * 1.85, minSeconds + days * 18),
    minSeconds + 60,
    1200
  ));

  return { minSeconds, recommendedSeconds, maxSeconds, days, distanceKm };
}

export function planPlayback(movements, {
  fps = 60,
  targetTotalSeconds = null,
  maxTotalSeconds = null,
  viewportWidth = 1100,
  viewportHeight = 700
} = {}) {
  if (!movements.length) {
    return {
      frames: [], segments: [], fps, durationSec: 0,
      durationLimits: durationLimitsForMovements([]), outroStartSec: 0,
      routeRenderPoints: []
    };
  }

  const width = clamp(Number(viewportWidth) || 1100, 320, 3840);
  const height = clamp(Number(viewportHeight) || 700, 240, 2160);
  const safeFps = clamp(Math.round(Number(fps) || 60), 24, 120);

  const enriched = movements.map((movement, index) => {
    const path = buildPathMetrics(movement.points?.length ? movement.points : [movement.start, movement.end]);
    const inference = inferMobility({
      ...movement,
      distanceMeters: Math.max(movement.distanceMeters || 0, path.totalMeters || 0)
    });
    const intent = cameraIntentForMovement(movement, inference);
    const naturalVideoSec = videoDurationFor(movement, inference, path.totalMeters);
    const minimumSec = minimumVideoSecFor({ ...movement, path, inference });
    return { ...movement, index, path, inference, intent, naturalVideoSec, minimumSec };
  });

  const durationLimits = durationLimitsForMovements(movements);
  const requested = Number.isFinite(Number(targetTotalSeconds))
    ? Number(targetTotalSeconds)
    : Number.isFinite(Number(maxTotalSeconds))
      ? Number(maxTotalSeconds)
      : durationLimits.recommendedSeconds;
  const totalTargetSec = clamp(requested, durationLimits.minSeconds, durationLimits.maxSeconds);
  const minimumMovementSec = enriched.reduce((sum, segment) => sum + segment.minimumSec, 0);
  const outroSec = clamp(Math.min(7, totalTargetSec - minimumMovementSec), 5, 7);
  const movementBudgetSec = Math.max(minimumMovementSec, totalTargetSec - outroSec);
  const extraBudgetSec = Math.max(0, movementBudgetSec - minimumMovementSec);
  const weightTotal = Math.max(0.001, enriched.reduce((sum, s) => sum + s.naturalVideoSec, 0));

  let cursor = 0;
  let sceneId = 0;
  const segments = enriched.map((segment, index) => {
    const videoSec = segment.minimumSec + extraBudgetSec * segment.naturalVideoSec / weightTotal;
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

  const movementFrameCount = Math.max(2, Math.ceil(cursor * safeFps));
  const raw = new Array(movementFrameCount);
  let segmentIndex = 0;

  for (let i = 0; i < movementFrameCount; i += 1) {
    const timeSec = Math.min(cursor, i / safeFps);
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
      kind: 'TRAVEL',
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

  const zoom = new Array(movementFrameCount);
  const centerX = new Array(movementFrameCount);
  const centerY = new Array(movementFrameCount);

  for (const [start, end] of sceneRanges(raw)) {
    const sceneRawZoom = raw.slice(start, end).map(f => f.targetZoom);
    let sceneZoom = anticipateZoomOut(sceneRawZoom, safeFps, 1.8, 0.28);
    sceneZoom = asymmetricSmooth(sceneZoom, safeFps, { zoomOutTau: 0.78, zoomInTau: 1.85 });
    sceneZoom = limitKinematics(sceneZoom, safeFps, { maxVelocity: 1.12, maxAcceleration: 1.18 });
    sceneZoom = smoothEma(sceneZoom, 0.16, safeFps);

    for (let i = start; i < end; i += 1) zoom[i] = clamp(sceneZoom[i - start], 4.0, 17.3);
    solveCenterScene(raw, zoom, centerX, centerY, start, end, width, height, safeFps);
  }

  const travelFrames = raw.map((frame, i) => ({
    ...frame,
    zoom: zoom[i],
    center: mercatorUnproject({ x: centerX[i], y: centerY[i] })
  }));
  addRouteProgress(travelFrames);

  const routePoints = segments.flatMap(segment => segment.path.points);
  const overview = overviewCameraForPoints(routePoints, width, height, 90);
  const outroFrames = buildOutroFrames(travelFrames, overview, outroSec, safeFps, cursor);
  const frames = [...travelFrames, ...outroFrames];
  const durationSec = cursor + outroSec;

  return {
    frames,
    segments,
    fps: safeFps,
    durationSec,
    travelDurationSec: cursor,
    outroStartSec: cursor,
    outroSec,
    durationLimits,
    targetTotalSeconds: totalTargetSec,
    routeRenderPoints: sampleRoutePositions(travelFrames, 16000)
  };
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

export function asymmetricSmooth(values, fps, { zoomOutTau = 0.78, zoomInTau = 1.85 } = {}) {
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

function overviewCameraForPoints(points, width, height, paddingPx) {
  const projected = (points || []).map(mercatorProject);
  if (!projected.length) return { center: { lat: 35, lng: 135 }, zoom: 5 };
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of projected) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const spanX = Math.max(1e-8, maxX - minX);
  const spanY = Math.max(1e-8, maxY - minY);
  const usableW = Math.max(180, width - paddingPx * 2);
  const usableH = Math.max(160, height - paddingPx * 2);
  const zoomX = Math.log2(usableW / (TILE_SIZE * spanX));
  const zoomY = Math.log2(usableH / (TILE_SIZE * spanY));
  return {
    center: mercatorUnproject({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 }),
    zoom: clamp(Math.min(zoomX, zoomY), 3.5, 11.5)
  };
}

function buildOutroFrames(travelFrames, overview, outroSec, fps, startTimeSec) {
  if (!travelFrames.length || outroSec <= 0) return [];
  const count = Math.max(2, Math.ceil(outroSec * fps));
  const last = travelFrames.at(-1);
  const startCenter = mercatorProject(last.center);
  const endCenter = mercatorProject(overview.center);
  const transitionSec = Math.min(4.2, outroSec * 0.68);
  const out = [];

  for (let i = 1; i <= count; i += 1) {
    const localSec = i / fps;
    const t = smootherstep(clamp(localSec / Math.max(0.01, transitionSec), 0, 1));
    const center = mercatorUnproject({
      x: startCenter.x + (endCenter.x - startCenter.x) * t,
      y: startCenter.y + (endCenter.y - startCenter.y) * t
    });
    out.push({
      kind: 'OUTRO',
      timeSec: startTimeSec + localSec,
      segmentIndex: Math.max(0, last.segmentIndex),
      sceneId: last.sceneId + 1,
      sceneBreak: i === 1,
      progress: 1,
      position: last.position,
      center,
      zoom: last.zoom + (overview.zoom - last.zoom) * t,
      targetZoom: overview.zoom,
      viewSpanKm: null,
      mobilityClass: 'OVERVIEW',
      speedKmh: 0,
      routeProgress: 1
    });
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
    const markerPxX = (marker.x - nextX) * scale;
    const markerPxY = (marker.y - nextY) * scale;
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
      return clamp(7.2 + Math.log2(1 + distanceKm / 300) * 0.9, 7.5, 10.5);
    case 'FAST_GROUND':
      return clamp(1.10 + Math.log2(1 + distanceKm / 20) * 1.15, 1.25, 7.0);
    case 'FERRY':
      return clamp(1.35 + Math.log2(1 + distanceKm / 15) * 0.9, 1.5, 5.5);
    case 'ROAD':
      return clamp(0.82 + Math.log2(1 + distanceKm / 10) * 0.62, 0.9, 3.2);
    case 'URBAN_TRANSIT':
      return clamp(0.72 + Math.log2(1 + distanceKm / 7) * 0.50, 0.78, 2.6);
    case 'BIKE':
      return clamp(0.68 + Math.log2(1 + distanceKm / 4) * 0.40, 0.72, 2.2);
    case 'WALK':
      return clamp(0.52 + Math.log2(1 + distanceKm / 1.0) * 0.30, 0.55, 1.75);
    default:
      return 0.82;
  }
}

function videoDurationFor(segment, inference, pathDistanceMeters) {
  const distance = Math.max(0.05, Math.max(inference.distanceKm, pathDistanceMeters / 1000));
  const speed = Math.max(1, inference.speedKmh);
  const complexity = Math.log2(1 + distance) * 1.25;
  const speedCompression = clamp(Math.log2(1 + speed / 18) * 0.18, 0, 0.9);
  return clamp(2.1 + complexity - speedCompression, 1.6, 8.5);
}

function sampleRoutePositions(frames, maxPoints) {
  if (frames.length <= maxPoints) return frames.map(f => f.position);
  const step = (frames.length - 1) / (maxPoints - 1);
  const out = [];
  for (let i = 0; i < maxPoints; i += 1) out.push(frames[Math.round(i * step)].position);
  return out;
}

function smootherstep(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function round5(value) {
  return Math.ceil(value / 5) * 5;
}
