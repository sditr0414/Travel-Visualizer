import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPhotoJourneyBeats, VideoPlaybackMode } from '../src/photo-journey-v2.js';

function buildPlan() {
  const startMs = Date.parse('2026-03-25T10:00:00+09:00');
  const endMs = startMs + 60 * 60_000;
  const fps = 10;
  const travelDurationSec = 30;
  const frames = Array.from({ length: fps * travelDurationSec }, (_, index) => ({
    kind: 'TRAVEL',
    timeSec: index / fps,
    segmentIndex: 0,
    position: {
      lat: 34.7 - index / (fps * travelDurationSec) * 1.2,
      lng: 135.5 - index / (fps * travelDurationSec) * 5.0
    }
  }));
  return {
    startMs,
    endMs,
    plan: {
      fps,
      travelDurationSec,
      outroStartSec: travelDurationSec,
      durationSec: 35,
      frames,
      segments: [{
        startMs,
        endMs,
        videoStartSec: 0,
        videoEndSec: travelDurationSec,
        videoSec: travelDurationSec,
        start: { lat: 34.7, lng: 135.5 },
        end: { lat: 33.5, lng: 130.5 }
      }]
    }
  };
}

function mediaForPlan(startMs) {
  return [
    { title: 'a.jpg', takenMs: startMs + 5 * 60_000, mediaType: 'photo', hasGps: false },
    { title: 'b.jpg', takenMs: startMs + 20 * 60_000, mediaType: 'photo', hasGps: false },
    { title: 'clip.mp4', takenMs: startMs + 40 * 60_000, mediaType: 'video', hasGps: false },
    { title: 'c.jpg', takenMs: startMs + 55 * 60_000, mediaType: 'photo', hasGps: false }
  ];
}

test('photo scenes honor the configured display duration', () => {
  const { startMs, plan } = buildPlan();
  const beats = buildPhotoJourneyBeats(mediaForPlan(startMs), plan, {
    photoDisplaySec: 3,
    videoMode: VideoPlaybackMode.THUMBNAIL,
    videoMinPlaySec: 5
  });

  assert.ok(beats.length >= 3);
  for (const beat of beats) {
    assert.ok(Math.abs(beat.displayDurationSec - 3) < 1e-6);
  }
  for (let i = 1; i < beats.length; i += 1) {
    assert.ok(beats[i].startSec >= beats[i - 1].endSec - 1e-9);
  }
});

test('video playback scenes reserve at least the configured minimum time', () => {
  const { startMs, plan } = buildPlan();
  const beats = buildPhotoJourneyBeats(mediaForPlan(startMs), plan, {
    photoDisplaySec: 3,
    videoMode: VideoPlaybackMode.PLAY,
    videoMinPlaySec: 5
  });

  const videoBeat = beats.find(beat => beat.photos.some(item => item.mediaType === 'video'));
  assert.ok(videoBeat, 'expected a video beat');
  assert.ok(videoBeat.displayDurationSec >= 5 - 1e-9);
  assert.equal(videoBeat.videoMode, VideoPlaybackMode.PLAY);

  for (let i = 1; i < beats.length; i += 1) {
    assert.ok(beats[i].startSec >= beats[i - 1].endSec - 1e-9);
  }
});
