const journeyMode = document.querySelector('#journeyMode');
const journeyModeHint = document.querySelector('#journeyModeHint');
const photoDisplaySeconds = document.querySelector('#photoDisplaySeconds');
const photoDisplaySecondsLabel = document.querySelector('#photoDisplaySecondsLabel');
const photoVideoMode = document.querySelector('#photoVideoMode');
const videoMaxPlaySeconds = document.querySelector('#videoMaxPlaySeconds');
const videoMaxPlaySecondsLabel = document.querySelector('#videoMaxPlaySecondsLabel');
const videoMaxPlaySetting = document.querySelector('#videoMaxPlaySetting');
const playButton = document.querySelector('#playButton');
const resetButton = document.querySelector('#resetButton');
const seek = document.querySelector('#seek');
const photoImages = document.querySelector('#photoImages');
const photoFolderInput = document.querySelector('#photoFolderInput');
const importHint = document.querySelector('#photoImportHint');
const status = document.querySelector('#status');

if (journeyMode && photoDisplaySeconds && photoVideoMode && videoMaxPlaySeconds) {
  const updateLabels = () => {
    if (photoDisplaySecondsLabel) photoDisplaySecondsLabel.textContent = `${Number(photoDisplaySeconds.value).toFixed(1)}초`;
    if (videoMaxPlaySecondsLabel) videoMaxPlaySecondsLabel.textContent = `${Number(videoMaxPlaySeconds.value).toFixed(1)}초`;
    const playVideos = photoVideoMode.value === 'PLAY';
    videoMaxPlaySeconds.disabled = !playVideos;
    if (videoMaxPlaySetting) videoMaxPlaySetting.dataset.disabled = String(!playVideos);
  };

  const syncJourneyVideos = () => {
    const shouldPlay = journeyMode.value === 'PHOTOS' &&
      photoVideoMode.value === 'PLAY' &&
      playButton?.textContent === '일시정지';
    for (const video of document.querySelectorAll('#photoImages video')) {
      if (shouldPlay) video.play().catch(() => {});
      else video.pause();
    }
  };

  const updateJourneyCopy = () => {
    if (journeyMode.value === 'PHOTOS' && journeyModeHint) {
      journeyModeHint.textContent = '촬영 위치에 도착하면 경로를 멈추고 사진·동영상을 크게 감상한 뒤 다음 이동을 이어갑니다.';
    }
  };

  const schedulePlaybackSync = () => requestAnimationFrame(syncJourneyVideos);

  const rebuildJourney = () => {
    updateLabels();
    updateJourneyCopy();
    if (journeyMode.value !== 'PHOTOS') return;
    journeyMode.dispatchEvent(new Event('change', { bubbles: true }));
    schedulePlaybackSync();
  };

  const handleVideoModeChange = () => {
    const importedMode = photoFolderInput?.dataset?.googleVideoMode || '';
    const needsGoogleReload = photoFolderInput?.dataset?.importSource === 'google-photos-picker' &&
      photoVideoMode.value === 'PLAY' && importedMode !== 'PLAY';
    rebuildJourney();
    if (needsGoogleReload) {
      const message = 'Google Photos는 썸네일만 내려받은 상태입니다. 동영상을 재생하려면 상단의 미디어 새로 선택을 눌러 다시 가져오세요.';
      if (importHint) importHint.textContent = message;
      if (status) status.textContent = message;
    }
  };

  photoDisplaySeconds.addEventListener('input', updateLabels);
  photoDisplaySeconds.addEventListener('change', rebuildJourney);
  videoMaxPlaySeconds.addEventListener('input', updateLabels);
  videoMaxPlaySeconds.addEventListener('change', rebuildJourney);
  photoVideoMode.addEventListener('change', handleVideoModeChange);
  journeyMode.addEventListener('change', () => {
    queueMicrotask(updateJourneyCopy);
    schedulePlaybackSync();
  });
  playButton?.addEventListener('click', () => queueMicrotask(syncJourneyVideos));
  resetButton?.addEventListener('click', () => queueMicrotask(syncJourneyVideos));
  seek?.addEventListener('input', () => queueMicrotask(syncJourneyVideos));
  if (photoImages && globalThis.MutationObserver) {
    new MutationObserver(() => queueMicrotask(syncJourneyVideos)).observe(photoImages, { childList: true, subtree: true });
  }
  updateLabels();
  updateJourneyCopy();
}
