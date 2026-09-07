import { parseLatLng, parseTimeline as parseLegacyTimeline } from '../timeline-parser.js';
import type { ParsedTrip, TimelineDateRange, TimelineScanResult } from '../types';

type TimelineRoot = { semanticSegments?: Array<Record<string, unknown>> };
type ActiveDay = { date: string; ordinal: number; distanceMeters: number };

const MEANINGFUL_ACTIVITY_METERS = 1_000;
const MAX_RECOMMENDED_DAYS = 30;

export function parseTimelineJson(text: string): TimelineRoot {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('올바른 JSON 파일이 아닙니다.');
  }
  if (!value || typeof value !== 'object' || !Array.isArray((value as TimelineRoot).semanticSegments)) {
    throw new Error('Google Timeline의 semanticSegments를 찾을 수 없습니다.');
  }
  if (!(value as TimelineRoot).semanticSegments?.length) {
    throw new Error('Timeline에 이동 기록이 없습니다.');
  }
  return value as TimelineRoot;
}

export function scanTimeline(json: TimelineRoot): TimelineScanResult {
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  const segments = json.semanticSegments ?? [];
  const distanceByDay = new Map<string, number>();

  for (const segment of segments) {
    if (!segment || typeof segment !== 'object') continue;
    const startMs = Date.parse(String(segment.startTime ?? ''));
    const endMs = Date.parse(String(segment.endTime ?? segment.startTime ?? ''));
    if (Number.isFinite(startMs)) start = Math.min(start, startMs);
    if (Number.isFinite(endMs)) end = Math.max(end, endMs);
    if (!Number.isFinite(startMs)) continue;

    const distanceMeters = activityDistanceMeters(segment);
    if (distanceMeters < MEANINGFUL_ACTIVITY_METERS) continue;
    const date = toKoreaDate(startMs);
    distanceByDay.set(date, (distanceByDay.get(date) ?? 0) + distanceMeters);
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    throw new Error('Timeline에서 유효한 날짜를 찾을 수 없습니다.');
  }
  const fullRange = { startDate: toKoreaDate(start), endDate: toKoreaDate(end) };
  return {
    ...fullRange,
    semanticSegments: segments.length,
    recommendedRange: recommendTripRange(distanceByDay, fullRange)
  };
}

export function buildParsedTrip(
  json: TimelineRoot,
  range: TimelineDateRange,
  includeFlights: boolean,
  availableRange: TimelineDateRange = range
): ParsedTrip {
  const parsed = parseLegacyTimeline(json, { ...range, includeFlights });
  return { ...parsed, availableRange };
}

function activityDistanceMeters(segment: Record<string, unknown>): number {
  const activity = segment.activity;
  if (!activity || typeof activity !== 'object') return 0;
  const value = activity as Record<string, unknown>;
  const stated = Number(value.distanceMeters);
  if (Number.isFinite(stated) && stated > 0) return stated;
  const start = readActivityCoordinate(value.start);
  const end = readActivityCoordinate(value.end);
  return start && end ? directDistanceMeters(start, end) : 0;
}

function readActivityCoordinate(value: unknown): { lat: number; lng: number } | null {
  if (!value || typeof value !== 'object') return null;
  return parseLatLng((value as Record<string, unknown>).latLng);
}

function recommendTripRange(distanceByDay: Map<string, number>, fullRange: TimelineDateRange): TimelineDateRange {
  const days: ActiveDay[] = [...distanceByDay.entries()]
    .map(([date, distanceMeters]) => ({ date, distanceMeters, ordinal: dateOrdinal(date) }))
    .filter(day => Number.isFinite(day.ordinal))
    .sort((a, b) => a.ordinal - b.ordinal);
  if (!days.length) return fullRange;

  let left = 0;
  let windowDistance = 0;
  let best = { left: 0, right: 0, distanceMeters: -1, spanDays: Number.POSITIVE_INFINITY };
  for (let right = 0; right < days.length; right += 1) {
    windowDistance += days[right].distanceMeters;
    while (days[right].ordinal - days[left].ordinal + 1 > MAX_RECOMMENDED_DAYS) {
      windowDistance -= days[left].distanceMeters;
      left += 1;
    }
    const spanDays = days[right].ordinal - days[left].ordinal + 1;
    const betterDistance = windowDistance > best.distanceMeters;
    const equalDistance = Math.abs(windowDistance - best.distanceMeters) < 0.001;
    if (betterDistance || (equalDistance && spanDays < best.spanDays) || (equalDistance && spanDays === best.spanDays && days[right].ordinal > days[best.right].ordinal)) {
      best = { left, right, distanceMeters: windowDistance, spanDays };
    }
  }
  return { startDate: days[best.left].date, endDate: days[best.right].date };
}

function dateOrdinal(date: string): number {
  return Date.parse(`${date}T00:00:00Z`) / 86_400_000;
}

function directDistanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const lat1 = a.lat * rad;
  const lat2 = b.lat * rad;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

function toKoreaDate(ms: number): string {
  return new Date(ms + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
