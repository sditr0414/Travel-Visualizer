const MEDIA_MIN_MS = 420;
const MEDIA_MAX_MS = 540;
const MEDIA_REFERENCE_MIN_SEC = 1.5;
const MEDIA_REFERENCE_MAX_SEC = 8;
const TRANSIT_MIN_MS = 16;
const TRANSIT_MAX_MS = 320;

export function sceneTransitionDurationMs(displaySec: number): number {
  const seconds = positiveSeconds(displaySec, 3);
  const ratio = Math.min(1, Math.max(0, (seconds - MEDIA_REFERENCE_MIN_SEC) / (MEDIA_REFERENCE_MAX_SEC - MEDIA_REFERENCE_MIN_SEC)));
  return Math.round(MEDIA_MIN_MS + (MEDIA_MAX_MS - MEDIA_MIN_MS) * ratio);
}

export function transitSceneTransitionDurationMs(displaySec: number): number {
  const seconds = positiveSeconds(displaySec, 1);
  return Math.round(Math.min(TRANSIT_MAX_MS, Math.max(TRANSIT_MIN_MS, seconds * 100)));
}

function positiveSeconds(value: number, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}
