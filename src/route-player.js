const ACTIVE = '#ef4444';
const TAIL_GRADIENT = [
  'interpolate', ['linear'], ['line-progress'],
  0, 'rgba(239,68,68,0)',
  0.16, 'rgba(239,68,68,0.18)',
  0.48, 'rgba(239,68,68,0.52)',
  0.78, 'rgba(239,68,68,0.84)',
  1, ACTIVE
];

export class RoutePlayer {
  constructor({ map, plan, onFrame, lockToPosition = true, trailSeconds = 3.2 }) {
    this.map = map;
    this.plan = plan;
    this.onFrame = onFrame;
    this.lockToPosition = lockToPosition;
    this.trailSeconds = Math.max(0.8, Number(trailSeconds) || 3.2);
    this.playing = false;
    this.startedAt = 0;
    this.pauseAt = 0;
    this.raf = 0;
    this.lastRenderedFrame = -1;
    this.showingOutro = false;
  }

  setLockToPosition(enabled) {
    this.lockToPosition = !!enabled;
    this.renderFrame(Math.max(0, this.lastRenderedFrame), true);
  }

  play() {
    if (!this.plan.frames.length || this.playing) return;
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
    this.renderFrame(0, true);
  }

  seek(seconds) {
    this.pauseAt = Math.max(0, Math.min(this.plan.durationSec, Number(seconds) || 0));
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
      return;
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  renderFrame(index, force = false) {
    const clampedIndex = Math.max(0, Math.min(index, this.plan.frames.length - 1));
    const frame = this.plan.frames[clampedIndex];
    if (!frame || (!force && clampedIndex === this.lastRenderedFrame)) return;

    const isOutro = frame.kind === 'OUTRO';
    const cameraCenter = isOutro ? frame.center : this.lockToPosition ? frame.position : frame.center;
    this.map.jumpTo({ center: [cameraCenter.lng, cameraCenter.lat], zoom: frame.zoom });
    this.paintRoute(clampedIndex, isOutro);
    this.lastRenderedFrame = clampedIndex;
    this.onFrame?.(frame, clampedIndex);
  }

  paintRoute(frameIndex, isOutro) {
    const source = this.map.getSource('route-progress');
    if (!source) return;

    if (isOutro) {
      if (!this.showingOutro) {
        source.setData(toLine(this.plan.routeRenderPoints));
        this.map.setPaintProperty('route-progress', 'line-gradient', ACTIVE);
        this.showingOutro = true;
      }
      return;
    }

    if (this.showingOutro) this.showingOutro = false;
    const points = tailPointsForFrame(this.plan, frameIndex, this.trailSeconds);
    source.setData(toLine(points));
    this.map.setPaintProperty('route-progress', 'line-gradient', TAIL_GRADIENT);
  }
}

export function tailPointsForFrame(plan, frameIndex, trailSeconds = 3.2) {
  const frames = plan?.frames || [];
  const i = Math.max(0, Math.min(Number(frameIndex) || 0, frames.length - 1));
  const head = frames[i];
  if (!head || head.kind !== 'TRAVEL') return [];

  const classSeconds = {
    WALK: 4.8,
    BIKE: 4.0,
    URBAN_TRANSIT: 3.2,
    ROAD: 2.8,
    FAST_GROUND: 2.2,
    FERRY: 2.8,
    FLIGHT: 1.6,
    UNKNOWN: 3.0
  }[head.mobilityClass] ?? trailSeconds;
  const seconds = Math.min(Math.max(0.8, trailSeconds), classSeconds);
  const maxFrames = Math.max(2, Math.round(seconds * (plan.fps || 60)));
  const points = [];

  for (let j = i; j >= 0 && points.length < maxFrames; j -= 1) {
    const frame = frames[j];
    if (!frame || frame.kind !== 'TRAVEL' || frame.sceneId !== head.sceneId) break;
    points.push(frame.position);
  }
  points.reverse();

  if (points.length === 1) points.unshift(points[0]);
  return points;
}

function toLine(points) {
  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'LineString',
      coordinates: (points || []).map(p => [p.lng, p.lat])
    }
  };
}
