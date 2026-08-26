import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLatLng, parseTimeline } from '../src/timeline-parser.js';
import { inferMobility, cameraIntentForMovement, MobilityClass } from '../src/mobility.js';
import { anticipateZoomOut, durationLimitsForMovements, planPlayback, screenDistancePx, zoomForViewSpan } from '../src/camera-planner.js';
import { tailPointsForFrame } from '../src/route-player.js';

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
  assert.ok(train.points.length > 3, 'sparse timeline path should be densified');
});

test('a missing movement interval is bridged instead of teleporting', () => {
  const data = { semanticSegments: [
    {
      startTime: '2026-03-20T10:00:00+09:00', endTime: '2026-03-20T10:10:00+09:00',
      activity: {
        start: { latLng: '34.60°, 135.40°' }, end: { latLng: '34.61°, 135.41°' },
        distanceMeters: 1500, topCandidate: { type: 'WALKING', probability: 0.9 }
      }
    },
    {
      startTime: '2026-03-20T10:40:00+09:00', endTime: '2026-03-20T11:00:00+09:00',
      activity: {
        start: { latLng: '34.80°, 135.55°' }, end: { latLng: '34.82°, 135.57°' },
        distanceMeters: 4000, topCandidate: { type: 'IN_TRAIN', probability: 0.9 }
      }
    }
  ]};
  const parsed = parseTimeline(data, { startDate: '2026-03-20', endDate: '2026-03-20' });
  assert.equal(parsed.movements.length, 3);
  assert.equal(parsed.movements[1].inferred, true);
  assert.ok(parsed.movements[1].points.length >= 10);
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
  const preview = anticipateZoomOut(raw, 60, 1.15, 0.22);
  assert.ok(preview[30] < 15, 'zoom-out should be anticipated before the segment boundary');
});

test('playback defaults to 60 fps', () => {
  const walk = movement({ distanceKm: 1.2, durationMin: 15, type: 'WALKING', probability: 0.95 });
  const plan = planPlayback([walk], { viewportWidth: 1100, viewportHeight: 700 });
  assert.equal(plan.fps, 60);
});

test('two-week long-distance trip can use roughly a one-minute minimum', () => {
  const base = Date.parse('2026-03-17T10:00:00+09:00');
  const moves = Array.from({ length: 15 }, (_, i) => {
    const m = movement({ distanceKm: 386, durationMin: 180, type: i === 0 ? 'FLYING' : 'IN_TRAIN', probability: 0.95 });
    m.startMs = base + i * 86_400_000;
    m.endMs = m.startMs + 180 * 60_000;
    m.start = { lat: 34 + i * 0.01, lng: 130 + i * 0.02 };
    m.end = { lat: 34.1 + i * 0.01, lng: 130.1 + i * 0.02 };
    m.points = [m.start, m.end];
    return m;
  });
  const limits = durationLimitsForMovements(moves);
  assert.ok(limits.minSeconds >= 55 && limits.minSeconds <= 65, `expected about one minute, got ${limits.minSeconds}`);
  const plan = planPlayback(moves, { fps: 60, targetTotalSeconds: 60, viewportWidth: 1100, viewportHeight: 700 });
  assert.ok(Math.abs(plan.durationSec - 60) < 0.1, `expected 60 second cut, got ${plan.durationSec}`);
});

test('duration limits are ordered and travel-aware', () => {
  const a = movement({ distanceKm: 1, durationMin: 12, type: 'WALKING', probability: 0.95 });
  const b = movement({ distanceKm: 300, durationMin: 150, type: 'IN_TRAIN', probability: 0.95 });
  b.startMs = a.endMs + 24 * 60 * 60_000;
  b.endMs = b.startMs + 150 * 60_000;
  b.start = a.end;
  b.points = [b.start, { lat: 34.9, lng: 132.0 }];
  b.end = b.points[1];
  const limits = durationLimitsForMovements([a, b]);
  assert.ok(limits.minSeconds < limits.recommendedSeconds);
  assert.ok(limits.recommendedSeconds < limits.maxSeconds);
  assert.ok(limits.distanceKm > 250);
});

test('requested video duration is clamped and ends with an overview outro', () => {
  const train = movement({ distanceKm: 120, durationMin: 55, type: 'IN_TRAIN', probability: 0.98 });
  train.points = [
    { lat: 35.0, lng: 135.0 },
    { lat: 35.2, lng: 135.6 },
    { lat: 35.5, lng: 136.2 }
  ];
  train.end = train.points.at(-1);
  const limits = durationLimitsForMovements([train]);
  const plan = planPlayback([train], {
    fps: 60,
    targetTotalSeconds: limits.recommendedSeconds,
    viewportWidth: 1100,
    viewportHeight: 700
  });
  assert.equal(plan.frames.at(-1).kind, 'OUTRO');
  assert.equal(plan.frames.at(-1).mobilityClass, 'OVERVIEW');
  assert.ok(plan.outroSec >= 4.5 && plan.outroSec <= 7);
  assert.ok(Math.abs(plan.durationSec - limits.recommendedSeconds) < 0.1);
});

test('camera screen pan speed is bounded inside a continuous train scene', () => {
  const train = movement({ distanceKm: 120, durationMin: 55, type: 'IN_TRAIN', probability: 0.98 });
  train.points = [
    { lat: 35.0, lng: 135.0 },
    { lat: 35.2, lng: 135.6 },
    { lat: 35.5, lng: 136.2 }
  ];
  train.end = train.points.at(-1);
  const plan = planPlayback([train], { fps: 60, viewportWidth: 1100, viewportHeight: 700 });
  let maxPxPerSec = 0;
  const travel = plan.frames.filter(f => f.kind === 'TRAVEL');
  for (let i = 1; i < travel.length; i += 1) {
    const a = travel[i - 1];
    const b = travel[i];
    maxPxPerSec = Math.max(maxPxPerSec, screenDistancePx(a.center, b.center, (a.zoom + b.zoom) / 2) * 60);
  }
  assert.ok(maxPxPerSec < 360, `camera is chasing too fast: ${maxPxPerSec}px/s`);
});

test('route tail always ends at the exact current travel position', () => {
  const train = movement({ distanceKm: 120, durationMin: 55, type: 'IN_TRAIN', probability: 0.98 });
  train.points = [
    { lat: 35.0, lng: 135.0 },
    { lat: 35.2, lng: 135.6 },
    { lat: 35.5, lng: 136.2 }
  ];
  train.end = train.points.at(-1);
  const plan = planPlayback([train], { fps: 60, targetTotalSeconds: 60, viewportWidth: 1100, viewportHeight: 700 });
  const index = Math.min(300, plan.frames.findIndex(f => f.kind === 'OUTRO') - 1);
  const tail = tailPointsForFrame(plan, index, 3.2);
  assert.deepEqual(tail.at(-1), plan.frames[index].position);
  assert.ok(tail.length <= Math.round(3.2 * 60), `stable route tail is too long: ${tail.length}`);
});

test('large spatial gaps form a new scene when fed directly to the planner', () => {
  const a = movement({ distanceKm: 1, durationMin: 10, type: 'WALKING', probability: 0.95 });
  a.end = { lat: 37.46, lng: 126.44 };
  a.points = [{ lat: 37.45, lng: 126.43 }, a.end];
  const b = movement({ distanceKm: 5, durationMin: 15, type: 'IN_BUS', probability: 0.95 });
  b.startMs = a.endMs + 60 * 60_000;
  b.endMs = b.startMs + 15 * 60_000;
  b.start = { lat: 33.84, lng: 131.03 };
  b.end = { lat: 33.9, lng: 131.1 };
  b.points = [b.start, b.end];
  const plan = planPlayback([a, b], { fps: 60, viewportWidth: 1100, viewportHeight: 700 });
  assert.equal(plan.segments[0].sceneId, 0);
  assert.equal(plan.segments[1].sceneId, 1);
  assert.ok(plan.segments[1].sceneBreakBefore);
});

test('train to walk zoom remains frame-continuous at 60fps', () => {
  const train = movement({ distanceKm: 30, durationMin: 20, type: 'IN_TRAIN', probability: 0.95 });
  train.points = [{ lat: 35, lng: 135 }, { lat: 35.15, lng: 135.2 }];
  train.end = train.points[1];
  const walk = movement({ distanceKm: 0.8, durationMin: 12, type: 'WALKING', probability: 0.95 });
  walk.startMs = train.endMs;
  walk.endMs = walk.startMs + 12 * 60_000;
  walk.start = train.end;
  walk.points = [{ ...train.end }, { lat: 35.16, lng: 135.21 }];
  walk.end = walk.points[1];
  const plan = planPlayback([train, walk], { fps: 60, targetTotalSeconds: 60, viewportWidth: 1100, viewportHeight: 700 });
  let maxFrameDelta = 0;
  const travel = plan.frames.filter(f => f.kind === 'TRAVEL');
  for (let i = 1; i < travel.length; i += 1) {
    maxFrameDelta = Math.max(maxFrameDelta, Math.abs(travel[i].zoom - travel[i - 1].zoom));
  }
  assert.ok(maxFrameDelta < 0.035, `zoom frame jump too large: ${maxFrameDelta}`);
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