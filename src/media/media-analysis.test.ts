import { parseTakeoutSidecar } from './media-analysis';

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
});
