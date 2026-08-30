import { organizeJourneyMedia, parseFilenameTimestamp, playbackSecondFor } from './media-library';
import { loadLocalMediaManifest } from './local-media-library';
import { buildPlaybackPlan } from '../domain/planner';
import { simplePlan } from '../test/fixtures';
import type { AnalysisOptions, JourneyMedia, Movement } from '../types';

describe('local media matching', () => {
  it('builds a lazy journey entry from the configured photo folder manifest', async () => {
    const plan = simplePlan();
    const result = loadLocalMediaManifest({
      available: true,
      rootName: '여행 사진',
      count: 1,
      totalBytes: 2_162_417,
      items: [{
        id: '0', name: '20260410_000500.jpg', size: 2_162_417, lastModified: Date.now(), kind: 'image',
        metadata: { takenMs: Date.parse('2026-04-10T00:05:00'), lat: null, lng: null, source: 'filename-time', embeddedScanned: true }
      }]
    }, plan);
    const resolved = await result;
    expect(resolved.all).toHaveLength(1);
    expect(resolved.all[0]).toMatchObject({ file: null, sourceUrl: '/api/local-media/0', metadataSource: 'filename-time' });
  });

  it('saves metadata for an uncached local media item', async () => {
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ saved: 1 }), { status: 200 }));
    const result = await loadLocalMediaManifest({
      available: true,
      rootName: '여행 사진',
      count: 1,
      totalBytes: 1_000,
      items: [{ id: 'video-1', name: '20260410_000500.mp4', size: 1_000, lastModified: Date.now(), kind: 'video' }]
    }, simplePlan());
    expect(result.all[0]?.metadataSource).toBe('filename-time');
    expect(request).toHaveBeenCalledWith('/api/local-media-metadata-cache', expect.objectContaining({ method: 'POST' }));
    request.mockRestore();
  });

  it('reads common camera filename timestamps', () => {
    const value = parseFilenameTimestamp('IMG_20260410_091530.jpg');
    expect(value).not.toBeNull();
    expect(new Date(value!).getFullYear()).toBe(2026);
  });

  it('rejects impossible filename dates instead of rolling them into another month', () => {
    expect(parseFilenameTimestamp('20260231_120000.jpg')).toBeNull();
  });

  it('matches capture time into a route segment', () => {
    const plan = simplePlan();
    const middle = (plan.segments[0].startMs + plan.segments[0].endMs) / 2;
    expect(playbackSecondFor(middle, null, plan)).toBeCloseTo(0.25, 4);
  });

  it('matches photos against a plan produced by the camera planner', () => {
    const movement: Movement = {
      startMs: Date.parse('2026-04-10T00:00:00Z'),
      endMs: Date.parse('2026-04-10T00:10:00Z'),
      start: { lat: 37.5, lng: 127 },
      end: { lat: 37.51, lng: 127.01 },
      points: [{ lat: 37.5, lng: 127 }, { lat: 37.51, lng: 127.01 }],
      distanceMeters: 2_000,
      durationSec: 600,
      avgSpeedKmh: 12,
      googleType: 'WALKING',
      googleProbability: 0.9,
      activityProbability: 0.9,
      inferred: false
    };
    const options: AnalysisOptions = {
      startDate: '2026-04-10', endDate: '2026-04-10', includeFlights: true,
      targetDurationSec: 90, viewportWidth: 1200, viewportHeight: 700,
      cameraMode: 'AUTO', zoomOffset: 0.3, pacingMode: 'LOCAL_DAYS'
    };
    const plan = buildPlaybackPlan([movement], options);
    const segment = plan.segments[0];
    expect(segment.startVideoSec).toBe(0);
    expect(segment.endVideoSec).toBeGreaterThan(0);
    expect(playbackSecondFor((movement.startMs + movement.endMs) / 2, null, plan)).toBeGreaterThan(0);
  });

  it('groups nearby photos and keeps three representative scenes', () => {
    const plan = simplePlan();
    const start = plan.segments[0].startMs;
    const items = Array.from({ length: 5 }, (_, index): JourneyMedia => ({
      id: `photo-${index}`,
      file: new File(['image'], `photo-${index}.jpg`, { type: 'image/jpeg' }),
      kind: 'image',
      title: `photo ${index}`,
      takenMs: start + index * 20_000,
      lat: 37.5,
      lng: 127,
      metadataSource: 'embedded-exif',
      playbackSec: index / 10,
      matchedLat: 37.5,
      matchedLng: 127,
      positionSource: 'gps',
      groupId: '',
      groupIndex: 0,
      groupCount: 1,
      sourceCount: 1
    }));

    const result = organizeJourneyMedia(items, plan);
    expect(result.map(item => item.id)).toEqual(['photo-0', 'photo-2', 'photo-4']);
    expect(result.map(item => item.groupIndex)).toEqual([0, 1, 2]);
    expect(result.every(item => item.groupCount === 3 && item.sourceCount === 5)).toBe(true);
    expect(new Set(result.map(item => item.playbackSec)).size).toBe(1);

    const all = organizeJourneyMedia(items, plan, 'ALL');
    expect(all).toHaveLength(5);
    expect(all.map(item => item.groupIndex)).toEqual([0, 1, 2, 3, 4]);
    expect(all.every(item => item.groupCount === 5 && item.sourceCount === 5)).toBe(true);
  });
});
