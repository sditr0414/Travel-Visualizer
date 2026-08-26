import test from 'node:test';
import assert from 'node:assert/strict';
import { stationaryTrailFeatureCollection } from '../src/route-player-split.js';

function planWithLongMediaHold() {
  const fps = 10;
  const frames = [];

  for (let index = 0; index < 30; index += 1) {
    frames.push({
      kind: 'TRAVEL',
      timeSec: index / fps,
      sceneId: 1,
      mobilityClass: 'WALK',
      position: {
        lat: 34.70,
        lng: 135.48 + index * 0.001
      }
    });
  }

  const stopPosition = { lat: 34.70, lng: 135.51 };
  for (let index = 0; index < 60; index += 1) {
    frames.push({
      kind: 'TRAVEL',
      timeSec: frames.length / fps,
      sceneId: 1,
      mobilityClass: 'WALK',
      mediaHold: true,
      mediaBeatId: 'photo-beat-1',
      position: { ...stopPosition }
    });
  }

  return { fps, frames };
}

function allCoordinates(collection) {
  return (collection.features || []).flatMap(feature => feature.geometry?.coordinates || []);
}

test('photo stop keeps the approach route visible even late in a long hold', () => {
  const plan = planWithLongMediaHold();
  const lateHoldFrame = plan.frames.length - 1;
  const collection = stationaryTrailFeatureCollection(plan, lateHoldFrame, 4.8);
  const coordinates = allCoordinates(collection);

  assert.ok(coordinates.length > 4, 'expected more than a stationary point');
  const stop = plan.frames[lateHoldFrame].position;
  const hasApproachPoint = coordinates.some(([lng, lat]) =>
    Math.abs(lng - stop.lng) > 0.002 || Math.abs(lat - stop.lat) > 0.002
  );
  assert.ok(hasApproachPoint, 'approach path should remain visible while media is displayed');
});
