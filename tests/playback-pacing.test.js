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
  probability = 0.99,
  minuteOffset = 0
}) {
  const startMs = Date.parse(`${day}T08:00:00+09:00`) + minuteOffset * 60_000;
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

function cityDay(day, seed) {
  const moves = [];
  let point = { lat: 34.62 + seed * 0.004, lng: 135.42 + seed * 0.005 };
  let minuteOffset = 0;
  for (let i = 0; i < 8; i += 1) {
    const type = i % 3 === 0 ? 'IN_SUBWAY' : i % 3 === 1 ? 'WALKING' : 'IN_BUS';
    const distanceKm = type === 'WALKING' ? 1.4 : type === 'IN_SUBWAY' ? 6.5 : 4.2;
    const durationMin = type === 'WALKING' ? 24 : type === 'IN_SUBWAY' ? 18 : 20;
    const next = {
      lat: point.lat + 0.008 + i * 0.0002,
      lng: point.lng + 0.012 + i * 0.0003
    };
    moves.push(movement({ day, start: point, end: next, type, durationMin, distanceKm, minuteOffset }));
    point = next;
    minuteOffset += durationMin + 28;
  }
  return moves;
}

function sampleTrip() {
  const trip = [movement({
    day: '2026-03-17',
    start: { lat: 37.46, lng: 126.44 },
    end: { lat: 34.44, lng: 135.24 },
    type: 'FLYING', durationMin: 110, distanceKm: 900
  })];

  const before = ['2026-03-18', '2026-03-19', '2026-03-20', '2026-03-21', '2026-03-22', '2026-03-23', '2026-03-24'];
  before.forEach((day, index) => trip.push(...cityDay(day, index)));

  const outbound = movement({
    day: '2026-03-25',
    start: { lat: 34.73, lng: 135.50 },
    end: { lat: 33.59, lng: 130.42 },
    type: 'IN_TRAIN', durationMin: 165, distanceKm: 510,
    minuteOffset: 5 * 60
  });
  const returnTrain = movement({
    day: '2026-03-25',
    start: outbound.end,
    end: { lat: 34.73, lng: 135.50 },
    type: 'IN_TRAIN', durationMin: 165, distanceKm: 515,
    minuteOffset: 11 * 60
  });
  trip.push(outbound, returnTrain);

  const after = ['2026-03-26', '2026-03-27', '2026-03-28', '2026-03-29', '2026-03-30'];
  after.forEach((day, index) => trip.push(...cityDay(day, index + 7)));

  trip.push(movement({
    day: '2026-03-31',
    start: { lat: 34.44, lng: 135.24 },
    end: { lat: 37.46, lng: 126.44 },
    type: 'FLYING', durationMin: 110, distanceKm: 900,
    minuteOffset: 12 * 60
  }));
  return trip;
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
  const globalFlights = global.segments.filter(segment => segment.inference.mobilityClass === 'FLIGHT');
  const localFlights = local.segments.filter(segment => segment.inference.mobilityClass === 'FLIGHT');
  assert.equal(globalFlights.length, localFlights.length);
  for (let i = 0; i < globalFlights.length; i += 1) {
    assert.ok(Math.abs(globalFlights[i].videoSec - localFlights[i].videoSec) < 1e-9);
  }
});

test('same-day long-distance rail round trip gets more screen time in a busy two-week trip', () => {
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