import { resolveCityLabel, type CityLabelMap } from './city-label';

describe('resolveCityLabel', () => {
  it('uses a city label and prefers its Korean name', () => {
    const map = fakeMap([{ geometry: { type: 'Point', coordinates: [126.98, 37.57] }, properties: { class: 'city', 'name:ko': '서울', name: 'Seoul' } }]);
    expect(resolveCityLabel(map, { lat: 37.56, lng: 126.97 })).toBe('서울');
  });

  it('does not expose district or neighborhood labels', () => {
    const map = fakeMap([
      { layer: { id: 'place-city-label' }, properties: { class: 'district', name: '강남구' } },
      { properties: { place: 'neighborhood', name: '서초동' } }
    ]);
    expect(resolveCityLabel(map, { lat: 37.49, lng: 127.02 })).toBeNull();
  });

  it('rejects eup and myeon even when vector tiles classify them as towns', () => {
    const map = fakeMap([
      { geometry: { type: 'Point', coordinates: [126.77, 37.60] }, properties: { place: 'town', 'name:ko': '고촌읍', name: 'Gochon' } },
      { geometry: { type: 'Point', coordinates: [126.45, 37.49] }, properties: { place: 'town', 'name:ko': '북도면', name: 'Bukdo' } }
    ]);
    expect(resolveCityLabel(map, { lat: 37.55, lng: 126.70 })).toBeNull();
  });

  it('uses a nearby loaded city source when its rendered label is outside the viewport', () => {
    const map = fakeMap([]);
    map.getStyle = () => ({ layers: [{ id: 'place-city-label', source: 'openmaptiles', 'source-layer': 'place' }] });
    map.querySourceFeatures = () => [{ geometry: { type: 'Point', coordinates: [127.03, 37.28] }, properties: { class: 'city', name: '수원' } }];
    expect(resolveCityLabel(map, { lat: 37.27, lng: 127.02 })).toBe('수원');
  });

  it('skips township labels and falls back to the nearest true city', () => {
    const map = fakeMap([{ geometry: { type: 'Point', coordinates: [126.78, 37.60] }, properties: { class: 'town', name: '고촌읍' } }]);
    map.getStyle = () => ({ layers: [{ id: 'place-city-label', source: 'region', 'source-layer': 'places' }] });
    map.querySourceFeatures = () => [
      { geometry: { type: 'Point', coordinates: [126.72, 37.62] }, properties: { class: 'city', name: '김포시' } },
      { geometry: { type: 'Point', coordinates: [126.78, 37.60] }, properties: { class: 'town', name: '고촌읍' } }
    ];
    expect(resolveCityLabel(map, { lat: 37.60, lng: 126.77 })).toBe('김포시');
  });
});

function fakeMap(features: ReturnType<CityLabelMap['queryRenderedFeatures']>): CityLabelMap {
  return {
    project: () => ({ x: 100, y: 100 }),
    queryRenderedFeatures: () => features
  };
}
