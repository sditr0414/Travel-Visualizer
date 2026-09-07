import { parseTimeline as parseLegacyTimeline } from '../timeline-parser.js';
import type { ParsedTrip, TimelineDateRange, TimelineScanResult } from '../types';

type TimelineRoot = { semanticSegments?: Array<Record<string, unknown>> };

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
  for (const segment of segments) {
    if (!segment || typeof segment !== 'object') continue;
    const startMs = Date.parse(String(segment.startTime ?? ''));
    const endMs = Date.parse(String(segment.endTime ?? segment.startTime ?? ''));
    if (Number.isFinite(startMs)) start = Math.min(start, startMs);
    if (Number.isFinite(endMs)) end = Math.max(end, endMs);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    throw new Error('Timeline에서 유효한 날짜를 찾을 수 없습니다.');
  }
  return {
    startDate: toKoreaDate(start),
    endDate: toKoreaDate(end),
    semanticSegments: segments.length
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

function toKoreaDate(ms: number): string {
  return new Date(ms + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
