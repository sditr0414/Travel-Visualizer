import { haversineMeters, inferredBridgePath, pathDistanceMeters, smoothPath } from './geo.js';

const LATLNG_RE = /(-?\d+(?:\.\d+)?)°?\s*,\s*(-?\d+(?:\.\d+)?)°?/;

export function parseLatLng(value) {
  if (!value || typeof value !== 'string') return null;
  const match = value.match(LATLNG_RE);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
    ? { lat, lng }
    : null;
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
      const directDistance = haversineMeters(start, end);
      const distanceMeters = Number.isFinite(statedDistance) && statedDistance > 0
        ? statedDistance
        : directDistance;
      activities.push({
        startMs: segmentStart,
        endMs: segmentEnd,
        start,
        end,
        statedDistanceMeters: Number.isFinite(statedDistance) ? Math.max(0, statedDistance) : null,
        distanceMeters,
        durationSec,
        avgSpeedKmh: distanceMeters / durationSec * 3.6,
        googleType,
        googleProbability: Number(activity.topCandidate?.probability ?? 0),
        activityProbability: Number(activity.probability ?? 0),
        inferred: false
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

  // Flatten and sort Timeline path evidence once. The previous implementation
  // repeated flatMap/filter over every path for every activity, which scaled
  // poorly when the original multi-megabyte Timeline export was selected.
  const allTimelinePoints = timelinePaths
    .flatMap(path => path.points)
    .sort((a, b) => a.timeMs - b.timeMs);

  const enriched = activities.map(activity => enrichActivityWithPath(activity, allTimelinePoints));
  const movements = bridgeMovementGaps(enriched, allTimelinePoints, includeFlights);
  const routePoints = dedupeChronological(movements.flatMap(m => m.points));
  return { movements, routePoints, visits, timelinePaths };
}

function enrichActivityWithPath(activity, allTimelinePoints) {
  const rawPoints = pathForActivity(activity, allTimelinePoints);
  const pathDistance = pathDistanceMeters(rawPoints);
  const directDistance = haversineMeters(rawPoints[0] || activity.start, rawPoints[rawPoints.length - 1] || activity.end);
  const stated = Number(activity.statedDistanceMeters);

  const statedMissingOrTiny = !Number.isFinite(stated) || stated < 100;
  const pathStronglyDisagrees = Number.isFinite(stated) && stated > 0 && pathDistance > stated * 1.6 + 1000;
  const physicallyPlausible = pathDistance / Math.max(activity.durationSec, 1) * 3.6 <= 1300;

  let distanceMeters = activity.distanceMeters;
  if (physicallyPlausible && pathDistance > 250 && (statedMissingOrTiny || pathStronglyDisagrees)) {
    distanceMeters = pathDistance;
  } else if (!(distanceMeters > 0)) {
    distanceMeters = Math.max(pathDistance, directDistance);
  }

  const spacing = smoothingSpacingMeters(activity.googleType);
  const points = smoothPath(rawPoints, { maxSegmentMeters: spacing });
  const start = points[0] ? stripTime(points[0]) : activity.start;
  const end = points.length ? stripTime(points[points.length - 1]) : activity.end;
  return {
    ...activity,
    start,
    end,
    points,
    distanceMeters,
    pathDistanceMeters: pathDistance,
    avgSpeedKmh: distanceMeters / Math.max(activity.durationSec, 1) * 3.6
  };
}

function bridgeMovementGaps(movements, allTimelinePoints, includeFlights) {
  if (movements.length < 2) return movements;
  const out = [];

  for (let i = 0; i < movements.length; i += 1) {
    const current = movements[i];
    out.push(current);
    const next = movements[i + 1];
    if (!next) continue;

    const gapSec = (next.startMs - current.endMs) / 1000;
    const gapMeters = haversineMeters(current.end, next.start);
    if (gapSec < 0 || gapMeters < 140) continue;

    const between = timelinePointsInRange(allTimelinePoints, current.endMs, next.startMs, true);
    const candidate = dedupeChronological([
      { ...current.end, timeMs: current.endMs },
      ...between,
      { ...next.start, timeMs: next.startMs }
    ]);
    const candidateDistance = pathDistanceMeters(candidate);
    const durationSec = Math.max(1, gapSec);
    const evidenceDistance = Math.max(gapMeters, candidateDistance);
    const speedKmh = evidenceDistance / durationSec * 3.6;
    const googleType = inferGapType(evidenceDistance / 1000, speedKmh);

    if (!includeFlights && googleType === 'FLYING') continue;
    if (speedKmh > 1400) continue;

    const hasTimelineEvidence = between.length > 0;
    const rawBridge = hasTimelineEvidence
      ? candidate
      : inferredBridgePath(current.end, next.start, {
          startMs: current.endMs,
          endMs: next.startMs,
          distanceMeters: gapMeters,
          mode: googleType
        });
    const points = hasTimelineEvidence
      ? smoothPath(rawBridge, { maxSegmentMeters: smoothingSpacingMeters(googleType) })
      : rawBridge;
    const distanceMeters = Math.max(gapMeters, pathDistanceMeters(points));

    out.push({
      startMs: current.endMs,
      endMs: next.startMs,
      start: stripTime(points[0]),
      end: stripTime(points[points.length - 1]),
      points,
      statedDistanceMeters: null,
      distanceMeters,
      pathDistanceMeters: distanceMeters,
      durationSec,
      avgSpeedKmh: distanceMeters / durationSec * 3.6,
      googleType,
      googleProbability: 0,
      activityProbability: 0,
      inferred: true,
      inferenceSource: hasTimelineEvidence ? 'timeline-gap' : 'synthetic-gap'
    });
  }

  return out.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
}

function pathForActivity(activity, allTimelinePoints) {
  const toleranceMs = 2 * 60 * 1000;
  const timelinePoints = timelinePointsInRange(
    allTimelinePoints,
    activity.startMs - toleranceMs,
    activity.endMs + toleranceMs,
    false
  );

  if (!timelinePoints.length) {
    return [
      { ...activity.start, timeMs: activity.startMs },
      { ...activity.end, timeMs: activity.endMs }
    ];
  }

  const maxSpeedKmh = plausibleEndpointSpeed(activity.googleType);
  const first = timelinePoints[0];
  const last = timelinePoints[timelinePoints.length - 1];

  const startBridgeSec = Math.max(1, Math.abs(first.timeMs - activity.startMs) / 1000);
  const endBridgeSec = Math.max(1, Math.abs(activity.endMs - last.timeMs) / 1000);
  const startBridgeSpeed = haversineMeters(activity.start, first) / startBridgeSec * 3.6;
  const endBridgeSpeed = haversineMeters(last, activity.end) / endBridgeSec * 3.6;

  const useActivityStart = startBridgeSpeed <= maxSpeedKmh;
  const useActivityEnd = endBridgeSpeed <= maxSpeedKmh;

  return dedupeChronological([
    ...(useActivityStart ? [{ ...activity.start, timeMs: activity.startMs }] : []),
    ...timelinePoints,
    ...(useActivityEnd ? [{ ...activity.end, timeMs: activity.endMs }] : [])
  ]);
}

function timelinePointsInRange(points, minMs, maxMs, excludeEdges = false) {
  if (!points.length || maxMs < minMs) return [];
  const startIndex = lowerBoundTime(points, minMs, excludeEdges);
  const endIndex = lowerBoundTime(points, maxMs, !excludeEdges);
  return points.slice(startIndex, endIndex);
}

function lowerBoundTime(points, targetMs, strictGreater) {
  let low = 0;
  let high = points.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    const value = points[mid].timeMs;
    if (value < targetMs || strictGreater && value === targetMs) low = mid + 1;
    else high = mid;
  }
  return low;
}

function inferGapType(distanceKm, speedKmh) {
  if (speedKmh > 330 || distanceKm > 300 && speedKmh > 150) return 'FLYING';
  if (speedKmh > 65 || distanceKm > 35 && speedKmh > 35) return 'IN_TRAIN';
  if (speedKmh > 18) return 'IN_BUS';
  if (speedKmh > 8) return 'CYCLING';
  return 'WALKING';
}

function smoothingSpacingMeters(type) {
  if (type === 'FLYING') return 12000;
  if (type === 'IN_TRAIN') return 850;
  if (type === 'IN_SUBWAY' || type === 'IN_TRAM') return 350;
  if (type === 'IN_BUS' || type === 'IN_PASSENGER_VEHICLE') return 280;
  if (type === 'IN_FERRY') return 1500;
  if (type === 'CYCLING') return 140;
  if (type === 'WALKING') return 90;
  return 300;
}

function plausibleEndpointSpeed(type) {
  if (type === 'FLYING') return 1300;
  if (type === 'IN_TRAIN' || type === 'IN_SUBWAY' || type === 'IN_TRAM') return 420;
  if (type === 'IN_BUS' || type === 'IN_PASSENGER_VEHICLE') return 220;
  if (type === 'IN_FERRY') return 100;
  if (type === 'CYCLING') return 65;
  if (type === 'WALKING') return 18;
  return 320;
}

function stripTime(p) { return { lat: p.lat, lng: p.lng }; }

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
