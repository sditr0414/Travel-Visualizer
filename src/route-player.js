import { toGeoJSONLine } from './geo.js';

export class RoutePlayer {
  constructor({ map, plan, onFrame }) {
    this.map = map;
    this.plan = plan;
    this.onFrame = onFrame;
    this.playing = false;
    this.startedAt = 0;
    this.pauseAt = 0;
    this.raf = 0;
    this.lastDrawnFrame = -1;
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
    this.lastDrawnFrame = -1;
    this.renderFrame(0);
  }

  seek(seconds) {
    this.pauseAt = Math.max(0, Math.min(this.plan.durationSec, Number(seconds) || 0));
    this.renderFrame(Math.floor(this.pauseAt * this.plan.fps));
    if (this.playing) this.startedAt = performance.now() - this.pauseAt * 1000;
  }

  tick = (now) => {
    if (!this.playing) return;
    const elapsed = (now - this.startedAt) / 1000;
    this.pauseAt = Math.min(elapsed, this.plan.durationSec);
    const frameIndex = Math.min(this.plan.frames.length - 1, Math.floor(this.pauseAt * this.plan.fps));
    this.renderFrame(frameIndex);
    if (this.pauseAt >= this.plan.durationSec) {
      this.pause();
      return;
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  renderFrame(index) {
    const frame = this.plan.frames[Math.max(0, Math.min(index, this.plan.frames.length - 1))];
    if (!frame) return;
    this.map.jumpTo({ center: [frame.center.lng, frame.center.lat], zoom: frame.zoom });
    if (index !== this.lastDrawnFrame) {
      const visited = this.plan.frames.slice(0, index + 1).map(f => f.position);
      const source = this.map.getSource('route-progress');
      if (source) source.setData(toGeoJSONLine(visited));
      this.lastDrawnFrame = index;
    }
    this.onFrame?.(frame, index);
  }
}
