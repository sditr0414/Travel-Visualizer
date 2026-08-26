import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TRANSPORT_COLORS,
  effectiveTrackingMultiplier,
  routeHeadFeatureForFrame,
  tailFeatureCollectionForFrame,
  trackingDurationScale,
  transportColor
} from '../src/route-player.js';

const frames = [
  { kind: 'TRAVEL', sceneId: 0, mobilityClass: 'WALK', position: { lat: 35, lng: 135 } },
  { kind: 'TRAVEL', sceneId: 0, mobilityClass: 'WALK', position: { lat: 35.001, lng: 135.001 } },
  { kind: 'TRAVEL', sceneId: 0, mobilityClass: 'FAST_GROUND', position: { lat: 35.01, lng: 135.02 } },
  { kind: 'TRAVEL', sceneId: 0, mobilityClass: 'FAST_GROUND', position: { lat: 35.02, lng: 135.04 } }
];
const plan = { fps: 60, frames };

test('tail preserves transport colors across a mode boundary', () => {
  const collection = tailFeatureCollectionForFrame(plan, 3, 3.2);
  assert.equal(collection.features.length, 2);
  assert.equal(collection.features[0].properties.color, TRANSPORT_COLORS.WALK);
  assert.equal(collection.features[1].properties.color, TRANSPORT_COLORS.FAST_GROUND);
  assert.notEqual(collection.features[0].properties.color, collection.features[1].properties.color);
});

test('route head is exactly the current travel position', () => {
  const head = routeHeadFeatureForFrame(plan, 3);
  assert.deepEqual(head.features[0].geometry.coordinates, [135.04, 35.02]);
  assert.equal(head.features[0].properties.color, transportColor('FAST_GROUND'));
});

test('recent route remains visible across a scene boundary without a connector', () => {
  const scenePlan = {
    fps: 60,
    frames: [
      { kind: 'TRAVEL', sceneId: 0, mobilityClass: 'WALK', position: { lat: 35, lng: 135 } },
      { kind: 'TRAVEL', sceneId: 0, mobilityClass: 'WALK', position: { lat: 35.001, lng: 135.001 } },
      { kind: 'TRAVEL', sceneId: 1, sceneBreak: true, mobilityClass: 'FAST_GROUND', position: { lat: 35.5, lng: 135.5 } },
      { kind: 'TRAVEL', sceneId: 1, mobilityClass: 'FAST_GROUND', position: { lat: 35.51, lng: 135.52 } }
    ]
  };

  const collection = tailFeatureCollectionForFrame(scenePlan, 3, 3.2);
  assert.equal(collection.features.length, 2);
  assert.deepEqual(collection.features[0].geometry.coordinates.at(-1), [135.001, 35.001]);
  assert.deepEqual(collection.features[1].geometry.coordinates[0], [135.5, 35.5]);
  assert.notDeepEqual(collection.features[0].geometry.coordinates.at(-1), collection.features[1].geometry.coordinates[0]);
});

test('shorter videos automatically allow faster camera tracking', () => {
  const short = {
    targetTotalSeconds: 60,
    durationLimits: { recommendedSeconds: 180 }
  };
  const recommended = {
    targetTotalSeconds: 180,
    durationLimits: { recommendedSeconds: 180 }
  };
  const long = {
    targetTotalSeconds: 360,
    durationLimits: { recommendedSeconds: 180 }
  };

  assert.ok(trackingDurationScale(short) > trackingDurationScale(recommended));
  assert.equal(trackingDurationScale(recommended), 1);
  assert.ok(trackingDurationScale(long) < trackingDurationScale(recommended));
  assert.ok(Math.abs(trackingDurationScale(short) - Math.sqrt(3)) < 0.01);
});

test('tracking slider remains a user multiplier on top of duration adaptation', () => {
  const short = {
    targetTotalSeconds: 60,
    durationLimits: { recommendedSeconds: 180 }
  };
  const automatic = trackingDurationScale(short);

  assert.ok(Math.abs(effectiveTrackingMultiplier(short, 0.5) - automatic * 0.5) < 1e-9);
  assert.ok(Math.abs(effectiveTrackingMultiplier(short, 2) - automatic * 2) < 1e-9);
});
