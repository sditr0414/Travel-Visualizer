export * from './photo-journey-v4.js';

import {
  JourneyMode,
  PhotoJourneyController as PhotoJourneyControllerV4,
  VideoPlaybackMode,
  formatPhotoTimestamp
} from './photo-journey-v4.js';

const VIDEO_THUMB_PREFIX = '__tc_video_thumb__';

export class PhotoJourneyController extends PhotoJourneyControllerV4 {
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

  // Google Photos thumbnail mode deliberately stores a still image with a
  // video mediaType. Keep that special proxy as an image, while local MP4/MOV
  // files are always rendered as <video> even when the browser reports no MIME.
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
