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

function toRad(deg) { return deg * Math.PI / 180; }
function toDeg(rad) { return rad * 180 / Math.PI; }
