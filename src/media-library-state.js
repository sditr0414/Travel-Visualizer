export const MediaLibrarySource = Object.freeze({
  NONE: 'NONE',
  LOCAL_GALLERY: 'LOCAL_GALLERY',
  GOOGLE_PHOTOS_PICKER: 'GOOGLE_PHOTOS_PICKER',
  GOOGLE_PHOTOS_TAKEOUT: 'GOOGLE_PHOTOS_TAKEOUT'
});

const VALID_SOURCES = new Set(Object.values(MediaLibrarySource));
let activeMediaLibrary = createState(MediaLibrarySource.NONE, []);

export function setActiveMediaLibrary(source, media) {
  if (!VALID_SOURCES.has(source) || source === MediaLibrarySource.NONE) {
    throw new TypeError(`Unsupported media library source: ${String(source)}`);
  }
  activeMediaLibrary = createState(source, Array.isArray(media) ? media : []);
  return activeMediaLibrary;
}

export function clearActiveMediaLibrary(expectedSource = null) {
  if (expectedSource != null && activeMediaLibrary.source !== expectedSource) {
    return activeMediaLibrary;
  }
  activeMediaLibrary = createState(MediaLibrarySource.NONE, []);
  return activeMediaLibrary;
}

export function getActiveMediaLibrary() {
  return activeMediaLibrary;
}

export function getActiveMediaItems() {
  return activeMediaLibrary.media;
}

export function isActiveMediaSource(source) {
  return activeMediaLibrary.source === source;
}

function createState(source, media) {
  return Object.freeze({ source, media });
}
