const journeyMode = document.querySelector('#journeyMode');
const photoDisplaySeconds = document.querySelector('#photoDisplaySeconds');
const photoDisplaySecondsLabel = document.querySelector('#photoDisplaySecondsLabel');
const photoVideoMode = document.querySelector('#photoVideoMode');
const videoMinPlaySeconds = document.querySelector('#videoMinPlaySeconds');
const videoMinPlaySecondsLabel = document.querySelector('#videoMinPlaySecondsLabel');
const videoMinPlaySetting = document.querySelector('#videoMinPlaySetting');
const playButton = document.querySelector('#playButton');
const resetButton = document.querySelector('#resetButton');
const seek = document.querySelector('#seek');
const photoImages = document.querySelector('#photoImages');
const photoFolderInput = document.querySelector('#photoFolderInput');
const importHint = document.querySelector('#photoImportHint');
const status = document.querySelector('#status');

if (journeyMode && photoDisplaySeconds && photoVideoMode && videoMinPlaySeconds) {
  const updateLabels = () => {
    if (photoDisplaySecondsLabel) photoDisplaySecondsLabel.textContent = `${Number(photoDisplaySeconds.value).toFixed(1)}초`;
    if (videoMinPlaySecondsLabel) videoMinPlaySecondsLabel.textContent = `${Number(videoMinPlaySeconds.value).toFixed(1)}초`;
    const playVideos = photoVideoMode.value === 'PLAY';
    videoMinPlaySeconds.disabled = !playVideos;
    if (videoMinPlaySetting) videoMinPlaySetting.dataset.disabled = String(!playVideos);
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

  const schedulePlaybackSync = () => requestAnimationFrame(syncJourneyVideos);

  const rebuildJourney = () => {
    updateLabels();
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
  videoMinPlaySeconds.addEventListener('input', updateLabels);
  videoMinPlaySeconds.addEventListener('change', rebuildJourney);
  photoVideoMode.addEventListener('change', handleVideoModeChange);
  journeyMode.addEventListener('change', schedulePlaybackSync);
  playButton?.addEventListener('click', () => queueMicrotask(syncJourneyVideos));
  resetButton?.addEventListener('click', () => queueMicrotask(syncJourneyVideos));
  seek?.addEventListener('input', () => queueMicrotask(syncJourneyVideos));
  if (photoImages && globalThis.MutationObserver) {
    new MutationObserver(() => queueMicrotask(syncJourneyVideos)).observe(photoImages, { childList: true, subtree: true });
  }
  updateLabels();
}
