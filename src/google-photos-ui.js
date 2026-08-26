import { pickGooglePhotos, releaseGooglePhotosSelection } from './google-photos-picker.js';

const CACHE_DB = 'travel-camera-photo-cache';
const CACHE_STORE = 'trip-selections';
const CACHE_VERSION = 1;
const journeyMode = document.querySelector('#journeyMode');
const connectButton = document.querySelector('#googlePhotosConnect');
const folderInput = document.querySelector('#photoFolderInput');
const importCount = document.querySelector('#photoImportCount');
const importHint = document.querySelector('#photoImportHint');
const status = document.querySelector('#status');
const startDate = document.querySelector('#startDate');
const endDate = document.querySelector('#endDate');
const persistPhotos = document.querySelector('#persistGooglePhotos');
const clearPhotoCache = document.querySelector('#clearPhotoCache');

let configPromise = null;
let restoredKey = '';

if (journeyMode && connectButton && folderInput && startDate && endDate) {
  const syncMode = () => {
    const photoMode = journeyMode.value === 'PHOTOS';
    connectButton.hidden = !photoMode;
    updateConnectButtonLabel();
    if (photoMode) restoreCachedTripPhotos().catch(() => {});
  };
  journeyMode.addEventListener('change', syncMode);
  startDate.addEventListener('change', handleDateRangeChange);
  endDate.addEventListener('change', handleDateRangeChange);
  persistPhotos?.addEventListener('change', () => {
    if (!persistPhotos.checked) importHint.textContent = '이번 실행에서만 사진을 사용합니다. 저장된 기존 사진은 아래 삭제 버튼으로 지울 수 있습니다.';
  });
  clearPhotoCache?.addEventListener('click', async () => {
    await deleteTripSelection(currentDateRange()).catch(() => {});
    restoredKey = '';
    clearPhotoCache.disabled = true;
    persistPhotos.checked = false;
    importHint.textContent = '이 여행 날짜 범위의 브라우저 저장 사진을 삭제했습니다.';
    status.textContent = '저장된 여행 사진 삭제 완료';
    updateConnectButtonLabel();
  });
  syncMode();

  connectButton.addEventListener('click', async () => {
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
          connectButton.textContent = '연결 중…';
          importHint.textContent = message;
          status.textContent = message;
        }
      });

      importCount.textContent = `${pickerResult.photos.length.toLocaleString()}장 선택`;
      importHint.textContent = `${rangeLabel} 사진을 영상용 미리보기 크기로 준비하는 중입니다.`;
      const files = await downloadPreviewFiles(pickerResult.photos, pickerResult.accessToken, progress => {
        connectButton.textContent = `${progress.done}/${progress.total}`;
        importCount.textContent = `${progress.done.toLocaleString()} / ${progress.total.toLocaleString()}장`;
      });

      applyFilesToPhotoJourney(files);
      let cacheSaved = false;
      if (persistPhotos?.checked) {
        cacheSaved = await saveTripSelection(dateRange, files).catch(() => false);
      }
      const excluded = Number(pickerResult.stats?.excludedOutsideRange || 0);
      importCount.textContent = `${files.length.toLocaleString()}장 · 일정 자동 필터`;
      importHint.textContent = [
        `${rangeLabel} 범위의 사진만 사용합니다.`,
        excluded ? `범위 밖 ${excluded.toLocaleString()}장은 자동 제외했습니다.` : '',
        persistPhotos?.checked
          ? cacheSaved ? '이 브라우저에 저장해 다음 실행부터 자동 복원합니다.' : '브라우저 저장공간이 부족해 이번 실행에서만 사용합니다.'
          : '브라우저에는 영구 저장하지 않고 이번 실행에서만 사용합니다.'
      ].filter(Boolean).join(' ');
      status.textContent = `Google Photos 준비 완료 · ${files.length.toLocaleString()}장`;
      restoredKey = cacheSaved ? tripCacheKey(dateRange) : '';
      await refreshCacheControls();
      updateConnectButtonLabel(true);
    } catch (error) {
      importCount.textContent = '연결 실패';
      importHint.textContent = error.message;
      status.textContent = `Google Photos 연결 실패: ${error.message}`;
      updateConnectButtonLabel();
    } finally {
      if (pickerResult?.sessionId && pickerResult?.accessToken) {
        await releaseGooglePhotosSelection(pickerResult.sessionId, pickerResult.accessToken).catch(() => {});
      }
      connectButton.disabled = false;
    }
  });
}

function handleDateRangeChange() {
  restoredKey = '';
  updateConnectButtonLabel();
  refreshCacheControls().catch(() => {});
  if (journeyMode.value === 'PHOTOS') restoreCachedTripPhotos().catch(() => {});
}

async function restoreCachedTripPhotos() {
  const dateRange = currentDateRange();
  const key = tripCacheKey(dateRange);
  if (!key || restoredKey === key) return;
  restoredKey = key;

  const cached = await loadTripSelection(dateRange).catch(() => null);
  clearPhotoCache.disabled = !cached;
  if (!cached?.files?.length || cached.consented !== true) {
    updateConnectButtonLabel();
    importHint.textContent = `${dateRange.startDate} ~ ${dateRange.endDate} 여행 사진을 처음 한 번 선택하면 됩니다. 저장 옵션을 체크한 경우에만 다음 실행에서 자동 복원됩니다.`;
    return;
  }

  persistPhotos.checked = true;
  applyFilesToPhotoJourney(cached.files);
  importCount.textContent = `${cached.files.length.toLocaleString()}장 · 자동 복원`;
  importHint.textContent = `${dateRange.startDate} ~ ${dateRange.endDate}에 사용자가 저장을 허용한 사진을 이 브라우저에서 자동으로 불러왔습니다.`;
  status.textContent = `Google Photos 로컬 사진 복원 · ${cached.files.length.toLocaleString()}장`;
  updateConnectButtonLabel(true);
}

async function refreshCacheControls() {
  if (!clearPhotoCache) return;
  const cached = await loadTripSelection(currentDateRange()).catch(() => null);
  clearPhotoCache.disabled = !cached;
  if (cached?.consented) persistPhotos.checked = true;
}

function currentDateRange() {
  return {
    startDate: String(startDate.value || '').trim(),
    endDate: String(endDate.value || '').trim()
  };
}

function tripCacheKey(dateRange) {
  const start = String(dateRange?.startDate || '').trim();
  const end = String(dateRange?.endDate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return '';
  return `${start}__${end}`;
}

function updateConnectButtonLabel(hasPhotos = false) {
  if (!connectButton || connectButton.disabled) return;
  if (hasPhotos) {
    connectButton.textContent = '사진 새로 선택';
    return;
  }
  const { startDate: start, endDate: end } = currentDateRange();
  const short = formatShortDateRange(start, end);
  connectButton.textContent = short ? `여행 사진 선택 · ${short}` : 'Google Photos에서 여행 사진 선택';
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
  folderInput.files = transfer.files;
  folderInput.dispatchEvent(new Event('change', { bubbles: true }));
}

async function downloadPreviewFiles(photos, accessToken, onProgress) {
  const files = [];
  let done = 0;
  for (const photo of photos) {
    const response = await fetch(photo.remoteUrl, {
      headers: { authorization: `Bearer ${accessToken}` }
    });
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

async function saveTripSelection(dateRange, files) {
  if (!globalThis.indexedDB || !files.length) return false;
  const db = await openCacheDb();
  const key = tripCacheKey(dateRange);
  if (!key) return false;
  const record = {
    key,
    consented: true,
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    savedAt: Date.now(),
    files: files.map(file => ({
      name: file.name,
      type: file.type,
      lastModified: file.lastModified,
      blob: file
    }))
  };
  await transactionPromise(db, 'readwrite', store => store.put(record));
  return true;
}

async function loadTripSelection(dateRange) {
  if (!globalThis.indexedDB) return null;
  const key = tripCacheKey(dateRange);
  if (!key) return null;
  const db = await openCacheDb();
  const record = await transactionPromise(db, 'readonly', store => store.get(key));
  if (!record?.files?.length || record.consented !== true) return null;
  return {
    ...record,
    files: record.files.map(item => new File([item.blob], item.name, {
      type: item.type || item.blob?.type || 'image/jpeg',
      lastModified: Number(item.lastModified) || Date.now()
    }))
  };
}

async function deleteTripSelection(dateRange) {
  if (!globalThis.indexedDB) return;
  const key = tripCacheKey(dateRange);
  if (!key) return;
  const db = await openCacheDb();
  await transactionPromise(db, 'readwrite', store => store.delete(key));
}

function openCacheDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CACHE_DB, CACHE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CACHE_STORE)) db.createObjectStore(CACHE_STORE, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('사진 캐시를 열지 못했습니다.'));
  });
}

function transactionPromise(db, mode, action) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CACHE_STORE, mode);
    const store = tx.objectStore(CACHE_STORE);
    const request = action(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('사진 캐시 작업에 실패했습니다.'));
    tx.onerror = () => reject(tx.error || new Error('사진 캐시 트랜잭션에 실패했습니다.'));
  });
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
