import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearActiveMediaLibrary,
  getActiveMediaItems,
  getActiveMediaLibrary,
  isActiveMediaSource,
  MediaLibrarySource,
  setActiveMediaLibrary
} from '../src/media-library-state.js';

test('active media library exposes one explicit source and media collection', () => {
  clearActiveMediaLibrary();
  const localMedia = [{ title: 'local.jpg' }];
  const localState = setActiveMediaLibrary(MediaLibrarySource.LOCAL_GALLERY, localMedia);

  assert.equal(localState.source, MediaLibrarySource.LOCAL_GALLERY);
  assert.equal(getActiveMediaLibrary(), localState);
  assert.equal(getActiveMediaItems(), localMedia);
  assert.equal(isActiveMediaSource(MediaLibrarySource.LOCAL_GALLERY), true);

  const takeoutMedia = [{ title: 'takeout.jpg' }];
  const takeoutState = setActiveMediaLibrary(MediaLibrarySource.GOOGLE_PHOTOS_TAKEOUT, takeoutMedia);

  assert.notEqual(takeoutState, localState);
  assert.equal(getActiveMediaLibrary(), takeoutState);
  assert.equal(getActiveMediaItems(), takeoutMedia);
  assert.equal(isActiveMediaSource(MediaLibrarySource.LOCAL_GALLERY), false);
});

test('guarded clear does not erase a newer media source', () => {
  clearActiveMediaLibrary();
  setActiveMediaLibrary(MediaLibrarySource.GOOGLE_PHOTOS_TAKEOUT, []);
  const localState = setActiveMediaLibrary(MediaLibrarySource.LOCAL_GALLERY, [{ title: 'newer.jpg' }]);

  const unchanged = clearActiveMediaLibrary(MediaLibrarySource.GOOGLE_PHOTOS_TAKEOUT);
  assert.equal(unchanged, localState);
  assert.equal(getActiveMediaLibrary(), localState);

  const cleared = clearActiveMediaLibrary(MediaLibrarySource.LOCAL_GALLERY);
  assert.equal(cleared.source, MediaLibrarySource.NONE);
  assert.deepEqual(cleared.media, []);
});

test('invalid media source is rejected instead of creating implicit state', () => {
  clearActiveMediaLibrary();
  assert.throws(
    () => setActiveMediaLibrary('LOCAL', []),
    /Unsupported media library source/
  );
  assert.equal(getActiveMediaLibrary().source, MediaLibrarySource.NONE);
});
