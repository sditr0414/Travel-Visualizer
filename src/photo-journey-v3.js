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
const sessionPreviewUrls = new Set();

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
  releaseSessionPreviewUrls();

  const files = Array.from(fileList || []);
  const mediaFiles = files.filter(isDisplayableMediaFile);
  const jsonFiles = files.filter(file => /\.json$/i.test(file.name));
  const mediaIndex = buildMediaIndex(mediaFiles);
  const matchedFiles = new Set();
  const media = [];
  const totalWork = jsonFiles.length + mediaFiles.length;
  let processed = 0;

  for (const sidecar of jsonFiles) {
    processed += 1;
    if (sidecar.size > 3_000_000) continue;
    try {
      const metadata = parseGooglePhotosMetadata(JSON.parse(await sidecar.text()), sidecar.name);
      if (!metadata?.takenMs) continue;
      const file = findMatchingMedia(sidecar, metadata, mediaIndex);
      if (!file || matchedFiles.has(file)) continue;
      matchedFiles.add(file);
      media.push({
        ...metadata,
        title: cleanMediaTitle(metadata.title || file.name),
        file,
        previewUrl: createSessionPreviewUrl(file),
        mediaType: mediaTypeForFile(file),
        source: 'google-photos-takeout'
      });
    } catch {}
    if (processed % 25 === 0) onProgress?.({ processed, total: totalWork, found: media.length });
  }

  for (const file of mediaFiles) {
    processed += 1;
    if (matchedFiles.has(file)) continue;

    const embedded = await readLocalMediaMetadata(file);
    const fileTime = Number(file.lastModified);
    const takenMs = Number(embedded?.takenMs) || fileTime;
    if (!(takenMs > Date.UTC(2000, 0, 1))) continue;

    media.push({
      title: cleanMediaTitle(file.name),
      takenMs,
      lat: Number.isFinite(embedded?.lat) ? embedded.lat : null,
      lng: Number.isFinite(embedded?.lng) ? embedded.lng : null,
      hasGps: !!embedded?.hasGps,
      file,
      previewUrl: createSessionPreviewUrl(file),
      mediaType: mediaTypeForFile(file),
      source: embedded?.source || 'file-time'
    });
    if (processed % 10 === 0) onProgress?.({ processed, total: totalWork, found: media.length });
  }

  media.sort((a, b) => a.takenMs - b.takenMs);
  onProgress?.({ processed: totalWork, total: totalWork, found: media.length });
  const videoCount = media.filter(item => item.mediaType === 'video').length;
  return {
    photos: media,
    stats: {
      files: files.length,
      images: media.length - videoCount,
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
  const beats = buildPhotoJourneyBeatsV2(media, plan, options);
  updateMatchDiagnostics(media, beats);
  return beats;
}

function createMediaNode(item, videoMode, objectUrls) {
  const stableUrl = String(item?.previewUrl || '');
  let url = stableUrl;
  if (!url && item?.file) {
    try {
      url = URL.createObjectURL(item.file);
      objectUrls.push(url);
    } catch {
      url = '';
    }
  }
  if (!url) return null;

  if (item.mediaType !== 'video') {
    const img = document.createElement('img');
    img.alt = item.title || '여행 사진';
    img.decoding = 'async';
    img.src = url;
    return img;
  }

  if (!String(item.file?.type || '').startsWith('video/')) {
    const img = document.createElement('img');
    img.alt = `${item.title || '여행 영상'} 썸네일`;
    img.decoding = 'async';
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
  const total = Array.isArray(media) ? media.length : 0;
  const matchedItems = (beats || []).reduce((sum, beat) => sum + Math.max(1, Number(beat?.photos?.length) || 0), 0);
  if (count && total) count.textContent = `${total.toLocaleString()}장 · 장면 ${(beats || []).length.toLocaleString()}`;

  if (hint && total && !(beats || []).length) {
    const times = media.map(item => Number(item?.takenMs)).filter(Number.isFinite).sort((a, b) => a - b);
    const range = times.length
      ? `${formatDateOnly(times[0])} ~ ${formatDateOnly(times.at(-1))}`
      : '촬영시각 없음';
    hint.textContent = `미디어 ${total.toLocaleString()}개는 읽었지만 현재 Timeline 기간에 매칭된 장면이 없습니다. 읽은 촬영시각 범위: ${range}`;
  } else if (hint && total && (beats || []).length) {
    hint.textContent = `미디어 ${total.toLocaleString()}개를 읽었고 Timeline에 ${(beats || []).length.toLocaleString()}개 촬영 지점을 매칭했습니다. 실제 표시 미디어 ${matchedItems.toLocaleString()}개.`;
  }
}

function createSessionPreviewUrl(file) {
  if (!file || typeof URL?.createObjectURL !== 'function') return null;
  try {
    const url = URL.createObjectURL(file);
    sessionPreviewUrls.add(url);
    return url;
  } catch {
    return null;
  }
}

function releaseSessionPreviewUrls() {
  for (const url of sessionPreviewUrls) {
    try { URL.revokeObjectURL(url); } catch {}
  }
  sessionPreviewUrls.clear();
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
