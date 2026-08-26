const journeyMode = document.querySelector('#journeyMode');
const photoDisplaySeconds = document.querySelector('#photoDisplaySeconds');
const photoDisplaySecondsLabel = document.querySelector('#photoDisplaySecondsLabel');
const photoVideoMode = document.querySelector('#photoVideoMode');
const videoMinPlaySeconds = document.querySelector('#videoMinPlaySeconds');
const videoMinPlaySecondsLabel = document.querySelector('#videoMinPlaySecondsLabel');
const videoMinPlaySetting = document.querySelector('#videoMinPlaySetting');

if (journeyMode && photoDisplaySeconds && photoVideoMode && videoMinPlaySeconds) {
  const updateLabels = () => {
    if (photoDisplaySecondsLabel) photoDisplaySecondsLabel.textContent = `${Number(photoDisplaySeconds.value).toFixed(1)}초`;
    if (videoMinPlaySecondsLabel) videoMinPlaySecondsLabel.textContent = `${Number(videoMinPlaySeconds.value).toFixed(1)}초`;
    const playVideos = photoVideoMode.value === 'PLAY';
    videoMinPlaySeconds.disabled = !playVideos;
    if (videoMinPlaySetting) videoMinPlaySetting.dataset.disabled = String(!playVideos);
  };

  const rebuildJourney = () => {
    updateLabels();
    if (journeyMode.value !== 'PHOTOS') return;
    journeyMode.dispatchEvent(new Event('change', { bubbles: true }));
  };

  photoDisplaySeconds.addEventListener('input', updateLabels);
  photoDisplaySeconds.addEventListener('change', rebuildJourney);
  videoMinPlaySeconds.addEventListener('input', updateLabels);
  videoMinPlaySeconds.addEventListener('change', rebuildJourney);
  photoVideoMode.addEventListener('change', rebuildJourney);
  updateLabels();
}
