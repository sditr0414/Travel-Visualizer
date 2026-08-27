import {
  JourneyMode,
  PhotoJourneyController as PhotoJourneyControllerV2,
  VideoPlaybackMode,
  activePhotoBeatAtTime,
  buildPhotoJourneyBeats as buildPhotoJourneyBeatsV2,
  choosePhotoPlacement,
  formatPhotoTimestamp,
  insertPhotoJourneyStops,
  parseGooglePhotosMetadata
} from './photo-journey-v2.js';
import { readLocalMediaMetadata } from './image-metadata.js';

export {
  JourneyMode,
  VideoPlaybackMode,
  activePhotoBeatAtTime,
  choosePhotoPlacement,
  formatPhotoTimestamp,
  insertPhotoJourneyStops,
  parseGooglePhotosMetadata
};

const MEDIA_EXTENSIONS = /\.(?:jpe?g|png|webp|gif|avif|heic|heif|mp4|m4v|mov|webm)$/i;
const VIDEO_EXTENSIONS = /\.(?:mp4|m4v|mov|webm)$/i;
const SIDECAR_SUFFIX = /(?:\.supplemental-metadata)?\.json$/i;
const VIDEO_THUMB_PREFIX = '__tc_video_thumb__';
const IMPORT_YIELD_EVERY = 6;

export class PhotoJourneyController extends PhotoJourneyControllerV2 {
  renderBeat(beat) {
    this.revokeUrls();
    this.images.replaceChildren();
    this.images.dataset.count = '1';

    const item = beat.photos[0];
    if (item) {
      const figure = document.createElement('figure');
      figure.className = `photo-frame${item.mediaType === 'video' ? ' video-frame' : ''}`;
      const node = createMediaNode(item, beat.videoMode, this.objectUrls);
      if (node) {
        node.addEventListener('error', () => {
          figure.classList.add('photo-load-error');
          node.remove();
          const fallback = document.createElement('span');
          fallback.textContent = '미리보기 불가';
          figure.append(fallback);
        }, { once: true });
        figure.append(node);
      } else {
        figure.classList.add('photo-load-error');
        const fallback = document.createElement('span');
        fallback.textContent = '미리보기 불가';
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

export async function loadGooglePhotosTakeout(fileList, { onProgress } = {}) {
  const files = Array.from(fileList || []);
  const mediaFiles = files.filter(isDisplayableMediaFile);
  const jsonFiles = files.filter(file => /\.json$/i.test(file.name));
  const mediaIndex = buildMediaIndex(mediaFiles);
  const matchedFiles = new Set();
  const media = [];
  const totalWork = jsonFiles.length + mediaFiles.length;
  const selectedVideoCount = mediaFiles.filter(file => mediaTypeForFile(file) === 'video').length;
  const selectedPhotoCount = mediaFiles.length - selectedVideoCount;
  let processed = 0;

  reportPhotoProgress({
    phase: 'METADATA',
    processed: 0,
    total: Math.max(1, totalWork),
    photos: selectedPhotoCount,
    videos: selectedVideoCount,
    message: jsonFiles.length
      ? '사진 메타데이터와 Takeout sidecar를 분석합니다.'
      : 'EXIF 촬영시각·GPS를 분석합니다.'
  });

  for (const sidecar of jsonFiles) {
    processed += 1;
    if (sidecar.size <= 3_000_000) {
      try {
        const metadata = parseGooglePhotosMetadata(JSON.parse(await sidecar.text()), sidecar.name);
        if (metadata?.takenMs) {
          const file = findMatchingMedia(sidecar, metadata, mediaIndex);
          if (file && !matchedFiles.has(file)) {
            matchedFiles.add(file);
            media.push({
              ...metadata,
              title: cleanMediaTitle(metadata.title || file.name),
              file,
              mediaType: mediaTypeForFile(file),
              source: 'google-photos-takeout'
            });
          }
        }
      } catch {}
    }
    if (processed % IMPORT_YIELD_EVERY === 0) {
      const progress = { processed, total: totalWork, found: media.length };
      onProgress?.(progress);
      reportPhotoProgress({
        phase: 'METADATA',
        processed,
        total: Math.max(1, totalWork),
        photos: selectedPhotoCount,
        videos: selectedVideoCount,
        message: `${processed.toLocaleString()} / ${totalWork.toLocaleString()} 메타데이터 분석`
      });
      await yieldToBrowser();
    }
  }

  let localProcessed = 0;
  for (const file of mediaFiles) {
    processed += 1;
    localProcessed += 1;
    if (!matchedFiles.has(file)) {
      const embedded = await readLocalMediaMetadata(file);
      const fileTime = Number(file.lastModified);
      const takenMs = Number(embedded?.takenMs) || fileTime;
      if (takenMs > Date.UTC(2000, 0, 1)) {
        media.push({
          title: cleanMediaTitle(file.name),
          takenMs,
          lat: Number.isFinite(embedded?.lat) ? embedded.lat : null,
          lng: Number.isFinite(embedded?.lng) ? embedded.lng : null,
          hasGps: !!embedded?.hasGps,
          file,
          mediaType: mediaTypeForFile(file),
          source: embedded?.source || 'file-time'
        });
      }
    }

    if (localProcessed % IMPORT_YIELD_EVERY === 0 || localProcessed === mediaFiles.length) {
      const progress = { processed, total: totalWork, found: media.length };
      onProgress?.(progress);
      reportPhotoProgress({
        phase: 'METADATA',
        processed,
        total: Math.max(1, totalWork),
        photos: selectedPhotoCount,
        videos: selectedVideoCount,
        message: `${localProcessed.toLocaleString()} / ${mediaFiles.length.toLocaleString()} 미디어 분석`
      });
      await yieldToBrowser();
    }
  }

  media.sort((a, b) => a.takenMs - b.takenMs);
  onProgress?.({ processed: totalWork, total: totalWork, found: media.length });
  const videoCount = media.filter(item => item.mediaType === 'video').length;
  const photoCount = media.length - videoCount;

  reportPhotoProgress({
    phase: 'MATCH',
    processed: 0,
    total: Math.max(1, media.length),
    photos: photoCount,
    videos: videoCount,
    message: `촬영시각 ${media.length.toLocaleString()}개를 Timeline과 매칭합니다.`
  });

  return {
    photos: media,
    stats: {
      files: files.length,
      images: photoCount,
      videos: videoCount,
      sidecars: jsonFiles.length,
      photos: media.length,
      gpsPhotos: media.filter(item => item.hasGps).length,
      embeddedMetadataMedia: media.filter(item => item.source === 'embedded-exif').length,
      filenameTimeMedia: media.filter(item => item.source === 'filename-time').length,
      inferredTimePhotos: media.filter(item => item.source === 'file-time').length
    }
  };
}

export function buildPhotoJourneyBeats(media, plan, options = {}) {
  const items = Array.isArray(media) ? media : [];
  const videoCount = items.filter(item => item?.mediaType === 'video').length;
  const photoCount = items.length - videoCount;

  reportPhotoProgress({
    phase: 'MATCH',
    processed: 0,
    total: Math.max(1, items.length),
    photos: photoCount,
    videos: videoCount,
    message: '촬영시각과 Timeline 위치를 매칭하는 중입니다.'
  });

  try {
    const beats = buildPhotoJourneyBeatsV2(media, plan, options);
    updateMatchDiagnostics(media, beats);
    reportPhotoProgress({
      phase: 'BUILD',
      processed: 1,
      total: 2,
      photos: photoCount,
      videos: videoCount,
      scenes: beats.length,
      message: `${beats.length.toLocaleString()}개 촬영 지점으로 사진 여정을 구성합니다.`
    });
    scheduleCompleteProgress(photoCount, videoCount, beats.length);
    return beats;
  } catch (error) {
    reportPhotoProgress({
      phase: 'ERROR',
      photos: photoCount,
      videos: videoCount,
      message: error?.message || '사진 여정 구성에 실패했습니다.'
    });
    throw error;
  }
}

function createMediaNode(item, videoMode, objectUrls) {
  if (!item?.file) return null;

  let url = '';
  try {
    url = URL.createObjectURL(item.file);
    objectUrls.push(url);
  } catch {
    return null;
  }

  if (item.mediaType !== 'video') {
    const img = document.createElement('img');
    img.alt = item.title || '여행 사진';
    img.decoding = 'async';
    img.loading = 'eager';
    img.src = url;
    return img;
  }

  if (!String(item.file?.type || '').startsWith('video/')) {
    const img = document.createElement('img');
    img.alt = `${item.title || '여행 영상'} 썸네일`;
    img.decoding = 'async';
    img.loading = 'eager';
    img.src = url;
    return img;
  }

  const video = document.createElement('video');
  video.setAttribute('aria-label', item.title || '여행 영상');
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  video.preload = 'metadata';
  video.controls = false;
  video.loop = false;

  if (videoMode === VideoPlaybackMode.THUMBNAIL) {
    video.addEventListener('loadedmetadata', () => {
      const duration = Number(video.duration);
      if (!Number.isFinite(duration) || duration <= 0) return;
      try { video.currentTime = Math.min(0.12, duration / 2); } catch {}
    }, { once: true });
  }
  return video;
}

function updateMatchDiagnostics(media, beats) {
  const count = globalThis.document?.querySelector?.('#photoImportCount');
  const hint = globalThis.document?.querySelector?.('#photoImportHint');
  const items = Array.isArray(media) ? media : [];
  const total = items.length;
  const videoCount = items.filter(item => item?.mediaType === 'video').length;
  const photoCount = total - videoCount;
  const matchedItems = (beats || []).flatMap(beat => Array.isArray(beat?.photos) ? beat.photos : []);
  const matchedVideoCount = matchedItems.filter(item => item?.mediaType === 'video').length;
  const matchedPhotoCount = matchedItems.length - matchedVideoCount;

  if (count && total) {
    count.textContent = `사진 ${photoCount.toLocaleString()}장 · 영상 ${videoCount.toLocaleString()}개 · 장면 ${(beats || []).length.toLocaleString()}`;
  }

  if (hint && total && !(beats || []).length) {
    const times = items.map(item => Number(item?.takenMs)).filter(Number.isFinite).sort((a, b) => a - b);
    const range = times.length
      ? `${formatDateOnly(times[0])} ~ ${formatDateOnly(times.at(-1))}`
      : '촬영시각 없음';
    hint.textContent = `사진 ${photoCount.toLocaleString()}장 · 영상 ${videoCount.toLocaleString()}개를 읽었지만 현재 Timeline 기간에 매칭된 장면이 없습니다. 읽은 촬영시각 범위: ${range}`;
  } else if (hint && total && (beats || []).length) {
    hint.textContent = `사진 ${photoCount.toLocaleString()}장 · 영상 ${videoCount.toLocaleString()}개를 읽었고 Timeline에 ${(beats || []).length.toLocaleString()}개 촬영 지점을 매칭했습니다. 실제 표시: 사진 ${matchedPhotoCount.toLocaleString()}장 · 영상 ${matchedVideoCount.toLocaleString()}개.`;
  }
}

function scheduleCompleteProgress(photos, videos, scenes) {
  if (typeof setTimeout !== 'function') return;
  setTimeout(() => {
    reportPhotoProgress({
      phase: 'COMPLETE',
      processed: 1,
      total: 1,
      photos,
      videos,
      scenes,
      message: '사진 여정 준비가 완료되었습니다.'
    });
  }, 0);
}

function reportPhotoProgress(detail) {
  if (typeof globalThis.window?.dispatchEvent !== 'function' || typeof globalThis.CustomEvent !== 'function') return;
  globalThis.window.dispatchEvent(new CustomEvent('travel-camera:photo-progress', { detail }));
}

function yieldToBrowser() {
  return new Promise(resolve => {
    if (typeof setTimeout === 'function') setTimeout(resolve, 0);
    else resolve();
  });
}

function formatDateOnly(ms) {
  try {
    return new Intl.DateTimeFormat('ko-KR', {
      year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Tokyo'
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

function isDisplayableMediaFile(file) {
  if (!file) return false;
  const type = String(file.type || '');
  if (/^(?:image\/(?:jpeg|png|webp|gif|avif|heic|heif|heic-sequence|heif-sequence)|video\/(?:mp4|quicktime|webm|x-m4v))$/i.test(type)) return true;
  return MEDIA_EXTENSIONS.test(file.name || '');
}

function mediaTypeForFile(file) {
  const name = String(file?.name || '');
  if (name.startsWith(VIDEO_THUMB_PREFIX)) return 'video';
  if (String(file?.type || '').startsWith('video/') || VIDEO_EXTENSIONS.test(name)) return 'video';
  return 'photo';
}

function cleanMediaTitle(value) {
  const text = String(value || '').replace(VIDEO_THUMB_PREFIX, '');
  return text || '여행 미디어';
}

function buildMediaIndex(files) {
  const byPath = new Map();
  const byName = new Map();
  for (const file of files) {
    const path = normalizePath(file.webkitRelativePath || file.name);
    byPath.set(path.toLowerCase(), file);
    const name = file.name.toLowerCase();
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(file);
  }
  return { byPath, byName };
}

function findMatchingMedia(sidecar, metadata, index) {
  const relative = normalizePath(sidecar.webkitRelativePath || sidecar.name);
  const slash = relative.lastIndexOf('/');
  const directory = slash >= 0 ? relative.slice(0, slash + 1) : '';
  const sidecarBase = stripSidecarName(sidecar.name);
  const candidates = [metadata.title, sidecarBase].filter(Boolean);
  for (const name of candidates) {
    const exact = index.byPath.get(`${directory}${name}`.toLowerCase());
    if (exact) return exact;
  }
  for (const name of candidates) {
    const matches = index.byName.get(String(name).toLowerCase());
    if (matches?.length === 1) return matches[0];
    if (matches?.length > 1) {
      const sameDirectory = matches.find(file => normalizePath(file.webkitRelativePath || file.name).startsWith(directory));
      if (sameDirectory) return sameDirectory;
    }
  }
  return null;
}

function stripSidecarName(name) {
  return String(name || '').replace(SIDECAR_SUFFIX, '');
}

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
}
