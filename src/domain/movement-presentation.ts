import { inferMobility } from '../mobility.js';
import { shortestLongitudeDelta } from '../geo.js';
import type { MobilityClass, PlaybackSegment } from '../types';

export const MOVEMENT_VISUALS: Record<MobilityClass, { icon: string; label: string }> = {
  WALK: { icon: '🚶', label: '도보' },
  BIKE: { icon: '🚲', label: '자전거' },
  URBAN_TRANSIT: { icon: '🚇', label: '대중교통' },
  FAST_GROUND: { icon: '🚆', label: '기차' },
  FERRY: { icon: '⛴️', label: '페리' },
  FLIGHT: { icon: '✈️', label: '비행기' },
  ROAD: { icon: '🚗', label: '차량' },
  UNKNOWN: { icon: '●', label: '이동 중' }
};

// Use the same transport plausibility limits as the mobility identity rules.
const MAX_SPEED: Record<MobilityClass, number> = {
  WALK: 18, BIKE: 55, URBAN_TRANSIT: 140, FAST_GROUND: 360,
  FERRY: 95, FLIGHT: 1300, ROAD: 220, UNKNOWN: 1000
};

/** Display-only estimates never change the route, camera, or recorded speed. */
export function movementPresentation(segments: PlaybackSegment[], index: number) {
  const segment = segments[index];
  const recorded = segment.inference.mobilityClass;
  const mobilityClass = recorded === 'UNKNOWN' ? estimateGap(segments, index) : recorded;
  return { mobilityClass, label: MOVEMENT_VISUALS[mobilityClass].label };
}

/** Estimate display speed without changing playback timing, camera motion or source data. */
export function movementSpeed(segments: PlaybackSegment[], index: number, frameSpeedKmh: number): string {
  const segment = segments[index];
  if (segment.hideRoute) return '—';
  if (segment.inference.mobilityClass !== 'UNKNOWN' && segment.inferenceSource !== 'visual-gap') {
    return Number.isFinite(frameSpeedKmh) && frameSpeedKmh >= 0 ? `${frameSpeedKmh.toFixed(0)} km/h` : '—';
  }
  const { mobilityClass } = movementPresentation(segments, index);
  const plausible = (speed: number | undefined): speed is number => speed !== undefined && Number.isFinite(speed)
    && speed > 0 && speed <= MAX_SPEED[mobilityClass];
  const calculated = usableGapSpeed(segment);
  if (plausible(calculated)) return `${calculated.toFixed(0)} km/h`;
  const neighbour = matchingNeighbour(segments, index, mobilityClass);
  if (!neighbour) return '—';
  const borrowed = plausible(neighbour.inference.speedKmh) ? neighbour.inference.speedKmh : usableGapSpeed(neighbour);
  return plausible(borrowed) ? `${borrowed.toFixed(0)} km/h` : '—';
}

/** Keep individual movements separate; attach each estimated gap to one matching neighbour. */
export function movementDistances(segments: PlaybackSegment[]): Array<string | null> {
  const distances = segments.map(visibleDistanceMeters);
  const owners = segments.map((segment, index) => {
    if (distances[index] === null || segment.inference.mobilityClass !== 'UNKNOWN') return index;
    const { mobilityClass } = movementPresentation(segments, index);
    if (mobilityClass === 'UNKNOWN') return index;
    const neighbour = matchingNeighbour(segments, index, mobilityClass);
    return neighbour ? neighbour === segments[index - 1] ? index - 1 : index + 1 : index;
  });
  const totals = new Array<number>(segments.length).fill(0);
  distances.forEach((meters, index) => { if (meters !== null) totals[owners[index]] += meters; });
  return distances.map((meters, index) => meters === null ? null : formatMovementDistance(totals[owners[index]]));
}

/** Sum each underlying movement once, including estimated gaps but excluding hidden routes. */
export function totalJourneyDistance(segments: PlaybackSegment[]): string | null {
  const distances = segments.map(visibleDistanceMeters).filter((meters): meters is number => meters !== null);
  return distances.length ? formatMovementDistance(distances.reduce((sum, meters) => sum + meters, 0)) : null;
}

export function visibleDistanceMeters(segment: PlaybackSegment): number | null {
  return segment.hideRoute || !Number.isFinite(segment.distanceMeters) || segment.distanceMeters < 0 ? null : segment.distanceMeters;
}

function matchingNeighbour(segments: PlaybackSegment[], index: number, mobilityClass: MobilityClass): PlaybackSegment | undefined {
  const matching = (candidate?: PlaybackSegment) => candidate && !candidate.hideRoute
    && Number.isFinite(candidate.distanceMeters) && candidate.distanceMeters >= 0
    && candidate.inference.mobilityClass === mobilityClass ? candidate : undefined;
  return closestNeighbourSegment(segments[index], matching(segments[index - 1]), matching(segments[index + 1]), usableGapSpeed(segments[index]));
}

function usableGapSpeed(segment: PlaybackSegment): number | undefined {
  const seconds = (segment.endMs - segment.startMs) / 1000;
  const speed = segment.distanceMeters / seconds * 3.6;
  return Number.isFinite(seconds) && seconds >= 60 && seconds <= 6 * 3600 && speed >= 1 && speed <= 1000 ? speed : undefined;
}

export function formatMovementDistance(meters: number): string {
  const roundedMeters = Math.round(meters);
  return roundedMeters < 1000
    ? `${roundedMeters.toLocaleString('ko-KR')} m`
    : `${(roundedMeters / 1000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })} km`;
}

function estimateGap(segments: PlaybackSegment[], index: number): MobilityClass {
  const segment = segments[index];
  const previous = segments[index - 1];
  const next = segments[index + 1];
  if (segment.hideRoute) return closestNeighbour(segment, previous, next);
  const distance = segment.distanceMeters;
  if (!Number.isFinite(distance) || distance < 30) return closestNeighbour(segment, previous, next);
  const before = segments[index - 1]?.inference.mobilityClass;
  const after = segments[index + 1]?.inference.mobilityClass;

  // Coordinate discontinuities have no reliable elapsed time. Nearby matching
  // transport, or walking to/from a vehicle, is better evidence than gap speed.
  if (before && before === after && before !== 'UNKNOWN' && before !== 'FLIGHT') {
    const limit = before === 'WALK' ? 1000 : before === 'BIKE' ? 2000 : 5000;
    if (distance <= limit) return before;
  }
  if (distance <= 1000 && (before === 'WALK' || after === 'WALK')) return 'WALK';

  // Only use speed when there is an actual, bounded time interval. A GPS jump
  // or overnight stay uses neighbouring movement evidence instead.
  const speed = usableGapSpeed(segment);
  if (speed === undefined) return closestNeighbour(segment, previous, next);
  const inference = inferMobility({ ...segment, inferenceSource: 'display-gap', avgSpeedKmh: speed });
  if (inference.confidence < 0.55) {
    const neighbour = closestNeighbour(segment, previous, next, speed);
    if (neighbour !== 'UNKNOWN') return neighbour;
  }
  return inference.mobilityClass as MobilityClass;
}

function closestNeighbour(segment: PlaybackSegment, previous?: PlaybackSegment, next?: PlaybackSegment, speed?: number): MobilityClass {
  return closestNeighbourSegment(segment, previous, next, speed)?.inference.mobilityClass ?? 'UNKNOWN';
}

function closestNeighbourSegment(segment: PlaybackSegment, previous?: PlaybackSegment, next?: PlaybackSegment, speed?: number): PlaybackSegment | undefined {
  const candidates = [previous, next].filter((candidate): candidate is PlaybackSegment => !!candidate
    && candidate.inference.mobilityClass !== 'UNKNOWN' && !candidate.hideRoute
    && !(segment.hideRoute && candidate.inference.mobilityClass === 'FLIGHT'));
  if (!candidates.length) return undefined;
  const similarityCost = (candidate: PlaybackSegment) => {
    const distanceCost = Number.isFinite(segment.distanceMeters)
      ? Math.abs(Math.log((Math.max(0, segment.distanceMeters) + 100) / (candidate.distanceMeters + 100))) : 0;
    const speedCost = speed === undefined ? 0
      : Math.abs(Math.log((speed + 1) / (candidate.inference.speedKmh + 1)));
    const directionCost = directionDifference(segment, candidate);
    return distanceCost * 0.35 + directionCost * 0.65 + speedCost;
  };
  // Equal evidence continues the preceding movement, avoiding arbitrary flicker.
  return candidates.reduce((best, candidate) => similarityCost(candidate) < similarityCost(best) ? candidate : best);
}

function directionDifference(a: PlaybackSegment, b: PlaybackSegment): number {
  const vector = (segment: PlaybackSegment) => {
    const latitude = (segment.start.lat + segment.end.lat) / 2 * Math.PI / 180;
    return [shortestLongitudeDelta(segment.start.lng, segment.end.lng) * Math.cos(latitude), segment.end.lat - segment.start.lat];
  };
  const [ax, ay] = vector(a);
  const [bx, by] = vector(b);
  const length = Math.hypot(ax, ay) * Math.hypot(bx, by);
  return length > 0 ? 1 - Math.max(-1, Math.min(1, (ax * bx + ay * by) / length)) : 0;
}
