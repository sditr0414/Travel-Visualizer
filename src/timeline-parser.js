import { haversineMeters, pathDistanceMeters } from './geo.js';

const LATLNG_RE = /(-?\d+(?:\.\d+)?)°?\s*,\s*(-?\d+(?:\.\d+)?)°?/;

export function parseLatLng(value) {
  if (!value || typeof value !== 'string') return null;
  const match = value.match(LATLNG_RE);
  if (!match) return null;
  return { lat: Number(match[1]), lng: Number(match[2]) };
}

export function parseTimeline(json, { startDate, endDate, includeFlights = true } = {}) {
  const semanticSegments = Array.isArray(json?.semanticSegments) ? json.semanticSegments : [];
  const startMs = startDate ? calendarDateToUtcMs(startDate, false) : -Infinity;
  const endMs = endDate ? calendarDateToUtcMs(endDate, true) : Infinity;

  const timelinePaths = [];
  const activities = [];
  const visits = [];

  for (const segment of semanticSegments) {
    const segmentStart = parseTime(segment.startTime);
    const segmentEnd = parseTime(segment.endTime) || segmentStart;
    if (!overlaps(segmentStart, segmentEnd, startMs, endMs)) continue;

    if (Array.isArray(segment.timelinePath)) {
      const points = segment.timelinePath
        .map(item => {
          const p = parseLatLng(item.point);
          const timeMs = parseTime(item.time);
          return p && Number.isFinite(timeMs) ? { ...p, timeMs } : null;
        })
        .filter(Boolean)
        .filter(p => p.timeMs >= startMs && p.timeMs < endMs)
        .sort((a, b) => a.timeMs - b.timeMs);
      if (points.length) timelinePaths.push({ startMs: segmentStart, endMs: segmentEnd, points });
    }

    if (segment.activity) {
      const activity = segment.activity;
      const start = parseLatLng(activity.start?.latLng);
      const end = parseLatLng(activity.end?.latLng);
      const googleType = activity.topCandidate?.type || 'UNKNOWN';
      if (!includeFlights && googleType === 'FLYING') continue;
      if (!start || !end || !Number.isFinite(segmentStart) || !Number.isFinite(segmentEnd)) continue;
      const durationSec = Math.max(1, (segmentEnd - segmentStart) / 1000);
      const statedDistance = Number(activity.distanceMeters);
      const distanceMeters = Number.isFinite(statedDistance) && statedDistance > 0
        ? statedDistance
        : haversineMeters(start, end);
      activities.push({
        startMs: segmentStart,
        endMs: segmentEnd,
        start,
        end,
        distanceMeters,
        durationSec,
        avgSpeedKmh: distanceMeters / durationSec * 3.6,
        googleType,
        googleProbability: Number(activity.topCandidate?.probability ?? 0),
        activityProbability: Number(activity.probability ?? 0)
      });
    }

    if (segment.visit) {
      const p = parseLatLng(segment.visit.topCandidate?.placeLocation?.latLng);
      if (p) visits.push({
        startMs: segmentStart,
        endMs: segmentEnd,
        point: p,
        placeId: segment.visit.topCandidate?.placeId || null,
        probability: Number(segment.visit.probability ?? 0)
      });
    }
  }

  activities.sort((a, b) => a.startMs - b.startMs);
  timelinePaths.sort((a, b) => a.startMs - b.startMs);

  const movements = activities.map(activity => ({
    ...activity,
    points: pathForActivity(activity, timelinePaths)
  }));

  const routePoints = dedupeChronological(timelinePaths.flatMap(p => p.points));
  return { movements, routePoints, visits, timelinePaths };
}

function pathForActivity(activity, paths) {
  const toleranceMs = 2 * 60 * 1000;
  const points = paths
    .flatMap(path => path.points)
    .filter(p => p.timeMs >= activity.startMs - toleranceMs && p.timeMs <= activity.endMs + toleranceMs)
    .sort((a, b) => a.timeMs - b.timeMs);
  const candidate = dedupeChronological([
    { ...activity.start, timeMs: activity.startMs },
    ...points,
    { ...activity.end, timeMs: activity.endMs }
  ]);
  const pathDistance = pathDistanceMeters(candidate);
  if (candidate.length >= 2 && pathDistance > 0) return candidate;
  return [
    { ...activity.start, timeMs: activity.startMs },
    { ...activity.end, timeMs: activity.endMs }
  ];
}

function dedupeChronological(points) {
  const sorted = [...points].sort((a, b) => (a.timeMs ?? 0) - (b.timeMs ?? 0));
  const out = [];
  for (const p of sorted) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev.lat - p.lat) < 1e-7 && Math.abs(prev.lng - p.lng) < 1e-7 && Math.abs((prev.timeMs ?? 0) - (p.timeMs ?? 0)) < 1000) continue;
    out.push(p);
  }
  return out;
}

function parseTime(value) {
  if (!value) return NaN;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : NaN;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  if (!Number.isFinite(aStart)) return false;
  const end = Number.isFinite(aEnd) ? aEnd : aStart;
  return end >= bStart && aStart < bEnd;
}

function calendarDateToUtcMs(yyyyMmDd, endExclusive) {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + (endExclusive ? 1 : 0)));
  const yy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return Date.parse(`${yy}-${mm}-${dd}T00:00:00+09:00`);
}
