import { clamp, haversineMeters } from './geo.js';

export const MobilityClass = Object.freeze({
  WALK: 'WALK',
  BIKE: 'BIKE',
  URBAN_TRANSIT: 'URBAN_TRANSIT',
  FAST_GROUND: 'FAST_GROUND',
  FERRY: 'FERRY',
  FLIGHT: 'FLIGHT',
  ROAD: 'ROAD',
  UNKNOWN: 'UNKNOWN'
});

const GOOGLE_PRIORS = {
  WALKING: MobilityClass.WALK,
  CYCLING: MobilityClass.BIKE,
  IN_SUBWAY: MobilityClass.URBAN_TRANSIT,
  IN_TRAM: MobilityClass.URBAN_TRANSIT,
  IN_TRAIN: MobilityClass.FAST_GROUND,
  IN_BUS: MobilityClass.ROAD,
  IN_PASSENGER_VEHICLE: MobilityClass.ROAD,
  IN_FERRY: MobilityClass.FERRY,
  FLYING: MobilityClass.FLIGHT
};

export function inferMobility(segment) {
  const speed = Math.max(0, segment.avgSpeedKmh || 0);
  const distanceKm = Math.max(0, segment.distanceMeters || 0) / 1000;
  const directKm = haversineMeters(segment.start, segment.end) / 1000;
  const straightness = clamp(directKm / Math.max(distanceKm, 0.05), 0, 1);
  const googleClass = GOOGLE_PRIORS[segment.googleType] || MobilityClass.UNKNOWN;
  const googleConfidence = clamp(segment.googleProbability || 0, 0, 1);

  const scores = new Map(Object.values(MobilityClass).map(k => [k, 0]));
  add(scores, MobilityClass.WALK, bell(speed, 4.8, 5.5) * 1.35 + falloff(distanceKm, 8) * 0.35);
  add(scores, MobilityClass.BIKE, bell(speed, 16, 13) * 1.0 + bell(distanceKm, 6, 12) * 0.2);
  add(scores, MobilityClass.URBAN_TRANSIT, bell(speed, 31, 32) * 0.9 + bell(distanceKm, 8, 18) * 0.35);
  add(scores, MobilityClass.ROAD, bell(speed, 48, 42) * 0.8 + bell(distanceKm, 22, 65) * 0.25);
  add(scores, MobilityClass.FAST_GROUND, rising(speed, 55, 170) * 0.85 + rising(distanceKm, 8, 140) * 0.3 + straightness * 0.15);
  add(scores, MobilityClass.FERRY, bell(speed, 27, 35) * 0.45 + rising(distanceKm, 2, 80) * 0.15);
  add(scores, MobilityClass.FLIGHT, rising(speed, 250, 650) * 1.5 + rising(distanceKm, 250, 800) * 1.0 + straightness * 0.25);

  if (googleClass !== MobilityClass.UNKNOWN) {
    add(scores, googleClass, 0.25 + googleConfidence * 1.15);
  }

  if (speed < 8 && distanceKm < 5) add(scores, MobilityClass.WALK, 0.8);
  if (speed > 350 || distanceKm > 400 && speed > 180) add(scores, MobilityClass.FLIGHT, 1.2);
  if (speed > 90 && distanceKm > 15) add(scores, MobilityClass.FAST_GROUND, 0.55);

  const sorted = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const best = sorted[0];
  const second = sorted[1];
  const confidence = clamp((best[1] - second[1]) / Math.max(best[1], 0.001) * 0.75 + 0.25, 0.25, 0.99);

  return {
    mobilityClass: best[0],
    confidence,
    scores: Object.fromEntries(sorted),
    speedKmh: speed,
    distanceKm,
    straightness,
    googleClass,
    googleConfidence
  };
}

/**
 * Returns a physical camera intent instead of a hard-coded zoom number.
 * viewSpanKm means roughly how much horizontal ground should be visible.
 * The planner converts this to a Web-Mercator zoom using the actual viewport width.
 */
export function cameraIntentForMovement(segment, inference) {
  const distanceKm = Math.max(inference.distanceKm, 0.05);
  const speed = Math.max(inference.speedKmh, 0);
  const sqrtDistance = Math.sqrt(distanceKm);

  let viewSpanKm;
  switch (inference.mobilityClass) {
    case MobilityClass.WALK:
      viewSpanKm = clamp(0.9 + speed * 0.10 + sqrtDistance * 0.35, 0.9, 2.6);
      break;
    case MobilityClass.BIKE:
      viewSpanKm = clamp(2.3 + speed * 0.10 + sqrtDistance * 0.50, 2.5, 7.5);
      break;
    case MobilityClass.URBAN_TRANSIT:
      viewSpanKm = clamp(5.5 + speed * 0.14 + sqrtDistance * 1.0, 6, 22);
      break;
    case MobilityClass.ROAD:
      viewSpanKm = clamp(7 + speed * 0.14 + sqrtDistance * 1.2, 8, 38);
      break;
    case MobilityClass.FAST_GROUND:
      viewSpanKm = clamp(12 + speed * 0.13 + sqrtDistance * 1.8, 14, 75);
      break;
    case MobilityClass.FERRY:
      viewSpanKm = clamp(16 + speed * 0.18 + sqrtDistance * 2.0, 18, 110);
      break;
    case MobilityClass.FLIGHT:
      viewSpanKm = clamp(Math.max(180, distanceKm * 1.25), 180, 1600);
      break;
    default:
      viewSpanKm = clamp(3 + speed * 0.12 + sqrtDistance, 2, 45);
      break;
  }

  const lookAhead = {
    [MobilityClass.WALK]: 0.04,
    [MobilityClass.BIKE]: 0.08,
    [MobilityClass.URBAN_TRANSIT]: 0.14,
    [MobilityClass.ROAD]: 0.18,
    [MobilityClass.FAST_GROUND]: 0.24,
    [MobilityClass.FERRY]: 0.20,
    [MobilityClass.FLIGHT]: 0.32,
    [MobilityClass.UNKNOWN]: 0.10
  }[inference.mobilityClass] ?? 0.10;

  const smoothingTauSec = clamp(
    0.48 + Math.log2(1 + speed / 35) * 0.12 + Math.log2(1 + distanceKm) * 0.035,
    0.45,
    inference.mobilityClass === MobilityClass.FLIGHT ? 1.25 : 1.0
  );

  return { viewSpanKm, lookAhead, smoothingTauSec };
}

function add(map, key, value) { map.set(key, (map.get(key) || 0) + Math.max(0, value)); }
function bell(x, center, width) { return Math.exp(-0.5 * ((x - center) / Math.max(width, 0.001)) ** 2); }
function rising(x, start, full) { return clamp((x - start) / Math.max(full - start, 0.001), 0, 1); }
function falloff(x, scale) { return Math.exp(-Math.max(0, x) / Math.max(scale, 0.001)); }
