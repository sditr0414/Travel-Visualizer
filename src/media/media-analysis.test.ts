import { mergeSidecarMetadata, parseTakeoutSidecar } from './media-analysis';
import { parseJpegExif, parseQuickTimeMetadataChunks } from './media-metadata';

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
      lng: 126.978,
      gpsAccuracyM: null
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
      gpsAccuracyM: 9,
      source: 'embedded-exif'
    }, {
      title: 'photo.jpg',
      takenMs: 200,
      lat: null,
      lng: null,
      gpsAccuracyM: null
    });
    expect(merged).toMatchObject({ takenMs: 200, lat: 37.5, lng: 127, gpsAccuracyM: 9, source: 'takeout-sidecar' });
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
      lng: 126.978,
      gpsAccuracyM: null
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
      lng: null,
      gpsAccuracyM: null
    });
  });
});

describe('JPEG GPS accuracy metadata', () => {
  it('reads GPSHPositioningError as horizontal meters', () => {
    const tiff = new Uint8Array(148);
    const view = new DataView(tiff.buffer);
    tiff.set([0x49, 0x49], 0);
    view.setUint16(2, 0x2a, true);
    view.setUint32(4, 8, true);

    view.setUint16(8, 1, true);
    view.setUint16(10, 0x8825, true);
    view.setUint16(12, 4, true);
    view.setUint32(14, 1, true);
    view.setUint32(18, 26, true);
    view.setUint32(22, 0, true);

    const gps = 26;
    view.setUint16(gps, 5, true);
    const entry = (index: number, tag: number, type: number, count: number, value: number) => {
      const start = gps + 2 + index * 12;
      view.setUint16(start, tag, true);
      view.setUint16(start + 2, type, true);
      view.setUint32(start + 4, count, true);
      view.setUint32(start + 8, value, true);
    };
    entry(0, 1, 2, 2, 0x4e);
    entry(1, 2, 5, 3, 92);
    entry(2, 3, 2, 2, 0x45);
    entry(3, 4, 5, 3, 116);
    entry(4, 0x001f, 5, 1, 140);
    view.setUint32(gps + 62, 0, true);

    const rational = (offset: number, numerator: number, denominator = 1) => {
      view.setUint32(offset, numerator, true);
      view.setUint32(offset + 4, denominator, true);
    };
    rational(92, 37); rational(100, 30); rational(108, 0);
    rational(116, 127); rational(124, 0); rational(132, 0);
    rational(140, 8);

    const payload = new Uint8Array(6 + tiff.length);
    payload.set([0x45, 0x78, 0x69, 0x66, 0, 0], 0);
    payload.set(tiff, 6);
    const jpeg = new Uint8Array(2 + 4 + payload.length + 2);
    jpeg.set([0xff, 0xd8, 0xff, 0xe1], 0);
    new DataView(jpeg.buffer).setUint16(4, payload.length + 2, false);
    jpeg.set(payload, 6);
    jpeg.set([0xff, 0xd9], jpeg.length - 2);

    expect(parseJpegExif(jpeg.buffer)).toEqual({
      takenMs: null,
      lat: 37.5,
      lng: 127,
      gpsAccuracyM: 8
    });
  });
});
