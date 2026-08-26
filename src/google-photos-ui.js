import { pickGooglePhotos, releaseGooglePhotosSelection } from './google-photos-picker.js';

const LEGACY_CACHE_DB = 'travel-camera-photo-cache';
const VIDEO_THUMB_PREFIX = '__tc_video_thumb__';
const journeyMode = document.querySelector('#journeyMode');
const connectButton = document.querySelector('#googlePhotosConnect');
const folderInput = document.querySelector('#photoFolderInput');
const importCount = document.querySelector('#photoImportCount');
const importHint = document.querySelector('#photoImportHint');
const status = document.querySelector('#status');
const startDate = document.querySelector('#startDate');
const endDate = document.querySelector('#endDate');
const photoVideoMode = document.querySelector('#photoVideoMode');

let configPromise = null;
let hasPhotosThisSession = false;

removeLegacyPhotoCache();

if (journeyMode && connectButton && folderInput && startDate && endDate) {
  const syncMode = () => {
    connectButton.hidden = false;
    updateConnectButtonLabel(hasPhotosThisSession);
  };

  journeyMode.addEventListener('change', syncMode);
  startDate.addEventListener('change', handleDateRangeChange);
  endDate.addEventListener('change', handleDateRangeChange);
  syncMode();

  connectButton.addEventListener('click', async () => {
    if (journeyMode.value !== 'PHOTOS') {
      journeyMode.value = 'PHOTOS';
      journeyMode.dispatchEvent(new Event('change', { bubbles: true }));
    }

    connectButton.disabled = true;
    let pickerResult = null;
    try {
      const config = await loadGooglePhotosConfig();
      if (!config?.configured || !config?.clientId) {
        throw new Error('Google Photos 로그인이 아직 앱에 설정되지 않았습니다. 서버 실행 전에 GOOGLE_PHOTOS_CLIENT_ID를 설정하세요.');
      }

      const dateRange = currentDateRange();
      const rangeLabel = `${dateRange.startDate} ~ ${dateRange.endDate}`;
      pickerResult = await pickGooglePhotos({
        clientId: config.clientId,
        dateRange,
        onStatus: message => {
          connectButton.textContent = 'Google 로그인 중…';
          importHint.textContent = message;
          status.textContent = message;
        }
      });

      const selectedVideos = pickerResult.photos.filter(item => item.mediaType === 'video').length;
      const selectedPhotos = pickerResult.photos.length - selectedVideos;
      importCount.textContent = `사진 ${selectedPhotos.toLocaleString()} · 영상 ${selectedVideos.toLocaleString()}`;
      importHint.textContent = `${rangeLabel} 미디어를 사진 여정용으로 준비하는 중입니다.`;
      const downloadResult = await downloadPreviewFiles(pickerResult.photos, pickerResult.accessToken, {
        playVideos: photoVideoMode?.value === 'PLAY',
        onProgress: progress => {
          connectButton.textContent = `${progress.done}/${progress.total}`;
          importCount.textContent = `${progress.done.toLocaleString()} / ${progress.total.toLocaleString()}개`;
        }
      });

      applyFilesToPhotoJourney(downloadResult.files);
      hasPhotosThisSession = downloadResult.files.length > 0;
      const excluded = Number(pickerResult.stats?.excludedOutsideRange || 0);
      importCount.textContent = `사진 ${selectedPhotos.toLocaleString()} · 영상 ${selectedVideos.toLocaleString()}`;
      importHint.textContent = [
        `${rangeLabel} 범위의 미디어만 사용합니다.`,
        excluded ? `범위 밖 ${excluded.toLocaleString()}개는 자동 제외했습니다.` : '',
        downloadResult.videoFallbacks ? `처리 중인 영상 ${downloadResult.videoFallbacks.toLocaleString()}개는 썸네일로 표시합니다.` : '',
        'Google Photos 미디어는 브라우저에 저장하지 않고 현재 실행에서만 사용합니다.'
      ].filter(Boolean).join(' ');
      status.textContent = `Google Photos 준비 완료 · ${downloadResult.files.length.toLocaleString()}개`;
      updateConnectButtonLabel(true);
    } catch (error) {
      importCount.textContent = '연결 실패';
      importHint.textContent = error.message;
      status.textContent = `Google Photos 연결 실패: ${error.message}`;
      updateConnectButtonLabel(hasPhotosThisSession);
    } finally {
      if (pickerResult?.sessionId && pickerResult?.accessToken) {
        await releaseGooglePhotosSelection(pickerResult.sessionId, pickerResult.accessToken).catch(() => {});
      }
      connectButton.disabled = false;
      updateConnectButtonLabel(hasPhotosThisSession);
    }
  });
}

function handleDateRangeChange() {
  hasPhotosThisSession = false;
  updateConnectButtonLabel(false);
}

function currentDateRange() {
  return {
    startDate: String(startDate.value || '').trim(),
    endDate: String(endDate.value || '').trim()
  };
}

function updateConnectButtonLabel(hasPhotos = false) {
  if (!connectButton || connectButton.disabled) return;
  if (hasPhotos) {
    connectButton.textContent = '미디어 새로 선택';
    return;
  }
  if (journeyMode.value !== 'PHOTOS') {
    connectButton.textContent = 'Google Photos 로그인';
    return;
  }
  const { startDate: start, endDate: end } = currentDateRange();
  const short = formatShortDateRange(start, end);
  connectButton.textContent = short ? `Google 로그인 · ${short}` : 'Google Photos 로그인';
}

function formatShortDateRange(start, end) {
  const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(start || '');
  const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(end || '');
  if (!a || !b) return '';
  if (start === end) return `${Number(a[2])}/${Number(a[3])}`;
  return `${Number(a[2])}/${Number(a[3])}–${Number(b[2])}/${Number(b[3])}`;
}

function applyFilesToPhotoJourney(files) {
  const transfer = new DataTransfer();
  for (const file of files) transfer.items.add(file);
  folderInput.dataset.importSource = 'google-photos-picker';
  folderInput.files = transfer.files;
  folderInput.dispatchEvent(new Event('change', { bubbles: true }));
}

async function downloadPreviewFiles(media, accessToken, { playVideos = false, onProgress } = {}) {
  const files = [];
  let done = 0;
  let videoFallbacks = 0;

  for (const item of media) {
    const isVideo = item.mediaType === 'video';
    const videoReady = !item.videoStatus || /READY$/i.test(item.videoStatus);
    const downloadVideo = isVideo && playVideos && videoReady;
    const sourceUrl = isVideo
      ? downloadVideo ? item.remoteVideoUrl : item.remoteThumbnailUrl
      : item.remoteUrl;
    if (!sourceUrl) continue;

    const response = await fetch(sourceUrl, {
      headers: { authorization: `Bearer ${accessToken}` }
    });
    if (!response.ok) throw new Error(`미디어 다운로드 실패 (HTTP ${response.status})`);
    const blob = await response.blob();

    let filename;
    let type;
    if (isVideo && !downloadVideo) {
      filename = videoThumbnailFilename(item.title, done);
      type = blob.type || 'image/jpeg';
      if (playVideos) videoFallbacks += 1;
    } else {
      filename = safeFilename(item.title, blob.type || item.mimeType, done, isVideo);
      type = blob.type || item.mimeType || mimeFromFilename(filename);
    }

    files.push(new File([blob], filename, {
      type,
      lastModified: item.takenMs
    }));
    done += 1;
    onProgress?.({ done, total: media.length });
  }
  return { files, videoFallbacks };
}

async function loadGooglePhotosConfig() {
  if (!configPromise) {
    configPromise = fetch('/api/google-photos-config', { cache: 'no-store' })
      .then(response => {
        if (!response.ok) throw new Error('Google Photos 앱 설정을 읽지 못했습니다.');
        return response.json();
      });
  }
  return configPromise;
}

function removeLegacyPhotoCache() {
  if (!globalThis.indexedDB) return;
  try {
    indexedDB.deleteDatabase(LEGACY_CACHE_DB);
  } catch {}
}

function videoThumbnailFilename(value, index) {
  const raw = String(value || `google-video-${index + 1}`)
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .trim();
  return `${VIDEO_THUMB_PREFIX}${raw || `google-video-${index + 1}`}.jpg`;
}

function safeFilename(value, mimeType, index, video = false) {
  const raw = String(value || '').replace(/[\\/:*?"<>|]/g, '_').trim();
  if (/\.[a-z0-9]{2,5}$/i.test(raw)) return raw;
  const ext = video
    ? mimeType === 'video/webm' ? '.webm' : mimeType === 'video/quicktime' ? '.mov' : '.mp4'
    : mimeType === 'image/png' ? '.png'
      : mimeType === 'image/webp' ? '.webp'
        : mimeType === 'image/gif' ? '.gif'
          : '.jpg';
  return `${raw || `google-media-${index + 1}`}${ext}`;
}

function mimeFromFilename(filename) {
  if (/\.png$/i.test(filename)) return 'image/png';
  if (/\.webp$/i.test(filename)) return 'image/webp';
  if (/\.gif$/i.test(filename)) return 'image/gif';
  if (/\.webm$/i.test(filename)) return 'video/webm';
  if (/\.mov$/i.test(filename)) return 'video/quicktime';
  if (/\.(?:mp4|m4v)$/i.test(filename)) return 'video/mp4';
  return 'image/jpeg';
}
