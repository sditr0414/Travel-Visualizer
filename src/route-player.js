export class RoutePlayer {
  constructor({ map, plan, onFrame, lockToPosition = true }) {
    this.map = map;
    this.plan = plan;
    this.onFrame = onFrame;
    this.lockToPosition = lockToPosition;
    this.playing = false;
    this.startedAt = 0;
    this.pauseAt = 0;
    this.raf = 0;
    this.lastRenderedFrame = -1;
    this.lastProgress = -1;
    this.lastProgressPaintAt = -Infinity;
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
    this.lastProgressPaintAt = -Infinity;
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

    if (frameIndex !== this.lastRenderedFrame) this.renderFrame(frameIndex, false, now);

    if (this.pauseAt >= this.plan.durationSec) {
      this.pause();
      return;
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  renderFrame(index, force = false, now = performance.now()) {
    const clampedIndex = Math.max(0, Math.min(index, this.plan.frames.length - 1));
    const frame = this.plan.frames[clampedIndex];
    if (!frame) return;
    if (!force && clampedIndex === this.lastRenderedFrame) return;

    const cameraCenter = this.lockToPosition ? frame.position : frame.center;
    this.map.jumpTo({ center: [cameraCenter.lng, cameraCenter.lat], zoom: frame.zoom });
    this.lastRenderedFrame = clampedIndex;

    if (force || now - this.lastProgressPaintAt >= 80 || frame.routeProgress >= 0.9999) {
      this.paintProgress(frame.routeProgress);
      this.lastProgressPaintAt = now;
    }

    this.onFrame?.(frame, clampedIndex);
  }

  paintProgress(progress) {
    const p = Math.max(0, Math.min(1, Number(progress) || 0));
    if (Math.abs(p - this.lastProgress) < 0.0005 && p !== 0 && p !== 1) return;
    if (!this.map.getLayer('route-progress')) return;
    const active = '#ef4444';
    const hidden = 'rgba(239, 68, 68, 0)';
    this.map.setPaintProperty('route-progress', 'line-gradient', [
      'step', ['line-progress'], active, p, hidden
    ]);
    this.lastProgress = p;
  }
}
