export * from './photo-journey-v3.js';

import {
  buildPhotoJourneyBeats as buildPhotoJourneyBeatsV3,
  loadGooglePhotosTakeout as loadGooglePhotosTakeoutV3
} from './photo-journey-v3.js';

let localGalleryMedia = [];
let preferLocalGallery = false;

if (typeof globalThis.window?.addEventListener === 'function') {
  globalThis.window.addEventListener('travel-camera:local-media-ready', event => {
    localGalleryMedia = Array.isArray(event?.detail?.photos) ? event.detail.photos : [];
    preferLocalGallery = true;
  });
}

export function buildPhotoJourneyBeats(media, plan, options = {}) {
  const activeMedia = preferLocalGallery ? localGalleryMedia : media;
  const beats = buildPhotoJourneyBeatsV3(activeMedia, plan, options);

  if (preferLocalGallery) {
    const photos = localGalleryMedia.filter(item => item?.mediaType !== 'video').length;
    const videos = localGalleryMedia.length - photos;
    scheduleLocalReadyStatus(photos, videos, beats.length);
  }
  return beats;
}

export async function loadGooglePhotosTakeout(fileList, options = {}) {
  preferLocalGallery = false;
  localGalleryMedia = [];
  return loadGooglePhotosTakeoutV3(fileList, options);
}

export function useLocalGalleryMedia(media) {
  localGalleryMedia = Array.isArray(media) ? media : [];
  preferLocalGallery = true;
}

export function clearLocalGalleryMedia() {
  localGalleryMedia = [];
  preferLocalGallery = false;
}

function scheduleLocalReadyStatus(photos, videos, scenes) {
  if (typeof setTimeout !== 'function') return;
  setTimeout(() => {
    const status = globalThis.document?.querySelector?.('#status');
    if (status && preferLocalGallery) {
      status.textContent = `기기 갤러리 · 준비 완료 · 사진 ${photos.toLocaleString()}장 · 영상 ${videos.toLocaleString()}개 · 장면 ${scenes.toLocaleString()}개`;
    }
  }, 0);
}
