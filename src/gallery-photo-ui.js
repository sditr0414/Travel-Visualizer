import './photo-progress-ui.js';
import {
  isLocalMediaFile,
  loadLocalGalleryFiles,
  mediaTypeForLocalFile
} from './local-media-loader.js';

const galleryInput = document.querySelector('#photoGalleryInput');
const journeyMode = document.querySelector('#journeyMode');
const importHint = document.querySelector('#photoImportHint');
const importCount = document.querySelector('#photoImportCount');
const status = document.querySelector('#status');

let importGeneration = 0;

if (galleryInput && journeyMode) {
  galleryInput.addEventListener('change', async () => {
    const generation = ++importGeneration;
    const files = Array.from(galleryInput.files || []).filter(isLocalMediaFile);

    if (!files.length) {
      const message = '선택한 항목에서 지원되는 사진·동영상 파일을 찾지 못했습니다.';
      if (importHint) importHint.textContent = message;
      reportPhotoProgress({ phase: 'ERROR', reset: true, message });
      return;
    }

    const counts = countSelectedMedia(files);
    if (journeyMode.value !== 'PHOTOS') {
      journeyMode.value = 'PHOTOS';
      journeyMode.dispatchEvent(new Event('change', { bubbles: true }));
    }

    galleryInput.disabled = true;
    if (importCount) {
      importCount.textContent = `사진 ${counts.photos.toLocaleString()}장 · 영상 ${counts.videos.toLocaleString()}개`;
    }
    if (importHint) {
      importHint.textContent = '기기 갤러리 파일을 직접 분석합니다. Takeout 입력으로 복사하지 않습니다.';
    }
    if (status) {
      status.textContent = `기기 갤러리 분석 시작 · ${files.length.toLocaleString()}개 파일`;
    }

    try {
      const result = await loadLocalGalleryFiles(files, {
        onProgress: progress => {
          if (generation !== importGeneration) return;
          reportPhotoProgress(progress);
          const processed = Math.max(0, Number(progress.processed) || 0);
          const total = Math.max(0, Number(progress.total) || files.length);
          if (progress.phase === 'METADATA') {
            if (importCount) {
              importCount.textContent = `사진 ${counts.photos.toLocaleString()}장 · 영상 ${counts.videos.toLocaleString()}개 · ${processed.toLocaleString()}/${total.toLocaleString()} 분석`;
            }
            if (status) {
              status.textContent = `기기 갤러리 촬영 정보 분석 · ${processed.toLocaleString()} / ${total.toLocaleString()}`;
            }
          }
        }
      });

      if (generation !== importGeneration) return;
      const stats = result.stats;
      if (importCount) {
        importCount.textContent = `사진 ${stats.images.toLocaleString()}장 · 영상 ${stats.videos.toLocaleString()}개`;
      }
      if (importHint) {
        importHint.textContent = stats.photos
          ? `기기 갤러리 ${stats.photos.toLocaleString()}개를 읽었습니다. GPS ${stats.gpsPhotos.toLocaleString()}개는 직접 사용하고, 나머지는 촬영시각으로 Timeline 위치를 보완합니다.`
          : '사용 가능한 촬영 정보를 찾지 못했습니다.';
      }
      if (status) {
        status.textContent = `기기 갤러리 촬영 정보 준비 완료 · 사진 ${stats.images.toLocaleString()}장 · 영상 ${stats.videos.toLocaleString()}개`;
      }

      window.dispatchEvent(new CustomEvent('travel-camera:local-media-ready', {
        detail: result
      }));

      // Rebuild through the existing main.js change handler. The photo-journey
      // adapter now owns the active local library, so no hidden input/DataTransfer
      // bridge is required.
      journeyMode.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (error) {
      if (generation !== importGeneration) return;
      const message = error?.message || '기기 갤러리 분석에 실패했습니다.';
      if (importCount) importCount.textContent = '가져오기 실패';
      if (importHint) importHint.textContent = message;
      if (status) status.textContent = `기기 갤러리 처리 실패: ${message}`;
      reportPhotoProgress({
        phase: 'ERROR',
        photos: counts.photos,
        videos: counts.videos,
        message
      });
    } finally {
      if (generation === importGeneration) galleryInput.disabled = false;
    }
  });
}

function countSelectedMedia(files) {
  let videos = 0;
  for (const file of files) {
    if (mediaTypeForLocalFile(file) === 'video') videos += 1;
  }
  return { photos: Math.max(0, files.length - videos), videos };
}

function reportPhotoProgress(detail) {
  window.dispatchEvent(new CustomEvent('travel-camera:photo-progress', { detail }));
}
