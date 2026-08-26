import test from 'node:test';
import assert from 'node:assert/strict';
import { planPlayback } from '../src/camera-planner.js';
import { applyCameraMode as applyCoreCameraMode, CameraMode } from '../src/camera-modes.js';
import { applyCameraMode as applyCloserCameraMode } from '../src/camera-modes-auto.js';

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

function movements() {
  const startMs = Date.parse('2026-03-25T08:00:00+09:00');
  const local = movement({
    startMs,
    durationMin: 35,
    start: { lat: 34.69, lng: 135.50 },
    end: { lat: 34.73, lng: 135.56 },
    distanceKm: 7,
    type: 'IN_SUBWAY'
  });
  const rail = movement({
    startMs: local.endMs + 90 * 60_000,
    durationMin: 165,
    start: local.end,
    mid: { lat: 34.2, lng: 133.0 },
    end: { lat: 33.59, lng: 130.42 },
    distanceKm: 515,
    type: 'IN_TRAIN'
  });
  const flight = movement({
    startMs: rail.endMs + 90 * 60_000,
    durationMin: 95,
    start: rail.end,
    mid: { lat: 35.1, lng: 129.7 },
    end: { lat: 37.46, lng: 126.44 },
    distanceKm: 650,
    type: 'FLYING'
  });
  return [local, rail, flight];
}

function makeBasePlan() {
  return planPlayback(movements(), {
    fps: 60,
    targetTotalSeconds: 120,
    viewportWidth: 1100,
    viewportHeight: 700
  });
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

test('recommended automatic camera is closer for non-flight travel while flights stay unchanged', () => {
  const core = applyCoreCameraMode(makeBasePlan(), {
    mode: CameraMode.AUTO,
    zoomOffset: 0.3,
    viewportWidth: 1100,
    viewportHeight: 700
  });
  const closer = applyCloserCameraMode(makeBasePlan(), {
    mode: CameraMode.AUTO,
    zoomOffset: 0.3,
    viewportWidth: 1100,
    viewportHeight: 700
  });

  const coreTravel = core.frames.filter(frame => frame.kind === 'TRAVEL');
  const closerTravel = closer.frames.filter(frame => frame.kind === 'TRAVEL');
  assert.equal(coreTravel.length, closerTravel.length);

  const localLockedDiffs = [];
  const localViewDiffs = [];
  for (let index = 0; index < coreTravel.length; index += 1) {
    const before = coreTravel[index];
    const after = closerTravel[index];
    if (before.mobilityClass === 'FLIGHT') {
      assert.ok(Math.abs((after.zoom ?? 0) - (before.zoom ?? 0)) < 1e-9);
      assert.ok(Math.abs((after.lockedZoom ?? 0) - (before.lockedZoom ?? 0)) < 1e-9);
    } else {
      localViewDiffs.push(after.zoom - before.zoom);
      localLockedDiffs.push(after.lockedZoom - before.lockedZoom);
    }
  }

  assert.ok(localViewDiffs.length > 100);
  assert.ok(average(localViewDiffs) > 0.24, `AUTO normal view should be closer, got ${average(localViewDiffs)}`);
  assert.ok(average(localLockedDiffs) > 0.40, `AUTO locked view should be noticeably closer, got ${average(localLockedDiffs)}`);
  assert.ok(Math.abs(closer.autoCloserBias - 0.28) < 1e-9);
  assert.ok(Math.abs(closer.autoLockedCloserBias - 0.46) < 1e-9);
});

test('day and segment modes are not changed by the automatic closer wrapper', () => {
  for (const mode of [CameraMode.DAY, CameraMode.SEGMENT]) {
    const core = applyCoreCameraMode(makeBasePlan(), { mode, zoomOffset: 0.3, viewportWidth: 1100, viewportHeight: 700 });
    const wrapped = applyCloserCameraMode(makeBasePlan(), { mode, zoomOffset: 0.3, viewportWidth: 1100, viewportHeight: 700 });
    const coreTravel = core.frames.filter(frame => frame.kind === 'TRAVEL');
    const wrappedTravel = wrapped.frames.filter(frame => frame.kind === 'TRAVEL');
    assert.equal(coreTravel.length, wrappedTravel.length);
    for (let index = 0; index < coreTravel.length; index += 1) {
      assert.ok(Math.abs(coreTravel[index].zoom - wrappedTravel[index].zoom) < 1e-9);
      assert.ok(Math.abs(coreTravel[index].lockedZoom - wrappedTravel[index].lockedZoom) < 1e-9);
    }
  }
});
