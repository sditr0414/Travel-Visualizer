import { clamp, haversineMeters } from './geo.js';

export const PlaybackPacing = Object.freeze({
  LOCAL_DAYS: 'LOCAL_DAYS',
  GLOBAL: 'GLOBAL'
});

export function allocatePlaybackSeconds(segments, movementBudgetSec, fps = 60, mode = PlaybackPacing.LOCAL_DAYS) {
  const items = Array.isArray(segments) ? segments : [];
  if (!items.length) return [];

  const budget = Math.max(0, Number(movementBudgetSec) || 0);
  const safeFps = clamp(Math.round(Number(fps) || 60), 24, 120);
  const global = allocateWeighted(items, budget, safeFps);
  if (mode === PlaybackPacing.GLOBAL || items.length < 2) return global;

  const flightIndices = [];
  const localIndices = [];
  for (let i = 0; i < items.length; i += 1) {
    if (items[i].inference?.mobilityClass === 'FLIGHT') flightIndices.push(i);
    else localIndices.push(i);
  }
  if (!localIndices.length) return global;

  // Keep flight timing exactly as the legacy/global allocator produced it.
  const result = new Array(items.length).fill(0);
  let flightBudget = 0;
  for (const index of flightIndices) {
    result[index] = global[index];
    flightBudget += global[index];
  }
  const localBudget = Math.max(0, budget - flightBudget);
  if (!(localBudget > 0)) return global;

  const dayGroups = groupLocalDays(items, localIndices);
  const dayInfos = dayGroups.map(group => describeDay(items, group));
  const dayWeightTotal = Math.max(1e-9, dayInfos.reduce((sum, day) => sum + day.weight, 0));

  let used = flightBudget;
  for (let d = 0; d < dayGroups.length; d += 1) {
    const group = dayGroups[d];
    const dayBudget = localBudget * dayInfos[d].weight / dayWeightTotal;
    const daySeconds = allocateWithinDay(group.map(index => items[index]), dayBudget, safeFps);
    for (let j = 0; j < group.length; j += 1) {
      result[group[j]] = daySeconds[j];
      used += daySeconds[j];
    }
  }

  // Floating-point correction without changing preserved flight timing.
  const delta = budget - used;
  if (Math.abs(delta) > 1e-9) result[localIndices.at(-1)] += delta;
  return result;
}

export function localDayKey(segment) {
  if (typeof segment?.localDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(segment.localDay)) {
    return segment.localDay;
  }
  const startMs = Number(segment?.startMs);
  if (!Number.isFinite(startMs)) return 'unknown';

  // The current travel project uses Korea/Japan records and the video HUD also
  // uses Asia/Tokyo. Keep day grouping aligned with what the viewer sees.
  return new Date(startMs + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function describeDay(items, indices) {
  const segments = indices.map(index => items[index]);
  const distanceKm = segments.reduce((sum, segment) => sum + segmentDistanceKm(segment), 0);
  const longGroundKm = segments.reduce((sum, segment) => {
    return sum + (segment.inference?.mobilityClass === 'FAST_GROUND' ? segmentDistanceKm(segment) : 0);
  }, 0);

  const firstPoint = segments[0]?.start || segments[0]?.path?.points?.[0];
  const last = segments.at(-1);
  const lastPoint = last?.end || last?.path?.points?.at(-1);
  let maxExcursionKm = 0;
  if (firstPoint) {
    for (const segment of segments) {
      for (const point of [segment.start, segment.end]) {
        if (point) maxExcursionKm = Math.max(maxExcursionKm, haversineMeters(firstPoint, point) / 1000);
      }
    }
  }
  const returnDistanceKm = firstPoint && lastPoint ? haversineMeters(firstPoint, lastPoint) / 1000 : Infinity;
  const roundTrip = longGroundKm >= 200
    && maxExcursionKm >= 120
    && returnDistanceKm <= Math.max(50, maxExcursionKm * 0.28);

  let weight = 1
    + Math.log2(1 + Math.max(0, distanceKm)) * 0.22
    + Math.log2(1 + segments.length) * 0.11;
  if (distanceKm >= 500) weight += 0.35;
  if (roundTrip) weight += 0.9;

  return {
    key: localDayKey(segments[0]),
    distanceKm,
    longGroundKm,
    maxExcursionKm,
    returnDistanceKm,
    roundTrip,
    weight
  };
}

function groupLocalDays(items, indices) {
  const groups = [];
  let currentKey = null;
  let current = null;
  for (const index of indices) {
    const key = localDayKey(items[index]);
    if (key !== currentKey) {
      currentKey = key;
      current = [];
      groups.push(current);
    }
    current.push(index);
  }
  return groups;
}

function allocateWeighted(items, budget, fps) {
  const floorSec = Math.max(2 / fps, Math.min(0.12, budget / (items.length * 3)));
  const floorTotal = floorSec * items.length;
  const distributable = Math.max(0, budget - floorTotal);
  const weightTotal = Math.max(0.001, items.reduce((sum, item) => sum + positiveWeight(item), 0));
  const out = items.map(item => floorSec + distributable * positiveWeight(item) / weightTotal);
  correctTotal(out, budget);
  return out;
}

function allocateWithinDay(items, budget, fps) {
  if (!items.length) return [];
  const genericFloor = Math.max(2 / fps, Math.min(0.10, budget / (items.length * 5)));
  let floors = items.map(item => Math.max(genericFloor, protectedLocalFloor(item)));
  const floorTotal = floors.reduce((sum, value) => sum + value, 0);

  if (floorTotal > budget && floorTotal > 0) {
    const scale = budget / floorTotal;
    floors = floors.map(value => value * scale);
  }

  const usedFloor = floors.reduce((sum, value) => sum + value, 0);
  const distributable = Math.max(0, budget - usedFloor);
  const weightTotal = Math.max(0.001, items.reduce((sum, item) => sum + positiveWeight(item), 0));
  const out = items.map((item, index) => floors[index] + distributable * positiveWeight(item) / weightTotal);
  correctTotal(out, budget);
  return out;
}

function protectedLocalFloor(segment) {
  const km = segmentDistanceKm(segment);
  switch (segment.inference?.mobilityClass) {
    case 'FAST_GROUND':
      if (km >= 300) return 1.55;
      if (km >= 150) return 1.15;
      if (km >= 60) return 0.78;
      return 0;
    case 'FERRY':
      if (km >= 100) return 1.0;
      if (km >= 40) return 0.7;
      return 0;
    case 'ROAD':
      if (km >= 180) return 0.85;
      if (km >= 80) return 0.6;
      return 0;
    default:
      return 0;
  }
}

function segmentDistanceKm(segment) {
  const pathKm = Number(segment?.path?.totalMeters) / 1000;
  const statedKm = Number(segment?.distanceMeters) / 1000;
  return Math.max(Number.isFinite(pathKm) ? pathKm : 0, Number.isFinite(statedKm) ? statedKm : 0);
}

function positiveWeight(item) {
  return Math.max(0.001, Number(item?.weight) || 0.001);
}

function correctTotal(values, target) {
  if (!values.length) return;
  const delta = target - values.reduce((sum, value) => sum + value, 0);
  values[values.length - 1] += delta;
}
