import { mergeSidecarMetadata, parseTakeoutSidecar } from './media-analysis';

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
