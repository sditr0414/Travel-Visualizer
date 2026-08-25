import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLatLng, parseTimeline } from '../src/timeline-parser.js';
import { inferMobility, cameraIntentForMovement, MobilityClass } from '../src/mobility.js';
import { bidirectionalAdaptiveEma, planPlayback, zoomForViewSpan } from '../src/camera-planner.js';

function movement({ distanceKm, durationMin, type = 'UNKNOWN', probability = 0.2 }) {
  return {
    startMs: Date.parse('2026-03-18T10:00:00+09:00'),
    endMs: Date.parse('2026-03-18T10:00:00+09:00') + durationMin * 60_000,
    start: { lat: 35, lng: 135 },
    end: { lat: 35.01, lng: 135.01 },
    points: [{ lat: 35, lng: 135 }, { lat: 35.01, lng: 135.01 }],
    distanceMeters: distanceKm * 1000,
    durationSec: durationMin * 60,
    avgSpeedKmh: distanceKm / (durationMin / 60),
    googleType: type,
    googleProbability: probability
  };
}

test('parses Google degree lat/lng format', () => {
  assert.deepEqual(parseLatLng('34.6605423°, 135.5045515°'), { lat: 34.6605423, lng: 135.5045515 });
});

test('physical evidence can infer walking without a Google label', () => {
  const inferred = inferMobility(movement({ distanceKm: 0.8, durationMin: 12 }));
  assert.equal(inferred.mobilityClass, MobilityClass.WALK);
});

test('high-speed long-distance movement is not treated as walking', () => {
  const inferred = inferMobility(movement({ distanceKm: 120, durationMin: 55, type: 'UNKNOWN' }));
  assert.notEqual(inferred.mobilityClass, MobilityClass.WALK);
  assert.ok([MobilityClass.FAST_GROUND, MobilityClass.FLIGHT, MobilityClass.ROAD].includes(inferred.mobilityClass));
});

test('camera span keeps a 10km train at regional/city scale rather than country scale', () => {
  const train = movement({ distanceKm: 10, durationMin: 10, type: 'IN_TRAIN', probability: 0.98 });
  const inferred = inferMobility(train);
  const intent = cameraIntentForMovement(train, inferred);
  const zoom = zoomForViewSpan(intent.viewSpanKm, 35, 1100);
  assert.ok(zoom > 10 && zoom < 13, `unexpected train zoom ${zoom}`);
});

test('walking uses a materially closer camera than a fast train', () => {
  const walk = movement({ distanceKm: 0.7, durationMin: 10, type: 'WALKING', probability: 0.98 });
  const train = movement({ distanceKm: 30, durationMin: 20, type: 'IN_TRAIN', probability: 0.98 });
  const walkIntent = cameraIntentForMovement(walk, inferMobility(walk));
  const trainIntent = cameraIntentForMovement(train, inferMobility(train));
  const walkZoom = zoomForViewSpan(walkIntent.viewSpanKm, 35, 1100);
  const trainZoom = zoomForViewSpan(trainIntent.viewSpanKm, 35, 1100);
  assert.ok(walkZoom - trainZoom > 3, `expected clear zoom separation: walk=${walkZoom}, train=${trainZoom}`);
});

test('bidirectional smoothing anticipates a zoom transition', () => {
  const raw = [...Array(60).fill(10), ...Array(60).fill(16)];
  const tau = Array(raw.length).fill(0.7);
  const smooth = bidirectionalAdaptiveEma(raw, tau, 30);
  assert.ok(smooth[55] > 10, 'zoom should begin moving before the raw boundary');
  assert.ok(smooth[64] < 16, 'zoom should still be settling after the raw boundary');
});

test('playback produces a continuous camera trajectory for train to walk', () => {
  const train = movement({ distanceKm: 30, durationMin: 20, type: 'IN_TRAIN', probability: 0.95 });
  train.points = [{ lat: 35, lng: 135 }, { lat: 35.15, lng: 135.2 }];
  train.end = train.points[1];
  const walk = movement({ distanceKm: 0.8, durationMin: 12, type: 'WALKING', probability: 0.95 });
  walk.startMs = train.endMs;
  walk.endMs = walk.startMs + 12 * 60_000;
  walk.start = train.end;
  walk.points = [{ ...train.end }, { lat: 35.16, lng: 135.21 }];
  walk.end = walk.points[1];
  const plan = planPlayback([train, walk], { fps: 30, maxTotalSeconds: 30, viewportWidth: 1100 });
  let maxDelta = 0;
  for (let i = 1; i < plan.frames.length; i += 1) {
    maxDelta = Math.max(maxDelta, Math.abs(plan.frames[i].zoom - plan.frames[i - 1].zoom));
  }
  assert.ok(maxDelta < 0.09, `per-frame zoom jump too large: ${maxDelta}`);
  assert.equal(plan.frames[0].routeProgress, 0);
  assert.ok(plan.frames.at(-1).routeProgress > 0.99);
});

test('timeline date filtering creates movements', () => {
  const data = {
    semanticSegments: [{
      startTime: '2026-03-18T10:00:00+09:00',
      endTime: '2026-03-18T10:10:00+09:00',
      activity: {
        start: { latLng: '35.0°, 135.0°' },
        end: { latLng: '35.01°, 135.01°' },
        distanceMeters: 1500,
        topCandidate: { type: 'IN_TRAIN', probability: 0.9 }
      }
    }]
  };
  const parsed = parseTimeline(data, { startDate: '2026-03-17', endDate: '2026-03-31' });
  assert.equal(parsed.movements.length, 1);
});
