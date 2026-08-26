import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TRANSPORT_COLORS,
  effectiveTrackingMultiplier,
  routeHeadFeatureForFrame,
  tailFeatureCollectionForFrame,
  trackingDemandPxPerSec,
  trackingDurationScale,
  trackingPanLimitPxPerSec,
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

test('shorter videos keep a faster global fallback tracking floor', () => {
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
});

test('tracking slider remains a user multiplier on top of automatic adaptation', () => {
  const short = {
    targetTotalSeconds: 60,
    durationLimits: { recommendedSeconds: 180 }
  };
  const automatic = trackingDurationScale(short);

  assert.ok(Math.abs(effectiveTrackingMultiplier(short, 0.5) - automatic * 0.5) < 1e-9);
  assert.ok(Math.abs(effectiveTrackingMultiplier(short, 2) - automatic * 2) < 1e-9);
});

test('instantaneous tracking demand follows actual video motion rather than only total duration', () => {
  const slow = targetMotionPlan({ frameCount: 181, deltaX: 0.002 });
  const fast = targetMotionPlan({ frameCount: 61, deltaX: 0.002 });

  const slowDemand = trackingDemandPxPerSec(slow, 90);
  const fastDemand = trackingDemandPxPerSec(fast, 30);

  assert.ok(fastDemand > slowDemand * 2.5, `expected fast=${fastDemand} to materially exceed slow=${slowDemand}`);
});

test('tracking pan limit rises with instantaneous motion and accumulated lag', () => {
  const fast = targetMotionPlan({ frameCount: 61, deltaX: 0.002 });
  const slow = targetMotionPlan({ frameCount: 181, deltaX: 0.002 });

  const slowLimit = trackingPanLimitPxPerSec(slow, 90, 1, 20);
  const fastLimit = trackingPanLimitPxPerSec(fast, 30, 1, 20);
  const catchUpLimit = trackingPanLimitPxPerSec(fast, 30, 1, 180);

  assert.ok(fastLimit > slowLimit, `fast limit ${fastLimit} should exceed slow limit ${slowLimit}`);
  assert.ok(catchUpLimit > fastLimit, `lag catch-up ${catchUpLimit} should exceed normal fast limit ${fastLimit}`);
});

test('tracking demand never crosses a scene break', () => {
  const sceneFrames = [
    ...targetFrames({ frameCount: 31, startX: 0.50, deltaX: 0.0002, sceneId: 0 }),
    ...targetFrames({ frameCount: 31, startX: 0.80, deltaX: 0.0002, sceneId: 1 })
  ];
  const scenePlan = { fps: 60, frames: sceneFrames };

  const before = trackingDemandPxPerSec(scenePlan, 29);
  const after = trackingDemandPxPerSec(scenePlan, 32);

  assert.ok(before < 1000, `scene jump leaked into pre-break demand: ${before}`);
  assert.ok(after < 1000, `scene jump leaked into post-break demand: ${after}`);
});

function targetMotionPlan({ frameCount, deltaX }) {
  return {
    fps: 60,
    targetTotalSeconds: frameCount / 60,
    durationLimits: { recommendedSeconds: frameCount / 60 },
    frames: targetFrames({ frameCount, startX: 0.50, deltaX, sceneId: 0 })
  };
}

function targetFrames({ frameCount, startX, deltaX, sceneId }) {
  return Array.from({ length: frameCount }, (_, index) => ({
    kind: 'TRAVEL',
    sceneId,
    mobilityClass: 'FAST_GROUND',
    zoom: 10,
    maxPanPxPerSec: 265,
    targetCenterX: startX + deltaX * index / Math.max(1, frameCount - 1),
    targetCenterY: 0.40,
    position: { lat: 35, lng: 135 + index * 0.001 }
  }));
}
