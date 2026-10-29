import { DEFAULT_PREFERENCES } from '../settings/preferences';
import { identifyTimeline, parseProject, projectMedia, reconnectMedia, type TravelProject } from './travel-project';
import type { JourneyMedia } from '../types';

function project(): TravelProject {
  return { format: 'travel-camera-project', version: 1, name: '봄 여행', savedAt: '2026-10-02T00:00:00Z',
    timeline: { name: 'timeline.json', bytes: 100, sha256: 'a'.repeat(64) }, range: { startDate: '2026-04-10', endDate: '2026-04-11' },
    preferences: { ...DEFAULT_PREFERENCES }, durationSec: 90,
    view: { mode: 'PHOTOS', cursors: { ROUTE: 12, PHOTOS: 20 }, desktopMapShare: 0.5, mobileMapShare: 0.4 },
    media: [{ name: 'day/photo.jpg', size: 3, lastModified: 1000, excluded: true }], captureTimeZone: 'Asia/Seoul' };
}
function photo(id: string, name: string, lastModified = 1000): JourneyMedia {
  return { id, file: new File(['jpg'], name, { lastModified, type: 'image/jpeg' }), kind: 'image', title: name,
    takenMs: 1000, lat: 35, lng: 139, gpsAccuracyM: null, metadataSource: 'embedded-exif', playbackSec: 5,
    matchedLat: 35, matchedLng: 139, positionSource: 'gps', groupId: 'group', groupIndex: 0, groupCount: 1, sourceCount: 1 };
}

describe('local trip project', () => {
  it('round-trips explicit settings while dropping unknown fields and disabling online coordinates', () => {
    const original = project(); original.preferences.onlinePlaceLookup = true;
    const decoded = parseProject(JSON.stringify({ ...original, rawTimeline: { coordinates: [35,139] }, serverUrl: 'https://invalid.example' }));
    expect(decoded).toEqual({ ...original, preferences: { ...original.preferences, onlinePlaceLookup: false } });
    expect(JSON.stringify(decoded)).not.toContain('coordinates');
    expect(JSON.stringify(decoded)).not.toContain('serverUrl');
  });

  it.each([
    ['future version', (p: TravelProject) => ({ ...p, version: 2 })],
    ['impossible date', (p: TravelProject) => ({ ...p, range: { ...p.range, startDate: '2026-02-31' } })],
    ['reversed range', (p: TravelProject) => ({ ...p, range: { startDate: '2026-04-12', endDate: '2026-04-11' } })],
    ['negative position', (p: TravelProject) => ({ ...p, view: { ...p.view, cursors: { ROUTE: -1, PHOTOS: 2 } } })],
    ['invalid preference', (p: TravelProject) => ({ ...p, preferences: { ...p.preferences, zoomOffset: 999 } })],
    ['array as enum', (p: TravelProject) => ({ ...p, preferences: { ...p.preferences, cameraMode: ['AUTO'] } })],
    ['duplicate photo', (p: TravelProject) => ({ ...p, media: [p.media[0], p.media[0]] })]
  ])('rejects %s without silently defaulting settings', (_name, change) => {
    expect(() => parseProject(JSON.stringify(change(project())))).toThrow();
  });

  it('requires the same timeline contents even if the filename stays the same', async () => {
    const first = await identifyTimeline('timeline.json', '{"a":1}');
    const renamed = await identifyTimeline('renamed.json', '{"a":1}');
    const changed = await identifyTimeline('timeline.json', '{"a":2}');
    expect(first.sha256).toHaveLength(64);
    expect(renamed.sha256).toBe(first.sha256);
    expect(changed.sha256).not.toBe(first.sha256);
  });

  it('reconnects by source information when file order and runtime IDs change', () => {
    const first = photo('old-0', 'a.jpg'), second = photo('old-1', 'b.jpg');
    const references = projectMedia([first, second], null, new Set([second.id]));
    expect(JSON.stringify(references)).not.toMatch(/lat|lng|takenMs|sourceUrl/);
    const restored = reconnectMedia(references, [photo('new-0', 'b.jpg'), photo('new-1', 'a.jpg')], null);
    expect(restored.items.map(item => item.id)).toEqual(['new-1','new-0']);
    expect([...restored.excluded]).toEqual(['new-0']);
  });

  it('rejects missing, modified and ambiguous originals', () => {
    const reference = projectMedia([photo('old', 'photo.jpg')], null, new Set());
    expect(() => reconnectMedia(reference, [], null)).toThrow('1개');
    expect(() => reconnectMedia(reference, [photo('new', 'photo.jpg', 2000)], null)).toThrow('1개');
    expect(() => reconnectMedia(reference, [photo('a','photo.jpg'),photo('b','photo.jpg')], null)).toThrow('1개');
  });
});


it('restores older v1 projects using their recorded capture zone', () => {
  const old = project();
  const preferences: Record<string, unknown> = { ...old.preferences }; delete preferences.captureTimeZone;
  const parsed = parseProject(JSON.stringify({ ...old, preferences }));
  expect(parsed.version).toBe(1);
  expect(parsed.preferences.captureTimeZone).toBe('Asia/Seoul');
  expect(() => parseProject(JSON.stringify({ ...old, preferences: { ...preferences, captureTimeZone: 'Invalid/Zone' } }))).toThrow();
});
