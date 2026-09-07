import { describe, expect, it } from 'vitest';
import type { CityLabelMap } from './city-label';
import { resolvePhotoPlaceLabel } from './photo-place-label';

interface FeatureFixture {
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: Record<string, unknown>;
  sourceLayer?: string;
}

describe('resolvePhotoPlaceLabel', () => {
  it('falls back to the city instead of showing eup or myeon township labels', () => {
    const map = placeMap([
      point(126.452, 37.495, { place: 'town', 'name:ko': '북도면', name: 'Bukdo' }),
      point(126.621, 37.473, { place: 'suburb', name: '중구' }),
      point(126.705, 37.456, { place: 'city', name: '인천광역시' })
    ]);

    expect(resolvePhotoPlaceLabel(map, { lat: 37.46, lng: 126.44 })).toBe('인천광역시');
  });

  it('uses a district only when its label is close enough to the photo coordinate', () => {
    const map = placeMap([
      point(126.621, 37.473, { place: 'suburb', name: '중구' }),
      point(126.705, 37.456, { place: 'city', name: '인천광역시' }),
      point(126.63, 37.48, { place: 'town', name: '고촌읍' })
    ]);

    expect(resolvePhotoPlaceLabel(map, { lat: 37.475, lng: 126.62 })).toBe('인천광역시 중구');
  });

  it('uses city and ward-level labels in Japan while rejecting cho and mura', () => {
    const map = placeMap([
      point(130.873, 33.885, { place: 'city', name: '北九州市' }),
      point(130.961, 33.947, { place: 'suburb', name: '門司区' }),
      point(130.955, 33.944, { place: 'suburb', name: '港町' }),
      point(130.957, 33.946, { place: 'village', name: '旧門司村' })
    ]);

    expect(resolvePhotoPlaceLabel(map, { lat: 33.945, lng: 130.96 })).toBe('北九州市 門司区');
  });

  it('falls back to a city label instead of exposing raw coordinates', () => {
    const map = placeMap([
      point(-0.127, 51.507, { place: 'city', name: 'London' }),
      point(-0.11, 51.51, { place: 'neighbourhood', name: 'Temple' })
    ]);

    expect(resolvePhotoPlaceLabel(map, { lat: 51.508, lng: -0.12 })).toBe('London');
  });

  it('prefers Korean, then the local native name, before an English fallback', () => {
    const korean = placeMap([
      point(2.3522, 48.8566, { place: 'city', 'name:ko': '파리', name: 'Paris', 'name:en': 'Paris' })
    ]);
    expect(resolvePhotoPlaceLabel(korean, { lat: 48.8566, lng: 2.3522 })).toBe('파리');

    const native = placeMap([
      point(139.6917, 35.6895, { place: 'city', name: '東京都', 'name:en': 'Tokyo' })
    ]);
    expect(resolvePhotoPlaceLabel(native, { lat: 35.6895, lng: 139.6917 })).toBe('東京都');
  });

  it('returns unresolved when the nearest city feature is too far from the photo', () => {
    const map = placeMap([
      point(127.58, 37.31, { place: 'city', name: '멀리 있는 도시' }),
      point(126.44, 37.46, { place: 'town', name: '북도면' })
    ]);

    expect(resolvePhotoPlaceLabel(map, { lat: 37.46, lng: 126.44 })).toBeNull();
  });
});

function point(lng: number, lat: number, properties: Record<string, unknown>): FeatureFixture {
  return { geometry: { type: 'Point', coordinates: [lng, lat] }, properties, sourceLayer: 'places' };
}

function placeMap(features: FeatureFixture[]): CityLabelMap {
  return {
    project: () => ({ x: 500, y: 400 }),
    queryRenderedFeatures: () => [],
    getStyle: () => ({
      layers: [{ id: 'region-places-label', source: 'region', 'source-layer': 'places' }]
    }),
    querySourceFeatures: () => features
  };
}
