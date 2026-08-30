import type { PlaybackPlan } from './types';

export const CameraMode: Readonly<{ AUTO: 'AUTO'; DAY: 'DAY'; SEGMENT: 'SEGMENT' }>;
export const ZOOM_OFFSET_MIN: number;
export const ZOOM_OFFSET_MAX: number;
export function applyCameraMode(plan: PlaybackPlan, options?: {
  mode?: 'AUTO' | 'DAY' | 'SEGMENT';
  zoomOffset?: number;
  viewportWidth?: number;
  viewportHeight?: number;
}): PlaybackPlan;
