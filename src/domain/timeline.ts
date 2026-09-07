import { parseLatLng, parseTimeline as parseLegacyTimeline } from '../timeline-parser.js';
import type { Coordinate, ParsedTrip, TimelineDateRange, TimelineScanResult, TimelineTripCandidate } from '../types';

type TimelineRoot = { semanticSegments?: Array<Record<string, unknown>> };
type EvidencePoint = { point: Coordinate; weight: number };
type DayEvidence = {
  date: string;
  ordinal: number;
  distanceMeters: number;
  points: EvidencePoint[];
};
type VisitEvidence = {
  startMs: number;
  endMs: number;
  point: Coordinate;
  durationMs: number;
};
type VisitCluster = {
  lat: number;
  lng: number;
  weightMs: number;
  visits: number;
};

const MEANINGFUL_ACTIVITY_METERS = 1_000;
const FALLBACK_TRAVEL_DAY_METERS = 30_000;
const LONG_LOCAL_MOVEMENT_METERS = 80_000;
const AWAY_FROM_HOME_METERS = 40_000;
const CANDIDATE_GAP_DAYS = 2;
const HOME_CLUSTER_RADIUS_METERS = 3_000;
const DESTINATION_CLUSTER_RADIUS_METERS = 30_000;
const MAX_TRIP_CANDIDATES = 10;

const KOREA_DESTINATIONS = [
  { name: '서울', lat: 37.5665, lng: 126.9780, radiusKm: 35 },
  { name: '인천', lat: 37.4563, lng: 126.7052, radiusKm: 28 },
  { name: '수원', lat: 37.2636, lng: 127.0286, radiusKm: 25 },
  { name: '춘천', lat: 37.8813, lng: 127.7298, radiusKm: 30 },
  { name: '강릉', lat: 37.7519, lng: 128.8761, radiusKm: 35 },
  { name: '속초', lat: 38.2070, lng: 128.5918, radiusKm: 25 },
  { name: '대전', lat: 36.3504, lng: 127.3845, radiusKm: 30 },
  { name: '전주', lat: 35.8242, lng: 127.1480, radiusKm: 30 },
  { name: '광주', lat: 35.1595, lng: 126.8526, radiusKm: 30 },
  { name: '여수', lat: 34.7604, lng: 127.6622, radiusKm: 25 },
  { name: '대구', lat: 35.8714, lng: 128.6014, radiusKm: 32 },
  { name: '경주', lat: 35.8562, lng: 129.2247, radiusKm: 28 },
  { name: '포항', lat: 36.0190, lng: 129.3435, radiusKm: 25 },
  { name: '부산', lat: 35.1796, lng: 129.0756, radiusKm: 38 },
  { name: '울산', lat: 35.5384, lng: 129.3114, radiusKm: 28 }
] as const;

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
  const days = new Map<string, DayEvidence>();
  const visits: VisitEvidence[] = [];

  for (const segment of segments) {
    if (!segment || typeof segment !== 'object') continue;
    const startMs = Date.parse(String(segment.startTime ?? ''));
    const endMs = Date.parse(String(segment.endTime ?? segment.startTime ?? ''));
    if (Number.isFinite(startMs)) start = Math.min(start, startMs);
    if (Number.isFinite(endMs)) end = Math.max(end, endMs);
    if (!Number.isFinite(startMs)) continue;

    const date = toKoreaDate(startMs);
    const day = ensureDay(days, date);
    const distanceMeters = activityDistanceMeters(segment);
    if (distanceMeters >= MEANINGFUL_ACTIVITY_METERS) day.distanceMeters += distanceMeters;

    const activity = readActivityCoordinates(segment);
    if (activity.start) day.points.push({ point: activity.start, weight: 1 });
    if (activity.end) day.points.push({ point: activity.end, weight: 1 });

    const visitPoint = readVisitCoordinate(segment);
    if (visitPoint) {
      const resolvedEndMs = Number.isFinite(endMs) ? Math.max(startMs, endMs) : startMs;
      const durationMs = Math.max(15 * 60_000, resolvedEndMs - startMs);
      visits.push({ startMs, endMs: resolvedEndMs, point: visitPoint, durationMs });
      day.points.push({ point: visitPoint, weight: Math.min(12, Math.max(1, durationMs / 3_600_000)) });
    }
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    throw new Error('Timeline에서 유효한 날짜를 찾을 수 없습니다.');
  }

  const fullRange = { startDate: toKoreaDate(start), endDate: toKoreaDate(end) };
  const home = inferHomeCoordinate(visits);
  const tripCandidates = detectTripCandidates(days, visits, home);
  return {
    ...fullRange,
    semanticSegments: segments.length,
    recommendedRange: tripCandidates[0]
      ? { startDate: tripCandidates[0].startDate, endDate: tripCandidates[0].endDate }
      : fullRange,
    tripCandidates
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

function ensureDay(days: Map<string, DayEvidence>, date: string): DayEvidence {
  const existing = days.get(date);
  if (existing) return existing;
  const created = { date, ordinal: dateOrdinal(date), distanceMeters: 0, points: [] };
  days.set(date, created);
  return created;
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

function readActivityCoordinates(segment: Record<string, unknown>): { start: Coordinate | null; end: Coordinate | null } {
  const activity = segment.activity;
  if (!activity || typeof activity !== 'object') return { start: null, end: null };
  const value = activity as Record<string, unknown>;
  return { start: readActivityCoordinate(value.start), end: readActivityCoordinate(value.end) };
}

function readActivityCoordinate(value: unknown): Coordinate | null {
  if (!value || typeof value !== 'object') return null;
  return parseLatLng((value as Record<string, unknown>).latLng);
}

function readVisitCoordinate(segment: Record<string, unknown>): Coordinate | null {
  const visit = segment.visit;
  if (!visit || typeof visit !== 'object') return null;
  const topCandidate = (visit as Record<string, unknown>).topCandidate;
  if (!topCandidate || typeof topCandidate !== 'object') return null;
  const placeLocation = (topCandidate as Record<string, unknown>).placeLocation;
  if (!placeLocation || typeof placeLocation !== 'object') return null;
  return parseLatLng((placeLocation as Record<string, unknown>).latLng);
}

function inferHomeCoordinate(visits: VisitEvidence[]): Coordinate | null {
  const clusters: VisitCluster[] = [];
  for (const visit of [...visits].sort((a, b) => b.durationMs - a.durationMs)) {
    let cluster = clusters
      .map(candidate => ({ candidate, distance: directDistanceMeters(candidate, visit.point) }))
      .filter(item => item.distance <= HOME_CLUSTER_RADIUS_METERS)
      .sort((a, b) => a.distance - b.distance)[0]?.candidate;
    if (!cluster) {
      cluster = { lat: visit.point.lat, lng: visit.point.lng, weightMs: 0, visits: 0 };
      clusters.push(cluster);
    }
    const totalWeight = cluster.weightMs + visit.durationMs;
    if (totalWeight > 0) {
      cluster.lat = (cluster.lat * cluster.weightMs + visit.point.lat * visit.durationMs) / totalWeight;
      cluster.lng = (cluster.lng * cluster.weightMs + visit.point.lng * visit.durationMs) / totalWeight;
    }
    cluster.weightMs = totalWeight;
    cluster.visits += 1;
  }

  const best = clusters
    .filter(cluster => cluster.visits >= 2 && cluster.weightMs >= 8 * 3_600_000)
    .sort((a, b) => (b.weightMs + b.visits * 3_600_000) - (a.weightMs + a.visits * 3_600_000))[0];
  return best ? { lat: best.lat, lng: best.lng } : null;
}

function detectTripCandidates(
  days: Map<string, DayEvidence>,
  visits: VisitEvidence[],
  home: Coordinate | null
): TimelineTripCandidate[] {
  const orderedDays = [...days.values()]
    .filter(day => Number.isFinite(day.ordinal))
    .sort((a, b) => a.ordinal - b.ordinal);
  const seedDays = orderedDays.filter(day => isTravelDay(day, home));
  if (!seedDays.length) return [];

  const groups: DayEvidence[][] = [];
  for (const day of seedDays) {
    const current = groups.at(-1);
    if (!current || day.ordinal - current.at(-1)!.ordinal > CANDIDATE_GAP_DAYS) groups.push([day]);
    else current.push(day);
  }

  return groups
    .map((group, index) => buildTripCandidate(group, orderedDays, visits, home, index))
    .filter((candidate): candidate is TimelineTripCandidate & { score: number } => Boolean(candidate))
    .sort((a, b) => b.score - a.score || b.startDate.localeCompare(a.startDate))
    .slice(0, MAX_TRIP_CANDIDATES);
}

function isTravelDay(day: DayEvidence, home: Coordinate | null): boolean {
  if (!home) return day.distanceMeters >= FALLBACK_TRAVEL_DAY_METERS;
  const maxAwayMeters = day.points.reduce((max, value) => Math.max(max, directDistanceMeters(home, value.point)), 0);
  return maxAwayMeters >= AWAY_FROM_HOME_METERS || day.distanceMeters >= LONG_LOCAL_MOVEMENT_METERS;
}

function buildTripCandidate(
  group: DayEvidence[],
  allDays: DayEvidence[],
  visits: VisitEvidence[],
  home: Coordinate | null,
  index: number
): (TimelineTripCandidate & { score: number }) | null {
  const startDate = group[0]?.date;
  const endDate = group.at(-1)?.date;
  if (!startDate || !endDate) return null;
  const startOrdinal = group[0].ordinal;
  const endOrdinal = group.at(-1)!.ordinal;
  const rangeDays = allDays.filter(day => day.ordinal >= startOrdinal && day.ordinal <= endOrdinal);
  const distanceMeters = rangeDays.reduce((sum, day) => sum + day.distanceMeters, 0);
  const representativeCoordinate = destinationCoordinate(startDate, endDate, rangeDays, visits, home);
  const maxAwayMeters = home
    ? rangeDays.flatMap(day => day.points).reduce((max, value) => Math.max(max, directDistanceMeters(home, value.point)), 0)
    : 0;
  const spanDays = Math.max(1, endOrdinal - startOrdinal + 1);
  const score = distanceMeters / 1_000 + maxAwayMeters / 1_000 * 1.5 + spanDays * 2;
  return {
    id: `trip-${startDate}-${endDate}-${index}`,
    startDate,
    endDate,
    activeDays: group.length,
    distanceMeters: Math.round(distanceMeters),
    representativeCoordinate: representativeCoordinate ?? undefined,
    destinationHint: representativeCoordinate ? coarseDestinationHint(representativeCoordinate) ?? undefined : undefined,
    score
  };
}

function destinationCoordinate(
  startDate: string,
  endDate: string,
  days: DayEvidence[],
  visits: VisitEvidence[],
  home: Coordinate | null
): Coordinate | null {
  const rangeVisits = visits.filter(visit => {
    const date = toKoreaDate(visit.startMs);
    if (date < startDate || date > endDate) return false;
    return !home || directDistanceMeters(home, visit.point) >= AWAY_FROM_HOME_METERS * 0.5;
  });
  if (rangeVisits.length) {
    const clusters: VisitCluster[] = [];
    for (const visit of rangeVisits) {
      let cluster = clusters
        .map(candidate => ({ candidate, distance: directDistanceMeters(candidate, visit.point) }))
        .filter(item => item.distance <= DESTINATION_CLUSTER_RADIUS_METERS)
        .sort((a, b) => a.distance - b.distance)[0]?.candidate;
      if (!cluster) {
        cluster = { lat: visit.point.lat, lng: visit.point.lng, weightMs: 0, visits: 0 };
        clusters.push(cluster);
      }
      const totalWeight = cluster.weightMs + visit.durationMs;
      cluster.lat = (cluster.lat * cluster.weightMs + visit.point.lat * visit.durationMs) / totalWeight;
      cluster.lng = (cluster.lng * cluster.weightMs + visit.point.lng * visit.durationMs) / totalWeight;
      cluster.weightMs = totalWeight;
      cluster.visits += 1;
    }
    const best = clusters.sort((a, b) => (b.weightMs + b.visits * 3_600_000) - (a.weightMs + a.visits * 3_600_000))[0];
    if (best) return { lat: best.lat, lng: best.lng };
  }

  const points = days.flatMap(day => day.points.map(value => value.point));
  if (!points.length) return null;
  if (home) return points.sort((a, b) => directDistanceMeters(home, b) - directDistanceMeters(home, a))[0] ?? null;
  return weightedCenter(days.flatMap(day => day.points));
}

function weightedCenter(points: EvidencePoint[]): Coordinate | null {
  if (!points.length) return null;
  let weight = 0;
  let lat = 0;
  let lng = 0;
  for (const value of points) {
    const resolvedWeight = Math.max(0.1, value.weight);
    weight += resolvedWeight;
    lat += value.point.lat * resolvedWeight;
    lng += value.point.lng * resolvedWeight;
  }
  return weight > 0 ? { lat: lat / weight, lng: lng / weight } : null;
}

function coarseDestinationHint(point: Coordinate): string | null {
  if (point.lat >= 33.05 && point.lat <= 33.65 && point.lng >= 126.05 && point.lng <= 126.98) return '제주도';
  if (isJapan(point)) return '일본';
  if (!isSouthKorea(point)) return null;

  const nearby = KOREA_DESTINATIONS
    .map(destination => ({ destination, distanceKm: directDistanceMeters(point, destination) / 1_000 }))
    .filter(value => value.distanceKm <= value.destination.radiusKm)
    .sort((a, b) => a.distanceKm / a.destination.radiusKm - b.distanceKm / b.destination.radiusKm)[0];
  return nearby?.destination.name ?? '대한민국';
}

function isSouthKorea(point: Coordinate): boolean {
  return point.lat >= 33.0 && point.lat <= 38.7 && point.lng >= 124.5 && point.lng <= 131.5;
}

function isJapan(point: Coordinate): boolean {
  return (
    (point.lat >= 41.2 && point.lat <= 45.8 && point.lng >= 139.0 && point.lng <= 146.2) ||
    (point.lat >= 33.4 && point.lat <= 41.7 && point.lng >= 130.4 && point.lng <= 142.2) ||
    (point.lat >= 32.6 && point.lat <= 34.7 && point.lng >= 132.0 && point.lng <= 135.9) ||
    (point.lat >= 29.8 && point.lat <= 34.1 && point.lng >= 129.0 && point.lng <= 132.2) ||
    (point.lat >= 24.0 && point.lat <= 28.8 && point.lng >= 123.0 && point.lng <= 130.2)
  );
}

function dateOrdinal(date: string): number {
  return Date.parse(`${date}T00:00:00Z`) / 86_400_000;
}

function directDistanceMeters(a: Coordinate, b: Coordinate): number {
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
