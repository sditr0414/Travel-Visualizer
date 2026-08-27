import {
  JourneyMode,
  PhotoJourneyController,
  VideoPlaybackMode,
  activePhotoBeatAtTime,
  buildPhotoJourneyBeats,
  choosePhotoPlacement,
  formatPhotoTimestamp,
  insertPhotoJourneyStops,
  parseGooglePhotosMetadata
} from './photo-journey-v2.js';
import { readLocalMediaMetadata } from './image-metadata.js';

export {
  JourneyMode,
  PhotoJourneyController,
  VideoPlaybackMode,
  activePhotoBeatAtTime,
  buildPhotoJourneyBeats,
  choosePhotoPlacement,
  formatPhotoTimestamp,
  insertPhotoJourneyStops,
  parseGooglePhotosMetadata
};

const MEDIA_EXTENSIONS = /\.(?:jpe?g|png|webp|gif|avif|heic|heif|mp4|m4v|mov|webm)$/i;
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
