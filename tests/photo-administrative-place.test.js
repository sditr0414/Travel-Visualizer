import test from 'node:test';
import assert from 'node:assert/strict';
import { administrativePlaceLabel, movementVisualForMobility } from '../src/photo-journey-v4.js';

const project = coordinate => ({ x: coordinate[0], y: coordinate[1] });

test('GPS place label preserves explicit Korean administrative names and ignores nearby POIs', () => {
  const features = [
    {
      layer: { id: 'poi-label' },
      properties: { 'name:ko': '오사카역', 'name:en': 'Osaka Station', kind: 'station' },
      geometry: { type: 'Point', coordinates: [101, 100] }
    },
    {
      layer: { id: 'place-city' },
      properties: { 'name:ko': '오사카시', 'name:en': 'Osaka', kind: 'city' },
      geometry: { type: 'Point', coordinates: [180, 105] }
    },
    {
      layer: { id: 'place-district' },
      properties: { 'name:ko': '주오구', 'name:en': 'Chuo', kind: 'district' },
      geometry: { type: 'Point', coordinates: [112, 103] }
    }
  ];

  assert.equal(
    administrativePlaceLabel(features, { x: 100, y: 100 }, project),
    '오사카시 · 주오구'
  );
});

test('GPS place label includes all available units below city level', () => {
  const features = [
    {
      layer: { id: 'place-city' },
      properties: { 'name:ko': '오사카시', 'name:en': 'Osaka', kind: 'city' },
      geometry: { type: 'Point', coordinates: [160, 100] }
    },
    {
      layer: { id: 'place-ward' },
      properties: { 'name:ko': '주오구', 'name:en': 'Chuo', kind: 'ward' },
      geometry: { type: 'Point', coordinates: [118, 100] }
    },
    {
      layer: { id: 'place-neighbourhood' },
      properties: { 'name:ko': '신사이바시', 'name:en': 'Shinsaibashi', kind: 'neighbourhood' },
      geometry: { type: 'Point', coordinates: [104, 101] }
    }
  ];

  assert.equal(
    administrativePlaceLabel(features, { x: 100, y: 100 }, project),
    '오사카시 · 주오구 · 신사이바시'
  );
});

test('GPS place label falls back to the available administrative level', () => {
  const features = [{
    layer: { id: 'place-region' },
    properties: { 'name:ko': '후쿠오카현', 'name:en': 'Fukuoka', kind: 'prefecture' },
    geometry: { type: 'Point', coordinates: [130, 120] }
  }];

  assert.equal(
    administrativePlaceLabel(features, { x: 100, y: 100 }, project),
    '후쿠오카현'
  );
});

test('GPS place label ranks polygon administrative areas by representative position', () => {
  const features = [
    {
      layer: { id: 'boundary-city' },
      properties: { 'name:ko': '오사카시', 'name:en': 'Osaka', kind: 'city' },
      geometry: {
        type: 'Polygon',
        coordinates: [[[40, 40], [180, 40], [180, 180], [40, 180], [40, 40]]]
      }
    },
    {
      layer: { id: 'boundary-district' },
      properties: { 'name:ko': '주오구', 'name:en': 'Chuo', kind: 'district' },
      geometry: {
        type: 'Polygon',
        coordinates: [[[80, 82], [126, 82], [126, 126], [80, 126], [80, 82]]]
      }
    },
    {
      layer: { id: 'boundary-district' },
      properties: { 'name:ko': '멀리있는구', 'name:en': 'Far District', kind: 'district' },
      geometry: {
        type: 'Polygon',
        coordinates: [[[900, 900], [980, 900], [980, 980], [900, 980], [900, 900]]]
      }
    }
  ];

  assert.equal(
    administrativePlaceLabel(features, { x: 100, y: 100 }, project),
    '오사카시 · 주오구'
  );
});

test('GPS place label uses English when an explicit Korean label is unavailable', () => {
  const features = [
    {
      layer: { id: 'place-city' },
      properties: { name: '大阪市', 'name:en': 'Osaka', kind: 'city' },
      geometry: { type: 'Point', coordinates: [150, 100] }
    },
    {
      layer: { id: 'place-district' },
      properties: { name: '中央区', 'name:en': 'Chuo', kind: 'district' },
      geometry: { type: 'Point', coordinates: [112, 100] }
    }
  ];

  assert.equal(
    administrativePlaceLabel(features, { x: 100, y: 100 }, project),
    'Osaka · Chuo'
  );
});

test('GPS place label falls back to the native source name without Korean transliteration', () => {
  const features = [{
    layer: { id: 'place-city' },
    properties: { name: '大阪市', kind: 'city' },
    geometry: { type: 'Point', coordinates: [130, 120] }
  }];

  assert.equal(
    administrativePlaceLabel(features, { x: 100, y: 100 }, project),
    '大阪市'
  );
});

test('movement pictogram maps route mobility classes to media-rail labels', () => {
  assert.deepEqual(movementVisualForMobility('WALK'), { icon: '🚶', label: '도보 이동' });
  assert.deepEqual(movementVisualForMobility('FAST_GROUND'), { icon: '🚆', label: '철도 이동' });
  assert.deepEqual(movementVisualForMobility('FLIGHT'), { icon: '✈', label: '항공 이동' });
  assert.deepEqual(movementVisualForMobility('not-known'), { icon: '●', label: '이동 중' });
});
