import { mergeSidecarMetadata, parseTakeoutSidecar } from './media-analysis';
import { parseQuickTimeMetadataChunks } from './media-metadata';

describe('local Takeout metadata', () => {
  it('reads capture time and GPS from a local sidecar', () => {
    const parsed = parseTakeoutSidecar({
      title: 'IMG_20260410_091530.jpg',
      photoTakenTime: { timestamp: '1775780130' },
      geoDataExif: { latitude: 37.5665, longitude: 126.978 }
    });

    expect(parsed).toEqual({
      title: 'IMG_20260410_091530.jpg',
      takenMs: 1_775_780_130_000,
      lat: 37.5665,
      lng: 126.978
    });
  });

  it('ignores unrelated or invalid JSON', () => {
    expect(parseTakeoutSidecar({ title: 'missing-time.jpg' })).toBeNull();
    expect(parseTakeoutSidecar(null)).toBeNull();
  });

  it('keeps EXIF GPS when a preferred sidecar only contains capture time', () => {
    const merged = mergeSidecarMetadata({
      fileIndex: 0,
      title: 'photo.jpg',
      takenMs: 100,
      lat: 37.5,
      lng: 127,
      source: 'embedded-exif'
    }, {
      title: 'photo.jpg',
      takenMs: 200,
      lat: null,
      lng: null
    });
    expect(merged).toMatchObject({ takenMs: 200, lat: 37.5, lng: 127, source: 'takeout-sidecar' });
  });
});

describe('QuickTime metadata', () => {
  it('reads Apple creation date and ISO 6709 GPS from bounded metadata chunks', () => {
    const bytes = Uint8Array.from(new TextEncoder().encode([
      'com.apple.quicktime.creationdate',
      '2026-04-10T09:15:30+09:00',
      'com.apple.quicktime.location.ISO6709',
      '+37.5665+126.9780+000.000/'
    ].join('\0')));

    expect(parseQuickTimeMetadataChunks([bytes.buffer])).toEqual({
      takenMs: Date.parse('2026-04-10T09:15:30+09:00'),
      lat: 37.5665,
      lng: 126.978
    });
  });

  it('falls back to the mvhd creation timestamp when text metadata is absent', () => {
    const bytes = new Uint8Array(32);
    const view = new DataView(bytes.buffer);
    const expected = Date.parse('2026-04-10T00:15:30Z');
    const seconds = Math.floor((expected - Date.UTC(1904, 0, 1)) / 1000);
    view.setUint32(0, 24, false);
    bytes.set([0x6d, 0x76, 0x68, 0x64], 4);
    view.setUint8(8, 0);
    view.setUint32(12, seconds, false);

    expect(parseQuickTimeMetadataChunks([bytes.buffer])).toEqual({
      takenMs: expected,
      lat: null,
      lng: null
    });
  });
});
