import { validCaptureTimeZone } from '../media/capture-time';
import { DEFAULT_PREFERENCES, normalizePreferences, type Preferences } from '../settings/preferences';
import type { JourneyMedia, LocalMediaManifest, TimelineDateRange } from '../types';

export const PROJECT_MAX_BYTES = 10 * 1024 * 1024;
export interface SourceIdentity { name: string; sha256: string; bytes: number }
export interface MediaReference { name: string; size: number; lastModified: number; excluded: boolean }
export interface TravelProject {
  format: 'travel-camera-project';
  version: 1;
  name: string;
  savedAt: string;
  timeline: SourceIdentity;
  range: TimelineDateRange;
  preferences: Preferences;
  durationSec: number;
  view: { mode: 'ROUTE' | 'PHOTOS'; cursors: { ROUTE: number; PHOTOS: number }; desktopMapShare: number; mobileMapShare: number };
  media: MediaReference[];
  captureTimeZone: string;
}

const fail = (message: string): never => { throw new Error(message); };
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('프로젝트 파일의 구성이 올바르지 않습니다.');
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 255): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || [...value].some(character => character.charCodeAt(0) < 32)) return fail('프로젝트 이름 또는 파일 정보가 올바르지 않습니다.');
  return value;
}
function number(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) return fail('프로젝트의 재생 위치 또는 숫자 설정이 올바르지 않습니다.');
  return value;
}
function date(value: unknown): string {
  const result = text(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(Date.parse(result)) || new Date(`${result}T00:00:00Z`).toISOString().slice(0, 10) !== result) return fail('여행 날짜가 올바르지 않습니다.');
  return result;
}

export function parseProject(contents: string): TravelProject {
  if (new TextEncoder().encode(contents).byteLength > PROJECT_MAX_BYTES) return fail('프로젝트 파일은 10 MB 이하여야 합니다.');
  let raw: unknown;
  try { raw = JSON.parse(contents); } catch { return fail('프로젝트 JSON을 읽을 수 없습니다. 기존 여행은 유지됩니다.'); }
  const value = record(raw);
  if (value.format !== 'travel-camera-project' || value.version !== 1) return fail('지원하는 Travel Camera 프로젝트(v1) 파일을 선택해 주세요.');
  const source = record(value.timeline), range = record(value.range), view = record(value.view), cursors = record(view.cursors);
  const prefs = record(value.preferences), preferences = normalizePreferences(prefs);
  for (const key of Object.keys(DEFAULT_PREFERENCES) as Array<keyof Preferences>) {
    if ((key === 'captureTimeZone' || key === 'showBottomScene') && prefs[key] === undefined) continue;
    if (prefs[key] !== preferences[key]) return fail('프로젝트의 감상 설정이 올바르지 않습니다.');
  }
  // Importing a file must never silently enable transmission of photo coordinates.
  preferences.onlinePlaceLookup = false;
  // v1 files predating the setting already recorded the originating browser zone.
  if (prefs.captureTimeZone === undefined) {
    if (!validCaptureTimeZone(value.captureTimeZone)) return fail('저장한 촬영 시간대를 확인할 수 없습니다.');
    preferences.captureTimeZone = value.captureTimeZone;
  }
  if (typeof source.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(source.sha256)) return fail('타임라인 확인 정보가 올바르지 않습니다.');
  const startDate = date(range.startDate), endDate = date(range.endDate);
  if (startDate > endDate) return fail('여행 시작일이 마지막 날보다 늦습니다.');
  if (view.mode !== 'ROUTE' && view.mode !== 'PHOTOS') return fail('프로젝트의 감상 모드가 올바르지 않습니다.');
  if (!Array.isArray(value.media) || value.media.length > 20_000) return fail('프로젝트 사진 목록은 20,000개 이하여야 합니다.');
  const media = value.media.map(rawItem => {
    const item = record(rawItem);
    if (typeof item.excluded !== 'boolean') return fail('사진 제외 정보가 올바르지 않습니다.');
    return { name: text(item.name, 1024), size: number(item.size, 0, Number.MAX_SAFE_INTEGER), lastModified: number(item.lastModified, 0, 8.64e15), excluded: item.excluded };
  });
  if (new Set(media.map(mediaKey)).size !== media.length) return fail('프로젝트에 중복된 사진 정보가 있습니다.');
  const savedAt = text(value.savedAt, 40);
  if (!Number.isFinite(Date.parse(savedAt))) return fail('프로젝트 저장 시각이 올바르지 않습니다.');
  return {
    format: 'travel-camera-project', version: 1, name: text(value.name, 100), savedAt,
    timeline: { name: text(source.name), sha256: source.sha256, bytes: number(source.bytes, 0, 250 * 1024 * 1024) },
    range: { startDate, endDate }, preferences, durationSec: number(value.durationSec, 1, 86400),
    view: { mode: view.mode, cursors: { ROUTE: number(cursors.ROUTE, 0, 7 * 86400), PHOTOS: number(cursors.PHOTOS, 0, 7 * 86400) }, desktopMapShare: number(view.desktopMapShare, 0.38, 0.78), mobileMapShare: number(view.mobileMapShare, 0.34, 0.72) },
    media, captureTimeZone: text(value.captureTimeZone, 100)
  };
}

export async function identifyTimeline(name: string, contents: string): Promise<SourceIdentity> {
  const data = new TextEncoder().encode(contents);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return { name, bytes: data.byteLength, sha256: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('') };
}

export function mediaKey(item: Omit<MediaReference, 'excluded'>): string {
  return JSON.stringify([item.name, item.size, Math.trunc(item.lastModified)]);
}
export function referenceFor(item: JourneyMedia, manifest: LocalMediaManifest | null): Omit<MediaReference, 'excluded'> {
  if (item.file) {
    const path = item.file.webkitRelativePath;
    return { name: path ? path.slice(path.indexOf('/') + 1) : item.file.name, size: item.file.size, lastModified: Math.trunc(item.file.lastModified) };
  }
  const local = manifest?.items.find(candidate => `local-${candidate.id}` === item.id);
  if (!local) return fail('연결된 사진의 원본 정보를 확인할 수 없습니다. 사진을 다시 연결해 주세요.');
  return { name: local.name, size: local.size, lastModified: Math.trunc(local.lastModified) };
}
export function projectMedia(items: JourneyMedia[], manifest: LocalMediaManifest | null, excluded: Set<string>): MediaReference[] {
  return items.map(item => ({ ...referenceFor(item, manifest), excluded: excluded.has(item.id) }));
}

export function reconnectMedia(references: MediaReference[], items: JourneyMedia[], manifest: LocalMediaManifest | null): { items: JourneyMedia[]; excluded: Set<string> } {
  const index = items.map(item => ({ item, reference: referenceFor(item, manifest) }));
  const selected: JourneyMedia[] = [], excluded = new Set<string>(), missing: string[] = [];
  for (const reference of references) {
    let matches = index.filter(candidate => mediaKey(candidate.reference) === mediaKey(reference));
    // Selecting individual files loses their directory prefix. Only accept a unique match.
    if (!matches.length) matches = index.filter(candidate => candidate.reference.name.split('/').at(-1) === reference.name.split('/').at(-1) && candidate.reference.size === reference.size && Math.trunc(candidate.reference.lastModified) === Math.trunc(reference.lastModified));
    if (matches.length !== 1 || selected.some(item => item.id === matches[0].item.id)) { missing.push(reference.name); continue; }
    selected.push(matches[0].item);
    if (reference.excluded) excluded.add(matches[0].item.id);
  }
  if (missing.length) return fail(`원본 사진·영상 ${missing.length}개를 확인하지 못했습니다. 파일명·크기·수정 시각과 여행 기간을 확인하고 원래 폴더를 다시 선택해 주세요. 예: ${missing.slice(0, 3).join(', ')}`);
  return { items: selected, excluded };
}
