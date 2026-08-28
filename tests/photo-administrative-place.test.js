import test from 'node:test';
import assert from 'node:assert/strict';
import { administrativePlaceLabel } from '../src/photo-journey-v4.js';

const project = coordinate => ({ x: coordinate[0], y: coordinate[1] });

test('GPS place label prefers city and district over nearby POI', () => {
  const features = [
    {
      layer: { id: 'poi-label' },
      properties: { 'name:ko': '오사카역', kind: 'station' },
      geometry: { type: 'Point', coordinates: [101, 100] }
    },
    {
      layer: { id: 'place-city' },
      properties: { 'name:ko': '오사카시', kind: 'city' },
      geometry: { type: 'Point', coordinates: [180, 105] }
    },
    {
      layer: { id: 'place-district' },
      properties: { 'name:ko': '주오구', kind: 'district' },
      geometry: { type: 'Point', coordinates: [112, 103] }
    }
  ];

  assert.equal(
    administrativePlaceLabel(features, { x: 100, y: 100 }, project),
    '오사카시 · 주오구'
  );
});

test('GPS place label falls back to the available administrative level', () => {
  const features = [{
    layer: { id: 'place-region' },
    properties: { 'name:ko': '후쿠오카현', kind: 'prefecture' },
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
      properties: { 'name:ko': '오사카시', kind: 'city' },
      geometry: {
        type: 'Polygon',
        coordinates: [[[40, 40], [180, 40], [180, 180], [40, 180], [40, 40]]]
      }
    },
    {
      layer: { id: 'boundary-district' },
      properties: { 'name:ko': '주오구', kind: 'district' },
      geometry: {
        type: 'Polygon',
        coordinates: [[[80, 82], [126, 82], [126, 126], [80, 126], [80, 82]]]
      }
    },
    {
      layer: { id: 'boundary-district' },
      properties: { 'name:ko': '멀리있는구', kind: 'district' },
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
