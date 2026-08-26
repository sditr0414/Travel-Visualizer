import {
  JourneyMode,
  PhotoJourneyController as CorePhotoJourneyController,
  activePhotoBeatAtTime,
  buildPhotoJourneyBeats as buildCorePhotoJourneyBeats,
  choosePhotoPlacement,
  formatPhotoTimestamp,
  parseGooglePhotosMetadata
} from './photo-journey.js?core=1';

export { JourneyMode, activePhotoBeatAtTime, choosePhotoPlacement, formatPhotoTimestamp, parseGooglePhotosMetadata };

export const VideoPlaybackMode = Object.freeze({
  THUMBNAIL: 'THUMBNAIL',
  PLAY: 'PLAY'
});

const MEDIA_EXTENSIONS = /\.(?:jpe?g|png|webp|gif|avif|mp4|m4v|mov|webm)$/i;
const VIDEO_EXTENSIONS = /\.(?:mp4|m4v|mov|webm)$/i;
const SIDECAR_SUFFIX = /(?:\.supplemental-metadata)?\.json$/i;
const VIDEO_THUMB_PREFIX = '__tc_video_thumb__';

export async function loadGooglePhotosTakeout(fileList, { onProgress } = {}) {
  const files = Array.from(fileList || []);
  const mediaFiles = files.filter(isDisplayableMediaFile);
  const jsonFiles = files.filter(file => /\.json$/i.test(file.name));
  const mediaIndex = buildMediaIndex(mediaFiles);
  const matchedFiles = new Set();
  const media = [];

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
        mediaType: mediaTypeForFile(file),
        source: 'google-photos-takeout'
      });
    } catch {}
    if (processed % 50 === 0) onProgress?.({ processed, total: jsonFiles.length, found: media.length });
  }

  for (const file of mediaFiles) {
    if (matchedFiles.has(file)) continue;
    const takenMs = Number(file.lastModified);
    if (!(takenMs > Date.UTC(2000, 0, 1))) continue;
    media.push({
      title: cleanMediaTitle(file.name),
      takenMs,
      lat: null,
      lng: null,
      hasGps: false,
      file,
      mediaType: mediaTypeForFile(file),
      source: 'file-time'
    });
  }

  media.sort((a, b) => a.takenMs - b.takenMs);
  onProgress?.({ processed: jsonFiles.length, total: jsonFiles.length, found: media.length });
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
      inferredTimePhotos: media.filter(item => item.source === 'file-time').length
    }
  };
}

export function buildPhotoJourneyBeats(media, plan, options = {}) {
  const baseBeats = buildCorePhotoJourneyBeats(media, plan);
  if (!baseBeats.length) return [];

  const settings = resolveJourneyMediaOptions(options);
  const travelDuration = Math.max(0.1, Number(plan?.travelDurationSec) || Number(plan?.outroStartSec) || Number(plan?.durationSec) || 0.1);
  const maxRequiredDuration = settings.videoMode === VideoPlaybackMode.PLAY
    ? Math.max(settings.photoDisplaySec, settings.videoMinPlaySec)
    : settings.photoDisplaySec;
  const maxCount = Math.max(1, Math.min(48, Math.floor(travelDuration / Math.max(0.5, maxRequiredDuration)) || 1));
  const selected = selectBeatsAcrossVideo(baseBeats, maxCount, travelDuration);

  const prepared = selected.map(beat => {
    const hasVideo = beat.photos.some(item => item.mediaType === 'video');
    const desiredDurationSec = Math.min(
      travelDuration,
      hasVideo && settings.videoMode === VideoPlaybackMode.PLAY
        ? Math.max(settings.photoDisplaySec, settings.videoMinPlaySec)
        : settings.photoDisplaySec
    );
    return {
      ...beat,
      photos: normalizeRepresentativeMedia(beat.photos, settings.videoMode),
      hasVideo,
      videoMode: settings.videoMode,
      desiredDurationSec
    };
  });

  const windows = allocateBeatWindows(prepared, travelDuration);
  return prepared.map((beat, index) => ({
    ...beat,
    startSec: windows[index].startSec,
    endSec: windows[index].endSec,
    displayDurationSec: windows[index].endSec - windows[index].startSec
  }));
}

export class PhotoJourneyController extends CorePhotoJourneyController {
  renderBeat(beat) {
    this.revokeUrls();
    this.images.replaceChildren();
    this.images.dataset.count = String(beat.photos.length);

    for (const item of beat.photos) {
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
        badge.textContent = beat.videoMode === VideoPlaybackMode.PLAY ? '▶ 재생' : '▶ 영상';
        figure.append(badge);
      }
      this.images.append(figure);
    }

    this.place.textContent = beat.placeName || '장소 확인 중…';
    this.time.textContent = formatPhotoTimestamp(beat.takenMs);
    const sourceLabel = beat.positionSource === 'gps' ? '사진 GPS' : 'Timeline 위치 추정';
    const videoCount = beat.photos.filter(item => item.mediaType === 'video').length;
    const videoLabel = videoCount ? ` · 영상 ${videoCount}` : '';
    const extra = beat.sourceCount > beat.photos.length ? ` · +${beat.sourceCount - beat.photos.length}개` : '';
    this.meta.textContent = `${sourceLabel}${videoLabel}${extra}`;
    this.card.hidden = false;
    this.setPhotoAnchor(beat.anchor);
  }

  revokeUrls() {
    for (const video of this.images?.querySelectorAll?.('video') || []) {
      try { video.pause(); } catch {}
    }
    super.revokeUrls();
  }
}

function resolveJourneyMediaOptions(options) {
  const domPhotoSec = readNumberControl('#photoDisplaySeconds');
  const domVideoMinSec = readNumberControl('#videoMinPlaySeconds');
  const domVideoMode = readValueControl('#photoVideoMode');
  return {
    photoDisplaySec: clampNumber(options.photoDisplaySec ?? domPhotoSec ?? 3, 1.5, 8),
    videoMode: normalizeVideoMode(options.videoMode ?? domVideoMode),
    videoMinPlaySec: clampNumber(options.videoMinPlaySec ?? domVideoMinSec ?? 5, 2, 15)
  };
}

function readNumberControl(selector) {
  const node = globalThis.document?.querySelector?.(selector);
  if (!node) return null;
  const value = Number(node.value);
  return Number.isFinite(value) ? value : null;
}

function readValueControl(selector) {
  return String(globalThis.document?.querySelector?.(selector)?.value || '').trim() || null;
}

function normalizeVideoMode(value) {
  return value === VideoPlaybackMode.PLAY ? VideoPlaybackMode.PLAY : VideoPlaybackMode.THUMBNAIL;
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || min));
}

function selectBeatsAcrossVideo(beats, maxCount, travelDuration) {
  if (beats.length <= maxCount) return beats;
  const buckets = Array.from({ length: maxCount }, () => []);
  const bucketWidth = travelDuration / maxCount;
  for (const beat of beats) {
    const index = Math.min(maxCount - 1, Math.max(0, Math.floor(Number(beat.videoSec || 0) / Math.max(0.001, bucketWidth))));
    buckets[index].push(beat);
  }
  return buckets
    .map(bucket => bucket.sort((a, b) => beatScore(b) - beatScore(a))[0])
    .filter(Boolean)
    .sort((a, b) => a.videoSec - b.videoSec);
}

function beatScore(beat) {
  const videos = beat.photos.filter(item => item.mediaType === 'video').length;
  return Number(beat.sourceCount || beat.photos.length) + videos * 0.35;
}

function normalizeRepresentativeMedia(items, videoMode) {
  if (videoMode !== VideoPlaybackMode.PLAY) return items;
  const videos = items.filter(item => item.mediaType === 'video');
  if (videos.length <= 1) return items;
  const selectedVideo = videos[Math.floor(videos.length / 2)];
  const photos = items.filter(item => item.mediaType !== 'video');
  return [selectedVideo, ...photos].slice(0, 3);
}

function allocateBeatWindows(beats, travelDuration) {
  if (!beats.length) return [];
  const durations = beats.map(beat => Math.max(0.1, Math.min(travelDuration, beat.desiredDurationSec)));
  const totalDuration = durations.reduce((sum, value) => sum + value, 0);
  const availableGap = Math.max(0, travelDuration - totalDuration);
  const centers = beats.map(beat => Math.min(travelDuration, Math.max(0, Number(beat.videoSec) || 0)));
  const rawGaps = [Math.max(0, centers[0])];
  for (let i = 1; i < centers.length; i += 1) rawGaps.push(Math.max(0, centers[i] - centers[i - 1]));
  rawGaps.push(Math.max(0, travelDuration - centers.at(-1)));
  const gapWeight = rawGaps.reduce((sum, value) => sum + value, 0) || rawGaps.length;
  const scaledGap = index => availableGap * ((rawGaps[index] || 0) / gapWeight);

  let cursor = scaledGap(0);
  return beats.map((beat, index) => {
    const startSec = cursor;
    const endSec = Math.min(travelDuration, startSec + durations[index]);
    cursor = endSec + scaledGap(index + 1);
    return { startSec, endSec };
  });
}

function createMediaNode(item, videoMode, objectUrls) {
  if (!item?.file) return null;
  const url = URL.createObjectURL(item.file);
  objectUrls.push(url);

  if (item.mediaType !== 'video') {
    const img = document.createElement('img');
    img.alt = item.title || '여행 사진';
    img.src = url;
    return img;
  }

  if (!String(item.file.type || '').startsWith('video/')) {
    const img = document.createElement('img');
    img.alt = `${item.title || '여행 영상'} 썸네일`;
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

  if (videoMode === VideoPlaybackMode.PLAY) {
    video.autoplay = true;
    video.loop = true;
    video.addEventListener('canplay', () => video.play().catch(() => {}), { once: true });
  } else {
    video.addEventListener('loadedmetadata', () => {
      const duration = Number(video.duration);
      if (!Number.isFinite(duration) || duration <= 0) return;
      try { video.currentTime = Math.min(0.12, duration / 2); } catch {}
    }, { once: true });
  }
  return video;
}

function isDisplayableMediaFile(file) {
  if (!file) return false;
  const type = String(file.type || '');
  if (/^(?:image\/(?:jpeg|png|webp|gif|avif)|video\/(?:mp4|quicktime|webm|x-m4v))$/i.test(type)) return true;
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
