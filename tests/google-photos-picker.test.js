import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePickedMediaItems } from '../src/google-photos-picker.js';

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
