const host = document.querySelector('#photoImportBlock');

if (host && !document.querySelector('#photoImportProgress')) {
  ensureProgressStyles();

  const progress = document.createElement('section');
  progress.id = 'photoImportProgress';
  progress.className = 'photo-import-progress';
  progress.hidden = true;
  progress.setAttribute('role', 'progressbar');
  progress.setAttribute('aria-label', '사진 여정 가져오기 진행률');
  progress.setAttribute('aria-valuemin', '0');
  progress.setAttribute('aria-valuemax', '100');
  progress.setAttribute('aria-valuenow', '0');
  progress.innerHTML = `
    <div class="photo-progress-head">
      <strong id="photoProgressStage">파일 준비</strong>
      <span id="photoProgressPercent">0%</span>
    </div>
    <div class="photo-progress-track" aria-hidden="true"><i id="photoProgressBar"></i></div>
    <div class="photo-progress-meta">
      <span id="photoProgressDetail">대기 중</span>
      <span id="photoProgressMedia">사진 0장 · 영상 0개</span>
    </div>
    <ol class="photo-progress-steps" aria-label="가져오기 단계">
      <li data-photo-progress-step="PREPARE">파일 준비</li>
      <li data-photo-progress-step="METADATA">메타데이터</li>
      <li data-photo-progress-step="MATCH">Timeline 매칭</li>
      <li data-photo-progress-step="BUILD">여정 구성</li>
    </ol>`;

  const head = host.querySelector('.setting-head');
  if (head?.nextSibling) host.insertBefore(progress, head.nextSibling);
  else host.prepend(progress);
}

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
    renderProgress(event?.detail || {});
  });
}

function renderProgress(next) {
  const phase = PHASES[next.phase] ? next.phase : state.phase;
  const config = PHASES[phase];
  const phaseChangedBackToStart = phase === 'PREPARE' && state.phase !== 'PREPARE';
  if (phaseChangedBackToStart || next.reset) {
    state.photos = 0;
    state.videos = 0;
    state.scenes = null;
    state.percent = 0;
  }
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
  state.percent = phase === 'PREPARE' ? percent : Math.max(state.percent, percent);

  root.hidden = false;
  root.dataset.phase = phase;
  stageLabel.textContent = next.label || config.label;
  percentLabel.textContent = `${phase === 'COMPLETE' ? 100 : state.percent}%`;
  bar.style.width = `${phase === 'COMPLETE' ? 100 : state.percent}%`;
  root.setAttribute('aria-valuenow', String(phase === 'COMPLETE' ? 100 : state.percent));

  if (next.message) detail.textContent = next.message;
  else if (total > 0) detail.textContent = `${processed.toLocaleString()} / ${total.toLocaleString()} 처리`;
  else detail.textContent = config.label;

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

  root.classList.toggle('is-error', phase === 'ERROR');
}

function ensureProgressStyles() {
  if (document.querySelector('#photoProgressStyles')) return;
  const style = document.createElement('style');
  style.id = 'photoProgressStyles';
  style.textContent = `
    .photo-import-progress{grid-column:1/-1;margin:8px 0 10px;padding:10px 11px;border:1px solid #334155;border-radius:10px;background:rgba(2,6,23,.58);min-width:0}
    .photo-import-progress[hidden]{display:none}
    .photo-progress-head,.photo-progress-meta{display:flex;align-items:center;justify-content:space-between;gap:10px;min-width:0}
    .photo-progress-head strong{color:#f8fafc;font-size:11px}
    .photo-progress-head span{color:#bfdbfe;font-size:11px;font-weight:800;font-variant-numeric:tabular-nums}
    .photo-progress-track{height:7px;margin:8px 0;border-radius:999px;overflow:hidden;background:#1e293b}
    .photo-progress-track i{display:block;width:0;height:100%;border-radius:inherit;background:#3b82f6;transition:width .16s ease}
    .photo-progress-meta{color:#94a3b8;font-size:9px;line-height:1.3}
    .photo-progress-meta span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .photo-progress-meta span:last-child{flex:0 0 auto;color:#cbd5e1;font-variant-numeric:tabular-nums}
    .photo-progress-steps{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:5px;margin:9px 0 0;padding:0;list-style:none}
    .photo-progress-steps li{min-width:0;padding:5px 4px;border:1px solid #273449;border-radius:7px;background:#111827;color:#64748b;font-size:8px;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .photo-progress-steps li.is-active{border-color:#3b82f6;color:#dbeafe;background:rgba(30,64,175,.24)}
    .photo-progress-steps li.is-done{border-color:#166534;color:#bbf7d0;background:rgba(22,101,52,.20)}
    .photo-import-progress.is-error{border-color:#7f1d1d}
    .photo-import-progress.is-error .photo-progress-track i{background:#ef4444}
    @media(max-width:640px){.photo-progress-meta{align-items:flex-start;flex-direction:column;gap:3px}.photo-progress-steps{grid-template-columns:repeat(2,minmax(0,1fr))}}
  `;
  document.head.append(style);
}
