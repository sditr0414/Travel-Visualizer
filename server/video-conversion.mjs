import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { basename, join, parse } from 'node:path';
import { randomUUID } from 'node:crypto';

const execute = promisify(execFile);
export function createVideoConverter(outputRoot) {
  const jobs = new Map();
  let active = null;
  let availability;
  const available = () => availability ??= Promise.all(['ffmpeg','ffprobe'].map(command => execute(command, ['-version'], { timeout: 5000, maxBuffer: 100000 }))).then(() => true, () => false);
  const status = job => ({ id: job.id, state: job.state, progress: job.progress, name: job.name, preview: job.preview, error: job.error ?? null });
  const get = id => { const job = jobs.get(id); return job ? status(job) : null; };
  const start = (item, metadata, preview = true) => {
    if (active) throw new Error('다른 영상 사본을 만드는 중입니다. 완료하거나 취소한 뒤 다시 시도하세요.');
    if (!item || item.kind !== 'video' || !/\.(mp4|mov|m4v|webm)$/i.test(item.path)) throw new Error('기본 사진 폴더에 연결된 영상 한 개를 선택해 주세요.');
    if (!Number.isFinite(metadata?.takenMs) || metadata.takenMs <= 0) throw new Error('촬영 시각을 확인한 뒤 다시 시도해 주세요.');
    if ((metadata.lat != null || metadata.lng != null) && (!Number.isFinite(metadata.lat) || !Number.isFinite(metadata.lng) || Math.abs(metadata.lat) > 90 || Math.abs(metadata.lng) > 180)) throw new Error('촬영 위치 정보가 올바르지 않습니다.');
    const id = randomUUID();
    const job = { id, state: 'preparing', progress: 0, name: `${parse(basename(item.path)).name}${preview ? '.preview' : ''}.h264-${id}.mp4`, preview, controller: new AbortController() };
    jobs.set(job.id, job); active = job;
    job.done = run(job, item, metadata).finally(() => { if (active === job) active = null; });
    return status(job);
  };
  async function probe(path, signal) {
    const result = await execute('ffprobe', ['-v','error','-protocol_whitelist','file,pipe','-show_format','-show_streams','-of','json',path], { signal, timeout: 30000, maxBuffer: 2_000_000 });
    return JSON.parse(result.stdout);
  }
  async function run(job, item, metadata) {
    const signal = job.controller.signal;
    try {
      if (!await available()) throw new Error('FFmpeg와 ffprobe를 설치한 로컬 실행 환경이 필요합니다.');
      signal.throwIfAborted();
      const original = await stat(item.path);
      if (original.size !== item.size || Math.abs(original.mtimeMs - item.lastModified) >= 1) throw new Error('원본 파일이 변경되었습니다. 사진 폴더를 다시 연결해 주세요.');
      const info = await probe(item.path, signal);
      const sourceVideo = info.streams.find(stream => stream.codec_type === 'video');
      const seconds = Number(info.format?.duration);
      if (!sourceVideo || !(seconds > 0)) throw new Error('영상 길이와 화면 정보를 읽지 못했습니다.');
      if (['smpte2084', 'arib-std-b67'].includes(sourceVideo.color_transfer) || sourceVideo.side_data_list?.some(data => /DOVI/i.test(data.side_data_type ?? ''))) throw new Error('HDR 영상은 색상을 보존하는 별도 변환 설정이 필요합니다. 이번 사본 기능은 SDR 영상만 지원합니다.');
      const duration = job.preview ? Math.min(5, seconds) : seconds;
      await mkdir(outputRoot, { recursive: true });
      job.directory = await mkdtemp(join(outputRoot, 'copy-'));
      job.videoPath = join(job.directory, job.name);
      job.sidecarPath = job.videoPath + '.json';
      job.state = 'running';
      await new Promise((resolve, reject) => {
        const args = ['-hide_banner','-nostdin','-n','-protocol_whitelist','file,pipe','-i',item.path,
          '-map','0:v:0','-map','0:a?','-map_metadata','0','-c:v','libx264','-threads','2','-preset','fast','-crf','20',
          '-pix_fmt','yuv420p','-vf','scale=trunc(iw/2)*2:trunc(ih/2)*2','-c:a','aac','-b:a','192k',
          '-t',String(duration),'-movflags','+faststart+use_metadata_tags','-progress','pipe:1','-nostats',job.videoPath];
        const child = spawn('ffmpeg', args, { stdio: ['ignore','pipe','pipe'], windowsHide: true });
        let buffer = '';
        let killTimer;
        const stop = () => { child.kill('SIGTERM'); killTimer = setTimeout(() => child.kill('SIGKILL'), 3000); killTimer.unref(); };
        signal.addEventListener('abort', stop, { once: true });
        if (signal.aborted) stop();
        child.stdout.on('data', chunk => {
          buffer += chunk.toString(); const lines = buffer.split('\n'); buffer = lines.pop() ?? '';
          for (const line of lines) if (line.startsWith('out_time_us=')) job.progress = Math.min(0.98, Math.max(0, Number(line.slice(12)) / 1e6 / duration));
        });
        // Drain stderr without exposing source paths or retaining an unbounded log.
        child.stderr.resume();
        child.on('error', reject);
        child.on('close', code => { clearTimeout(killTimer); signal.removeEventListener('abort', stop); if (signal.aborted) reject(signal.reason); else if (code === 0) resolve(); else reject(new Error('영상 사본을 만들지 못했습니다. 저장 공간과 FFmpeg의 H.264 지원을 확인해 주세요.')); });
      });
      signal.throwIfAborted();
      job.state = 'verifying';
      const output = await probe(job.videoPath, signal);
      const video = output.streams.find(stream => stream.codec_type === 'video');
      if (video?.codec_name !== 'h264' || !(video.width > 0) || Math.abs(Number(output.format?.duration) - duration) > 1) throw new Error('만든 사본의 영상 형식·길이를 확인하지 못했습니다.');
      const after = await stat(item.path);
      if (after.size !== original.size || after.mtimeMs !== original.mtimeMs) throw new Error('변환 중 원본 파일이 변경되어 사본을 취소했습니다.');
      const sidecar = { title: job.name, photoTakenTime: { timestamp: String(metadata.takenMs / 1000) },
        ...(metadata.lat != null && metadata.lng != null ? { geoDataExif: { latitude: metadata.lat, longitude: metadata.lng } } : {}),
        description: job.preview ? '첫 5초 이내 H.264 확인용 사본' : '원본을 보존한 H.264 감상용 사본' };
      await writeFile(job.sidecarPath, JSON.stringify(sidecar, null, 2), { flag: 'wx' });
      await utimes(job.videoPath, original.atime, original.mtime);
      signal.throwIfAborted();
      job.state = 'complete'; job.progress = 1;
    } catch (error) {
      job.state = signal.aborted ? 'cancelled' : 'failed';
      job.error = signal.aborted ? null : (error?.code === 'ENOSPC' ? '사본을 저장할 공간이 부족합니다.' : error instanceof Error && !error.message.includes(item.path) ? error.message : '영상 정보를 읽지 못했습니다. 원본은 변경하지 않았습니다.');
      if (job.directory) await rm(job.directory, { recursive: true, force: true }).catch(() => undefined);
    }
  }
  return {
    available, start, get,
    cancel(id) { const job = jobs.get(id); if (job && !['complete','failed','cancelled'].includes(job.state)) job.controller.abort(); return get(id); },
    artifact(id, kind) { const job = jobs.get(id); return job?.state === 'complete' ? { path: kind === 'sidecar' ? job.sidecarPath : job.videoPath, name: job.name + (kind === 'sidecar' ? '.json' : '') } : null; },
    stop() { active?.controller.abort(); return active?.done ?? Promise.resolve(); }
  };
}
