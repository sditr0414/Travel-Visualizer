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
const loadButton = document.querySelector('#loadButton');
const videoDuration = document.querySelector('#videoDuration');
const videoDurationLabel = document.querySelector('#videoDurationLabel');
const durationHint = document.querySelector('#durationHint');
const videoDurationTitle = document.querySelector('label[for="videoDuration"]');

// Keep the user-facing term simple. In photo journey mode, media stop time is
// still added to the route playback internally, but this control remains the
// primary video-length control from the user's point of view.
if (videoDurationTitle) videoDurationTitle.textContent = '영상 길이';
if (videoDuration) videoDuration.setAttribute('aria-label', '영상 길이');

// main.js recalculates duration limits when "설정 적용" is pressed and writes
// the minimum value back into this range. Guard that one programmatic reset at
// the input-property level so the recalculation itself reads the preserved value.
// If a changed date range makes the old value invalid, clamp it to the new range.
if (loadButton && videoDuration) {
  const valueDescriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  let preservingApply = false;
  let preservedVideoDuration = null;

  if (valueDescriptor?.get && valueDescriptor?.set) {
    Object.defineProperty(videoDuration, 'value', {
      configurable: true,
      enumerable: valueDescriptor.enumerable,
      get() {
        return valueDescriptor.get.call(this);
      },
      set(nextValue) {
        if (!preservingApply || !Number.isFinite(preservedVideoDuration)) {
          valueDescriptor.set.call(this, nextValue);
          return;
        }

        const min = Number(this.min);
        const max = Number(this.max);
        const lower = Number.isFinite(min) ? min : preservedVideoDuration;
        const upper = Number.isFinite(max) ? max : preservedVideoDuration;
        const restored = Math.min(upper, Math.max(lower, preservedVideoDuration));
        valueDescriptor.set.call(this, String(restored));
      }
    });

    loadButton.addEventListener('click', () => {
      const current = Number(valueDescriptor.get.call(videoDuration));
      preservedVideoDuration = Number.isFinite(current) ? current : null;
      preservingApply = Number.isFinite(preservedVideoDuration);

      // main.js schedules its actual playback plan in requestAnimationFrame.
      // Keep the guard through that frame, then release it.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          preservingApply = false;
          preservedVideoDuration = null;
          const displayed = Number(valueDescriptor.get.call(videoDuration));
          if (videoDurationLabel && Number.isFinite(displayed)) {
            const value = Math.max(0, Math.round(displayed));
            const h = Math.floor(value / 3600);
            const m = Math.floor((value % 3600) / 60);
            const s = value % 60;
            videoDurationLabel.textContent = h > 0
              ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
              : `${m}:${String(s).padStart(2, '0')}`;
          }
        });
      });
    }, { capture: true });
  }
}

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
      journeyModeHint.textContent = '촬영 위치에 도착하면 경로를 멈추고 왼쪽 지도·경로와 오른쪽 사진·동영상을 분할 화면으로 함께 보여준 뒤 다음 이동을 이어갑니다.';
    }
    if (durationHint && journeyMode.value === 'PHOTOS') {
      durationHint.dataset.photoJourneyCopy = 'true';
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
