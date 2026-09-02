import type { PlaybackStop } from '../types';
import { isDayMarkerId } from '../media/day-markers';

const BRIDGE_MIN_SECONDS = 2.5;
const BRIDGE_MAX_SECONDS = 8;
const BRIDGE_DISPLAY_MULTIPLIER = 2;

export function heldMediaStopId(routeTimeSec: number, stops: PlaybackStop[]): string | null {
  if (stops.length < 2) return null;

  let low = 0;
  let high = stops.length - 1;
  let previousIndex = -1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    if (stops[middle].atSec <= routeTimeSec) {
      previousIndex = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  if (previousIndex < 0 || previousIndex >= stops.length - 1) return null;
  const previous = stops[previousIndex];
  const next = stops[previousIndex + 1];
  if (isDayMarkerId(previous.id) || isDayMarkerId(next.id)) return null;
  if (routeTimeSec < previous.atSec || routeTimeSec >= next.atSec) return null;

  const gapSec = Math.max(0, next.atSec - previous.atSec);
  return gapSec <= mediaBridgeThresholdSec(previous, next) ? previous.id : null;
}

export function mediaBridgeThresholdSec(previous: PlaybackStop, next: PlaybackStop): number {
  const displaySec = Math.max(
    Math.max(0, Number(previous.durationSec) || 0),
    Math.max(0, Number(next.durationSec) || 0)
  );
  return Math.min(BRIDGE_MAX_SECONDS, Math.max(BRIDGE_MIN_SECONDS, displaySec * BRIDGE_DISPLAY_MULTIPLIER));
}
