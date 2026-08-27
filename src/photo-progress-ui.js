const root = document.querySelector('#photoImportProgress');
const stageLabel = document.querySelector('#photoProgressStage');
const percentLabel = document.querySelector('#photoProgressPercent');
const bar = document.querySelector('#photoProgressBar');
const detail = document.querySelector('#photoProgressDetail');
const media = document.querySelector('#photoProgressMedia');
const steps = Array.from(document.querySelectorAll('[data-photo-progress-step]'));

const PHASES = Object.freeze({
  PREPARE: { label: '파일 준비', start: 0, end: 15 },
  METADATA: { label: '메타데이터 분석', start: 15, end: 70 },
  MATCH: { label: 'Timeline 매칭', start: 70, end: 88 },
  BUILD: { label: '사진 여정 구성', start: 88, end: 99 },
  COMPLETE: { label: '준비 완료', start: 100, end: 100 },
  ERROR: { label: '처리 실패', start: 0, end: 0 }
});

const state = {
  phase: 'PREPARE',
  photos: 0,
  videos: 0,
  scenes: null,
  percent: 0
};

if (root) {
  window.addEventListener('travel-camera:photo-progress', event => {
    const next = event?.detail || {};
    renderProgress(next);
  });
}

function renderProgress(next) {
  const phase = PHASES[next.phase] ? next.phase : state.phase;
  const config = PHASES[phase];
  state.phase = phase;
  if (Number.isFinite(Number(next.photos))) state.photos = Math.max(0, Number(next.photos));
  if (Number.isFinite(Number(next.videos))) state.videos = Math.max(0, Number(next.videos));
  if (Number.isFinite(Number(next.scenes))) state.scenes = Math.max(0, Number(next.scenes));

  const processed = Math.max(0, Number(next.processed) || 0);
  const total = Math.max(0, Number(next.total) || 0);
  let ratio = total > 0 ? Math.min(1, processed / total) : 0;
  if (phase === 'COMPLETE') ratio = 1;
  const percent = phase === 'ERROR'
    ? state.percent
    : Math.round(config.start + (config.end - config.start) * ratio);
  state.percent = Math.max(state.percent, percent);

  root.hidden = false;
  root.dataset.phase = phase;
  stageLabel.textContent = next.label || config.label;
  percentLabel.textContent = `${phase === 'COMPLETE' ? 100 : state.percent}%`;
  bar.style.width = `${phase === 'COMPLETE' ? 100 : state.percent}%`;
  root.setAttribute('aria-valuenow', String(phase === 'COMPLETE' ? 100 : state.percent));

  if (next.message) {
    detail.textContent = next.message;
  } else if (total > 0) {
    detail.textContent = `${processed.toLocaleString()} / ${total.toLocaleString()} 처리`;
  } else {
    detail.textContent = config.label;
  }

  const parts = [`사진 ${state.photos.toLocaleString()}장`, `영상 ${state.videos.toLocaleString()}개`];
  if (state.scenes !== null) parts.push(`장면 ${state.scenes.toLocaleString()}개`);
  media.textContent = parts.join(' · ');

  const phaseOrder = ['PREPARE', 'METADATA', 'MATCH', 'BUILD'];
  const activeIndex = phaseOrder.indexOf(phase);
  for (const step of steps) {
    const stepPhase = step.dataset.photoProgressStep;
    const stepIndex = phaseOrder.indexOf(stepPhase);
    step.classList.toggle('is-active', stepPhase === phase && phase !== 'COMPLETE' && phase !== 'ERROR');
    step.classList.toggle('is-done', phase === 'COMPLETE' || (activeIndex >= 0 && stepIndex >= 0 && stepIndex < activeIndex));
  }

  if (phase === 'ERROR') {
    root.classList.add('is-error');
  } else {
    root.classList.remove('is-error');
  }
}
