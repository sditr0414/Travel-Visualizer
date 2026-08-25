export class RoutePlayer {
  constructor({ map, plan, onFrame, lockToPosition = true, trailSeconds = 10 }) {
    this.map = map;
    this.plan = plan;
    this.onFrame = onFrame;
    this.lockToPosition = lockToPosition;
    this.trailSeconds = Math.max(2, Number(trailSeconds) || 10);
    this.playing = false;
    this.startedAt = 0;
    this.pauseAt = 0;
    this.raf = 0;
    this.lastRenderedFrame = -1;
    this.lastProgress = -1;
    this.lastTrailStart = -1;
  }

  setLockToPosition(enabled) {
    this.lockToPosition = !!enabled;
    const index = Math.max(0, this.lastRenderedFrame);
    this.renderFrame(index, true);
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
    this.lastProgress = -1;
    this.lastTrailStart = -1;
    this.renderFrame(0, true);
  }

  seek(seconds) {
    this.pauseAt = Math.max(0, Math.min(this.plan.durationSec, Number(seconds) || 0));
    this.renderFrame(Math.floor(this.pauseAt * this.plan.fps), true);
    if (this.playing) this.startedAt = performance.now() - this.pauseAt * 1000;
  }

  tick = (now) => {
    if (!this.playing) return;
    const elapsed = (now - this.startedAt) / 1000;
    this.pauseAt = Math.min(elapsed, this.plan.durationSec);
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
    if (!frame) return;
    if (!force && clampedIndex === this.lastRenderedFrame) return;

    const cameraCenter = this.lockToPosition ? frame.position : frame.center;
    this.map.jumpTo({ center: [cameraCenter.lng, cameraCenter.lat], zoom: frame.zoom });
    this.lastRenderedFrame = clampedIndex;

    this.paintProgress(frame.routeProgress, clampedIndex);
    this.onFrame?.(frame, clampedIndex);
  }

  paintProgress(progress, frameIndex) {
    const p = Math.max(0, Math.min(1, Number(progress) || 0));
    const trailFrames = Math.max(1, Math.round(this.trailSeconds * this.plan.fps));
    const startFrame = this.plan.frames[Math.max(0, frameIndex - trailFrames)];
    let trailStart = Math.max(0, Math.min(p, Number(startFrame?.routeProgress) || 0));

    if (p - trailStart < 1e-7) trailStart = Math.max(0, p - 1e-7);
    if (Math.abs(p - this.lastProgress) < 1e-7 && Math.abs(trailStart - this.lastTrailStart) < 1e-7) return;
    if (!this.map.getLayer('route-progress')) return;

    const active = '#ef4444';
    const hidden = 'rgba(239, 68, 68, 0)';
    this.map.setPaintProperty('route-progress', 'line-gradient', [
      'step', ['line-progress'],
      hidden,
      trailStart, active,
      p, hidden
    ]);
    this.lastProgress = p;
    this.lastTrailStart = trailStart;
  }
}
