import { readLocalMediaMetadata } from './image-metadata.js';

const MEDIA_EXTENSIONS = /\.(?:jpe?g|png|webp|gif|avif|heic|heif|mp4|m4v|mov|webm)$/i;
const VIDEO_EXTENSIONS = /\.(?:mp4|m4v|mov|webm)$/i;
const INLINE_BATCH_SIZE = 4;

export async function loadLocalGalleryFiles(fileList, { onProgress } = {}) {
  const files = Array.from(fileList || []).filter(isLocalMediaFile);
  const videoCount = files.filter(file => mediaTypeForLocalFile(file) === 'video').length;
  const photoCount = files.length - videoCount;

  onProgress?.({
    phase: 'PREPARE',
    processed: files.length,
    total: Math.max(1, files.length),
    photos: photoCount,
    videos: videoCount,
    reset: true,
    message: `${files.length.toLocaleString()}개 로컬 미디어를 확인했습니다.`
  });

  if (!files.length) {
    return {
      photos: [],
      stats: emptyStats()
    };
  }

  await yieldToBrowser();

  const metadata = await readMetadata(files, progress => {
    onProgress?.({
      phase: 'METADATA',
      processed: progress.processed,
      total: files.length,
      photos: photoCount,
      videos: videoCount,
      message: `${progress.processed.toLocaleString()} / ${files.length.toLocaleString()} 촬영 정보 분석`
    });
  });

  const media = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const embedded = metadata[index];
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
      mediaType: mediaTypeForLocalFile(file),
      source: embedded?.source || 'file-time',
      localSource: true
    });
  }

  media.sort((a, b) => a.takenMs - b.takenMs);

  const readyVideos = media.filter(item => item.mediaType === 'video').length;
  const readyPhotos = media.length - readyVideos;
  onProgress?.({
    phase: 'MATCH',
    processed: 0,
    total: Math.max(1, media.length),
    photos: readyPhotos,
    videos: readyVideos,
    message: `촬영 정보 ${media.length.toLocaleString()}개를 Timeline과 매칭합니다.`
  });

  return {
    photos: media,
    stats: {
      files: files.length,
      images: readyPhotos,
      videos: readyVideos,
      photos: media.length,
      gpsPhotos: media.filter(item => item.hasGps).length,
      embeddedMetadataMedia: media.filter(item => item.source === 'embedded-exif').length,
      filenameTimeMedia: media.filter(item => item.source === 'filename-time').length,
      inferredTimePhotos: media.filter(item => item.source === 'file-time').length
    }
  };
}

export function isLocalMediaFile(file) {
  if (!file) return false;
  const type = String(file.type || '');
  if (/^(?:image|video)\//i.test(type)) return true;
  return MEDIA_EXTENSIONS.test(String(file.name || ''));
}

export function mediaTypeForLocalFile(file) {
  const type = String(file?.type || '');
  const name = String(file?.name || '');
  return /^video\//i.test(type) || VIDEO_EXTENSIONS.test(name) ? 'video' : 'photo';
}

async function readMetadata(files, onProgress) {
  if (typeof Worker === 'function') {
    try {
      return await readMetadataInWorker(files, onProgress);
    } catch {
      // Worker failure is not fatal. Fall back to the same parser on the main thread.
    }
  }
  return readMetadataInline(files, onProgress);
}

function readMetadataInWorker(files, onProgress) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./local-media-worker.js', import.meta.url), { type: 'module' });
    let settled = false;

    const cleanup = () => {
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
    };

    worker.onmessage = event => {
      const message = event?.data || {};
      if (message.type === 'progress') {
        onProgress?.({
          processed: Math.max(0, Number(message.processed) || 0),
          total: files.length
        });
        return;
      }
      if (message.type === 'complete') {
        settled = true;
        const results = Array.isArray(message.results) ? message.results : [];
        cleanup();
        resolve(results);
        return;
      }
      if (message.type === 'error') {
        settled = true;
        cleanup();
        reject(new Error(message.message || '로컬 미디어 분석 Worker 오류'));
      }
    };

    worker.onerror = event => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(event?.error || new Error(event?.message || '로컬 미디어 분석 Worker를 시작하지 못했습니다.'));
    };

    try {
      worker.postMessage({ files });
    } catch (error) {
      if (!settled) {
        settled = true;
        cleanup();
        reject(error);
      }
    }
  });
}

async function readMetadataInline(files, onProgress) {
  const results = new Array(files.length).fill(null);
  for (let start = 0; start < files.length; start += INLINE_BATCH_SIZE) {
    const chunk = files.slice(start, start + INLINE_BATCH_SIZE);
    const metadata = await Promise.all(chunk.map(file => readLocalMediaMetadata(file)));
    for (let offset = 0; offset < metadata.length; offset += 1) {
      results[start + offset] = metadata[offset] || null;
    }
    onProgress?.({ processed: Math.min(files.length, start + chunk.length), total: files.length });
    await yieldToBrowser();
  }
  return results;
}

function cleanMediaTitle(value) {
  return String(value || '').trim() || '여행 미디어';
}

function emptyStats() {
  return {
    files: 0,
    images: 0,
    videos: 0,
    photos: 0,
    gpsPhotos: 0,
    embeddedMetadataMedia: 0,
    filenameTimeMedia: 0,
    inferredTimePhotos: 0
  };
}

function yieldToBrowser() {
  return new Promise(resolve => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else if (typeof setTimeout === 'function') setTimeout(resolve, 0);
    else resolve();
  });
}
