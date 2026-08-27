import './photo-progress-ui.js';

const galleryInput = document.querySelector('#photoGalleryInput');
const journeyMode = document.querySelector('#journeyMode');
const photoFolderInput = document.querySelector('#photoFolderInput');
const importHint = document.querySelector('#photoImportHint');
const importCount = document.querySelector('#photoImportCount');
const status = document.querySelector('#status');

const MEDIA_NAME = /\.(?:jpe?g|png|webp|gif|avif|heic|heif|mp4|m4v|mov|webm)$/i;
const VIDEO_NAME = /\.(?:mp4|m4v|mov|webm)$/i;
const TRANSFER_BATCH_SIZE = 25;

if (galleryInput && journeyMode && photoFolderInput) {
  const syncDeviceGalleryCopy = () => {
    if (photoFolderInput.dataset.importSource !== 'device-gallery') return;
    if (status) {
      status.textContent = status.textContent
        .replace('Google Photos 데이터 읽는 중', '기기 갤러리 분석 중')
        .replace('Google Photos 데이터 준비 완료', '기기 갤러리 준비 완료');
    }
    if (importHint && /Google Photos Takeout|Takeout 폴더/.test(importHint.textContent || '')) {
      importHint.textContent = '기기 사진의 EXIF 촬영시각·GPS를 우선 사용하고, 없으면 파일명 또는 파일 시간으로 Timeline 위치를 추정합니다.';
    }
  };

  if (globalThis.MutationObserver) {
    const observer = new MutationObserver(syncDeviceGalleryCopy);
    if (status) observer.observe(status, { childList: true, characterData: true, subtree: true });
    if (importHint) observer.observe(importHint, { childList: true, characterData: true, subtree: true });
  }

  galleryInput.addEventListener('change', async () => {
    const files = Array.from(galleryInput.files || []).filter(file => {
      const type = String(file.type || '');
      return /^(?:image|video)\//i.test(type) || MEDIA_NAME.test(String(file.name || ''));
    });
    if (!files.length) {
      if (importHint) importHint.textContent = '선택한 항목에서 지원되는 사진·동영상 파일을 찾지 못했습니다.';
      reportPhotoProgress({ phase: 'ERROR', message: '지원되는 사진·동영상 파일이 없습니다.' });
      return;
    }

    const counts = countSelectedMedia(files);
    reportPhotoProgress({
      phase: 'PREPARE',
      processed: 0,
      total: files.length,
      photos: counts.photos,
      videos: counts.videos,
      reset: true,
      message: `선택한 ${files.length.toLocaleString()}개 파일을 준비합니다.`
    });

    if (journeyMode.value !== 'PHOTOS') {
      journeyMode.value = 'PHOTOS';
      journeyMode.dispatchEvent(new Event('change', { bubbles: true }));
    }

    if (typeof DataTransfer !== 'function') {
      const message = '이 브라우저에서는 기기 갤러리 전달 기능을 지원하지 않습니다. Takeout 또는 Google Photos를 사용하세요.';
      if (importHint) importHint.textContent = message;
      reportPhotoProgress({ phase: 'ERROR', photos: counts.photos, videos: counts.videos, message });
      return;
    }

    const transfer = new DataTransfer();
    if (importHint) importHint.textContent = '기기 갤러리 선택 항목을 준비하는 중입니다.';

    for (let index = 0; index < files.length; index += 1) {
      transfer.items.add(files[index]);
      const prepared = index + 1;
      if (prepared % TRANSFER_BATCH_SIZE === 0 || prepared === files.length) {
        if (importCount) importCount.textContent = `${prepared.toLocaleString()} / ${files.length.toLocaleString()}개 준비`;
        if (status) status.textContent = `기기 갤러리 준비 중 · ${prepared.toLocaleString()} / ${files.length.toLocaleString()}`;
        reportPhotoProgress({
          phase: 'PREPARE',
          processed: prepared,
          total: files.length,
          photos: counts.photos,
          videos: counts.videos,
          message: `${prepared.toLocaleString()} / ${files.length.toLocaleString()} 파일 준비`
        });
        await yieldToBrowser();
      }
    }

    photoFolderInput.dataset.importSource = 'device-gallery';
    delete photoFolderInput.dataset.googleVideoMode;
    if (importCount) importCount.textContent = `${files.length.toLocaleString()}개 선택`;
    if (importHint) importHint.textContent = '기기 사진의 촬영시각·GPS 메타데이터를 읽는 중입니다.';
    if (status) status.textContent = `기기 갤러리 분석 중 · ${files.length.toLocaleString()}개 파일`;
    reportPhotoProgress({
      phase: 'METADATA',
      processed: 0,
      total: files.length,
      photos: counts.photos,
      videos: counts.videos,
      message: 'EXIF 촬영시각·GPS를 분석합니다.'
    });
    photoFolderInput.files = transfer.files;
    photoFolderInput.dispatchEvent(new Event('change', { bubbles: true }));
    queueMicrotask(syncDeviceGalleryCopy);
  });
}

function countSelectedMedia(files) {
  let videos = 0;
  for (const file of files) {
    const type = String(file?.type || '');
    const name = String(file?.name || '');
    if (/^video\//i.test(type) || VIDEO_NAME.test(name)) videos += 1;
  }
  return { photos: Math.max(0, files.length - videos), videos };
}

function reportPhotoProgress(detail) {
  window.dispatchEvent(new CustomEvent('travel-camera:photo-progress', { detail }));
}

function yieldToBrowser() {
  return new Promise(resolve => setTimeout(resolve, 0));
}
