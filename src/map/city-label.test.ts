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

  it('uses a nearby loaded city source when its rendered label is outside the viewport', () => {
    const map = fakeMap([]);
    map.getStyle = () => ({ layers: [{ id: 'place-city-label', source: 'openmaptiles', 'source-layer': 'place' }] });
    map.querySourceFeatures = () => [{ geometry: { type: 'Point', coordinates: [127.03, 37.28] }, properties: { class: 'city', name: '수원' } }];
    expect(resolveCityLabel(map, { lat: 37.27, lng: 127.02 })).toBe('수원');
  });
});

function fakeMap(features: ReturnType<CityLabelMap['queryRenderedFeatures']>): CityLabelMap {
  return {
    project: () => ({ x: 100, y: 100 }),
    queryRenderedFeatures: () => features
  };
}
