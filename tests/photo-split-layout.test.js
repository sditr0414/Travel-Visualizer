import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPhotoMapShare,
  clampPhotoMapShare,
  defaultPhotoMapShare,
  photoMapShareLimits,
  photoPaneTarget
} from '../src/photo-split-layout.js';

test('photo split defaults preserve the existing desktop and mobile composition', () => {
  assert.equal(defaultPhotoMapShare(false), 0.60);
  assert.equal(defaultPhotoMapShare(true), 0.52);
});

test('photo split clamps user resizing to usable map and media panes', () => {
  const desktop = photoMapShareLimits(false);
  const mobile = photoMapShareLimits(true);
  assert.equal(clampPhotoMapShare(0.1, false), desktop.min);
  assert.equal(clampPhotoMapShare(0.95, false), desktop.max);
  assert.equal(clampPhotoMapShare(0.1, true), mobile.min);
  assert.equal(clampPhotoMapShare(0.95, true), mobile.max);
});

test('photo pane camera target follows the center of the resized map pane', () => {
  assert.deepEqual(photoPaneTarget(0.70, false), { x: 0.35, y: 0.50 });
  assert.deepEqual(photoPaneTarget(0.64, true), { x: 0.50, y: 0.32 });
});

test('applying a split updates stage variables used by layout CSS', () => {
  const properties = new Map();
  const stage = {
    dataset: {},
    style: { setProperty: (key, value) => properties.set(key, value) }
  };

  const share = applyPhotoMapShare(stage, 0.67, false);
  assert.equal(share, 0.67);
  assert.equal(stage.dataset.photoMapShare, '0.67');
  assert.equal(properties.get('--photo-map-share'), '67.00%');
  assert.equal(properties.get('--photo-media-share'), '33.00%');
});
