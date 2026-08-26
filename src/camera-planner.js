import { clamp, haversineMeters, mercatorProject, mercatorUnproject } from './geo.js';
import { inferMobility } from './mobility.js';
import { allocatePlaybackSeconds, PlaybackPacing } from './playback-pacing.js';

const EARTH_CIRCUMFERENCE_M = 40075016.686;
const TILE_SIZE = 512;
const DAY_MS = 86_400_000;

export { PlaybackPacing };

export function durationLimitsForMovements(movements) {
  if (!movements?.length) {
    return { minSeconds: 45, recommendedSeconds: 90, maxSeconds: 240, days: 1, distanceKm: 0 };
  }
  const stats = movementStats(movements);
  const minSeconds = round5(clamp(
    35 + stats.days * 1.1 + Math.log2(1 + stats.distanceKm) * 0.5,
    45,
    120
  ));
  const recommendedSeconds = round5(clamp(
    Math.max(minSeconds * 1.8, 70 + stats.days * 4.5 + Math.log2(1 + stats.distanceKm) * 4),
    minSeconds + 30,
    600
  ));
  const maxSeconds = round5(clamp(
    Math.max(recommendedSeconds * 2, minSeconds + stats.days * 15),
    recommendedSeconds + 60,
    900
  ));
  return { minSeconds, recommendedSeconds, maxSeconds, ...stats };
}

export function planPlayback(movements, {
  fps = 60,
  targetTotalSeconds = null,
  maxTotalSeconds = null,
  viewportWidth = 1100,
  viewportHeight = 700,
  pacingMode = PlaybackPacing.LOCAL_DAYS
} = {}) {
  const safeFps = clamp(Math.round(Number(fps) || 60), 24, 120);
  const resolvedPacingMode = pacingMode === PlaybackPacing.GLOBAL
    ? PlaybackPacing.GLOBAL
    : PlaybackPacing.LOCAL_DAYS;
  if (!movements?.length) {
    return {
      frames: [], segments: [], fps: safeFps, durationSec: 0,
      durationLimits: durationLimitsForMovements([]), outroStartSec: 0,
      outroSec: 0, routeRenderPoints: [], pacingMode: resolvedPacingMode
    };
  }

  const width = clamp(Number(viewportWidth) || 1100, 320, 3840);
  const height = clamp(Number(viewportHeight) || 700, 240, 2160);
  const durationLimits = durationLimitsForMovements(movements);
  const requested = Number.isFinite(Number(targetTotalSeconds))
    ? Number(targetTotalSeconds)
    : Number.isFinite(Number(maxTotalSeconds))
      ? Number(maxTotalSeconds)
      : durationLimits.recommendedSeconds;
  const totalTargetSec = clamp(requested, durationLimits.minSeconds, durationLimits.maxSeconds);
  const outroSec = clamp(totalTargetSec * 0.085, 4.5, 7);
  const movementBudgetSec = Math.max(1, totalTargetSec - outroSec);

  const enriched = movements.map((movement, index) => {
    const path = buildPathMetrics(movement.points?.length ? movement.points : [movement.start, movement.end]);
    const inference = inferMobility({
      ...movement,
      distanceMeters: Math.max(movement.distanceMeters || 0, path.totalMeters || 0)
    });
    const intent = cameraIntent(inference, path.totalMeters / 1000);
    const weight = playbackWeight(inference, path.totalMeters / 1000, movement.inferred);
    return { ...movement, index, path, inference, intent, weight };
  });
  const videoSeconds = allocatePlaybackSeconds(enriched, movementBudgetSec, safeFps, resolvedPacingMode);

  let cursor = 0;
  let sceneId = 0;
  const segments = enriched.map((segment, index) => {
    const videoSec = videoSeconds[index];
    const previous = index > 0 ? enriched[index - 1] : null;
    const gapKm = previous ? haversineMeters(previous.end, segment.start) / 1000 : 0;
    // Adjacent Google activities can share a timestamp while their recorded
    // endpoints disagree by hundreds of meters. Treat that impossible motion
    // as an intentional camera cut instead of whipping the map between points.
    const sceneBreakBefore = !!previous && gapKm > 0.5;
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

  if (segments.length) {
    const delta = movementBudgetSec - cursor;
    segments.at(-1).videoSec += delta;
    segments.at(-1).videoEndSec += delta;
    cursor = movementBudgetSec;
  }

  const movementFrameCount = Math.max(2, Math.ceil(cursor * safeFps));
  const raw = new Array(movementFrameCount);
  let segmentIndex = 0;

  for (let i = 0; i < movementFrameCount; i += 1) {
    const timeSec = Math.min(cursor, i / safeFps);
    while (segmentIndex < segments.length - 1 && timeSec >= segments[segmentIndex].videoEndSec) segmentIndex += 1;
    const segment = segments[segmentIndex];
    const local = clamp((timeSec - segment.videoStartSec) / Math.max(segment.videoSec, 1 / safeFps), 0, 1);
    const distanceAlongM = segment.path.totalMeters * local;
    const position = pointAtPathDistance(segment.path, distanceAlongM) || segment.end;

    const videoGroundSpeedKmSec = (segment.path.totalMeters / 1000) / Math.max(segment.videoSec, 1 / safeFps);
    const compressionSpanKm = videoGroundSpeedKmSec * width / Math.max(segment.intent.targetTraversalPxPerSec, 80);
    const viewSpanKm = Math.max(segment.intent.viewSpanKm, compressionSpanKm * 1.06);
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
      sceneBreak: i === 0 || raw[i - 1]?.sceneId !== segment.sceneId,
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
    let sceneZoom = anticipateZoomOut(sceneRawZoom, safeFps, 1.15, 0.22);
    sceneZoom = asymmetricSmooth(sceneZoom, safeFps, { zoomOutTau: 0.55, zoomInTau: 1.15 });
    sceneZoom = limitKinematics(sceneZoom, safeFps, { maxVelocity: 1.7, maxAcceleration: 2.4 });
    sceneZoom = smoothEma(sceneZoom, 0.09, safeFps);
    for (let i = start; i < end; i += 1) zoom[i] = clamp(sceneZoom[i - start], 4, 17.3);
    solveCenterScene(raw, zoom, centerX, centerY, start, end, width, height, safeFps);
  }

  const travelFrames = raw.map((frame, i) => ({
    ...frame,
    zoom: zoom[i],
    center: mercatorUnproject({ x: centerX[i], y: centerY[i] })
  }));

  const routePoints = segments.flatMap(segment => segment.path.points);
  const overview = overviewCameraForPoints(routePoints, width, height, 90);
  const outroFrames = buildOutroFrames(travelFrames, overview, outroSec, safeFps, cursor);
  const frames = [...travelFrames, ...outroFrames];

  return {
    frames,
    segments,
    fps: safeFps,
    durationSec: cursor + outroSec,
    travelDurationSec: cursor,
    outroStartSec: cursor,
    outroSec,
    durationLimits,
    targetTotalSeconds: totalTargetSec,
    pacingMode: resolvedPacingMode,
    routeRenderPoints: samplePoints(routePoints, 16000)
  };
}

export function zoomForViewSpan(viewSpanKm, latitude, viewportWidth = 1100) {
  const spanMeters = Math.max(250, Number(viewSpanKm || 0) * 1000);
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

export function anticipateZoomOut(values, fps, seconds = 1.15, allowance = 0.22) {
  if (values.length < 2) return [...values];
  const radius = Math.max(1, Math.round(seconds * fps));
  const out = [...values];
  const deque = [];
  for (let i = values.length - 1; i >= 0; i -= 1) {
    while (deque.length && deque[0] > i + radius) deque.shift();
    while (deque.length && values[deque[deque.length - 1]] >= values[i]) deque.pop();
    deque.push(i);
    out[i] = Math.min(values[i], values[deque[0]] + allowance);
  }
  return out;
}

export function asymmetricSmooth(values, fps, { zoomOutTau = 0.55, zoomInTau = 1.15 } = {}) {
  if (values.length < 2) return [...values];
  const dt = 1 / fps;
  const out = new Array(values.length);
  let state = values[0];
  out[0] = state;
  for (let i = 1; i < values.length; i += 1) {
    const target = values[i];
    const tau = target < state ? zoomOutTau : zoomInTau;
    const alpha = 1 - Math.exp(-dt / Math.max(0.04, tau));
    state += alpha * (target - state);
    out[i] = state;
  }
  return out;
}

function movementStats(movements) {
  const starts = movements.map(m => m.startMs).filter(Number.isFinite);
  const ends = movements.map(m => m.endMs).filter(Number.isFinite);
  const startMs = starts.length ? Math.min(...starts) : NaN;
  const endMs = ends.length ? Math.max(...ends) : NaN;
  const days = Number.isFinite(startMs) && Number.isFinite(endMs)
    ? Math.max(1, Math.floor((endMs - startMs) / DAY_MS) + 1)
    : 1;
  let distanceKm = 0;
  for (const movement of movements) {
    const path = buildPathMetrics(movement.points?.length ? movement.points : [movement.start, movement.end]);
    distanceKm += Math.max(Number(movement.distanceMeters) || 0, path.totalMeters) / 1000;
  }
  return { days, distanceKm };
}

function playbackWeight(inference, distanceKm, inferred) {
  const base = 0.55 + Math.log2(1 + Math.max(0.03, distanceKm));
  const mode = {
    FLIGHT: 2.4,
    FAST_GROUND: 1.6,
    FERRY: 1.4,
    ROAD: 1.15,
    URBAN_TRANSIT: 1.05,
    BIKE: 0.9,
    WALK: 0.78,
    UNKNOWN: 0.9
  }[inference.mobilityClass] ?? 0.9;
  return base * mode * (inferred ? 0.8 : 1);
}

function cameraIntent(inference, distanceKm) {
  const speed = Math.max(0, inference.speedKmh || 0);
  const sqrtDistance = Math.sqrt(Math.max(0.03, distanceKm));
  let viewSpanKm;
  switch (inference.mobilityClass) {
    case 'WALK': viewSpanKm = clamp(1.0 + speed * 0.1 + sqrtDistance * 0.28, 1.0, 3.0); break;
    case 'BIKE': viewSpanKm = clamp(2.6 + speed * 0.1 + sqrtDistance * 0.42, 2.8, 8); break;
    case 'URBAN_TRANSIT': viewSpanKm = clamp(6 + speed * 0.13 + sqrtDistance * 0.8, 6.5, 24); break;
    case 'ROAD': viewSpanKm = clamp(8 + speed * 0.14 + sqrtDistance, 9, 44); break;
    case 'FAST_GROUND': viewSpanKm = clamp(15 + speed * 0.15 + sqrtDistance * 1.35, 18, 105); break;
    case 'FERRY': viewSpanKm = clamp(20 + speed * 0.16 + sqrtDistance * 1.5, 24, 140); break;
    case 'FLIGHT': viewSpanKm = clamp(Math.max(240, distanceKm * 1.1), 240, 1800); break;
    default: viewSpanKm = clamp(4 + speed * 0.12 + sqrtDistance * 0.7, 3, 48); break;
  }
  const lookAheadViewRatio = {
    WALK: 0.04, BIKE: 0.06, URBAN_TRANSIT: 0.08, ROAD: 0.09,
    FAST_GROUND: 0.10, FERRY: 0.08, FLIGHT: 0.04, UNKNOWN: 0.06
  }[inference.mobilityClass] ?? 0.06;
  const targetTraversalPxPerSec = {
    WALK: 185, BIKE: 210, URBAN_TRANSIT: 235, ROAD: 250,
    FAST_GROUND: 270, FERRY: 230, FLIGHT: 190, UNKNOWN: 225
  }[inference.mobilityClass] ?? 225;
  const maxPanPxPerSec = {
    WALK: 175, BIKE: 205, URBAN_TRANSIT: 230, ROAD: 245,
    FAST_GROUND: 265, FERRY: 220, FLIGHT: 180, UNKNOWN: 220
  }[inference.mobilityClass] ?? 220;
  return { viewSpanKm, lookAheadViewRatio, targetTraversalPxPerSec, maxPanPxPerSec };
}

function overviewCameraForPoints(points, width, height, paddingPx) {
  const projected = (points || []).filter(Boolean).map(mercatorProject);
  if (!projected.length) return { center: { lat: 35, lng: 135 }, zoom: 5 };
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of projected) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const usableW = Math.max(180, width - paddingPx * 2);
  const usableH = Math.max(160, height - paddingPx * 2);
  const zoomX = Math.log2(usableW / (TILE_SIZE * Math.max(1e-8, maxX - minX)));
  const zoomY = Math.log2(usableH / (TILE_SIZE * Math.max(1e-8, maxY - minY)));
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
  const transitionSec = Math.min(3.2, outroSec * 0.68);
  const out = [];
  for (let i = 1; i <= count; i += 1) {
    const localSec = i / fps;
    const t = smootherstep(clamp(localSec / Math.max(0.01, transitionSec), 0, 1));
    out.push({
      kind: 'OUTRO',
      timeSec: startTimeSec + localSec,
      segmentIndex: last.segmentIndex,
      sceneId: last.sceneId + 1,
      sceneBreak: i === 1,
      progress: 1,
      position: last.position,
      center: mercatorUnproject({
        x: startCenter.x + (endCenter.x - startCenter.x) * t,
        y: startCenter.y + (endCenter.y - startCenter.y) * t
      }),
      zoom: last.zoom + (overview.zoom - last.zoom) * t,
      targetZoom: overview.zoom,
      viewSpanKm: null,
      mobilityClass: 'OVERVIEW',
      speedKmh: 0
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
    const movePx = Math.min(Math.max(0, errorPx - 5), maxStepPx);
    const ratio = movePx / Math.max(errorPx, 1e-9);
    let nextX = previousX + errorPxX * ratio / scale;
    let nextY = previousY + errorPxY * ratio / scale;

    const marker = mercatorProject(raw[i].position);
    const safeX = width * 0.40;
    const safeY = height * 0.38;
    const markerPxX = (marker.x - nextX) * scale;
    const markerPxY = (marker.y - nextY) * scale;
    if (Math.abs(markerPxX) > safeX) nextX += (markerPxX - Math.sign(markerPxX) * safeX) / scale;
    if (Math.abs(markerPxY) > safeY) nextY += (markerPxY - Math.sign(markerPxY) * safeY) / scale;
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
  if (path.points.length === 1 || path.totalMeters <= 0) return { ...path.points.at(-1) };
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

function samplePoints(points, maxPoints) {
  const clean = (points || []).filter(Boolean);
  if (clean.length <= maxPoints) return clean;
  const step = (clean.length - 1) / (maxPoints - 1);
  const out = [];
  for (let i = 0; i < maxPoints; i += 1) out.push(clean[Math.round(i * step)]);
  return out;
}

function smootherstep(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
function round5(value) { return Math.round(value / 5) * 5; }
