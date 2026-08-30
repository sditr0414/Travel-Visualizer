import type { DurationLimits, Movement, PlaybackPlan } from './types';

export const PlaybackPacing: Readonly<{ LOCAL_DAYS: 'LOCAL_DAYS'; GLOBAL: 'GLOBAL' }>;
export function durationLimitsForMovements(movements: Movement[]): DurationLimits;
export function planPlayback(
  movements: Movement[],
  options?: {
    fps?: number;
    targetTotalSeconds?: number;
    maxTotalSeconds?: number;
    viewportWidth?: number;
    viewportHeight?: number;
    pacingMode?: 'LOCAL_DAYS' | 'GLOBAL';
  }
): Omit<PlaybackPlan, 'cameraMode'>;
