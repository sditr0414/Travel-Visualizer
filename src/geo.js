const EARTH_RADIUS_M = 6371008.8;
const MAX_MERCATOR_LAT = 85.05112878;

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function haversineMeters(a, b) {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLat = lat2 - lat1;
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function pathDistanceMeters(points) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += haversineMeters(points[i - 1], points[i]);
  return total;
}

export function interpolatePoint(a, b, t) {
  return {
    lat: a.lat + (b.lat - a.lat) * t,
    lng: a.lng + (b.lng - a.lng) * t,
    timeMs: Number.isFinite(a.timeMs) && Number.isFinite(b.timeMs)
      ? a.timeMs + (b.timeMs - a.timeMs) * t
      : undefined
  };
}

export function smoothPath(points, { maxSegmentMeters = 300 } = {}) {
  const clean = (points || []).filter(p => Number.isFinite(p?.lat) && Number.isFinite(p?.lng));
  if (clean.length < 2) return clean.map(p => ({ ...p }));
  if (clean.length === 2) return densifyLine(clean[0], clean[1], maxSegmentMeters);

  const out = [{ ...clean[0] }];
  for (let i = 0; i < clean.length - 1; i += 1) {
    const p0 = clean[Math.max(0, i - 1)];
    const p1 = clean[i];
    const p2 = clean[i + 1];
    const p3 = clean[Math.min(clean.length - 1, i + 2)];
    const distance = haversineMeters(p1, p2);
    const steps = clamp(Math.ceil(distance / Math.max(60, maxSegmentMeters)), 2, 80);

    const minLat = Math.min(p1.lat, p2.lat) - Math.abs(p2.lat - p1.lat) * 0.25 - 0.001;
    const maxLat = Math.max(p1.lat, p2.lat) + Math.abs(p2.lat - p1.lat) * 0.25 + 0.001;
    const minLng = Math.min(p1.lng, p2.lng) - Math.abs(p2.lng - p1.lng) * 0.25 - 0.001;
    const maxLng = Math.max(p1.lng, p2.lng) + Math.abs(p2.lng - p1.lng) * 0.25 + 0.001;

    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      const lat = 0.5 * (
        2 * p1.lat +
        (-p0.lat + p2.lat) * t +
        (2 * p0.lat - 5 * p1.lat + 4 * p2.lat - p3.lat) * t2 +
        (-p0.lat + 3 * p1.lat - 3 * p2.lat + p3.lat) * t3
      );
      const lng = 0.5 * (
        2 * p1.lng +
        (-p0.lng + p2.lng) * t +
        (2 * p0.lng - 5 * p1.lng + 4 * p2.lng - p3.lng) * t2 +
        (-p0.lng + 3 * p1.lng - 3 * p2.lng + p3.lng) * t3
      );
      out.push({
        lat: clamp(lat, minLat, maxLat),
        lng: clamp(lng, minLng, maxLng),
        timeMs: Number.isFinite(p1.timeMs) && Number.isFinite(p2.timeMs)
          ? p1.timeMs + (p2.timeMs - p1.timeMs) * t
          : undefined
      });
    }
  }
  return dedupeSpatial(out);
}

export function inferredBridgePath(start, end, {
  startMs,
  endMs,
  distanceMeters = haversineMeters(start, end),
  mode = 'UNKNOWN'
} = {}) {
  const distanceKm = distanceMeters / 1000;
  const steps = clamp(Math.ceil(distanceKm * 1.2), 10, 100);
  const midLat = (start.lat + end.lat) / 2;
  const midLng = (start.lng + end.lng) / 2;
  const dLat = end.lat - start.lat;
  const dLng = end.lng - start.lng;
  const lengthDeg = Math.hypot(dLat, dLng) || 1;
  const isFlight = mode === 'FLYING' || distanceKm > 250;
  const curveStrength = isFlight ? 0.07 : distanceKm > 30 ? 0.025 : 0.012;
  const offset = Math.min(lengthDeg * curveStrength, isFlight ? 1.4 : 0.08);
  const control = {
    lat: midLat - (dLng / lengthDeg) * offset,
    lng: midLng + (dLat / lengthDeg) * offset
  };

  const out = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const inv = 1 - t;
    out.push({
      lat: inv * inv * start.lat + 2 * inv * t * control.lat + t * t * end.lat,
      lng: inv * inv * start.lng + 2 * inv * t * control.lng + t * t * end.lng,
      timeMs: Number.isFinite(startMs) && Number.isFinite(endMs)
        ? startMs + (endMs - startMs) * t
        : undefined,
      inferred: true
    });
  }
  return out;
}

export function pointAlongPath(points, t) {
  if (!points.length) return null;
  if (points.length === 1) return { ...points[0] };
  const clamped = clamp(t, 0, 1);
  const lengths = [];
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const d = haversineMeters(points[i - 1], points[i]);
    lengths.push(d);
    total += d;
  }
  if (total <= 0) return { ...points[points.length - 1] };
  let target = total * clamped;
  for (let i = 0; i < lengths.length; i += 1) {
    if (target <= lengths[i] || i === lengths.length - 1) {
      const local = lengths[i] <= 0 ? 1 : target / lengths[i];
      return interpolatePoint(points[i], points[i + 1], local);
    }
    target -= lengths[i];
  }
  return { ...points[points.length - 1] };
}

export function boundsForPoints(points) {
  if (!points.length) return null;
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const p of points) {
    minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng); maxLng = Math.max(maxLng, p.lng);
  }
  return { minLat, maxLat, minLng, maxLng };
}

export function midpoint(points) {
  if (!points.length) return null;
  return pointAlongPath(points, 0.5);
}

export function mercatorProject(p) {
  const lat = clamp(p.lat, -MAX_MERCATOR_LAT, MAX_MERCATOR_LAT);
  const x = (p.lng + 180) / 360;
  const sinLat = Math.sin(toRad(lat));
  const y = 0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI);
  return { x, y };
}

export function mercatorUnproject(p) {
  const lng = p.x * 360 - 180;
  const y2 = (0.5 - p.y) * 2 * Math.PI;
  const lat = toDeg(Math.atan(Math.sinh(y2)));
  return { lat, lng };
}

export function toGeoJSONLine(points) {
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: points.map(p => [p.lng, p.lat]) }
  };
}

function densifyLine(a, b, maxSegmentMeters) {
  const distance = haversineMeters(a, b);
  const steps = clamp(Math.ceil(distance / Math.max(60, maxSegmentMeters)), 1, 100);
  const out = [];
  for (let i = 0; i <= steps; i += 1) out.push(interpolatePoint(a, b, i / steps));
  return out;
}

function dedupeSpatial(points) {
  const out = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (prev && haversineMeters(prev, p) < 0.5) continue;
    out.push(p);
  }
  return out;
}

function toRad(deg) { return deg * Math.PI / 180; }
function toDeg(rad) { return rad * 180 / Math.PI; }
