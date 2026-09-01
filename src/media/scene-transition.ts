const MEDIA_MIN_MS = 80;
const MEDIA_MAX_MS = 900;
const TRANSIT_MIN_MS = 16;
const TRANSIT_MAX_MS = 320;

export function sceneTransitionDurationMs(displaySec: number): number {
  const seconds = positiveSeconds(displaySec, 3);
  return Math.round(Math.min(MEDIA_MAX_MS, Math.max(MEDIA_MIN_MS, seconds * 100)));
}

export function transitSceneTransitionDurationMs(displaySec: number): number {
  const seconds = positiveSeconds(displaySec, 1);
  return Math.round(Math.min(TRANSIT_MAX_MS, Math.max(TRANSIT_MIN_MS, seconds * 100)));
}

function positiveSeconds(value: number, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}
