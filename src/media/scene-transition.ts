export function sceneTransitionDurationMs(photoDisplaySec: number): number {
  return Math.round(Math.min(900, Math.max(300, (Number(photoDisplaySec) || 3) * 180)));
}
