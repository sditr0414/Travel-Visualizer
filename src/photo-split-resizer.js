import {
  PHOTO_SPLIT_BREAKPOINT,
  applyPhotoMapShare,
  defaultPhotoMapShare,
  photoMapShareForStage,
  photoMapShareLimits
} from './photo-split-layout.js';

const stage = document.querySelector('.stage');
const handle = document.querySelector('#photoSplitHandle');
let dragging = false;

if (stage && handle) {
  syncForViewport();

  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    dragging = true;
    handle.setPointerCapture?.(event.pointerId);
    stage.classList.add('photo-split-resizing');
    updateFromPointer(event);
  });

  handle.addEventListener('pointermove', event => {
    if (!dragging) return;
    updateFromPointer(event);
  });

  const stopDragging = event => {
    if (!dragging) return;
    dragging = false;
    stage.classList.remove('photo-split-resizing');
    try { handle.releasePointerCapture?.(event.pointerId); } catch {}
  };
  handle.addEventListener('pointerup', stopDragging);
  handle.addEventListener('pointercancel', stopDragging);

  handle.addEventListener('keydown', event => {
    const narrow = isNarrow();
    const current = photoMapShareForStage(stage, narrow);
    const limits = photoMapShareLimits(narrow);
    let next = current;
    const step = event.shiftKey ? 0.05 : 0.02;

    if ((!narrow && event.key === 'ArrowLeft') || (narrow && event.key === 'ArrowUp')) next -= step;
    else if ((!narrow && event.key === 'ArrowRight') || (narrow && event.key === 'ArrowDown')) next += step;
    else if (event.key === 'Home') next = limits.min;
    else if (event.key === 'End') next = limits.max;
    else return;

    event.preventDefault();
    setShare(next, narrow);
  });

  handle.addEventListener('dblclick', () => setShare(defaultPhotoMapShare(isNarrow()), isNarrow()));
  window.addEventListener('resize', syncForViewport, { passive: true });
}

function updateFromPointer(event) {
  const rect = stage.getBoundingClientRect();
  if (!(rect.width > 0) || !(rect.height > 0)) return;
  const narrow = isNarrow();
  const raw = narrow
    ? (event.clientY - rect.top) / rect.height
    : (event.clientX - rect.left) / rect.width;
  setShare(raw, narrow);
}

function syncForViewport() {
  const narrow = isNarrow();
  setShare(photoMapShareForStage(stage, narrow), narrow, false);
}

function setShare(value, narrow, announce = true) {
  const share = applyPhotoMapShare(stage, value, narrow);
  const mapPercent = Math.round(share * 100);
  const mediaPercent = 100 - mapPercent;
  const limits = photoMapShareLimits(narrow);

  handle.setAttribute('aria-orientation', narrow ? 'horizontal' : 'vertical');
  handle.setAttribute('aria-valuemin', String(Math.round(limits.min * 100)));
  handle.setAttribute('aria-valuemax', String(Math.round(limits.max * 100)));
  handle.setAttribute('aria-valuenow', String(mapPercent));
  handle.setAttribute('aria-valuetext', `경로 ${mapPercent}%, 사진 ${mediaPercent}%`);
  handle.title = `경로 ${mapPercent}% · 사진 ${mediaPercent}% · 드래그하여 조절`;

  if (announce) {
    window.dispatchEvent(new CustomEvent('travel-camera:photo-split-change', {
      detail: { share, narrow }
    }));
  }
}

function isNarrow() {
  return window.innerWidth <= PHOTO_SPLIT_BREAKPOINT;
}
