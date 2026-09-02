import type { DurationLimits, Movement, PlaybackPlan } from './types';

export const PlaybackPacing: Readonly<{ LOCAL_DAYS: 'LOCAL_DAYS'; GLOBAL: 'GLOBAL' }>;
export function durationLimitsForMovements(
  movements: Movement[],
  options?: { selectedDays?: number | null }
): DurationLimits;
export function planPlayback(
  movements: Movement[],
  options?: {
    fps?: number;
    targetTotalSeconds?: number;
    maxTotalSeconds?: number;
    viewportWidth?: number;
    viewportHeight?: number;
    pacingMode?: 'LOCAL_DAYS' | 'GLOBAL';
    selectedDays?: number | null;
  }
): Omit<PlaybackPlan, 'cameraMode'>;
