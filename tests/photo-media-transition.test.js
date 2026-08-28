import test from 'node:test';
import assert from 'node:assert/strict';
import { photoMediaTransitionMs } from '../src/photo-media-transition.js';

test('photo media transition speeds scale with configured route duration', () => {
  const short = photoMediaTransitionMs(30);
  const medium = photoMediaTransitionMs(180);
  const long = photoMediaTransitionMs(480);

  assert.ok(short < medium);
  assert.ok(medium < long);
  assert.equal(short, 163);
  assert.equal(medium, 275);
  assert.equal(long, 500);
});

test('photo media transition timing is bounded and has a stable fallback', () => {
  assert.equal(photoMediaTransitionMs(1), 141);
  assert.equal(photoMediaTransitionMs(10_000), 520);
  assert.equal(photoMediaTransitionMs('not-a-number'), 275);
});
