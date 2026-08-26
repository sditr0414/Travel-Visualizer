import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { applyCameraMode, CameraMode } from '../src/camera-modes.js';
import { planPlayback, screenDistancePx } from '../src/camera-planner.js';
import { parseTimeline } from '../src/timeline-parser.js';

const WIDTH = 1100;
const HEIGHT = 700;
const FPS = 60;

const partDir = new URL('../data/timeline-parts/', import.meta.url);
const partNames = (await readdir(partDir))
  .filter(name => /^part-\d+\.txt$/i.test(name))
  .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
const encoded = (await Promise.all(partNames.map(name => readFile(new URL(name, partDir), 'utf8'))))
  .join('')
  .replace(/\s+/g, '');
const fixture = JSON.parse(gunzipSync(Buffer.from(encoded, 'base64')));
const parsed = parseTimeline(fixture, {
  startDate: '2026-03-17',
  endDate: '2026-03-31',
  includeFlights: true
});

test('bundled trip camera remains bounded at short and long playback durations', () => {
  assert.ok(parsed.movements.length > 250, 'fixture should exercise the full trip movement mix');

  for (const duration of [60, 300]) {
    for (const mode of Object.values(CameraMode)) {
      const plan = applyCameraMode(planPlayback(parsed.movements, {
        fps: FPS,
        targetTotalSeconds: duration,
        viewportWidth: WIDTH,
        viewportHeight: HEIGHT,
        pacingMode: 'LOCAL_DAYS'
      }), { mode, viewportWidth: WIDTH, viewportHeight: HEIGHT });
      const frames = plan.frames.filter(frame => frame.kind === 'TRAVEL');
      const metrics = cameraMetrics(frames);

      assert.ok(frames.length > duration * FPS * 0.8, `${mode}/${duration}s generated too few frames`);
      assert.ok(metrics.sceneCount > 1, `${mode}/${duration}s should cut impossible endpoint jumps`);
      assert.ok(metrics.minZoom >= 4 && metrics.maxZoom <= 17.3, `${mode}/${duration}s zoom out of range`);
      assert.ok(metrics.maxZoomVelocity <= 1.36, `${mode}/${duration}s zoom velocity ${metrics.maxZoomVelocity}`);
      assert.ok(metrics.maxPanPxPerSec < 280, `${mode}/${duration}s pan ${metrics.maxPanPxPerSec}px/s`);
      assert.ok(metrics.maxLockedPanPxPerSec < 280, `${mode}/${duration}s locked pan ${metrics.maxLockedPanPxPerSec}px/s`);
      assert.ok(metrics.maxMarkerOffsetPx < 260, `${mode}/${duration}s marker offset ${metrics.maxMarkerOffsetPx}px`);
      assert.ok(metrics.maxLockedMarkerOffsetPx < 260, `${mode}/${duration}s locked marker offset ${metrics.maxLockedMarkerOffsetPx}px`);
      assert.equal(metrics.invalidFrames, 0, `${mode}/${duration}s contains invalid camera frames`);
    }
  }
});

test('flight frames request a wide compression-safe camera', () => {
  const plan = applyCameraMode(planPlayback(parsed.movements, {
    fps: FPS,
    targetTotalSeconds: 300,
    viewportWidth: WIDTH,
    viewportHeight: HEIGHT
  }), { mode: CameraMode.AUTO, viewportWidth: WIDTH, viewportHeight: HEIGHT });
  const flightFrames = plan.frames.filter(frame => frame.kind === 'TRAVEL' && frame.mobilityClass === 'FLIGHT');
  assert.ok(flightFrames.length > 100, 'fixture should contain material flight playback');
  const maxOverride = Math.max(...flightFrames.map(frame => Math.abs(frame.modeTargetZoom - frame.targetZoom)));
  assert.ok(maxOverride < 1e-9, `flight compression zoom was overridden by ${maxOverride}`);
});

function cameraMetrics(frames) {
  let maxZoomVelocity = 0;
  let maxPanPxPerSec = 0;
  let maxLockedPanPxPerSec = 0;
  let maxMarkerOffsetPx = 0;
  let maxLockedMarkerOffsetPx = 0;
  let invalidFrames = 0;

  for (let i = 0; i < frames.length; i += 1) {
    const frame = frames[i];
    const values = [
      frame.position?.lat, frame.position?.lng,
      frame.center?.lat, frame.center?.lng,
      frame.lockedCenter?.lat, frame.lockedCenter?.lng,
      frame.zoom, frame.lockedZoom
    ];
    if (values.some(value => !Number.isFinite(value))) invalidFrames += 1;
    maxMarkerOffsetPx = Math.max(maxMarkerOffsetPx, screenDistancePx(frame.center, frame.position, frame.zoom));
    maxLockedMarkerOffsetPx = Math.max(
      maxLockedMarkerOffsetPx,
      screenDistancePx(frame.lockedCenter, frame.position, frame.lockedZoom)
    );

    const previous = frames[i - 1];
    if (!previous || previous.sceneId !== frame.sceneId) continue;
    maxZoomVelocity = Math.max(maxZoomVelocity, Math.abs(frame.zoom - previous.zoom) * FPS);
    maxPanPxPerSec = Math.max(
      maxPanPxPerSec,
      screenDistancePx(previous.center, frame.center, (previous.zoom + frame.zoom) / 2) * FPS
    );
    maxLockedPanPxPerSec = Math.max(
      maxLockedPanPxPerSec,
      screenDistancePx(
        previous.lockedCenter,
        frame.lockedCenter,
        (previous.lockedZoom + frame.lockedZoom) / 2
      ) * FPS
    );
  }

  const zooms = frames.map(frame => frame.zoom);
  return {
    sceneCount: new Set(frames.map(frame => frame.sceneId)).size,
    minZoom: Math.min(...zooms),
    maxZoom: Math.max(...zooms),
    maxZoomVelocity,
    maxPanPxPerSec,
    maxLockedPanPxPerSec,
    maxMarkerOffsetPx,
    maxLockedMarkerOffsetPx,
    invalidFrames
  };
}
