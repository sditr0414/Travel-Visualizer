export const PHOTO_SPLIT_BREAKPOINT = 820;

const DESKTOP_DEFAULT = 0.60;
const MOBILE_DEFAULT = 0.52;
const DESKTOP_MIN = 0.38;
const DESKTOP_MAX = 0.78;
const MOBILE_MIN = 0.34;
const MOBILE_MAX = 0.72;

export function defaultPhotoMapShare(narrow) {
  return narrow ? MOBILE_DEFAULT : DESKTOP_DEFAULT;
}

export function photoMapShareLimits(narrow) {
  return narrow
    ? { min: MOBILE_MIN, max: MOBILE_MAX }
    : { min: DESKTOP_MIN, max: DESKTOP_MAX };
}

export function clampPhotoMapShare(value, narrow) {
  const limits = photoMapShareLimits(narrow);
  const fallback = defaultPhotoMapShare(narrow);
  const numeric = Number(value);
  return Math.min(limits.max, Math.max(limits.min, Number.isFinite(numeric) ? numeric : fallback));
}

export function photoMapShareForStage(stage, narrow) {
  return clampPhotoMapShare(stage?.dataset?.photoMapShare, narrow);
}

export function applyPhotoMapShare(stage, value, narrow) {
  const share = clampPhotoMapShare(value, narrow);
  if (stage?.dataset) stage.dataset.photoMapShare = String(share);
  if (stage?.style?.setProperty) {
    stage.style.setProperty('--photo-map-share', `${(share * 100).toFixed(2)}%`);
    stage.style.setProperty('--photo-media-share', `${((1 - share) * 100).toFixed(2)}%`);
    stage.style.setProperty('--photo-map-center', `${(share * 50).toFixed(2)}%`);
  }
  return share;
}

export function photoPaneTarget(share, narrow) {
  const safe = clampPhotoMapShare(share, narrow);
  return narrow
    ? { x: 0.50, y: safe / 2 }
    : { x: safe / 2, y: 0.50 };
}
