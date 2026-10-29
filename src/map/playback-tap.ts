// A single tap toggles playback; leave all map gestures and controls untouched.
// Wait through MapLibre's 500 ms double-tap window before committing a tap.
export function bindPlaybackTap(surface: HTMLElement, toggle: () => void, enabled: () => boolean = () => true): () => void {
  let gesture: { id: number; x: number; y: number; started: number; tolerance: number; cancelled: boolean } | null = null;
  let pending: ReturnType<typeof setTimeout> | undefined;
  const cancelPending = () => { clearTimeout(pending); pending = undefined; };
  const cancel = () => { cancelPending(); if (gesture) gesture.cancelled = true; };
  const reset = () => { cancelPending(); gesture = null; };
  const down = (event: PointerEvent) => {
    if (!(event.target instanceof HTMLCanvasElement) || !surface.contains(event.target) || !enabled()) { cancel(); return; }
    const repeated = pending !== undefined;
    cancelPending();
    if (gesture) { gesture.cancelled = true; return; }
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, started: event.timeStamp,
      tolerance: event.pointerType === 'mouse' ? 4 : 10,
      cancelled: repeated || !event.isPrimary || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey };
  };
  const move = (event: PointerEvent) => {
    if (gesture?.id === event.pointerId && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) >= gesture.tolerance) gesture.cancelled = true;
  };
  const up = (event: PointerEvent) => {
    if (!gesture || gesture.id !== event.pointerId) return;
    move(event);
    const valid = !gesture.cancelled && event.timeStamp - gesture.started < 500 && event.target instanceof HTMLCanvasElement && surface.contains(event.target);
    gesture = null;
    if (valid) pending = setTimeout(() => { pending = undefined; if (enabled()) toggle(); }, 500);
  };
  const pointerCancel = (event: PointerEvent) => {
    cancelPending();
    if (gesture?.id === event.pointerId) gesture = null;
  };
  window.addEventListener('pointerdown', down);
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', pointerCancel);
  surface.addEventListener('wheel', cancel, { passive: true });
  surface.addEventListener('dblclick', cancel);
  surface.addEventListener('contextmenu', cancel);
  window.addEventListener('blur', reset);
  window.addEventListener('keydown', cancel);
  return () => {
    cancelPending();
    window.removeEventListener('pointerdown', down);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', pointerCancel);
    surface.removeEventListener('wheel', cancel);
    surface.removeEventListener('dblclick', cancel);
    surface.removeEventListener('contextmenu', cancel);
    window.removeEventListener('blur', reset);
    window.removeEventListener('keydown', cancel);
  };
}
