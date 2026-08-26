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
    progress: index / Math.max(1, fps * travelDurationSec - 1),
    speedKmh: 45,
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
      outroSec: 0,
      durationSec: travelDurationSec,
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

test('photo journey inserts a stationary stop for every selected media location', () => {
  const { startMs, plan } = buildPlan();
  const baseDuration = plan.durationSec;
  const beats = buildPhotoJourneyBeats(mediaForPlan(startMs), plan, {
    photoDisplaySec: 3,
    videoMode: VideoPlaybackMode.THUMBNAIL,
    videoMaxPlaySec: 5
  });

  assert.equal(beats.length, 4);
  assert.ok(Math.abs(plan.durationSec - (baseDuration + 12)) < 1e-9);

  for (const beat of beats) {
    assert.ok(Math.abs(beat.displayDurationSec - 3) < 1e-9);
    const holdFrames = plan.frames.filter(frame => frame.mediaBeatId === beat.id);
    assert.equal(holdFrames.length, plan.fps * 3);
    assert.ok(holdFrames.every(frame => frame.mediaHold && frame.speedKmh === 0));
    const first = holdFrames[0].position;
    assert.ok(holdFrames.every(frame => frame.position.lat === first.lat && frame.position.lng === first.lng));
  }
});

test('multiple photos at one capture stop are shown sequentially, one photo duration each', () => {
  const { startMs, plan } = buildPlan();
  const media = [
    { title: 'a.jpg', takenMs: startMs + 20 * 60_000, mediaType: 'photo', hasGps: true, lat: 34.3, lng: 133.8 },
    { title: 'b.jpg', takenMs: startMs + 21 * 60_000, mediaType: 'photo', hasGps: true, lat: 34.3001, lng: 133.8001 }
  ];
  const beats = buildPhotoJourneyBeats(media, plan, {
    photoDisplaySec: 2.5,
    videoMode: VideoPlaybackMode.THUMBNAIL,
    videoMaxPlaySec: 5
  });

  assert.equal(beats.length, 1);
  assert.equal(beats[0].photos.length, 2);
  assert.ok(Math.abs(beats[0].displayDurationSec - 5) < 1e-9);
  const holdFrames = plan.frames.filter(frame => frame.mediaBeatId === beats[0].id);
  assert.equal(holdFrames.length, 50);
  assert.equal(holdFrames.filter(frame => frame.mediaItemIndex === 0).length, 25);
  assert.equal(holdFrames.filter(frame => frame.mediaItemIndex === 1).length, 25);
});

test('video playback uses the configured maximum stop time instead of a minimum', () => {
  const { startMs, plan } = buildPlan();
  const beats = buildPhotoJourneyBeats(mediaForPlan(startMs), plan, {
    photoDisplaySec: 3,
    videoMode: VideoPlaybackMode.PLAY,
    videoMaxPlaySec: 5
  });

  const videoBeat = beats.find(beat => beat.photos.some(item => item.mediaType === 'video'));
  assert.ok(videoBeat, 'expected a video beat');
  assert.ok(Math.abs(videoBeat.displayDurationSec - 5) < 1e-9);
  assert.equal(videoBeat.videoMode, VideoPlaybackMode.PLAY);

  const videoHoldFrames = plan.frames.filter(frame => frame.mediaBeatId === videoBeat.id);
  assert.equal(videoHoldFrames.length, plan.fps * 5);
  assert.ok(videoHoldFrames.every(frame => frame.mediaItemIndex === 0));
});
