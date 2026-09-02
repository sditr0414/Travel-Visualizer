import { describe, expect, it } from 'vitest';
import type { CityLabelMap } from './city-label';
import { resolvePhotoPlaceLabel } from './photo-place-label';

interface FeatureFixture {
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: Record<string, unknown>;
  sourceLayer?: string;
}

describe('resolvePhotoPlaceLabel', () => {
  it('uses city and gu while ignoring township-level labels in Korea', () => {
    const map = placeMap([
      point(126.452, 37.495, { place: 'village', name: '북도면' }),
      point(126.621, 37.473, { place: 'suburb', name: '중구' }),
      point(126.705, 37.456, { place: 'city', name: '인천광역시' })
    ]);

    expect(resolvePhotoPlaceLabel(map, { lat: 37.46, lng: 126.44 })).toBe('인천광역시 중구');
  });

  it('uses city and ward-level labels in Japan', () => {
    const map = placeMap([
      point(130.873, 33.885, { place: 'city', name: '北九州市' }),
      point(130.961, 33.947, { place: 'suburb', name: '門司区' }),
      point(130.955, 33.944, { place: 'suburb', name: '港町' })
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
