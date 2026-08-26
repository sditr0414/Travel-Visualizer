import { clamp, mercatorProject, mercatorUnproject } from './geo.js';

const TILE_SIZE = 512;
const DEFAULT_TRACKING_MULTIPLIER = 1;

export const TRANSPORT_COLORS = Object.freeze({
  WALK: '#ef4444',
  BIKE: '#22c55e',
  URBAN_TRANSIT: '#3b82f6',
  ROAD: '#f59e0b',
  FAST_GROUND: '#8b5cf6',
  FERRY: '#06b6d4',
  FLIGHT: '#ec4899',
  UNKNOWN: '#64748b',
  OVERVIEW: '#ef4444'
});

export class RoutePlayer {
  constructor({
    map,
    plan,
    onFrame,
    onComplete,
    lockToPosition = true,
    trailSeconds = 3.2,
    trackingSpeed = DEFAULT_TRACKING_MULTIPLIER
  }) {
    this.map = map;
    this.plan = plan;
    this.onFrame = onFrame;
    this.onComplete = onComplete;
    this.lockToPosition = !!lockToPosition;
    this.trailSeconds = Math.max(0.8, Number(trailSeconds) || 3.2);
    this.trackingSpeed = clamp(Number(trackingSpeed) || DEFAULT_TRACKING_MULTIPLIER, 0.5, 2);
    this.playing = false;
    this.startedAt = 0;
    this.pauseAt = 0;
    this.raf = 0;
    this.lastRenderedFrame = -1;
    this.showingOutro = false;
    this.trackedCenter = null;
  }

  setLockToPosition(enabled) {
    this.lockToPosition = !!enabled;
    this.trackedCenter = null;
    this.renderFrame(Math.max(0, this.lastRenderedFrame), true);
  }

  setTrackingSpeed(multiplier) {
    this.trackingSpeed = clamp(Number(multiplier) || DEFAULT_TRACKING_MULTIPLIER, 0.5, 2);
  }

  play() {
    if (!this.plan.frames.length || this.playing) return;
    if (this.pauseAt >= this.plan.durationSec) this.reset();
    this.playing = true;
    const now = performance.now();
    this.startedAt = now - this.pauseAt * 1000;
    this.tick(now);
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this.raf);
  }

  reset() {
    this.pause();
    this.pauseAt = 0;
    this.lastRenderedFrame = -1;
    this.showingOutro = false;
    this.trackedCenter = null;
    this.renderFrame(0, true);
  }

  seek(seconds) {
    this.pauseAt = Math.max(0, Math.min(this.plan.durationSec, Number(seconds) || 0));
    this.trackedCenter = null;
    this.renderFrame(Math.floor(this.pauseAt * this.plan.fps), true);
    if (this.playing) this.startedAt = performance.now() - this.pauseAt * 1000;
  }

  tick = now => {
    if (!this.playing) return;
    this.pauseAt = Math.min((now - this.startedAt) / 1000, this.plan.durationSec);
    const frameIndex = Math.min(this.plan.frames.length - 1, Math.floor(this.pauseAt * this.plan.fps));
    if (frameIndex !== this.lastRenderedFrame) this.renderFrame(frameIndex, false);
    if (this.pauseAt >= this.plan.durationSec) {
      this.pause();
      this.onComplete?.();
      return;
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  renderFrame(index, force = false) {
    const clampedIndex = Math.max(0, Math.min(index, this.plan.frames.length - 1));
    const frame = this.plan.frames[clampedIndex];
    if (!frame || (!force && clampedIndex === this.lastRenderedFrame)) return;

    const isOutro = frame.kind === 'OUTRO';
    let cameraCenter;
    let cameraZoom = frame.zoom;
    if (isOutro) {
      cameraCenter = frame.center;
      this.trackedCenter = null;
    } else if (this.lockToPosition) {
      cameraCenter = frame.lockedCenter || frame.position;
      cameraZoom = Number.isFinite(frame.lockedZoom) ? frame.lockedZoom : frame.zoom;
      this.trackedCenter = { ...cameraCenter };
    } else {
      cameraCenter = this.followCamera(frame, clampedIndex, force || frame.sceneBreak);
    }

    this.map.jumpTo({ center: [cameraCenter.lng, cameraCenter.lat], zoom: cameraZoom });
    this.paintRoute(clampedIndex, isOutro);
    this.lastRenderedFrame = clampedIndex;
    this.onFrame?.(cameraZoom === frame.zoom ? frame : { ...frame, zoom: cameraZoom }, clampedIndex);
  }

  followCamera(frame, frameIndex, reset = false) {
    const desiredProjected = trackingTargetProjected(frame);
    const desired = desiredProjected ? mercatorUnproject(desiredProjected) : frame.center || frame.position;

    if (reset || !this.trackedCenter) {
      this.trackedCenter = { ...frame.position };
      return this.trackedCenter;
    }

    const currentProjected = mercatorProject(this.trackedCenter);
    const scale = TILE_SIZE * 2 ** frame.zoom;
    const dxPx = (desiredProjected.x - currentProjected.x) * scale;
    const dyPx = (desiredProjected.y - currentProjected.y) * scale;
    const distancePx = Math.hypot(dxPx, dyPx);
    const panLimitPxPerSec = trackingPanLimitPxPerSec(
      this.plan,
      frameIndex,
      this.trackingSpeed,
      distancePx
    );
    const maxStepPx = panLimitPxPerSec / Math.max(1, this.plan.fps || 60);
    const movePx = Math.min(Math.max(0, distancePx - 4), maxStepPx);
    const ratio = movePx / Math.max(distancePx, 1e-9);

    this.trackedCenter = mercatorUnproject({
      x: currentProjected.x + dxPx * ratio / scale,
      y: currentProjected.y + dyPx * ratio / scale
    });
    return this.trackedCenter;
  }

  paintRoute(frameIndex, isOutro) {
    const routeSource = this.map.getSource('route-progress');
    const headSource = this.map.getSource('route-head');
    if (!routeSource) return;

    if (isOutro) {
      if (!this.showingOutro) {
        routeSource.setData(fullRouteFeatureCollection(this.plan));
        headSource?.setData(emptyFeatureCollection());
        this.showingOutro = true;
      }
      return;
    }

    this.showingOutro = false;
    routeSource.setData(tailFeatureCollectionForFrame(this.plan, frameIndex, this.trailSeconds));
    headSource?.setData(routeHeadFeatureForFrame(this.plan, frameIndex));
  }
}

export function trackingDurationScale(plan) {
  const recommendedSeconds = Number(plan?.durationLimits?.recommendedSeconds);
  const actualSeconds = Number(plan?.targetTotalSeconds ?? plan?.durationSec);
  if (!(recommendedSeconds > 0) || !(actualSeconds > 0)) return 1;
  return clamp(Math.sqrt(recommendedSeconds / actualSeconds), 0.72, 1.85);
}

export function effectiveTrackingMultiplier(plan, userMultiplier = DEFAULT_TRACKING_MULTIPLIER) {
  const user = clamp(Number(userMultiplier) || DEFAULT_TRACKING_MULTIPLIER, 0.5, 2);
  return trackingDurationScale(plan) * user;
}

/**
 * Measure how fast the planned look-ahead target is moving on screen around this
 * exact frame. Because frame positions already include video time compression,
 * this value automatically rises for short/fast cuts and falls for long/slow cuts.
 * Scene boundaries are never crossed, so teleports cannot contaminate the speed.
 */
export function trackingDemandPxPerSec(plan, frameIndex) {
  const frames = plan?.frames || [];
  if (!frames.length) return 0;
  const fps = Math.max(1, Number(plan?.fps) || 60);
  const i = Math.max(0, Math.min(Number(frameIndex) || 0, frames.length - 1));
  const frame = frames[i];
  if (!frame || frame.kind !== 'TRAVEL') return 0;

  const radius = Math.max(1, Math.round(fps * 0.10));
  let left = i;
  let right = i;

  while (left > 0 && i - left < radius) {
    const candidate = frames[left - 1];
    if (!candidate || candidate.kind !== 'TRAVEL' || candidate.sceneId !== frame.sceneId) break;
    left -= 1;
  }
  while (right < frames.length - 1 && right - i < radius) {
    const candidate = frames[right + 1];
    if (!candidate || candidate.kind !== 'TRAVEL' || candidate.sceneId !== frame.sceneId) break;
    right += 1;
  }

  if (left === right) return 0;
  const a = trackingTargetProjected(frames[left]);
  const b = trackingTargetProjected(frames[right]);
  if (!a || !b) return 0;

  const zoom = Number.isFinite(frame.zoom) ? frame.zoom : 10;
  const scale = TILE_SIZE * 2 ** zoom;
  const distancePx = Math.hypot((b.x - a.x) * scale, (b.y - a.y) * scale);
  const seconds = (right - left) / fps;
  return distancePx / Math.max(seconds, 1 / fps);
}

/**
 * Follow speed is driven primarily by instantaneous video motion. The old global
 * duration factor remains only as a low-speed floor. A small lead margin plus a
 * lag-dependent catch-up term prevents the camera from permanently falling behind.
 */
export function trackingPanLimitPxPerSec(plan, frameIndex, userMultiplier = 1, lagPx = 0) {
  const frames = plan?.frames || [];
  const i = Math.max(0, Math.min(Number(frameIndex) || 0, Math.max(0, frames.length - 1)));
  const frame = frames[i];
  const basePan = Math.max(120, Number(frame?.maxPanPxPerSec) || 240);
  const demand = trackingDemandPxPerSec(plan, i);
  const durationFloor = basePan * trackingDurationScale(plan) * 0.82;
  const synchronized = demand > 0 ? demand * 1.16 + 36 : 0;
  const catchUp = Math.max(0, Number(lagPx) - 36) * 2.8;
  const automatic = clamp(Math.max(basePan * 0.72, durationFloor, synchronized) + catchUp, 120, 2600);
  const user = clamp(Number(userMultiplier) || 1, 0.5, 2);
  return clamp(automatic * user, 80, 3600);
}

function trackingTargetProjected(frame) {
  if (Number.isFinite(frame?.targetCenterX) && Number.isFinite(frame?.targetCenterY)) {
    return { x: frame.targetCenterX, y: frame.targetCenterY };
  }
  const point = frame?.center || frame?.position;
  return point ? mercatorProject(point) : null;
}

export function transportColor(mobilityClass) {
  return TRANSPORT_COLORS[mobilityClass] || TRANSPORT_COLORS.UNKNOWN;
}

export function tailFeatureCollectionForFrame(plan, frameIndex, trailSeconds = 3.2) {
  const frames = travelTailFrames(plan, frameIndex, trailSeconds);
  if (!frames.length) return emptyFeatureCollection();

  const features = [];
  let currentClass = frames[0].mobilityClass || 'UNKNOWN';
  let currentSceneId = frames[0].sceneId;
  let currentPoints = [frames[0].position];

  for (let i = 1; i < frames.length; i += 1) {
    const previous = frames[i - 1];
    const frame = frames[i];
    const frameClass = frame.mobilityClass || 'UNKNOWN';
    const sceneChanged = frame.sceneId !== currentSceneId;
    const classChanged = frameClass !== currentClass;

    if (sceneChanged || classChanged) {
      features.push(lineFeature(currentPoints, currentClass));
      currentClass = frameClass;
      currentSceneId = frame.sceneId;
      currentPoints = sceneChanged
        ? [frame.position]
        : [previous.position, frame.position];
    } else {
      currentPoints.push(frame.position);
    }
  }
  features.push(lineFeature(currentPoints, currentClass));

  return {
    type: 'FeatureCollection',
    features: features.filter(Boolean)
  };
}

export function tailPointsForFrame(plan, frameIndex, trailSeconds = 3.2) {
  const points = travelTailFrames(plan, frameIndex, trailSeconds).map(frame => frame.position);
  if (points.length === 1) points.unshift(points[0]);
  return points;
}

export function routeHeadFeatureForFrame(plan, frameIndex) {
  const frames = plan?.frames || [];
  const i = Math.max(0, Math.min(Number(frameIndex) || 0, frames.length - 1));
  const frame = frames[i];
  if (!frame || frame.kind !== 'TRAVEL') return emptyFeatureCollection();
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {
        mobilityClass: frame.mobilityClass || 'UNKNOWN',
        color: transportColor(frame.mobilityClass)
      },
      geometry: {
        type: 'Point',
        coordinates: [frame.position.lng, frame.position.lat]
      }
    }]
  };
}

export function fullRouteFeatureCollection(plan) {
  const features = [];
  for (const segment of plan?.segments || []) {
    const points = segment.path?.points?.length
      ? samplePoints(segment.path.points, 700)
      : [segment.start, segment.end].filter(Boolean);
    const mobilityClass = segment.inference?.mobilityClass || 'UNKNOWN';
    const feature = lineFeature(points, mobilityClass);
    if (feature) features.push(feature);
  }
  return { type: 'FeatureCollection', features };
}

function travelTailFrames(plan, frameIndex, trailSeconds) {
  const frames = plan?.frames || [];
  if (!frames.length) return [];
  const i = Math.max(0, Math.min(Number(frameIndex) || 0, frames.length - 1));
  const head = frames[i];
  if (!head || head.kind !== 'TRAVEL') return [];

  const seconds = Math.max(0.8, Number(trailSeconds) || 3.2);
  const maxFrames = Math.max(2, Math.round(seconds * (plan.fps || 60)));
  const result = [];

  for (let j = i; j >= 0 && result.length < maxFrames; j -= 1) {
    const frame = frames[j];
    if (!frame || frame.kind !== 'TRAVEL') break;
    result.push(frame);
  }
  result.reverse();
  return result;
}

function lineFeature(points, mobilityClass) {
  const clean = (points || []).filter(point => Number.isFinite(point?.lat) && Number.isFinite(point?.lng));
  if (!clean.length) return null;
  if (clean.length === 1) clean.unshift({ ...clean[0] });
  return {
    type: 'Feature',
    properties: {
      mobilityClass,
      color: transportColor(mobilityClass)
    },
    geometry: {
      type: 'LineString',
      coordinates: clean.map(point => [point.lng, point.lat])
    }
  };
}

function samplePoints(points, maxPoints) {
  const clean = (points || []).filter(Boolean);
  if (clean.length <= maxPoints) return clean;
  const step = (clean.length - 1) / (maxPoints - 1);
  const result = [];
  for (let i = 0; i < maxPoints; i += 1) result.push(clean[Math.round(i * step)]);
  return result;
}

function emptyFeatureCollection() {
  return { type: 'FeatureCollection', features: [] };
}
