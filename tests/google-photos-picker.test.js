import test from 'node:test';
import assert from 'node:assert/strict';
import { filterPhotosToTravelDates, normalizePickedMediaItems } from '../src/google-photos-picker.js';

test('Google Photos Picker items become Timeline-matchable photos', () => {
  const photos = normalizePickedMediaItems([
    {
      id: 'photo-1',
      createTime: '2026-03-25T04:06:32Z',
      type: 'PHOTO',
      mediaFile: {
        baseUrl: 'https://example.test/photo',
        mimeType: 'image/jpeg',
        filename: 'Hakata.jpg'
      }
    },
    {
      id: 'video-1',
      createTime: '2026-03-25T04:07:00Z',
      type: 'VIDEO',
      mediaFile: {
        baseUrl: 'https://example.test/video',
        mimeType: 'video/mp4',
        filename: 'clip.mp4'
      }
    }
  ]);

  assert.equal(photos.length, 1);
  assert.equal(photos[0].title, 'Hakata.jpg');
  assert.equal(photos[0].takenMs, Date.parse('2026-03-25T04:06:32Z'));
  assert.equal(photos[0].hasGps, false);
  assert.equal(photos[0].source, 'google-photos-picker');
  assert.equal(photos[0].remoteUrl, 'https://example.test/photo=w1600-h1600');
});

test('Picker normalization rejects unusable or undated items', () => {
  const photos = normalizePickedMediaItems([
    { id: 'missing-time', type: 'PHOTO', mediaFile: { baseUrl: 'https://example.test/a', mimeType: 'image/jpeg' } },
    { id: 'missing-url', createTime: '2026-03-25T04:06:32Z', type: 'PHOTO', mediaFile: { mimeType: 'image/jpeg' } }
  ]);
  assert.deepEqual(photos, []);
});

test('Google Photos selections are automatically limited to the Timeline trip dates in Japan time', () => {
  const photos = [
    { title: 'before.jpg', takenMs: Date.parse('2026-03-16T14:59:59Z') },
    { title: 'first.jpg', takenMs: Date.parse('2026-03-16T15:00:00Z') },
    { title: 'middle.jpg', takenMs: Date.parse('2026-03-25T04:06:32Z') },
    { title: 'last.jpg', takenMs: Date.parse('2026-03-31T14:59:59.999Z') },
    { title: 'after.jpg', takenMs: Date.parse('2026-03-31T15:00:00Z') }
  ];

  const result = filterPhotosToTravelDates(photos, {
    startDate: '2026-03-17',
    endDate: '2026-03-31'
  });

  assert.deepEqual(result.photos.map(photo => photo.title), ['first.jpg', 'middle.jpg', 'last.jpg']);
  assert.equal(result.excludedOutsideRange, 2);
});

test('invalid date range leaves the selected photos untouched', () => {
  const photos = [{ title: 'one.jpg', takenMs: Date.parse('2026-03-25T04:06:32Z') }];
  const result = filterPhotosToTravelDates(photos, { startDate: '', endDate: '' });
  assert.deepEqual(result.photos, photos);
  assert.equal(result.excludedOutsideRange, 0);
});
