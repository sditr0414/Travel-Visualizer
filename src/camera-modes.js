import { clamp, haversineMeters, mercatorProject, mercatorUnproject } from './geo.js';

const TILE_SIZE = 512;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
export const ZOOM_OFFSET_MIN = -1.5;
export const ZOOM_OFFSET_MAX = 1.5;

export const CameraMode = Object.freeze({ AUTO: 'AUTO', DAY: 'DAY', SEGMENT: 'SEGMENT' });

export function applyCameraMode(plan, {
  mode = CameraMode.AUTO,
  zoomOffset = 0,
  viewportWidth = 1100,
  viewportHeight = 700
} = {}) {
  if (!plan?.frames?.length || !plan?.segments?.length) return plan;
  const resolvedMode = normalizeCameraMode(mode);
  const resolvedZoomOffset = clamp(Number(zoomOffset) || 0, ZOOM_OFFSET_MIN, ZOOM_OFFSET_MAX);
  const travelFrames = plan.frames.filter(frame => frame.kind === 'TRAVEL');
  if (!travelFrames.length) return { ...plan, cameraMode: resolvedMode, zoomOffset: resolvedZoomOffset, dayProfiles: {} };

  const width = clamp(Number(viewportWidth) || 1100, 320, 3840);
  const height = clamp(Number(viewportHeight) || 700, 240, 2160);
  const dayProfiles = buildDayProfiles(plan.segments, width, height);
  const desired = travelFrames.map(frame => {
    const segment = plan.segments[frame.segmentIndex];
    const dayKey = dayKeyForSegment(segment);
    const dayZoom = dayProfiles.get(dayKey)?.zoom ?? frame.targetZoom ?? frame.zoom;
    const segmentZoom = frame.targetZoom ?? frame.zoom;
    const longDistanceException = isLongDistanceException(segment);
    const baseTargetZoom = resolvedMode === CameraMode.SEGMENT
      ? segmentZoom
      : resolvedMode === CameraMode.DAY
        ? dayModeZoom(dayZoom, segmentZoom, segment)
        : autoZoom({ segmentZoom, dayZoom, segment, longDistanceException, totalSeconds: plan.durationSec });
    const targetZoom = applyLocalZoomOffset(baseTargetZoom, segment, resolvedZoomOffset);
    Object.assign(frame, { cameraMode: resolvedMode, dayKey, dayZoom, segmentZoom, longDistanceException, modeBaseTargetZoom: baseTargetZoom, modeTargetZoom: targetZoom });
    return targetZoom;
  });
  const lockedDesired = travelFrames.map((frame, index) => positionLockTargetZoom(
    desired[index], plan.segments[frame.segmentIndex], frame.longDistanceException, resolvedMode
  ));

  const smoothed = smoothZoomTrajectory(desired, plan.fps || 60, resolvedMode, plan.durationSec);
  const smoothedLocked = smoothZoomTrajectory(lockedDesired, plan.fps || 60, resolvedMode, plan.durationSec);
  for (let index = 0; index < travelFrames.length; index += 1) {
    travelFrames[index].zoom = smoothed[index];
    travelFrames[index].lockedZoom = smoothedLocked[index];
  }
  recomputeTravelCenters(travelFrames, width, height, plan.fps || 60, { zoomKey: 'zoom', centerKey: 'center', targetProjected: targetCenterProjected });
  recomputeTravelCenters(travelFrames, width, height, plan.fps || 60, { zoomKey: 'lockedZoom', centerKey: 'lockedCenter', targetProjected: frame => mercatorProject(frame.position) });
  reconnectOutroZoom(plan.frames, travelFrames.at(-1)?.zoom, plan.fps || 60);
  return { ...plan, cameraMode: resolvedMode, zoomOffset: resolvedZoomOffset, dayProfiles: serializableProfiles(dayProfiles) };
}

function buildDayProfiles(segments, width, height) {
  const grouped = new Map();
  for (const segment of segments) {
    const key = dayKeyForSegment(segment);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(segment);
  }
  const profiles = new Map();
  for (const [key, daySegments] of grouped) {
    const localSegments = daySegments.filter(segment => !isLongDistanceException(segment));
    const candidates = localSegments.length ? localSegments : daySegments;
    const clusters = buildLocalClusters(candidates);
    const dominant = clusters.sort((a, b) => b.score - a.score)[0];
    const fallback = daySegments.flatMap(segment => segmentPoints(segment));
    const points = dominant?.points?.length >= 2 ? dominant.points : fallback;
    const overview = overviewForPoints(points, width, height, 105);
    profiles.set(key, { center: overview.center, zoom: clamp(overview.zoom - 0.12, 8.8, 14.8), clusterCount: Math.max(1, clusters.length), localSegmentCount: localSegments.length });
  }
  return profiles;
}

function buildLocalClusters(segments) {
  const clusters = [];
  let cluster = null;
  for (const segment of segments) {
    const points = segmentPoints(segment);
    if (!points.length) continue;
    const first = points[0];
    const split = cluster?.lastPoint && haversineMeters(cluster.lastPoint, first) > 35_000;
    if (!cluster || split) {
      cluster = { points: [], score: 0, lastPoint: null };
      clusters.push(cluster);
    }
    cluster.points.push(...points);
    cluster.lastPoint = points.at(-1);
    const km = segmentDistanceKm(segment);
    cluster.score += 1 + Math.log2(1 + km) + Math.min(1.5, Math.max(0, segment.videoSec || 0) * 0.15);
  }
  return clusters;
}

function autoZoom({ segmentZoom, dayZoom, segment, longDistanceException, totalSeconds }) {
  const mobility = segment.inference?.mobilityClass;
  if (mobility === 'FLIGHT') return segmentZoom;
  if (longDistanceException) {
    const hardLimit = mobility === 'FAST_GROUND' ? 2.8 : 2.5;
    const sceneSeconds = Math.max(0.1, segment.videoSec || 0);
    const timeLimitedDepth = clamp(0.9 + sceneSeconds * 0.72, 1.15, hardLimit);
    const preferred = clamp(segmentZoom, dayZoom - timeLimitedDepth, dayZoom + 0.1);
    return Math.min(preferred, segmentZoom + playableZoomAllowance(segment));
  }
  const shortVideo = totalSeconds <= 90;
  const preferred = clamp(segmentZoom, dayZoom - (shortVideo ? 0.18 : 0.32), dayZoom + (shortVideo ? 0.32 : 0.55));
  return Math.min(preferred, segmentZoom + playableZoomAllowance(segment));
}

function dayModeZoom(dayZoom, segmentZoom, segment) {
  return segment.inference?.mobilityClass === 'FLIGHT' ? segmentZoom : Math.min(dayZoom, segmentZoom + playableZoomAllowance(segment));
}

function playableZoomAllowance(segment) {
  return ({ WALK: 0.45, BIKE: 0.40, URBAN_TRANSIT: 0.35, ROAD: 0.30, FAST_GROUND: 0.24, FERRY: 0.20, FLIGHT: 0, UNKNOWN: 0.30 })[segment.inference?.mobilityClass] ?? 0.30;
}

function applyLocalZoomOffset(baseZoom, segment, zoomOffset) {
  return segment.inference?.mobilityClass === 'FLIGHT' ? baseZoom : clamp(baseZoom + zoomOffset, 4, 17.3);
}

function positionLockTargetZoom(baseZoom, segment, longDistanceException, mode) {
  if (mode !== CameraMode.AUTO || !longDistanceException || segment.inference?.mobilityClass === 'FLIGHT') return baseZoom;
  const mobility = segment.inference?.mobilityClass;
  const km = segmentDistanceKm(segment);
  let extra = 0;
  if (mobility === 'FAST_GROUND') extra = km >= 450 ? 0.78 : km >= 300 ? 0.62 : km >= 150 ? 0.42 : km >= 80 ? 0.25 : 0.12;
  else if (mobility === 'FERRY') extra = km >= 150 ? 0.52 : km >= 70 ? 0.36 : 0.20;
  else if (mobility === 'ROAD') extra = km >= 250 ? 0.46 : km >= 140 ? 0.32 : 0.18;
  else if (mobility === 'URBAN_TRANSIT') extra = km >= 70 ? 0.24 : 0.12;
  else if (mobility === 'UNKNOWN') extra = km >= 150 ? 0.28 : 0.14;
  return clamp(baseZoom - extra, 4, 17.3);
}

function smoothZoomTrajectory(values, fps, mode, totalSeconds) {
  if (values.length < 2) return [...values];
  const config = zoomMotionConfig(mode, totalSeconds);
  let out = anticipateZoomOut(values, fps, config.previewSec, config.previewAllowance);
  out = kinematicZoomOutEnvelope(out, fps, config.maxVelocity, config.previewAllowance);
  out = asymmetricSmooth(out, fps, config.zoomOutTau, config.zoomInTau);
  out = limitKinematics(out, fps, config.maxVelocity, config.maxAcceleration);
  out = suppressZoomReversals(out, fps, config.reversalHoldSec, config.reversalThreshold);
  out = smoothEma(out, config.finalTau, fps);
  out = limitKinematics(out, fps, config.maxVelocity * 0.82, config.maxAcceleration * 0.72);
  return out.map(value => clamp(value, 4, 17.3));
}

function suppressZoomReversals(values, fps, holdSec, threshold) {
  if (values.length < 3) return [...values];
  const out = [...values];
  const holdFrames = Math.max(1, Math.round(Math.max(0, holdSec) * Math.max(1, fps)));
  let direction = 0;
  let pendingDirection = 0;
  let pendingStart = -1;

  for (let index = 1; index < values.length; index += 1) {
    const delta = values[index] - out[index - 1];
    const requestedDirection = Math.abs(delta) < 0.0001 ? 0 : Math.sign(delta);
    if (requestedDirection === 0) {
      out[index] = out[index - 1];
      continue;
    }
    if (direction === 0 || requestedDirection === direction) {
      direction = requestedDirection;
      pendingDirection = 0;
      pendingStart = -1;
      out[index] = values[index];
      continue;
    }
    if (pendingDirection !== requestedDirection) {
      pendingDirection = requestedDirection;
      pendingStart = index;
    }
    const persistent = index - pendingStart >= holdFrames;
    const decisiveZoomOut = requestedDirection < 0 && Math.abs(values[index] - out[index - 1]) >= threshold;
    if (persistent || decisiveZoomOut) {
      direction = requestedDirection;
      pendingDirection = 0;
      pendingStart = -1;
      out[index] = values[index];
    } else {
      out[index] = out[index - 1];
    }
  }
  return out;
}

function kinematicZoomOutEnvelope(values, fps, maxVelocity, allowance) {
  const out = [...values];
  const maxStep = Math.max(0.001, maxVelocity / Math.max(1, fps));
  for (let index = out.length - 2; index >= 0; index -= 1) out[index] = Math.min(out[index], out[index + 1] + maxStep + allowance / Math.max(1, fps));
  return out;
}

function zoomMotionConfig(mode, totalSeconds) {
  const short = totalSeconds <= 90;
  if (mode === CameraMode.SEGMENT) return short
    ? { previewSec: 3.0, previewAllowance: 0.15, zoomOutTau: 0.95, zoomInTau: 1.85, maxVelocity: 0.88, maxAcceleration: 1.02, finalTau: 0.20, reversalHoldSec: 0.80, reversalThreshold: 0.16 }
    : { previewSec: 2.2, previewAllowance: 0.18, zoomOutTau: 0.82, zoomInTau: 1.60, maxVelocity: 0.98, maxAcceleration: 1.18, finalTau: 0.17, reversalHoldSec: 0.72, reversalThreshold: 0.18 };
  if (short) return { previewSec: 4.6, previewAllowance: 0.13, zoomOutTau: 1.12, zoomInTau: 2.30, maxVelocity: 0.72, maxAcceleration: 0.78, finalTau: 0.25, reversalHoldSec: 1.0, reversalThreshold: 0.16 };
  if (totalSeconds <= 180) return { previewSec: 3.6, previewAllowance: 0.15, zoomOutTau: 0.98, zoomInTau: 2.0, maxVelocity: 0.78, maxAcceleration: 0.88, finalTau: 0.22, reversalHoldSec: 0.90, reversalThreshold: 0.17 };
  return { previewSec: 3.0, previewAllowance: 0.17, zoomOutTau: 0.88, zoomInTau: 1.80, maxVelocity: 0.85, maxAcceleration: 1.0, finalTau: 0.19, reversalHoldSec: 0.82, reversalThreshold: 0.18 };
}

function reconnectOutroZoom(frames, startZoom, fps) {
  if (!Number.isFinite(startZoom)) return;
  const outro = frames.filter(frame => frame.kind === 'OUTRO');
  if (!outro.length) return;
  const finalZoom = outro.at(-1).targetZoom ?? outro.at(-1).zoom;
  const transitionFrames = Math.max(1, Math.min(outro.length, Math.round(Math.min(3.2, outro.length / fps * 0.68) * fps)));
  for (let index = 0; index < outro.length; index += 1) {
    const t = smootherstep(clamp((index + 1) / transitionFrames, 0, 1));
    outro[index].zoom = startZoom + (finalZoom - startZoom) * t;
  }
}

function recomputeTravelCenters(frames, width, height, fps, options) {
  let sceneStart = 0;
  for (let index = 1; index <= frames.length; index += 1) {
    if (index === frames.length || frames[index].sceneId !== frames[sceneStart].sceneId) {
      solveCenterRange(frames, sceneStart, index, width, height, fps, options);
      sceneStart = index;
    }
  }
}

function solveCenterRange(frames, start, end, width, height, fps, { zoomKey, centerKey, targetProjected }) {
  if (start >= end) return;
  frames[start][centerKey] = mercatorUnproject(targetProjected(frames[start]));
  for (let index = start + 1; index < end; index += 1) {
    const frame = frames[index];
    const previous = mercatorProject(frames[index - 1][centerKey]);
    const target = targetProjected(frame);
    const scale = TILE_SIZE * 2 ** frame[zoomKey];
    const errorPxX = (target.x - previous.x) * scale;
    const errorPxY = (target.y - previous.y) * scale;
    const errorPx = Math.hypot(errorPxX, errorPxY);
    const maxStepPx = Math.max(120, Number(frame.maxPanPxPerSec) || 240) / Math.max(1, fps);
    const ratio = Math.min(Math.max(0, errorPx - 5), maxStepPx) / Math.max(errorPx, 1e-9);
    let nextX = previous.x + errorPxX * ratio / scale;
    let nextY = previous.y + errorPxY * ratio / scale;
    const marker = mercatorProject(frame.position);
    const markerPxX = (marker.x - nextX) * scale;
    const markerPxY = (marker.y - nextY) * scale;
    if (Math.abs(markerPxX) > width * 0.40) nextX += (markerPxX - Math.sign(markerPxX) * width * 0.40) / scale;
    if (Math.abs(markerPxY) > height * 0.38) nextY += (markerPxY - Math.sign(markerPxY) * height * 0.38) / scale;
    frame[centerKey] = mercatorUnproject({ x: nextX, y: nextY });
  }
}

function targetCenterProjected(frame) {
  return Number.isFinite(frame.targetCenterX) && Number.isFinite(frame.targetCenterY)
    ? { x: frame.targetCenterX, y: frame.targetCenterY }
    : mercatorProject(frame.center || frame.position);
}

function isLongDistanceException(segment) {
  const km = segmentDistanceKm(segment);
  return ({ FLIGHT: true, FAST_GROUND: km >= 55, FERRY: km >= 35, ROAD: km >= 90, URBAN_TRANSIT: km >= 40, UNKNOWN: km >= 75 })[segment.inference?.mobilityClass] ?? false;
}

function segmentDistanceKm(segment) {
  return Math.max(Math.max(0, segment.inference?.distanceKm || 0), Math.max(0, segment.path?.totalMeters || 0) / 1000);
}

function segmentPoints(segment) {
  return (segment.path?.points?.length ? segment.path.points : segment.points || [segment.start, segment.end]).filter(point => Number.isFinite(point?.lat) && Number.isFinite(point?.lng));
}

function dayKeyForSegment(segment) {
  const ms = Number.isFinite(segment?.startMs) && Number.isFinite(segment?.endMs) ? (segment.startMs + segment.endMs) / 2 : segment?.startMs;
  return Number.isFinite(ms) ? new Date(ms + JST_OFFSET_MS).toISOString().slice(0, 10) : 'unknown';
}

function overviewForPoints(points, width, height, paddingPx) {
  const projected = (points || []).filter(Boolean).map(mercatorProject);
  if (!projected.length) return { center: { lat: 35, lng: 135 }, zoom: 5 };
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const point of projected) { minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x); minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y); }
  const zoomX = Math.log2(Math.max(180, width - paddingPx * 2) / (TILE_SIZE * Math.max(1e-8, maxX - minX)));
  const zoomY = Math.log2(Math.max(160, height - paddingPx * 2) / (TILE_SIZE * Math.max(1e-8, maxY - minY)));
  return { center: mercatorUnproject({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 }), zoom: clamp(Math.min(zoomX, zoomY), 3.5, 15.2) };
}

function anticipateZoomOut(values, fps, seconds, allowance) {
  const radius = Math.max(1, Math.round(seconds * fps));
  const out = [...values];
  const deque = [];
  for (let index = values.length - 1; index >= 0; index -= 1) {
    while (deque.length && deque[0] > index + radius) deque.shift();
    while (deque.length && values[deque.at(-1)] >= values[index]) deque.pop();
    deque.push(index);
    out[index] = Math.min(values[index], values[deque[0]] + allowance);
  }
  return out;
}

function asymmetricSmooth(values, fps, zoomOutTau, zoomInTau) {
  const out = new Array(values.length);
  let state = values[0]; out[0] = state;
  for (let index = 1; index < values.length; index += 1) {
    const alpha = 1 - Math.exp(-(1 / fps) / Math.max(0.04, values[index] < state ? zoomOutTau : zoomInTau));
    state += alpha * (values[index] - state); out[index] = state;
  }
  return out;
}

function limitKinematics(values, fps, maxVelocity, maxAcceleration) {
  if (values.length < 3) return [...values];
  const dt = 1 / fps;
  const out = [...values];
  let velocity = 0;
  for (let index = 1; index < out.length; index += 1) {
    const desired = clamp((values[index] - out[index - 1]) / dt, -maxVelocity, maxVelocity);
    velocity += clamp(desired - velocity, -maxAcceleration * dt, maxAcceleration * dt);
    out[index] = out[index - 1] + velocity * dt;
  }
  return out;
}

function smoothEma(values, tauSec, fps) {
  const alpha = 1 - Math.exp(-(1 / fps) / Math.max(0.01, tauSec));
  const out = new Array(values.length);
  let state = values[0]; out[0] = state;
  for (let index = 1; index < values.length; index += 1) { state += alpha * (values[index] - state); out[index] = state; }
  return out;
}

function serializableProfiles(profiles) {
  return Object.fromEntries([...profiles.entries()].map(([key, value]) => [key, { center: value.center, zoom: value.zoom, clusterCount: value.clusterCount, localSegmentCount: value.localSegmentCount }]));
}

function normalizeCameraMode(mode) { return Object.values(CameraMode).includes(mode) ? mode : CameraMode.AUTO; }
function smootherstep(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
