import { haversineMeters } from '../geo.js';
import { analyzeMediaFiles } from './media-analysis';
export { parseFilenameTimestamp, readEmbeddedMetadata } from './media-metadata';
import type { MediaMetadataRecord, JourneyMedia, MediaImportProgress, PhotoViewMode, PlaybackPlan, PlaybackSegment, TravelFrame } from '../types';

const analyzedFileSets = new WeakMap<object, Promise<MediaMetadataRecord[]>>();

export interface JourneyMediaLibrary {
  preview: JourneyMedia[];
  all: JourneyMedia[];
}

export async function loadJourneyMedia(
  files: FileList | File[],
  plan: PlaybackPlan,
  onProgress?: (progress: MediaImportProgress) => void
): Promise<JourneyMediaLibrary> {
  const allFiles = Array.from(files);
  let analysis = analyzedFileSets.get(files);
  if (!analysis) {
    analysis = analyzeMediaFiles(allFiles, onProgress);
    analyzedFileSets.set(files, analysis);
    void analysis.catch(() => analyzedFileSets.delete(files));
  }
  const records = await analysis;
  onProgress?.({ phase: 'MATCH', processed: 0, total: records.length, message: '촬영 정보와 Timeline을 연결하고 있습니다.' });
  const mapped = records.map(record => {
    const file = allFiles[record.fileIndex];
    const position = record.lat != null && record.lng != null ? { lat: record.lat, lng: record.lng } : null;
    const playbackSec = playbackSecondFor(record.takenMs, position, plan);
    const matched = position ?? positionAtPlaybackSecond(playbackSec, plan);
    return {
      id: `${file.name}-${file.size}-${file.lastModified}-${record.fileIndex}`,
      file,
      kind: isVideo(file) ? 'video' as const : 'image' as const,
      title: record.title || cleanTitle(file.name),
      takenMs: record.takenMs,
      lat: record.lat,
      lng: record.lng,
      gpsAccuracyM: record.gpsAccuracyM,
      metadataSource: record.source,
      playbackSec,
      matchedLat: matched.lat,
      matchedLng: matched.lng,
      positionSource: position ? 'gps' as const : 'timeline' as const,
      groupId: '', groupIndex: 0, groupCount: 1, sourceCount: 1
    };
  });
  onProgress?.({ phase: 'BUILD', processed: mapped.length, total: mapped.length, message: '사진 장면을 구성하고 있습니다.' });
  const all = organizeJourneyMedia(mapped, plan, 'ALL');
  const preview = organizeJourneyMedia(mapped, plan, 'PREVIEW');
  onProgress?.({ phase: 'COMPLETE', processed: all.length, total: all.length, message: `${all.length}개의 미디어를 경로에 연결했습니다.` });
  return { preview, all };
}

export function organizeJourneyMedia(items: JourneyMedia[], plan: PlaybackPlan, mode: PhotoViewMode = 'PREVIEW'): JourneyMedia[] {
  const startMs = plan.selectedRange ? Date.parse(`${plan.selectedRange.startDate}T00:00:00+09:00`) : (plan.segments[0]?.startMs ?? -Infinity) - 12 * 60 * 60_000;
  const endMs = plan.selectedRange ? Date.parse(`${plan.selectedRange.endDate}T23:59:59.999+09:00`) : (plan.segments.at(-1)?.endMs ?? Infinity) + 12 * 60 * 60_000;
  const relevant = items.filter(item => item.takenMs >= startMs && item.takenMs <= endMs)
    .sort((a, b) => a.takenMs - b.takenMs);
  const groups: JourneyMedia[][] = [];
  for (const item of relevant) {
    const group = groups.at(-1);
    const previous = group?.at(-1);
    const closeInTime = previous && item.takenMs - previous.takenMs <= 2 * 60_000;
    const closeInSpace = previous && haversineMeters(
      { lat: previous.matchedLat, lng: previous.matchedLng },
      { lat: item.matchedLat, lng: item.matchedLng }
    ) <= 2_500;
    if (!group || !closeInTime || !closeInSpace) groups.push([item]);
    else group.push(item);
  }

  const maxGroups = Math.max(6, Math.min(48, Math.floor(Math.max(1, plan.travelDurationSec) / 2.25)));
  const selectedGroups = mode === 'ALL' || groups.length <= maxGroups
    ? groups
    : Array.from({ length: maxGroups }, (_, index) => groups[Math.round(index * (groups.length - 1) / Math.max(1, maxGroups - 1))]);
  return selectedGroups.flatMap((group, groupIndex) => {
    const selected = mode === 'ALL' ? group : representativeItems(group, 3);
    const atSec = median(group.map(item => item.playbackSec));
    return selected.map((item, itemIndex) => ({
      ...item,
      playbackSec: atSec,
      groupId: `media-group-${groupIndex}`,
      groupIndex: itemIndex,
      groupCount: selected.length,
      sourceCount: group.length
    }));
  });
}

export function playbackSecondFor(
  takenMs: number,
  position: { lat: number; lng: number } | null,
  plan: PlaybackPlan
): number {
  const segments = plan.segments;
  if (!segments.length) return 0;
  const first = segments[0];
  const last = segments.at(-1)!;
  if (Number.isFinite(takenMs) && takenMs >= first.startMs - 12 * 60 * 60_000 && takenMs <= last.endMs + 12 * 60 * 60_000) {
    return secondFromTimeline(takenMs, segments);
  }
  if (position) return secondFromPosition(position, plan);
  return secondFromTimeline(takenMs, segments);
}

function secondFromTimeline(takenMs: number, segments: PlaybackSegment[]): number {
  let closest = segments[0];
  let distance = Infinity;
  for (const segment of segments) {
    if (takenMs >= segment.startMs && takenMs <= segment.endMs) {
      const progress = (takenMs - segment.startMs) / Math.max(1, segment.endMs - segment.startMs);
      return finiteSecond(segment.startVideoSec) + progress * finiteSecond(segment.videoSec);
    }
    const nextDistance = Math.min(Math.abs(takenMs - segment.startMs), Math.abs(takenMs - segment.endMs));
    if (nextDistance < distance) { distance = nextDistance; closest = segment; }
  }
  return takenMs < closest.startMs ? finiteSecond(closest.startVideoSec) : finiteSecond(closest.endVideoSec);
}

function secondFromPosition(position: { lat: number; lng: number }, plan: PlaybackPlan): number {
  let best: TravelFrame | null = null;
  let distance = Infinity;
  const step = Math.max(1, Math.round(plan.fps / 2));
  for (let index = 0; index < plan.frames.length; index += step) {
    const frame = plan.frames[index];
    if (frame.kind !== 'TRAVEL') continue;
    const nextDistance = haversineMeters(position, frame.position);
    if (nextDistance < distance) { distance = nextDistance; best = frame; }
  }
  return best?.timeSec ?? 0;
}

export function positionAtPlaybackSecond(seconds: number, plan: PlaybackPlan): { lat: number; lng: number } {
  const fallback = plan.segments[0]?.start ?? { lat: 0, lng: 0 };
  const safeSeconds = finiteSecond(seconds);
  const safeFps = Math.max(1, finiteSecond(plan.fps) || 60);
  const index = Math.max(0, Math.min(plan.frames.length - 1, Math.round(safeSeconds * safeFps)));
  const candidate = plan.frames[index];
  if (candidate?.kind === 'TRAVEL') return { ...candidate.position };

  // At the exact end of travel, rounding can land on the first OUTRO frame.
  // Use the nearest preceding route frame so a GPS-less end-of-trip photo is
  // matched to the destination rather than falling back to the trip origin.
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const frame = plan.frames[cursor];
    if (frame.kind === 'TRAVEL') return { ...frame.position };
  }
  const first = plan.frames.find((frame): frame is TravelFrame => frame.kind === 'TRAVEL');
  return { ...(first?.position ?? fallback) };
}

function finiteSecond(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function representativeItems(group: JourneyMedia[], max: number): JourneyMedia[] {
  if (group.length <= max) return group;
  return Array.from({ length: max }, (_, index) => group[Math.round(index * (group.length - 1) / Math.max(1, max - 1))]);
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function isVideo(file: File): boolean { return file.type.startsWith('video/') || /\.(mp4|m4v|mov|webm)$/i.test(file.name); }
function cleanTitle(name: string): string { return name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || '여행 미디어'; }
