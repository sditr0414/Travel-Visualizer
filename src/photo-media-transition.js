const documentRef = globalThis.document;
const TRANSITION_STYLE_ID = 'photo-media-transition-style';
const DEFAULT_ROUTE_DURATION_SEC = 180;

export function photoMediaTransitionMs(routeDurationSec) {
  const numeric = Number(routeDurationSec);
  const seconds = Number.isFinite(numeric) && numeric > 0 ? numeric : DEFAULT_ROUTE_DURATION_SEC;
  return Math.round(Math.min(520, Math.max(140, 140 + seconds * 0.75)));
}

if (documentRef) {
  installTransitionStyles(documentRef);
  const stage = documentRef.querySelector?.('.stage') || null;
  const durationInput = documentRef.querySelector?.('#videoDuration') || null;
  const card = documentRef.querySelector?.('.photo-card') || null;

  // Keep the media card in the transition state machine even while hidden.
  // Its containing photo layer still controls whether photo mode is active.
  card?.classList?.add('media-stop-card');

  const syncDuration = () => {
    const ms = photoMediaTransitionMs(durationInput?.value);
    stage?.style?.setProperty?.('--photo-media-transition', `${ms}ms`);
  };

  syncDuration();
  durationInput?.addEventListener?.('input', syncDuration);
  durationInput?.addEventListener?.('change', syncDuration);
}

function installTransitionStyles(doc) {
  if (doc.getElementById?.(TRANSITION_STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = TRANSITION_STYLE_ID;
  style.textContent = `
.stage { --photo-media-transition: 275ms; }

.journey-movement-indicator {
  display: grid !important;
  opacity: 1;
  visibility: visible;
  transform: scale(1);
  transition:
    opacity var(--photo-media-transition) ease,
    transform var(--photo-media-transition) cubic-bezier(.16, .82, .2, 1),
    visibility 0s linear 0s;
  will-change: opacity, transform;
}

.journey-movement-indicator[hidden] {
  display: grid !important;
  opacity: 0;
  visibility: hidden;
  transform: scale(.955);
  transition:
    opacity var(--photo-media-transition) ease,
    transform var(--photo-media-transition) cubic-bezier(.16, .82, .2, 1),
    visibility 0s linear var(--photo-media-transition);
}

.photo-card.media-stop-card {
  opacity: 1;
  visibility: visible;
  transform: translateX(0) scale(1) !important;
  animation: none !important;
  transition:
    opacity var(--photo-media-transition) ease,
    transform var(--photo-media-transition) cubic-bezier(.16, .82, .2, 1),
    visibility 0s linear 0s;
  will-change: opacity, transform;
}

.photo-card.media-stop-card[hidden] {
  display: grid !important;
  opacity: 0 !important;
  visibility: hidden;
  transform: translateX(14px) scale(.992) !important;
  pointer-events: none;
  transition:
    opacity var(--photo-media-transition) ease,
    transform var(--photo-media-transition) cubic-bezier(.16, .82, .2, 1),
    visibility 0s linear var(--photo-media-transition);
}

@media (max-width: 820px) {
  .photo-card.media-stop-card {
    transform: translateY(0) scale(1) !important;
  }
  .photo-card.media-stop-card[hidden] {
    transform: translateY(12px) scale(.995) !important;
  }
}

@media (prefers-reduced-motion: reduce) {
  .journey-movement-indicator,
  .journey-movement-indicator[hidden],
  .photo-card.media-stop-card,
  .photo-card.media-stop-card[hidden] {
    transition-duration: 0ms !important;
  }
}
`;
  doc.head?.append?.(style);
}
