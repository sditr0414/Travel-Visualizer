import './photo-progress-ui.js';
import {
  isLocalMediaFile,
  loadLocalGalleryFiles,
  mediaTypeForLocalFile
} from './local-media-loader.js';
import { MediaLibrarySource, setActiveMediaLibrary } from './media-library-state.js';

const galleryInput = document.querySelector('#photoGalleryInput');
const galleryFolderInput = document.querySelector('#photoGalleryFolderInput');
const galleryInputs = [galleryInput, galleryFolderInput].filter(Boolean);
const journeyMode = document.querySelector('#journeyMode');
const importHint = document.querySelector('#photoImportHint');
const importCount = document.querySelector('#photoImportCount');
const status = document.querySelector('#status');

let importGeneration = 0;

if (galleryInputs.length && journeyMode) {
  for (const input of galleryInputs) {
    input.addEventListener('change', () => importLocalSelection(input));
  }
}

async function importLocalSelection(input) {
  const generation = ++importGeneration;
  const files = Array.from(input?.files || []).filter(isLocalMediaFile);
  const selectionLabel = selectedSourceLabel(input, files);

  if (!files.length) {
    const message = `${selectionLabel}에서 지원되는 사진이나 영상을 찾지 못했습니다.`;
    if (importHint) importHint.textContent = message;
    reportPhotoProgress({ phase: 'ERROR', reset: true, message });
    input.value = '';
    return;
  }

  const counts = countSelectedMedia(files);
  if (journeyMode.value !== 'PHOTOS') {
    journeyMode.value = 'PHOTOS';
    journeyMode.dispatchEvent(new Event('change', { bubbles: true }));
  }

  setGalleryInputsDisabled(true);
  if (importCount) {
    importCount.textContent = `사진 ${counts.photos.toLocaleString()}장 · 영상 ${counts.videos.toLocaleString()}개`;
  }
  if (importHint) {
    importHint.textContent = `${selectionLabel}의 사진과 영상을 확인하고 있습니다.`;
  }
  if (status) {
    status.textContent = `${selectionLabel} 분석 시작 · ${files.length.toLocaleString()}개 파일`;
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
            status.textContent = `${selectionLabel} 촬영 정보 분석 · ${processed.toLocaleString()} / ${total.toLocaleString()}`;
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
        ? `${selectionLabel}에서 ${stats.photos.toLocaleString()}개를 불러왔습니다. 위치 정보가 없는 항목은 촬영 시간으로 이동 기록과 맞춥니다.`
        : '사용 가능한 촬영 정보를 찾지 못했습니다.';
    }
    if (status) {
      status.textContent = `${selectionLabel} 준비 완료 · 사진 ${stats.images.toLocaleString()}장 · 영상 ${stats.videos.toLocaleString()}개`;
    }

    setActiveMediaLibrary(MediaLibrarySource.LOCAL_GALLERY, result.photos);

    // Rebuild through the existing main.js change handler. Both modules read
    // the same explicit active media library, so no hidden input or window
    // event bridge is required.
    journeyMode.dispatchEvent(new Event('change', { bubbles: true }));
  } catch (error) {
    if (generation !== importGeneration) return;
    const message = error?.message || `${selectionLabel} 분석에 실패했습니다.`;
    if (importCount) importCount.textContent = '가져오기 실패';
    if (importHint) importHint.textContent = message;
    if (status) status.textContent = `${selectionLabel} 처리 실패: ${message}`;
    reportPhotoProgress({
      phase: 'ERROR',
      photos: counts.photos,
      videos: counts.videos,
      message
    });
  } finally {
    if (generation === importGeneration) {
      setGalleryInputsDisabled(false);
      input.value = '';
    }
  }
}

function selectedSourceLabel(input, files) {
  if (input !== galleryFolderInput) return '선택한 파일';
  const relativePath = String(files[0]?.webkitRelativePath || '');
  const folderName = relativePath.split('/').filter(Boolean)[0];
  return folderName ? `${folderName} 폴더` : '선택한 폴더';
}

function setGalleryInputsDisabled(disabled) {
  for (const input of galleryInputs) input.disabled = disabled;
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
