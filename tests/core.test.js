import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLatLng, parseTimeline } from '../src/timeline-parser.js';
import { inferMobility, cameraIntentForMovement, MobilityClass } from '../src/mobility.js';
import { anticipateZoomOut, planPlayback, screenDistancePx, zoomForViewSpan } from '../src/camera-planner.js';

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
});

test('zero-distance train activity is recovered from timelinePath geometry', () => {
  const data = { semanticSegments: [
    {
      startTime: '2026-03-25T13:15:25+09:00',
      endTime: '2026-03-25T16:14:43+09:00',
      activity: {
        start: { latLng: '34.7334658°, 135.5002547°' },
        end: { latLng: '34.7334658°, 135.5002547°' },
        distanceMeters: 0,
        topCandidate: { type: 'IN_TRAIN', probability: 0 }
      }
    },
    {
      startTime: '2026-03-25T14:00:00+09:00',
      endTime: '2026-03-25T16:00:00+09:00',
      timelinePath: [
        { point: '34.7338234°, 134.8460827°', time: '2026-03-25T14:06:00+09:00' },
        { point: '34.0564476°, 131.3177075°', time: '2026-03-25T15:43:00+09:00' },
        { point: '33.8827415°, 130.895076°', time: '2026-03-25T15:56:00+09:00' }
      ]
    }
  ]};
  const parsed = parseTimeline(data, { startDate: '2026-03-25', endDate: '2026-03-25' });
  const train = parsed.movements[0];
  assert.ok(train.distanceMeters > 300_000, `expected recovered train distance, got ${train.distanceMeters}`);
  assert.ok(train.avgSpeedKmh > 90, `expected train-like speed, got ${train.avgSpeedKmh}`);
  assert.ok(train.end.lng < 132, `bad activity endpoint should be replaced by timeline path end: ${train.end.lng}`);
});

test('camera span keeps a 10km train at regional/city scale', () => {
  const train = movement({ distanceKm: 10, durationMin: 10, type: 'IN_TRAIN', probability: 0.98 });
  const intent = cameraIntentForMovement(train, inferMobility(train));
  const zoom = zoomForViewSpan(intent.viewSpanKm, 35, 1100);
  assert.ok(zoom > 9.5 && zoom < 13, `unexpected train zoom ${zoom}`);
});

test('walking uses a materially closer camera than a fast train', () => {
  const walk = movement({ distanceKm: 0.7, durationMin: 10, type: 'WALKING', probability: 0.98 });
  const train = movement({ distanceKm: 30, durationMin: 20, type: 'IN_TRAIN', probability: 0.98 });
  const walkZoom = zoomForViewSpan(cameraIntentForMovement(walk, inferMobility(walk)).viewSpanKm, 35, 1100);
  const trainZoom = zoomForViewSpan(cameraIntentForMovement(train, inferMobility(train)).viewSpanKm, 35, 1100);
  assert.ok(walkZoom - trainZoom > 3, `expected clear zoom separation: walk=${walkZoom}, train=${trainZoom}`);
});

test('zoom-out preview reacts before a faster segment', () => {
  const raw = [...Array(60).fill(15), ...Array(60).fill(10)];
  const preview = anticipateZoomOut(raw, 30, 1.8, 0.28);
  assert.ok(preview[30] < 15, 'zoom-out should be anticipated before the segment boundary');
});

test('camera screen pan speed is bounded inside a continuous train scene', () => {
  const train = movement({ distanceKm: 120, durationMin: 55, type: 'IN_TRAIN', probability: 0.98 });
  train.points = [
    { lat: 35.0, lng: 135.0 },
    { lat: 35.2, lng: 135.6 },
    { lat: 35.5, lng: 136.2 }
  ];
  train.end = train.points.at(-1);
  const plan = planPlayback([train], { fps: 30, maxTotalSeconds: 30, viewportWidth: 1100, viewportHeight: 700 });
  let maxPxPerSec = 0;
  for (let i = 1; i < plan.frames.length; i += 1) {
    const a = plan.frames[i - 1];
    const b = plan.frames[i];
    maxPxPerSec = Math.max(maxPxPerSec, screenDistancePx(a.center, b.center, (a.zoom + b.zoom) / 2) * 30);
  }
  assert.ok(maxPxPerSec < 330, `camera is chasing too fast: ${maxPxPerSec}px/s`);
});

test('large spatial gaps form a new scene instead of being smoothed across', () => {
  const a = movement({ distanceKm: 1, durationMin: 10, type: 'WALKING', probability: 0.95 });
  a.end = { lat: 37.46, lng: 126.44 };
  a.points = [{ lat: 37.45, lng: 126.43 }, a.end];
  const b = movement({ distanceKm: 5, durationMin: 15, type: 'IN_BUS', probability: 0.95 });
  b.startMs = a.endMs + 60 * 60_000;
  b.endMs = b.startMs + 15 * 60_000;
  b.start = { lat: 33.84, lng: 131.03 };
  b.end = { lat: 33.9, lng: 131.1 };
  b.points = [b.start, b.end];
  const plan = planPlayback([a, b], { fps: 30, maxTotalSeconds: 30, viewportWidth: 1100, viewportHeight: 700 });
  assert.equal(plan.segments[0].sceneId, 0);
  assert.equal(plan.segments[1].sceneId, 1);
  assert.ok(plan.segments[1].sceneBreakBefore);
});

test('train to walk zoom remains continuous and deliberately slow', () => {
  const train = movement({ distanceKm: 30, durationMin: 20, type: 'IN_TRAIN', probability: 0.95 });
  train.points = [{ lat: 35, lng: 135 }, { lat: 35.15, lng: 135.2 }];
  train.end = train.points[1];
  const walk = movement({ distanceKm: 0.8, durationMin: 12, type: 'WALKING', probability: 0.95 });
  walk.startMs = train.endMs;
  walk.endMs = walk.startMs + 12 * 60_000;
  walk.start = train.end;
  walk.points = [{ ...train.end }, { lat: 35.16, lng: 135.21 }];
  walk.end = walk.points[1];
  const plan = planPlayback([train, walk], { fps: 30, maxTotalSeconds: 30, viewportWidth: 1100, viewportHeight: 700 });
  let maxZoomVelocity = 0;
  for (let i = 1; i < plan.frames.length; i += 1) {
    maxZoomVelocity = Math.max(maxZoomVelocity, Math.abs(plan.frames[i].zoom - plan.frames[i - 1].zoom) * 30);
  }
  assert.ok(maxZoomVelocity < 1.0, `zoom velocity too high: ${maxZoomVelocity}`);
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
