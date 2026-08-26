import test from 'node:test';
import assert from 'node:assert/strict';
import { inferMobility, MobilityClass } from '../src/mobility.js';

function movement({
  distanceKm,
  speedKmh,
  type,
  probability = 0,
  activityProbability = 0.95
}) {
  const durationSec = Math.max(1, distanceKm / Math.max(speedKmh, 0.1) * 3600);
  return {
    start: { lat: 35, lng: 135 },
    end: { lat: 35.01, lng: 135.01 },
    distanceMeters: distanceKm * 1000,
    durationSec,
    avgSpeedKmh: speedKmh,
    googleType: type,
    googleProbability: probability,
    activityProbability
  };
}

test('slow cycling remains bicycle when Timeline selected CYCLING', () => {
  const inferred = inferMobility(movement({
    distanceKm: 2.96,
    speedKmh: 6.3,
    type: 'CYCLING',
    probability: 0.84,
    activityProbability: 0.88
  }));
  assert.equal(inferred.mobilityClass, MobilityClass.BIKE);
  assert.equal(inferred.identityAnchor, MobilityClass.BIKE);
});

test('zero candidate probability cycling can still use selected type identity', () => {
  const inferred = inferMobility(movement({
    distanceKm: 2.47,
    speedKmh: 3.0,
    type: 'CYCLING',
    probability: 0,
    activityProbability: 0.89
  }));
  assert.equal(inferred.mobilityClass, MobilityClass.BIKE);
});

test('slow short tram remains urban transit instead of bicycle or walk', () => {
  const inferred = inferMobility(movement({
    distanceKm: 0.22,
    speedKmh: 3.1,
    type: 'IN_TRAM',
    probability: 0,
    activityProbability: 0.95
  }));
  assert.equal(inferred.mobilityClass, MobilityClass.URBAN_TRANSIT);
  assert.equal(inferred.identityAnchor, MobilityClass.URBAN_TRANSIT);
});

test('subway at bicycle-like speed remains urban transit', () => {
  const inferred = inferMobility(movement({
    distanceKm: 3.09,
    speedKmh: 23.5,
    type: 'IN_SUBWAY',
    probability: 0.90,
    activityProbability: 0.99
  }));
  assert.equal(inferred.mobilityClass, MobilityClass.URBAN_TRANSIT);
});

test('physically implausible cycling label is not protected', () => {
  const inferred = inferMobility(movement({
    distanceKm: 80,
    speedKmh: 120,
    type: 'CYCLING',
    probability: 0.95,
    activityProbability: 0.99
  }));
  assert.notEqual(inferred.mobilityClass, MobilityClass.BIKE);
  assert.equal(inferred.identityAnchor, null);
});
