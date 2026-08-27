export * from './photo-journey-v3.js';

import {
  JourneyMode,
  PhotoJourneyController as PhotoJourneyControllerV3,
  VideoPlaybackMode,
  buildPhotoJourneyBeats as buildPhotoJourneyBeatsV3,
  formatPhotoTimestamp,
  loadGooglePhotosTakeout as loadGooglePhotosTakeoutV3
} from './photo-journey-v3.js';

const VIDEO_THUMB_PREFIX = '__tc_video_thumb__';
let localGalleryMedia = [];
let preferLocalGallery = false;

if (typeof globalThis.window?.addEventListener === 'function') {
  globalThis.window.addEventListener('travel-camera:local-media-ready', event => {
    localGalleryMedia = Array.isArray(event?.detail?.photos) ? event.detail.photos : [];
    preferLocalGallery = true;
  });
}

export class PhotoJourneyController extends PhotoJourneyControllerV3 {
  renderBeat(beat) {
    this.revokeUrls();
    this.images.replaceChildren();
    this.images.dataset.count = '1';

    const item = beat.photos[0];
    if (item) {
      const figure = document.createElement('figure');
      figure.className = `photo-frame${item.mediaType === 'video' ? ' video-frame' : ''}`;
      const node = createJourneyMediaNode(item, beat.videoMode, this.objectUrls);
      if (node) {
        node.addEventListener('error', () => {
          figure.classList.add('photo-load-error');
          node.remove();
          const fallback = document.createElement('span');
          fallback.textContent = item.mediaType === 'video' ? '영상 재생 불가' : '미리보기 불가';
          figure.append(fallback);
        }, { once: true });
        figure.append(node);
      } else {
        figure.classList.add('photo-load-error');
        const fallback = document.createElement('span');
        fallback.textContent = item.mediaType === 'video' ? '영상 재생 불가' : '미리보기 불가';
        figure.append(fallback);
      }

      if (item.mediaType === 'video') {
        const badge = document.createElement('span');
        badge.className = 'video-media-badge';
        badge.textContent = beat.videoMode === VideoPlaybackMode.PLAY ? '▶ 영상 재생' : '▶ 영상 썸네일';
        figure.append(badge);
      }
      this.images.append(figure);
    }

    this.place.textContent = beat.placeName || '장소 확인 중…';
    this.time.textContent = formatPhotoTimestamp(beat.takenMs);
    const sourceLabel = beat.positionSource === 'gps' ? '사진 GPS' : 'Timeline 위치 추정';
    const ordinal = beat.sourceCount > 1 ? ` · ${Number(beat.mediaItemIndex || 0) + 1}/${Math.min(beat.sourceCount, 3)}` : '';
    const mediaLabel = item?.mediaType === 'video' ? ' · 영상' : ' · 사진';
    this.meta.textContent = `${sourceLabel}${mediaLabel}${ordinal}`;
    this.card.hidden = false;
    this.card.classList.add('media-stop-card');
    this.layer.classList.add('media-stop-active');
    this.setPhotoAnchor(beat.anchor);
  }
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

function createJourneyMediaNode(item, videoMode, objectUrls) {
  if (!item?.file) return null;

  let url = '';
  try {
    url = URL.createObjectURL(item.file);
    objectUrls.push(url);
  } catch {
    return null;
  }

  if (item.mediaType !== 'video') return createImage(url, item.title || '여행 사진');

  // Google Photos thumbnail mode stores a still image while keeping mediaType
  // as video. Local MP4/MOV files, including files with an empty MIME type,
  // must still become a real <video> element.
  if (String(item.file?.name || '').startsWith(VIDEO_THUMB_PREFIX)) {
    return createImage(url, `${item.title || '여행 영상'} 썸네일`);
  }

  const video = document.createElement('video');
  video.setAttribute('aria-label', item.title || '여행 영상');
  video.src = url;
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.controls = false;
  video.loop = false;
  video.preload = videoMode === VideoPlaybackMode.PLAY ? 'auto' : 'metadata';

  if (videoMode === VideoPlaybackMode.PLAY) {
    const syncPlayback = () => {
      if (!shouldPlayJourneyVideo()) {
        try { video.pause(); } catch {}
        return;
      }
      video.play().then(() => {
        delete video.dataset.playbackBlocked;
      }).catch(() => {
        video.dataset.playbackBlocked = 'true';
      });
    };

    video.autoplay = shouldPlayJourneyVideo();
    video.addEventListener('loadeddata', syncPlayback, { once: true });
    video.addEventListener('canplay', syncPlayback, { once: true });
    queueMicrotask(syncPlayback);
  } else {
    video.addEventListener('loadedmetadata', () => {
      const duration = Number(video.duration);
      if (Number.isFinite(duration) && duration > 0) {
        try { video.currentTime = Math.min(0.12, duration / 2); } catch {}
      }
      try { video.pause(); } catch {}
    }, { once: true });
  }

  return video;
}

function createImage(url, alt) {
  const img = document.createElement('img');
  img.alt = alt;
  img.decoding = 'async';
  img.loading = 'eager';
  img.src = url;
  return img;
}

function shouldPlayJourneyVideo() {
  const journeyMode = String(globalThis.document?.querySelector?.('#journeyMode')?.value || '');
  const videoMode = String(globalThis.document?.querySelector?.('#photoVideoMode')?.value || '');
  const playText = String(globalThis.document?.querySelector?.('#playButton')?.textContent || '').trim();
  return journeyMode === JourneyMode.PHOTOS && videoMode === VideoPlaybackMode.PLAY && playText === '일시정지';
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
