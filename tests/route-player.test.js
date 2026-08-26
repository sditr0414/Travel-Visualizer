import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TRANSPORT_COLORS,
  tailFeatureCollectionForFrame,
  routeHeadFeatureForFrame,
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
    fps: 1,
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
