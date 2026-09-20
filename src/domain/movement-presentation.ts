import { inferMobility } from '../mobility.js';
import { shortestLongitudeDelta } from '../geo.js';
import type { MobilityClass, PlaybackSegment } from '../types';

const LABELS: Record<MobilityClass, string> = {
  WALK: '도보', BIKE: '자전거', URBAN_TRANSIT: '대중교통', FAST_GROUND: '기차',
  FERRY: '페리', FLIGHT: '비행기', ROAD: '차량', UNKNOWN: '이동 중'
};

/** Display-only estimates never change the route, camera, or recorded speed. */
export function movementPresentation(segments: PlaybackSegment[], index: number) {
  const segment = segments[index];
  const recorded = segment.inference.mobilityClass;
  const mobilityClass = recorded === 'UNKNOWN' ? estimateGap(segments, index) : recorded;
  return { mobilityClass, label: LABELS[mobilityClass] };
}

function estimateGap(segments: PlaybackSegment[], index: number): MobilityClass {
  const segment = segments[index];
  const previous = segments[index - 1];
  const next = segments[index + 1];
  if (segment.hideRoute) return closestNeighbour(segment, previous, next);
  const distance = segment.distanceMeters;
  if (!Number.isFinite(distance) || distance < 30) return closestNeighbour(segment, previous, next);
  const seconds = (segment.endMs - segment.startMs) / 1000;
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
  if (!Number.isFinite(seconds) || seconds < 60 || seconds > 6 * 3600) return closestNeighbour(segment, previous, next);
  const speed = distance / seconds * 3.6;
  if (speed < 1 || speed > 1000) return closestNeighbour(segment, previous, next);
  const inference = inferMobility({ ...segment, inferenceSource: 'display-gap', avgSpeedKmh: speed });
  if (inference.confidence < 0.55) {
    const neighbour = closestNeighbour(segment, previous, next, speed);
    if (neighbour !== 'UNKNOWN') return neighbour;
  }
  return inference.mobilityClass as MobilityClass;
}

function closestNeighbour(segment: PlaybackSegment, previous?: PlaybackSegment, next?: PlaybackSegment, speed?: number): MobilityClass {
  const candidates = [previous, next].filter((candidate): candidate is PlaybackSegment => !!candidate
    && candidate.inference.mobilityClass !== 'UNKNOWN' && !candidate.hideRoute
    && !(segment.hideRoute && candidate.inference.mobilityClass === 'FLIGHT'));
  if (!candidates.length) return 'UNKNOWN';
  const similarityCost = (candidate: PlaybackSegment) => {
    const distanceCost = Number.isFinite(segment.distanceMeters)
      ? Math.abs(Math.log((Math.max(0, segment.distanceMeters) + 100) / (candidate.distanceMeters + 100))) : 0;
    const speedCost = speed === undefined ? 0
      : Math.abs(Math.log((speed + 1) / (candidate.inference.speedKmh + 1)));
    const directionCost = directionDifference(segment, candidate);
    return distanceCost * 0.35 + directionCost * 0.65 + speedCost;
  };
  // Equal evidence continues the preceding movement, avoiding arbitrary flicker.
  return candidates.reduce((best, candidate) => similarityCost(candidate) < similarityCost(best) ? candidate : best)
    .inference.mobilityClass;
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
