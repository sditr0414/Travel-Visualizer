import { clamp, haversineMeters, mercatorProject } from './geo.js';

const TILE_SIZE = 512;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export const CameraMode = Object.freeze({
  AUTO: 'AUTO',
  DAY: 'DAY',
  SEGMENT: 'SEGMENT'
});

export function applyCameraMode(plan, {
  mode = CameraMode.AUTO,
  viewportWidth = 1100,
  viewportHeight = 700
} = {}) {
  if (!plan?.frames?.length || !plan?.segments?.length) return plan;

  const resolvedMode = normalizeCameraMode(mode);
  const travelFrames = plan.frames.filter(frame => frame.kind === 'TRAVEL');
  if (!travelFrames.length) return { ...plan, cameraMode: resolvedMode, dayProfiles: {} };

  const width = clamp(Number(viewportWidth) || 1100, 320, 3840);
  const height = clamp(Number(viewportHeight) || 700, 240, 2160);
  const dayProfiles = buildDayProfiles(plan.segments, width, height);

  const desired = travelFrames.map(frame => {
    const segment = plan.segments[frame.segmentIndex];
    const dayKey = dayKeyForSegment(segment);
    const dayProfile = dayProfiles.get(dayKey);
    const dayZoom = dayProfile?.zoom ?? frame.targetZoom ?? frame.zoom;
    const segmentZoom = frame.targetZoom ?? frame.zoom;
    const longDistanceException = isLongDistanceException(segment);
    const targetZoom = resolvedMode === CameraMode.SEGMENT
      ? segmentZoom
      : resolvedMode === CameraMode.DAY
        ? dayZoom
        : autoZoom({
            segmentZoom,
            dayZoom,
            segment,
            longDistanceException,
            totalSeconds: plan.durationSec
          });

    frame.cameraMode = resolvedMode;
    frame.dayKey = dayKey;
    frame.dayZoom = dayZoom;
    frame.segmentZoom = segmentZoom;
    frame.longDistanceException = longDistanceException;
    frame.modeTargetZoom = targetZoom;
    return targetZoom;
  });

  const smoothed = smoothZoomTrajectory(desired, plan.fps || 60, resolvedMode, plan.durationSec);
  for (let i = 0; i < travelFrames.length; i += 1) {
    travelFrames[i].zoom = smoothed[i];
  }
  reconnectOutroZoom(plan.frames, travelFrames.at(-1)?.zoom, plan.fps || 60);

  return {
    ...plan,
    cameraMode: resolvedMode,
    dayProfiles: serializableProfiles(dayProfiles)
  };
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

    profiles.set(key, {
      center: overview.center,
      zoom: clamp(overview.zoom - 0.12, 8.8, 14.8),
      clusterCount: Math.max(1, clusters.length),
      localSegmentCount: localSegments.length
    });
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
  if (longDistanceException) {
    const mobility = segment.inference?.mobilityClass;
    const km = segmentDistanceKm(segment);
    const sceneSeconds = Math.max(0.1, segment.videoSec || 0);
    const { hardLimit, distanceFloor } = longDistanceZoomDepth(mobility, km);

    const timeDepth = clamp(0.95 + sceneSeconds * 0.78, 1.15, hardLimit);
    const depth = clamp(Math.max(distanceFloor, timeDepth), 1.15, hardLimit);

    if (mobility === 'FLIGHT') {
      // Flights keep the previous framing rules. The destination-country
      // widening below is intentionally not applied to international travel.
      return clamp(segmentZoom, dayZoom - depth, dayZoom + 0.1);
    }

    // For major local travel the planner's segment zoom used to become a hard
    // floor, preventing the distance-aware policy from opening any wider. Use
    // whichever is wider: the planner's segment framing or the local-distance
    // framing derived from the day's normal scale.
    return clamp(Math.min(segmentZoom, dayZoom - depth), 4, dayZoom + 0.1);
  }

  const shortVideo = totalSeconds <= 90;
  const below = shortVideo ? 0.18 : 0.32;
  const above = shortVideo ? 0.32 : 0.55;
  return clamp(segmentZoom, dayZoom - below, dayZoom + above);
}

function longDistanceZoomDepth(mobility, km) {
  if (mobility === 'FLIGHT') {
    return { hardLimit: 3.6, distanceFloor: 1.15 };
  }

  if (mobility === 'FAST_GROUND') {
    if (km >= 450) return { hardLimit: 4.15, distanceFloor: 3.55 };
    if (km >= 300) return { hardLimit: 3.85, distanceFloor: 3.20 };
    if (km >= 150) return { hardLimit: 3.45, distanceFloor: 2.75 };
    if (km >= 80) return { hardLimit: 3.10, distanceFloor: 2.35 };
    return { hardLimit: 2.85, distanceFloor: 1.80 };
  }

  if (mobility === 'FERRY') {
    if (km >= 150) return { hardLimit: 3.35, distanceFloor: 2.70 };
    if (km >= 70) return { hardLimit: 3.00, distanceFloor: 2.25 };
    return { hardLimit: 2.65, distanceFloor: 1.70 };
  }

  if (mobility === 'ROAD') {
    if (km >= 250) return { hardLimit: 3.15, distanceFloor: 2.55 };
    if (km >= 140) return { hardLimit: 2.85, distanceFloor: 2.20 };
    return { hardLimit: 2.55, distanceFloor: 1.65 };
  }

  return { hardLimit: 2.5, distanceFloor: 1.45 };
}

function smoothZoomTrajectory(values, fps, mode, totalSeconds) {
  if (values.length < 2) return [...values];
  const config = zoomMotionConfig(mode, totalSeconds);
  let out = anticipateZoomOut(values, fps, config.previewSec, config.previewAllowance);
  out = asymmetricSmooth(out, fps, config.zoomOutTau, config.zoomInTau);
  out = limitKinematics(out, fps, config.maxVelocity, config.maxAcceleration);
  out = smoothEma(out, config.finalTau, fps);
  return out.map(value => clamp(value, 4, 17.3));
}

function zoomMotionConfig(mode, totalSeconds) {
  const shortVideo = totalSeconds <= 90;
  const mediumVideo = totalSeconds <= 180;

  if (mode === CameraMode.SEGMENT) {
    if (shortVideo) return {
      previewSec: 2.2, previewAllowance: 0.18,
      zoomOutTau: 0.72, zoomInTau: 1.35,
      maxVelocity: 1.15, maxAcceleration: 1.55, finalTau: 0.13
    };
    return {
      previewSec: 1.5, previewAllowance: 0.22,
      zoomOutTau: 0.58, zoomInTau: 1.15,
      maxVelocity: 1.35, maxAcceleration: 1.9, finalTau: 0.10
    };
  }

  if (shortVideo) return {
    previewSec: 3.8, previewAllowance: 0.16,
    zoomOutTau: 0.92, zoomInTau: 1.75,
    maxVelocity: 1.02, maxAcceleration: 1.30, finalTau: 0.16
  };
  if (mediumVideo) return {
    previewSec: 2.8, previewAllowance: 0.18,
    zoomOutTau: 0.78, zoomInTau: 1.55,
    maxVelocity: 0.92, maxAcceleration: 1.25, finalTau: 0.14
  };
  return {
    previewSec: 2.0, previewAllowance: 0.20,
    zoomOutTau: 0.68, zoomInTau: 1.35,
    maxVelocity: 1.08, maxAcceleration: 1.5, finalTau: 0.12
  };
}

function reconnectOutroZoom(frames, startZoom, fps) {
  if (!Number.isFinite(startZoom)) return;
  const outro = frames.filter(frame => frame.kind === 'OUTRO');
  if (!outro.length) return;
  const finalZoom = outro.at(-1).targetZoom ?? outro.at(-1).zoom;
  const transitionFrames = Math.max(1, Math.min(outro.length, Math.round(Math.min(3.2, outro.length / fps * 0.68) * fps)));
  for (let i = 0; i < outro.length; i += 1) {
    const t = smootherstep(clamp((i + 1) / transitionFrames, 0, 1));
    outro[i].zoom = startZoom + (finalZoom - startZoom) * t;
  }
}

function isLongDistanceException(segment) {
  const km = segmentDistanceKm(segment);
  switch (segment.inference?.mobilityClass) {
    case 'FLIGHT': return true;
    case 'FAST_GROUND': return km >= 55;
    case 'FERRY': return km >= 35;
    case 'ROAD': return km >= 90;
    case 'URBAN_TRANSIT': return km >= 40;
    case 'UNKNOWN': return km >= 75;
    default: return false;
  }
}

function segmentDistanceKm(segment) {
  const inferredKm = Math.max(0, segment.inference?.distanceKm || 0);
  const pathKm = Math.max(0, segment.path?.totalMeters || 0) / 1000;
  return Math.max(inferredKm, pathKm);
}

function segmentPoints(segment) {
  return (segment.path?.points?.length ? segment.path.points : segment.points || [segment.start, segment.end])
    .filter(point => Number.isFinite(point?.lat) && Number.isFinite(point?.lng));
}

function dayKeyForSegment(segment) {
  const ms = Number.isFinite(segment?.startMs) && Number.isFinite(segment?.endMs)
    ? (segment.startMs + segment.endMs) / 2
    : segment?.startMs;
  if (!Number.isFinite(ms)) return 'unknown';
  return new Date(ms + JST_OFFSET_MS).toISOString().slice(0, 10);
}

function overviewForPoints(points, width, height, paddingPx) {
  const projected = (points || []).filter(Boolean).map(mercatorProject);
  if (!projected.length) return { center: { lat: 35, lng: 135 }, zoom: 5 };
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of projected) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const usableW = Math.max(180, width - paddingPx * 2);
  const usableH = Math.max(160, height - paddingPx * 2);
  const spanX = Math.max(1e-8, maxX - minX);
  const spanY = Math.max(1e-8, maxY - minY);
  const zoomX = Math.log2(usableW / (TILE_SIZE * spanX));
  const zoomY = Math.log2(usableH / (TILE_SIZE * spanY));
  const centerProjected = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  return {
    center: mercatorUnprojectLocal(centerProjected),
    zoom: clamp(Math.min(zoomX, zoomY), 3.5, 15.2)
  };
}

function mercatorUnprojectLocal(p) {
  const lng = p.x * 360 - 180;
  const y2 = (0.5 - p.y) * 2 * Math.PI;
  const lat = Math.atan(Math.sinh(y2)) * 180 / Math.PI;
  return { lat, lng };
}

function anticipateZoomOut(values, fps, seconds, allowance) {
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

function asymmetricSmooth(values, fps, zoomOutTau, zoomInTau) {
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

function limitKinematics(values, fps, maxVelocity, maxAcceleration) {
  if (values.length < 3) return [...values];
  const dt = 1 / fps;
  const out = [...values];
  let velocity = 0;
  for (let i = 1; i < out.length; i += 1) {
    const desired = clamp((values[i] - out[i - 1]) / dt, -maxVelocity, maxVelocity);
    velocity += clamp(desired - velocity, -maxAcceleration * dt, maxAcceleration * dt);
    out[i] = out[i - 1] + velocity * dt;
  }
  return out;
}

function smoothEma(values, tauSec, fps) {
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

function serializableProfiles(profiles) {
  return Object.fromEntries([...profiles.entries()].map(([key, value]) => [key, {
    center: value.center,
    zoom: value.zoom,
    clusterCount: value.clusterCount,
    localSegmentCount: value.localSegmentCount
  }]));
}

function normalizeCameraMode(mode) {
  return Object.values(CameraMode).includes(mode) ? mode : CameraMode.AUTO;
}

function smootherstep(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}
