/** NaN elapsed time freezes an outgoing scene; finite elapsed time supports seeking both ways. */
export function videoTargetTime(elapsed: number, duration: number, mode: 'PLAY' | 'THUMBNAIL', current: number): number {
  if (!Number.isFinite(elapsed)) return Math.max(0, Number(current) || 0);
  if (mode === 'THUMBNAIL') return 0;
  const end = Number.isFinite(duration) ? Math.max(0, duration - 0.01) : Infinity;
  return Math.min(Math.max(0, elapsed), end);
}
