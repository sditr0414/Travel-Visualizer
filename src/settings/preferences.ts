import { useEffect, useState } from 'react';
import type { CameraMode, PacingMode, PhotoViewMode } from '../types';

export interface Preferences {
  cameraMode: CameraMode;
  pacingMode: PacingMode;
  zoomOffset: number;
  lockToPosition: boolean;
  showFullRouteWhenPaused: boolean;
  includeFlights: boolean;
  photoViewMode: PhotoViewMode;
  photoDisplaySec: number;
  photoDetailZoomMode: 'AUTO' | 'OFF';
  photoDetailZoomStrength: number;
  onlinePlaceLookup: boolean;
  showDayMarkers: boolean;
  dayMarkerSec: number;
  videoMode: 'PLAY' | 'THUMBNAIL';
  videoMuted: boolean;
  videoMaxSec: number;
}
export const DEFAULT_PREFERENCES: Preferences = {
  cameraMode: 'AUTO', pacingMode: 'LOCAL_DAYS', zoomOffset: 0, lockToPosition: true, showFullRouteWhenPaused: false,
  includeFlights: true, photoViewMode: 'PREVIEW', photoDisplaySec: 3,
  photoDetailZoomMode: 'AUTO', photoDetailZoomStrength: 1, onlinePlaceLookup: false, showDayMarkers: true,
  dayMarkerSec: 2.5, videoMode: 'PLAY', videoMuted: true, videoMaxSec: 5
};
const KEY = 'travel-camera.preferences.v3';

export function readPreferences(): Preferences {
  const result = { ...DEFAULT_PREFERENCES };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return result;
    const choices = { cameraMode: ['AUTO', 'DAY', 'SEGMENT'], pacingMode: ['LOCAL_DAYS', 'GLOBAL'], photoViewMode: ['PREVIEW', 'ALL'], photoDetailZoomMode: ['AUTO', 'OFF'], videoMode: ['PLAY', 'THUMBNAIL'] };
    const ranges = { zoomOffset: [-1.5, 1.5], photoDisplaySec: [1, 10], photoDetailZoomStrength: [0.5, 1.5], dayMarkerSec: [1, 5], videoMaxSec: [2, 15] };
    for (const key of Object.keys(result) as Array<keyof Preferences>) {
      const value = saved[key];
      if (key in choices && (choices as Record<string, string[]>)[key].includes(value)) Object.assign(result, { [key]: value });
      else if (key in ranges && typeof value === 'number' && Number.isFinite(value)) {
        const [min, max] = (ranges as Record<string, number[]>)[key];
        Object.assign(result, { [key]: Math.min(max, Math.max(min, value)) });
      } else if (typeof result[key] === 'boolean' && typeof value === 'boolean') Object.assign(result, { [key]: value });
    }
  } catch { /* Storage can be unavailable in private or restricted browsing. */ }
  return result;
}

export function usePreferences() {
  const [preferences, setPreferences] = useState(readPreferences);
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(preferences)); } catch { /* Preferences are optional. */ }
  }, [preferences]);
  const update = <K extends keyof Preferences>(key: K, value: Preferences[K]) => setPreferences(current => ({ ...current, [key]: value }));
  return { preferences, update, reset: () => setPreferences({ ...DEFAULT_PREFERENCES }) };
}
