import test from 'node:test';
import assert from 'node:assert/strict';
import { planPlayback } from '../src/camera-planner.js';
import { applyCameraMode, CameraMode, ZOOM_OFFSET_MAX, ZOOM_OFFSET_MIN } from '../src/camera-modes.js';

function movement({ startMs, durationMin, start, end, distanceKm, type, mid }) {
  return {
    startMs,
    endMs: startMs + durationMin * 60_000,
    start,
    end,
    points: mid ? [start, mid, end] : [start, end],
    distanceMeters: distanceKm * 1000,
    durationSec: durationMin * 60,
    avgSpeedKmh: distanceKm / (durationMin / 60),
    googleType: type,
    googleProbability: 0.98
  };
}

function sampleDay() {
  const day = Date.parse('2026-03-20T08:00:00+09:00');
  const subway = movement({ startMs: day, durationMin: 30, start: { lat: 34.69, lng: 135.50 }, end: { lat: 34.72, lng: 135.55 }, distanceKm: 6, type: 'IN_SUBWAY' });
  const walk = movement({ startMs: day + 60 * 60_000, durationMin: 20, start: subway.end, end: { lat: 34.70, lng: 135.48 }, distanceKm: 4, type: 'WALKING' });
  const train = movement({ startMs: day + 3 * 60 * 60_000, durationMin: 75, start: walk.end, mid: { lat: 34.6, lng: 134.0 }, end: { lat: 34.40, lng: 132.45 }, distanceKm: 300, type: 'IN_TRAIN' });
  const eveningWalk = movement({ startMs: day + 5 * 60 * 60_000, durationMin: 25, start: train.end, end: { lat: 34.39, lng: 132.48 }, distanceKm: 3, type: 'WALKING' });
  return [subway, walk, train, eveningWalk];
}

function sampleDayWithFlight() {
  const movements = sampleDay();
  const last = movements.at(-1);
  const flight = movement({
    startMs: last.endMs + 90 * 60_000,
    durationMin: 95,
    start: last.end,
    mid: { lat: 35.0, lng: 130.0 },
    end: { lat: 37.46, lng: 126.44 },
    distanceKm: 650,
    type: 'FLYING'
  });
  return [...movements, flight];
}

function makePlan(mode, zoomOffset = 0, movements = sampleDay()) {
  const base = planPlayback(movements, { fps: 60, targetTotalSeconds: 60, viewportWidth: 1100, viewportHeight: 700 });
  return applyCameraMode(base, { mode, zoomOffset, viewportWidth: 1100, viewportHeight: 700 });
}

function travelFrames(plan) {
  return plan.frames.filter(frame => frame.kind === 'TRAVEL');
}

function targetRange(plan) {
  const zooms = travelFrames(plan).map(frame => frame.modeTargetZoom);
  return Math.max(...zooms) - Math.min(...zooms);
}

test('camera modes provide distinct daily, automatic, and segment behavior', () => {
  const auto = makePlan(CameraMode.AUTO);
  const day = makePlan(CameraMode.DAY);
  const segment = makePlan(CameraMode.SEGMENT);
  assert.ok(targetRange(day) < targetRange(auto), 'day mode should vary less than automatic mode');
  assert.ok(targetRange(auto) < targetRange(segment), 'automatic mode should vary less than segment mode');
  assert.equal(auto.cameraMode, CameraMode.AUTO);
});

test('automatic mode keeps short-video zoom velocity controlled and still zooms out for long rail', () => {
  const plan = makePlan(CameraMode.AUTO);
  const frames = travelFrames(plan);
  let maxVelocity = 0;
  for (let i = 1; i < frames.length; i += 1) {
    maxVelocity = Math.max(maxVelocity, Math.abs(frames[i].zoom - frames[i - 1].zoom) * 60);
  }
  assert.ok(maxVelocity < 1.1, `short-video zoom is too abrupt: ${maxVelocity}`);

  const longFrames = frames.filter(frame => frame.longDistanceException);
  const localFrames = frames.filter(frame => !frame.longDistanceException);
  const average = values => values.reduce((sum, frame) => sum + frame.modeTargetZoom, 0) / values.length;
  assert.ok(longFrames.length > 0 && localFrames.length > 0);
  assert.ok(average(longFrames) < average(localFrames) - 1, 'long rail should still receive a wider camera');
});

test('local zoom offset moves non-flight zoom while leaving flight framing unchanged', () => {
  const neutral = makePlan(CameraMode.AUTO, 0, sampleDayWithFlight());
  const closer = makePlan(CameraMode.AUTO, 0.8, sampleDayWithFlight());
  const neutralFrames = travelFrames(neutral);
  const closerFrames = travelFrames(closer);

  const localDiffs = [];
  for (let i = 0; i < neutralFrames.length; i += 1) {
    const a = neutralFrames[i];
    const b = closerFrames[i];
    if (a.mobilityClass === 'FLIGHT') {
      assert.ok(Math.abs(b.modeTargetZoom - b.targetZoom) < 1e-9, 'flight zoom should ignore local zoom offset');
    } else if (a.modeTargetZoom < 16.4) {
      localDiffs.push(b.modeTargetZoom - a.modeTargetZoom);
    }
  }

  assert.ok(localDiffs.length > 100, 'test should include enough unclamped local frames');
  const averageDiff = localDiffs.reduce((sum, value) => sum + value, 0) / localDiffs.length;
  assert.ok(averageDiff > 0.72, `expected local zoom offset near +0.8, got ${averageDiff}`);
  assert.equal(closer.zoomOffset, 0.8);
});

test('local zoom offset is clamped to the supported range', () => {
  assert.equal(makePlan(CameraMode.AUTO, 9).zoomOffset, ZOOM_OFFSET_MAX);
  assert.equal(makePlan(CameraMode.AUTO, -9).zoomOffset, ZOOM_OFFSET_MIN);
});
