import { haversineMeters, pathDistanceMeters, smoothPath, unwrapPath } from '../geo.js';
import { parseLatLng, clipMovement } from '../timeline-parser.js';
import { inferMobility } from '../mobility.js';
import type { Coordinate, Movement, ParsedTrip, TimelineDateRange } from '../types';

interface Position extends Coordinate { timeMs: number; accuracy?: number }
export interface RawTimeline {
  positions: number;
  startMs: number;
  endMs: number;
  movements: Movement[];
}

const MAX_ACCURACY_METERS = 200;
const MAX_GAP_MS = 30 * 60_000;
const MAX_SEGMENT_MS = 30 * 60_000;
const MAX_SPEED_KMH = 1300;
const MIN_DISTANCE_METERS = 30;

/** Raw sensor records are samples, not Google's confirmed activities or visits. */
export function readRawTimeline(signals: unknown[]): RawTimeline {
  const samples: Position[] = [];
  for (const signal of signals) {
    if (!signal || typeof signal !== 'object') continue;
    const position = (signal as Record<string, unknown>).position;
    if (!position || typeof position !== 'object') continue;
    const value = position as Record<string, unknown>;
    const point = parseLatLng(value.LatLng ?? value.latLng);
    const timeMs = typeof value.timestamp === 'string' ? Date.parse(value.timestamp) : NaN;
    const accuracy = value.accuracyMeters;
    if (!point || !Number.isFinite(timeMs)) continue;
    if (accuracy !== undefined && (typeof accuracy !== 'number' || !Number.isFinite(accuracy) || accuracy < 0 || accuracy > MAX_ACCURACY_METERS)) continue;
    samples.push({ ...point, timeMs, accuracy: accuracy as number | undefined });
  }
  // Prefer the more accurate fix if several sensors report the same instant.
  samples.sort((a, b) => a.timeMs - b.timeMs || (a.accuracy ?? Infinity) - (b.accuracy ?? Infinity));
  const unique = samples.filter((point, index) => index === 0 || point.timeMs !== samples[index - 1].timeMs);
  const positions: Position[] = [];
  for (let index = 0; index < unique.length; index++) {
    const point = unique[index], previous = positions.at(-1), next = unique[index + 1];
    // Reject an isolated teleport only when both neighbours contradict it.
    if (previous && next && speed(previous, point) > MAX_SPEED_KMH && speed(point, next) > MAX_SPEED_KMH
      && next.timeMs - previous.timeMs <= MAX_GAP_MS && speed(previous, next) <= MAX_SPEED_KMH) continue;
    positions.push(point);
  }
  if (positions.length < 2) throw new Error('경로를 만들 수 있는 위치·시각 기록이 부족합니다. 유효한 원시 위치 기록이 두 개 이상 있는 파일을 선택해 주세요.');

  const movements: Movement[] = [];
  let group: Position[] = [positions[0]];
  let previousLongitude: number | null = null;
  const flush = () => {
    if (group.length < 2) return;
    const distanceMeters = pathDistanceMeters(group);
    if (distanceMeters < MIN_DISTANCE_METERS) return;
    const first = group[0], last = group[group.length - 1];
    const durationSec = (last.timeMs - first.timeMs) / 1000;
    const points = unwrapPath(smoothPath(group, { maxSegmentMeters: 300 }), previousLongitude);
    previousLongitude = points[points.length - 1].lng;
    movements.push({
      startMs: first.timeMs, endMs: last.timeMs,
      start: { lat: points[0].lat, lng: points[0].lng }, end: { lat: points[points.length - 1].lat, lng: points[points.length - 1].lng },
      points, distanceMeters, pathDistanceMeters: pathDistanceMeters(points), durationSec,
      avgSpeedKmh: distanceMeters / durationSec * 3.6,
      googleType: 'UNKNOWN', googleProbability: 0, activityProbability: 0,
      inferred: true, inferenceSource: 'raw-position', connectionBefore: 'missing-recording'
    });
  };
  for (let index = 1; index < positions.length; index++) {
    const point = positions[index], previous = positions[index - 1];
    if (point.timeMs - previous.timeMs > MAX_GAP_MS || speed(previous, point) > MAX_SPEED_KMH) {
      flush(); group = [point]; continue;
    }
    const anchor = group[group.length - 1];
    // Ignore motion inside the fix's noise radius rather than adding GPS drift to distance.
    const noiseMeters = Math.max(20, anchor.accuracy ?? 20, point.accuracy ?? 20);
    if (haversineMeters(anchor, point) >= noiseMeters) group.push(point);
    if (point.timeMs - group[0].timeMs >= MAX_SEGMENT_MS || koreaDay(point.timeMs) !== koreaDay(group[0].timeMs)) {
      flush(); group = [point];
    }
  }
  flush();
  if (!movements.length) throw new Error('원시 위치 기록은 있지만 재생할 이동 경로가 없습니다. 같은 장소의 기록만 있거나 위치 오차가 큰 파일인지 확인해 주세요.');
  return { positions: positions.length, startMs: positions[0].timeMs, endMs: positions[positions.length - 1].timeMs, movements };
}

export function rawTrip(raw: RawTimeline, range: TimelineDateRange, includeFlights: boolean, availableRange: TimelineDateRange): ParsedTrip {
  const startMs = Date.parse(`${range.startDate}T00:00:00+09:00`);
  const endMs = Date.parse(`${range.endDate}T00:00:00+09:00`) + 86_400_000;
  const movements = raw.movements.flatMap(movement => {
    if (!includeFlights && inferMobility(movement).mobilityClass === 'FLIGHT') return [];
    const clipped = clipMovement(movement, startMs, endMs);
    if (!clipped) return [];
    return [clipped];
  });
  return { movements, routePoints: movements.flatMap(movement => movement.points), visits: [], timelinePaths: [], availableRange };
}

function speed(a: Position, b: Position): number { return haversineMeters(a, b) / ((b.timeMs - a.timeMs) / 1000) * 3.6; }
function koreaDay(timeMs: number): number { return Math.floor((timeMs + 9 * 3_600_000) / 86_400_000); }
