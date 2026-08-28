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
const videoDuration = document.querySelector('#videoDuration');
const durationHint = document.querySelector('#durationHint');
const videoDurationTitle = document.querySelector('label[for="videoDuration"]');

// The configured value is the route playback length. Photo/video holds extend
// the actual player duration shown in the dock. main.js owns duration state.
if (videoDurationTitle) videoDurationTitle.textContent = '영상 길이';
if (videoDuration) videoDuration.setAttribute('aria-label', '영상 길이');

setupPlaybackClock();

function setupPlaybackClock() {
  if (!seek) return;
  const dock = seek.closest('.player-dock');
  if (!dock) return;

  let clock = dock.querySelector('#playbackTime');
  if (!clock) {
    clock = document.createElement('span');
    clock.id = 'playbackTime';
    clock.className = 'playback-time';
    clock.setAttribute('aria-label', '진행 시간과 전체 재생 시간');
    clock.textContent = '0:00 / 0:00';
    const fpsBadge = dock.querySelector('.fps-badge');
    if (fpsBadge) dock.insertBefore(clock, fpsBadge);
    else dock.append(clock);
  }

  let lastText = '';
  const render = () => {
    const current = Math.max(0, Number(seek.value) || 0);
    const total = Math.max(0, Number(seek.max) || 0);
    const text = `${formatPlaybackClock(current, false)} / ${formatPlaybackClock(total, true)}`;
    if (text !== lastText) {
      clock.textContent = text;
      lastText = text;
    }
  };

  seek.addEventListener('input', render);
  seek.addEventListener('change', render);
  playButton?.addEventListener('click', () => requestAnimationFrame(render));
  resetButton?.addEventListener('click', () => requestAnimationFrame(render));

  if (globalThis.MutationObserver) {
    new MutationObserver(render).observe(seek, { attributes: true, attributeFilter: ['max', 'value', 'disabled'] });
  }

  const tick = () => {
    render();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function formatPlaybackClock(seconds, total = false) {
  const raw = Math.max(0, Number(seconds) || 0);
  const value = total ? Math.ceil(raw) : Math.floor(raw);
  const h = Math.floor(value / 3600);
  const m = Math.floor((value % 3600) / 60);
  const s = value % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
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
      journeyModeHint.textContent = '지도·경로와 미디어 영역을 같은 구도로 유지하면서 촬영 위치에 도착하면 경로를 멈추고 사진·동영상을 보여준 뒤 다음 이동을 이어갑니다.';
    }
    if (durationHint && journeyMode.value === 'PHOTOS') {
      const base = String(durationHint.textContent || '')
        .replace(/ · 설정한 영상 길이는 경로 이동 부분 기준이며 실제 전체 시간은 재생바에서 확인합니다\.?$/, '');
      durationHint.textContent = `${base} · 설정한 영상 길이는 경로 이동 부분 기준이며 실제 전체 시간은 재생바에서 확인합니다.`;
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
