import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activePhotoBeatAtTime,
  buildPhotoJourneyBeats,
  choosePhotoPlacement,
  formatPhotoTimestamp,
  parseGooglePhotosMetadata
} from '../src/photo-journey.js';

test('Google Photos Takeout sidecar exposes capture time and GPS', () => {
  const metadata = parseGooglePhotosMetadata({
    title: 'hakata.jpg',
    photoTakenTime: { timestamp: '1774411560' },
    geoDataExif: { latitude: 33.5902, longitude: 130.4207 }
  }, 'hakata.jpg.json');

  assert.equal(metadata.title, 'hakata.jpg');
  assert.equal(metadata.takenMs, 1774411560 * 1000);
  assert.equal(metadata.hasGps, true);
  assert.equal(metadata.lat, 33.5902);
  assert.equal(metadata.lng, 130.4207);
});

test('photo timestamps are shown to the minute in Japan time', () => {
  const value = Date.parse('2026-03-25T04:06:00Z');
  assert.equal(formatPhotoTimestamp(value), '2026.03.25 13:06');
});

test('photo journey maps capture time onto playback time and groups nearby photos', () => {
  const startMs = Date.parse('2026-03-25T10:00:00+09:00');
  const endMs = startMs + 60 * 60_000;
  const fps = 60;
  const travelDurationSec = 12;
  const frameCount = fps * travelDurationSec;
  const frames = Array.from({ length: frameCount }, (_, index) => ({
    kind: 'TRAVEL',
    timeSec: index / fps,
    segmentIndex: 0,
    position: { lat: 34.70 - index / frameCount * 0.8, lng: 135.50 - index / frameCount * 4.6 }
  }));
  const plan = {
    fps,
    travelDurationSec,
    outroStartSec: travelDurationSec,
    durationSec: 17,
    frames,
    segments: [{
      startMs,
      endMs,
      videoStartSec: 0,
      videoEndSec: travelDurationSec,
      videoSec: travelDurationSec,
      start: { lat: 34.70, lng: 135.50 },
      end: { lat: 33.90, lng: 130.90 }
    }]
  };
  const photos = [
    { title: 'a.jpg', takenMs: startMs + 30 * 60_000, hasGps: true, lat: 34.30, lng: 133.20 },
    { title: 'b.jpg', takenMs: startMs + 31 * 60_000, hasGps: true, lat: 34.29, lng: 133.19 }
  ];

  const beats = buildPhotoJourneyBeats(photos, plan);
  assert.equal(beats.length, 1);
  assert.ok(beats[0].videoSec > 5 && beats[0].videoSec < 7);
  assert.equal(beats[0].photos.length, 2);
  assert.equal(activePhotoBeatAtTime(beats, beats[0].videoSec)?.id, beats[0].id);
});

test('photo placement strongly avoids occupied UI and route regions', () => {
  const placement = choosePhotoPlacement({
    viewportWidth: 1000,
    viewportHeight: 700,
    cardWidth: 300,
    cardHeight: 220,
    anchorPx: { x: 500, y: 350 },
    routePoints: [
      { x: 120, y: 90 }, { x: 160, y: 250 }, { x: 180, y: 500 }
    ],
    forbiddenRects: [{ x: 0, y: 0, width: 470, height: 700 }]
  });

  assert.ok(placement.slot.endsWith('RIGHT'), `expected a right-side placement, got ${placement.slot}`);
  assert.ok(placement.rect.x >= 470);
});
