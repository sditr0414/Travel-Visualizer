import { parseFilenameTimestamp, readEmbeddedMetadata } from './media-metadata';
import type { MediaImportProgress, MediaMetadataRecord, MediaMetadataSource } from '../types';

const MEDIA_PATTERN = /\.(?:jpe?g|png|webp|gif|avif|heic|heif|mp4|m4v|mov|webm)$/i;
const SIDECAR_PATTERN = /(?:\.supplemental-metadata)?\.json$/i;

export async function analyzeMediaFiles(
  files: File[],
  onProgress?: (progress: MediaImportProgress) => void
): Promise<MediaMetadataRecord[]> {
  const mediaCount = files.filter(isMediaFile).length;
  onProgress?.({ phase: 'PREPARE', processed: files.length, total: files.length, message: `${mediaCount.toLocaleString()}개의 사진·영상을 확인했습니다.` });
  if (!mediaCount) return [];

  if (typeof Worker === 'function') {
    try {
      return await analyzeInWorker(files, onProgress);
    } catch {
      // File/Worker support varies by browser. The same bounded parser is used as a fallback.
    }
  }
  return analyzeMediaFilesInline(files, onProgress);
}

export async function analyzeMediaFilesInline(
  files: File[],
  onProgress?: (progress: MediaImportProgress) => void
): Promise<MediaMetadataRecord[]> {
  const mediaEntries = files.map((file, fileIndex) => ({ file, fileIndex })).filter(entry => isMediaFile(entry.file));
  const sidecars = files.filter(file => SIDECAR_PATTERN.test(file.name) && file.size <= 3_000_000);
  const records: MediaMetadataRecord[] = [];

  for (let index = 0; index < mediaEntries.length; index += 1) {
    const { file, fileIndex } = mediaEntries[index];
    const embedded = await readEmbeddedMetadata(file);
    const filenameTime = parseFilenameTimestamp(file.name);
    const source: MediaMetadataSource = embedded?.takenMs != null ? 'embedded-exif' : filenameTime != null ? 'filename-time' : 'file-time';
    records.push({
      fileIndex,
      takenMs: embedded?.takenMs ?? filenameTime ?? Number(file.lastModified),
      lat: embedded?.lat ?? null,
      lng: embedded?.lng ?? null,
      gpsAccuracyM: embedded?.gpsAccuracyM ?? null,
      source,
      title: cleanTitle(file.name)
    });
    if (index % 6 === 0 || index === mediaEntries.length - 1) {
      onProgress?.({ phase: 'METADATA', processed: index + 1, total: mediaEntries.length, message: `${index + 1} / ${mediaEntries.length} 촬영 정보 분석` });
      await yieldToBrowser();
    }
  }

  const recordByFile = new Map(records.map(record => [files[record.fileIndex], record]));
  const mediaIndex = buildMediaIndex(mediaEntries.map(entry => entry.file));
  for (let index = 0; index < sidecars.length; index += 1) {
    const sidecar = sidecars[index];
    try {
      const parsed = parseTakeoutSidecar(JSON.parse(await sidecar.text()), sidecar.name);
      if (parsed) {
        const mediaFile = findMatchingMedia(sidecar, parsed.title, mediaIndex);
        const record = mediaFile ? recordByFile.get(mediaFile) : null;
        if (record) Object.assign(record, mergeSidecarMetadata(record, parsed));
      }
    } catch {
      // Invalid or unrelated JSON files are intentionally ignored.
    }
    if (index % 20 === 0 || index === sidecars.length - 1) {
      onProgress?.({ phase: 'SIDECAR', processed: index + 1, total: Math.max(1, sidecars.length), message: `${index + 1} / ${sidecars.length} 보조 촬영 정보 확인` });
      await yieldToBrowser();
    }
  }
  return records.filter(record => Number.isFinite(record.takenMs) && record.takenMs > Date.UTC(2000, 0, 1));
}

export function parseTakeoutSidecar(data: unknown, sidecarName = ''): { title: string; takenMs: number; lat: number | null; lng: number | null; gpsAccuracyM: number | null } | null {
  if (!data || typeof data !== 'object') return null;
  const value = data as Record<string, unknown>;
  const photoTakenTime = value.photoTakenTime as Record<string, unknown> | undefined;
  const creationTime = value.creationTime as Record<string, unknown> | string | undefined;
  const timestamp = photoTakenTime?.timestamp ?? (typeof creationTime === 'object' ? creationTime?.timestamp : creationTime);
  const takenMs = parseTimestamp(timestamp);
  if (!Number.isFinite(takenMs)) return null;
  const gps = validGps(value.geoDataExif) ?? validGps(value.geoData);
  return {
    title: String(value.title || stripSidecarName(sidecarName) || '여행 미디어'),
    takenMs,
    lat: gps?.lat ?? null,
    lng: gps?.lng ?? null,
    gpsAccuracyM: null
  };
}

export function mergeSidecarMetadata(
  record: MediaMetadataRecord,
  sidecar: { title: string; takenMs: number; lat: number | null; lng: number | null; gpsAccuracyM: number | null }
): MediaMetadataRecord {
  return {
    ...record,
    ...sidecar,
    lat: sidecar.lat ?? record.lat,
    lng: sidecar.lng ?? record.lng,
    gpsAccuracyM: sidecar.gpsAccuracyM ?? record.gpsAccuracyM,
    source: 'takeout-sidecar'
  };
}

function analyzeInWorker(files: File[], onProgress?: (progress: MediaImportProgress) => void): Promise<MediaMetadataRecord[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./media.worker.ts', import.meta.url), { type: 'module' });
    const cleanup = () => worker.terminate();
    worker.addEventListener('message', event => {
      const message = event.data as { type: 'PROGRESS'; progress: MediaImportProgress } | { type: 'RESULT'; records: MediaMetadataRecord[] } | { type: 'ERROR'; message: string };
      if (message.type === 'PROGRESS') return onProgress?.(message.progress);
      cleanup();
      if (message.type === 'ERROR') reject(new Error(message.message));
      else resolve(message.records);
    });
    worker.addEventListener('error', event => { cleanup(); reject(event.error || new Error('사진 분석을 시작하지 못했습니다. 새로고침한 뒤 다시 시도해 주세요.')); }, { once: true });
    worker.postMessage({ files });
  });
}

function buildMediaIndex(files: File[]) {
  const byPath = new Map<string, File>();
  const byName = new Map<string, File[]>();
  for (const file of files) {
    const path = normalizePath(file.webkitRelativePath || file.name).toLowerCase();
    byPath.set(path, file);
    const name = file.name.toLowerCase();
    byName.set(name, [...(byName.get(name) || []), file]);
  }
  return { byPath, byName };
}

function findMatchingMedia(sidecar: File, title: string, index: ReturnType<typeof buildMediaIndex>): File | null {
  const relative = normalizePath(sidecar.webkitRelativePath || sidecar.name);
  const slash = relative.lastIndexOf('/');
  const directory = slash >= 0 ? relative.slice(0, slash + 1) : '';
  const candidates = [title, stripSidecarName(sidecar.name)].filter(Boolean);
  for (const name of candidates) {
    const exact = index.byPath.get(`${directory}${name}`.toLowerCase());
    if (exact) return exact;
  }
  for (const name of candidates) {
    const matches = index.byName.get(name.toLowerCase());
    if (matches?.length === 1) return matches[0];
    const sameDirectory = matches?.find(file => normalizePath(file.webkitRelativePath || file.name).startsWith(directory));
    if (sameDirectory) return sameDirectory;
  }
  return null;
}

function validGps(value: unknown): { lat: number; lng: number } | null {
  if (!value || typeof value !== 'object') return null;
  const gps = value as Record<string, unknown>;
  const lat = Number(gps.latitude);
  const lng = Number(gps.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (Math.abs(lat) > 1e-7 || Math.abs(lng) > 1e-7) ? { lat, lng } : null;
}

function parseTimestamp(value: unknown): number {
  if (value == null || value === '') return NaN;
  if (/^\d+(?:\.\d+)?$/.test(String(value))) {
    const numeric = Number(value);
    return numeric > 10_000_000_000 ? numeric : numeric * 1000;
  }
  return Date.parse(String(value));
}

function isMediaFile(file: File): boolean { return /^(image|video)\//i.test(file.type) || MEDIA_PATTERN.test(file.name); }
function stripSidecarName(name: string): string { return name.replace(SIDECAR_PATTERN, ''); }
function normalizePath(value: string): string { return value.replace(/\\/g, '/').replace(/^\.\//, ''); }
function cleanTitle(name: string): string { return name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || '여행 미디어'; }
function yieldToBrowser(): Promise<void> { return new Promise(resolve => typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => resolve()) : setTimeout(resolve, 0)); }
