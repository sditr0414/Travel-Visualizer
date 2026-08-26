import { pickGooglePhotos } from './google-photos-picker.js';

const STORAGE_KEY = 'travel-camera.google-photos-client-id';
const journeyMode = document.querySelector('#journeyMode');
const connectButton = document.querySelector('#googlePhotosConnect');
const clientIdInput = document.querySelector('#googlePhotosClientId');
const folderInput = document.querySelector('#photoFolderInput');
const importCount = document.querySelector('#photoImportCount');
const importHint = document.querySelector('#photoImportHint');
const status = document.querySelector('#status');

if (journeyMode && connectButton && clientIdInput && folderInput) {
  const savedClientId = localStorage.getItem(STORAGE_KEY) || '';
  if (savedClientId) clientIdInput.value = savedClientId;

  const syncMode = () => {
    connectButton.hidden = journeyMode.value !== 'PHOTOS';
  };
  journeyMode.addEventListener('change', syncMode);
  syncMode();

  clientIdInput.addEventListener('change', () => {
    const value = clientIdInput.value.trim();
    if (value) localStorage.setItem(STORAGE_KEY, value);
    else localStorage.removeItem(STORAGE_KEY);
  });

  connectButton.addEventListener('click', async () => {
    const clientId = clientIdInput.value.trim();
    if (!clientId) {
      importHint.textContent = 'Google Cloud에서 만든 웹 애플리케이션 OAuth Client ID를 먼저 입력하세요.';
      clientIdInput.focus();
      return;
    }
    localStorage.setItem(STORAGE_KEY, clientId);
    connectButton.disabled = true;

    try {
      const result = await pickGooglePhotos({
        clientId,
        onStatus: message => {
          connectButton.textContent = '연결 중…';
          importHint.textContent = message;
          status.textContent = message;
        }
      });

      importCount.textContent = `${result.photos.length.toLocaleString()}장 선택`;
      importHint.textContent = '선택한 사진을 영상용 미리보기 크기로 준비하는 중입니다.';
      const files = await downloadPreviewFiles(result.photos, progress => {
        connectButton.textContent = `${progress.done}/${progress.total}`;
        importCount.textContent = `${progress.done.toLocaleString()} / ${progress.total.toLocaleString()}장`;
      });

      const transfer = new DataTransfer();
      for (const file of files) transfer.items.add(file);
      folderInput.files = transfer.files;
      folderInput.dispatchEvent(new Event('change', { bubbles: true }));
      connectButton.textContent = 'Google Photos 다시 선택';
    } catch (error) {
      connectButton.textContent = 'Google Photos 연결';
      importCount.textContent = '연결 실패';
      importHint.textContent = error.message;
      status.textContent = `Google Photos 연결 실패: ${error.message}`;
    } finally {
      connectButton.disabled = false;
    }
  });
}

async function downloadPreviewFiles(photos, onProgress) {
  const files = [];
  let done = 0;
  for (const photo of photos) {
    const response = await fetch(photo.remoteUrl);
    if (!response.ok) throw new Error(`사진 미리보기 다운로드 실패 (HTTP ${response.status})`);
    const blob = await response.blob();
    const filename = safeFilename(photo.title, blob.type, done);
    files.push(new File([blob], filename, {
      type: blob.type || mimeFromFilename(filename),
      lastModified: photo.takenMs
    }));
    done += 1;
    onProgress?.({ done, total: photos.length });
  }
  return files;
}

function safeFilename(value, mimeType, index) {
  const raw = String(value || '').replace(/[\\/:*?"<>|]/g, '_').trim();
  if (/\.[a-z0-9]{2,5}$/i.test(raw)) return raw;
  const ext = mimeType === 'image/png' ? '.png'
    : mimeType === 'image/webp' ? '.webp'
      : mimeType === 'image/gif' ? '.gif'
        : '.jpg';
  return `${raw || `google-photo-${index + 1}`}${ext}`;
}

function mimeFromFilename(filename) {
  if (/\.png$/i.test(filename)) return 'image/png';
  if (/\.webp$/i.test(filename)) return 'image/webp';
  if (/\.gif$/i.test(filename)) return 'image/gif';
  return 'image/jpeg';
}
