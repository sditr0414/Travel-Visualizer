import test from 'node:test';
import assert from 'node:assert/strict';
import { planPlayback, PlaybackPacing } from '../src/camera-planner.js';
import { describeDay } from '../src/playback-pacing.js';

function movement({
  day,
  start,
  end,
  type,
  durationMin,
  distanceKm,
  probability = 0.99
}) {
  const startMs = Date.parse(`${day}T10:00:00+09:00`);
  return {
    localDay: day,
    startMs,
    endMs: startMs + durationMin * 60_000,
    start,
    end,
    points: [start, end],
    distanceMeters: distanceKm * 1000,
    durationSec: durationMin * 60,
    avgSpeedKmh: distanceKm / (durationMin / 60),
    googleType: type,
    googleProbability: probability,
    activityProbability: probability,
    inferred: false
  };
}

function sampleTrip() {
  const flight = movement({
    day: '2026-03-17',
    start: { lat: 37.46, lng: 126.44 },
    end: { lat: 34.44, lng: 135.24 },
    type: 'FLYING', durationMin: 110, distanceKm: 900
  });
  const cityA = movement({
    day: '2026-03-18',
    start: { lat: 34.69, lng: 135.50 },
    end: { lat: 34.71, lng: 135.54 },
    type: 'IN_SUBWAY', durationMin: 25, distanceKm: 6
  });
  const walkA = movement({
    day: '2026-03-18',
    start: cityA.end,
    end: { lat: 34.72, lng: 135.55 },
    type: 'WALKING', durationMin: 35, distanceKm: 2
  });
  walkA.startMs = cityA.endMs + 60_000;
  walkA.endMs = walkA.startMs + walkA.durationSec * 1000;

  const outbound = movement({
    day: '2026-03-25',
    start: { lat: 34.73, lng: 135.50 },
    end: { lat: 33.59, lng: 130.42 },
    type: 'IN_TRAIN', durationMin: 165, distanceKm: 510
  });
  const returnTrain = movement({
    day: '2026-03-25',
    start: outbound.end,
    end: { lat: 34.73, lng: 135.50 },
    type: 'IN_TRAIN', durationMin: 165, distanceKm: 515
  });
  returnTrain.startMs = outbound.endMs + 3 * 60 * 60_000;
  returnTrain.endMs = returnTrain.startMs + returnTrain.durationSec * 1000;

  const cityB = movement({
    day: '2026-03-26',
    start: { lat: 34.68, lng: 135.50 },
    end: { lat: 34.70, lng: 135.53 },
    type: 'IN_SUBWAY', durationMin: 20, distanceKm: 5
  });
  return [flight, cityA, walkA, outbound, returnTrain, cityB];
}

test('local-day pacing is the default policy', () => {
  const plan = planPlayback(sampleTrip(), { fps: 60, targetTotalSeconds: 60 });
  assert.equal(plan.pacingMode, PlaybackPacing.LOCAL_DAYS);
});

test('local-day pacing preserves flight time from global pacing', () => {
  const trip = sampleTrip();
  const global = planPlayback(trip, {
    fps: 60,
    targetTotalSeconds: 60,
    pacingMode: PlaybackPacing.GLOBAL
  });
  const local = planPlayback(trip, {
    fps: 60,
    targetTotalSeconds: 60,
    pacingMode: PlaybackPacing.LOCAL_DAYS
  });
  const globalFlight = global.segments.find(segment => segment.inference.mobilityClass === 'FLIGHT');
  const localFlight = local.segments.find(segment => segment.inference.mobilityClass === 'FLIGHT');
  assert.ok(globalFlight && localFlight);
  assert.ok(Math.abs(globalFlight.videoSec - localFlight.videoSec) < 1e-9);
});

test('same-day long-distance rail round trip gets more screen time', () => {
  const trip = sampleTrip();
  const global = planPlayback(trip, {
    fps: 60,
    targetTotalSeconds: 60,
    pacingMode: PlaybackPacing.GLOBAL
  });
  const local = planPlayback(trip, {
    fps: 60,
    targetTotalSeconds: 60,
    pacingMode: PlaybackPacing.LOCAL_DAYS
  });

  const globalDay = global.segments
    .filter(segment => segment.localDay === '2026-03-25')
    .reduce((sum, segment) => sum + segment.videoSec, 0);
  const localDay = local.segments
    .filter(segment => segment.localDay === '2026-03-25')
    .reduce((sum, segment) => sum + segment.videoSec, 0);
  const localTrains = local.segments.filter(segment => segment.localDay === '2026-03-25');

  assert.ok(localDay > globalDay * 1.2, `expected protected day: global=${globalDay}, local=${localDay}`);
  assert.ok(localTrains.every(segment => segment.videoSec >= 1.4), localTrains.map(segment => segment.videoSec).join(', '));
});

test('day descriptor recognizes a long out-and-back rail day', () => {
  const trip = sampleTrip();
  const local = planPlayback(trip, {
    fps: 60,
    targetTotalSeconds: 60,
    pacingMode: PlaybackPacing.LOCAL_DAYS
  });
  const indices = local.segments
    .map((segment, index) => segment.localDay === '2026-03-25' ? index : -1)
    .filter(index => index >= 0);
  const day = describeDay(local.segments, indices);
  assert.equal(day.roundTrip, true);
  assert.ok(day.longGroundKm > 900);
  assert.ok(day.maxExcursionKm > 400);
});
