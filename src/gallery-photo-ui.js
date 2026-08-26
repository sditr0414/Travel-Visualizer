const galleryInput = document.querySelector('#photoGalleryInput');
const journeyMode = document.querySelector('#journeyMode');
const photoFolderInput = document.querySelector('#photoFolderInput');
const importHint = document.querySelector('#photoImportHint');
const status = document.querySelector('#status');

if (galleryInput && journeyMode && photoFolderInput) {
  galleryInput.addEventListener('change', () => {
    const files = Array.from(galleryInput.files || []).filter(file => String(file.type || '').startsWith('image/'));
    if (!files.length) return;

    if (journeyMode.value !== 'PHOTOS') {
      journeyMode.value = 'PHOTOS';
      journeyMode.dispatchEvent(new Event('change', { bubbles: true }));
    }

    if (typeof DataTransfer !== 'function') {
      importHint.textContent = '이 브라우저에서는 기기 갤러리 전달 기능을 지원하지 않습니다. Takeout 또는 Google Photos를 사용하세요.';
      return;
    }

    const transfer = new DataTransfer();
    for (const file of files) transfer.items.add(file);
    photoFolderInput.dataset.importSource = 'device-gallery';
    photoFolderInput.files = transfer.files;
    photoFolderInput.dispatchEvent(new Event('change', { bubbles: true }));

    // The shared photo importer also handles Takeout and Google Photos. Keep the
    // user-facing copy source-neutral after the shared pipeline finishes.
    setTimeout(() => {
      if (/Google Photos 데이터 준비 완료/.test(status?.textContent || '')) {
        status.textContent = status.textContent.replace('Google Photos 데이터 준비 완료', '기기 갤러리 준비 완료');
      }
      if (/Takeout 폴더/.test(importHint?.textContent || '')) {
        importHint.textContent = '선택한 사진에서 사용할 수 있는 촬영시각을 찾지 못했습니다. 앱 버전에서는 기기 사진 라이브러리의 촬영시각·GPS 메타데이터를 직접 사용합니다.';
      }
    }, 0);
  });
}
