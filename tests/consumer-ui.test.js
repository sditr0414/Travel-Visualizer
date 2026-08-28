import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('consumer UI stylesheet is loaded after functional styles', async () => {
  const html = await read('index.html');
  const mediaIndex = html.indexOf('./media-journey.css');
  const consumerIndex = html.indexOf('./consumer-ui.css');
  assert.ok(mediaIndex >= 0);
  assert.ok(consumerIndex > mediaIndex);
});

test('primary controls use natural Korean labels', async () => {
  const html = await read('index.html');
  assert.match(html, />경로만 보기</);
  assert.match(html, />사진과 함께</);
  assert.match(html, />사진·영상 추가</);
  assert.match(html, />설정</);
  assert.match(html, />설정 적용</);
  assert.doesNotMatch(html, />60 FPS</);
  const main = await read('src/main.js');
  assert.doesNotMatch(main, /<strong>60 FPS<\/strong>/);
});

test('consumer theme preserves viewport-safe responsive settings', async () => {
  const css = await read('consumer-ui.css');
  assert.match(css, /--ui-bg: #242228/);
  assert.match(css, /\.settings-shell\[open\] > \.settings-card/);
  assert.match(css, /max-height: calc\(100% - 68px\)/);
  assert.match(css, /scroll-padding-bottom: 48px/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /\.photo-split-handle span \{ display: none; \}/);
});
