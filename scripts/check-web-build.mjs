import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist-web', import.meta.url));
const allowedRoot = new Set(['index.html', '_headers', 'travel-camera.svg', 'assets']);
for (const entry of readdirSync(dist, { withFileTypes: true })) {
  assert(allowedRoot.has(entry.name), `Unexpected public file: ${entry.name}`);
  assert(!entry.isSymbolicLink(), `Public symlink is not allowed: ${entry.name}`);
  assert(entry.name === 'assets' ? entry.isDirectory() : entry.isFile(), `Unexpected public entry type: ${entry.name}`);
}
for (const entry of readdirSync(join(dist, 'assets'), { withFileTypes: true })) {
  assert(entry.isFile() && /\.(?:js|css|woff2)$/.test(entry.name), `Unexpected asset: ${entry.name}`);
}
const html = readFileSync(join(dist, 'index.html'), 'utf8');
assert(html.includes('http-equiv="Content-Security-Policy"'), 'Missing Pages CSP');
assert(!html.includes('frame-ancestors'), 'frame-ancestors requires an HTTP header');
assert(html.includes('worker-src'), 'Missing worker policy');
assert(html.indexOf('Content-Security-Policy') < html.indexOf('<script'), 'CSP must precede scripts');
for (const [, url] of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
  assert(url.startsWith('/Travel-Visualizer/'), `Asset outside the Pages base path: ${url}`);
  assert(readFileSync(join(dist, url.slice('/Travel-Visualizer/'.length))).length > 0, `Missing asset: ${url}`);
}
console.log('Web build checked: correct paths and CSP; only app assets, no trip data, photos, videos or previews.');
