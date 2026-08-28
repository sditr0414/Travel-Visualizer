import test from 'node:test';
import assert from 'node:assert/strict';
import { koreanJapanesePlaceName, romanizedJapaneseToHangul } from '../src/japanese-place-ko.js';
import { administrativePlaceLabel } from '../src/photo-journey-v4.js';

const project = coordinate => ({ x: coordinate[0], y: coordinate[1] });

test('Japanese administrative names use Korean map labels first', () => {
  assert.equal(koreanJapanesePlaceName({
    'name:ko': '오사카시',
    'name:ja': '大阪市',
    'name:en': 'Osaka'
  }), '오사카시');
});

test('Japanese romaji falls back to Hangul with administrative suffixes', () => {
  assert.equal(koreanJapanesePlaceName({ 'name:ja': '大阪市', 'name:en': 'Osaka' }), '오사카시');
  assert.equal(koreanJapanesePlaceName({ 'name:ja': '中央区', 'name:en': 'Chuo' }), '주오구');
  assert.equal(koreanJapanesePlaceName({ 'name:ja': '福岡県', 'name:en': 'Fukuoka' }), '후쿠오카현');
  assert.equal(koreanJapanesePlaceName({ 'name:ja': '心斎橋', 'name:en': 'Shinsaibashi' }), '신사이바시');
});

test('generic Japanese romaji transliteration handles common mora and coda patterns', () => {
  assert.equal(romanizedJapaneseToHangul('Shinsekai'), '신세카이');
  assert.equal(romanizedJapaneseToHangul('Dotonbori'), '도톤보리');
  assert.equal(romanizedJapaneseToHangul('Sapporo'), '삿포로');
});

test('GPS administrative label Koreanizes Japanese fallback names as a hierarchy', () => {
  const features = [
    {
      layer: { id: 'place-city' },
      properties: { name: '大阪市', 'name:ja': '大阪市', 'name:en': 'Osaka', kind: 'city' },
      geometry: { type: 'Point', coordinates: [150, 100] }
    },
    {
      layer: { id: 'place-district' },
      properties: { name: '中央区', 'name:ja': '中央区', 'name:en': 'Chuo', kind: 'ward' },
      geometry: { type: 'Point', coordinates: [115, 100] }
    },
    {
      layer: { id: 'place-neighbourhood' },
      properties: { name: '心斎橋', 'name:ja': '心斎橋', 'name:en': 'Shinsaibashi', kind: 'neighbourhood' },
      geometry: { type: 'Point', coordinates: [104, 100] }
    }
  ];

  assert.equal(
    administrativePlaceLabel(features, { x: 100, y: 100 }, project),
    '오사카시 · 주오구 · 신사이바시'
  );
});

test('non-Japanese properties are not guessed as Japanese', () => {
  assert.equal(koreanJapanesePlaceName({ name: 'Seoul', 'name:en': 'Seoul' }), null);
});
