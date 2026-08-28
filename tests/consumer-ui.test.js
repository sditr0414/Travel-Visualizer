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

test('primary controls use consumer-facing story language', async () => {
  const html = await read('index.html');
  assert.match(html, />경로 스토리</);
  assert.match(html, />사진 스토리</);
  assert.match(html, />사진·영상 추가</);
  assert.match(html, />영상 꾸미기</);
  assert.match(html, />이 설정으로 다시 만들기</);
  assert.doesNotMatch(html, />60 FPS</);
  const main = await read('src/main.js');
  assert.doesNotMatch(main, /<strong>60 FPS<\/strong>/);
});

test('consumer theme preserves viewport-safe responsive settings', async () => {
  const css = await read('consumer-ui.css');
  assert.match(css, /\.settings-shell\[open\] > \.settings-card/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /\.photo-split-handle span \{ display: none; \}/);
});
