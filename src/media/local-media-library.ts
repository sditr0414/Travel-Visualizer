import type { JourneyMedia, LocalMediaManifest, LocalMediaManifestItem, MediaImportProgress, MediaMetadataSource, PlaybackPlan } from '../types';
import { organizeJourneyMedia, parseFilenameTimestamp, playbackSecondFor, positionAtPlaybackSecond, type JourneyMediaLibrary } from './media-library';
import { readEmbeddedMetadata } from './media-metadata';

interface CachedMetadataUpdate {
  id: string;
  takenMs: number;
  lat: number | null;
  lng: number | null;
  source: MediaMetadataSource;
  embeddedScanned: boolean;
}
type AnalyzedMetadata = Omit<CachedMetadataUpdate, 'id'>;
const LOCAL_EXIF_FAST_BYTES = 128 * 1024;
const LOCAL_EXIF_MAX_BYTES = 256 * 1024;

export async function loadLocalMediaManifest(
  manifest: LocalMediaManifest,
  plan: PlaybackPlan,
  onProgress?: (progress: MediaImportProgress) => void
): Promise<JourneyMediaLibrary> {
  const mapped: JourneyMedia[] = [];
  const updates: CachedMetadataUpdate[] = [];
  const concurrency = 8;
  for (let offset = 0; offset < manifest.items.length; offset += concurrency) {
    const batch = manifest.items.slice(offset, offset + concurrency);
    const analyzed = await Promise.all(batch.map(analyzeLocalItem));
    for (const { item, metadata, shouldCache } of analyzed) {
      if (!Number.isFinite(metadata.takenMs)) continue;
      const position = metadata.lat != null && metadata.lng != null ? { lat: metadata.lat, lng: metadata.lng } : null;
      const playbackSec = playbackSecondFor(metadata.takenMs, position, plan);
      const matched = position ?? positionAtPlaybackSecond(playbackSec, plan);
      mapped.push({
      id: `local-${item.id}`,
      file: null,
      sourceUrl: `/api/local-media/${encodeURIComponent(item.id)}`,
      kind: item.kind,
      title: cleanTitle(item.name),
      takenMs: metadata.takenMs,
      lat: metadata.lat,
      lng: metadata.lng,
      metadataSource: metadata.source,
      playbackSec,
      matchedLat: matched.lat,
      matchedLng: matched.lng,
      positionSource: position ? 'gps' : 'timeline',
      groupId: '',
      groupIndex: 0,
      groupCount: 1,
      sourceCount: 1
      });
      if (shouldCache) updates.push({ id: item.id, ...metadata });
    }
    const processed = Math.min(offset + batch.length, manifest.items.length);
    onProgress?.({ phase: 'METADATA', processed, total: manifest.items.length, message: `${processed} / ${manifest.items.length} 촬영 정보 확인` });
  }
  if (updates.length) await saveMetadataCache(updates);
  return {
    preview: organizeJourneyMedia(mapped, plan, 'PREVIEW'),
    all: organizeJourneyMedia(mapped, plan, 'ALL')
  };
}

async function analyzeLocalItem(item: LocalMediaManifestItem): Promise<{
  item: LocalMediaManifestItem;
  metadata: AnalyzedMetadata;
  shouldCache: boolean;
}> {
  const cached = item.metadata;
  const shouldReadJpeg = item.kind === 'image' && /\.jpe?g$/i.test(item.name)
    && (!cached || (!cached.embeddedScanned && cached.lat == null));
  if (cached && !shouldReadJpeg) {
    return { item, metadata: { ...cached, embeddedScanned: cached.embeddedScanned ?? true }, shouldCache: false };
  }
  let embedded = null;
  if (shouldReadJpeg) {
    embedded = await fetchEmbeddedMetadata(item, LOCAL_EXIF_FAST_BYTES);
    if (!embedded && item.size > LOCAL_EXIF_FAST_BYTES) embedded = await fetchEmbeddedMetadata(item, LOCAL_EXIF_MAX_BYTES);
  }
  const filenameTime = parseFilenameTimestamp(item.name);
  return {
    item,
    metadata: {
      takenMs: cached?.takenMs ?? embedded?.takenMs ?? filenameTime ?? item.lastModified,
      lat: cached?.lat ?? embedded?.lat ?? null,
      lng: cached?.lng ?? embedded?.lng ?? null,
      source: cached?.source ?? (embedded ? 'embedded-exif' : filenameTime == null ? 'file-time' : 'filename-time'),
      embeddedScanned: shouldReadJpeg || cached?.embeddedScanned === true
    },
    shouldCache: true
  };
}

async function fetchEmbeddedMetadata(item: LocalMediaManifestItem, bytes: number) {
  try {
    const response = await fetch(`/api/local-media/${encodeURIComponent(item.id)}`, { headers: { Range: `bytes=0-${bytes - 1}` } });
    if (!response.ok) return null;
    const blob = await response.blob();
    return readEmbeddedMetadata(new File([blob], item.name, { type: 'image/jpeg', lastModified: item.lastModified }));
  } catch {
    return null;
  }
}

async function saveMetadataCache(entries: CachedMetadataUpdate[]): Promise<void> {
  try {
    await fetch('/api/local-media-metadata-cache', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries })
    });
  } catch {
    // Cache writes are an optimization; the journey remains usable without them.
  }
}

function cleanTitle(name: string): string {
  return name.replace(/^.*\//, '').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || '여행 미디어';
}
