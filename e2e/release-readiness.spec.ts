import { readFile, stat } from 'node:fs/promises';
import { extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { loadLocalTimeline } from './helpers';

// The filename-only photo fixture represents Korea local time, like the timeline fixture.
test.use({ timezoneId: 'Asia/Seoul' });

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = resolve(root, 'dist');

test('public static hosting starts cleanly without probing private local APIs', async ({ page }) => {
  const localRequests: string[] = [];
  const policyErrors: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) localRequests.push(request.url()); });
  page.on('console', message => { if (/Content Security Policy|violates.*directive/i.test(message.text())) policyErrors.push(message.text()); });
  const headerLines = (await readFile(resolve(root, 'public/_headers'), 'utf8')).split(/\r?\n/);
  const headers = Object.fromEntries(headerLines.flatMap(line => {
    const match = /^ {2}([^:]+): (.+)$/.exec(line);
    return match ? [[match[1], match[2]]] : [];
  }));
  await page.route('https://travel-public.test/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    let path = resolve(dist, `.${pathname}`);
    if (relative(dist, path).startsWith('..') || !(await stat(path).catch(() => null))?.isFile()) path = resolve(dist, 'index.html');
    const contentType = ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.woff2': 'font/woff2' } as Record<string, string>)[extname(path)] ?? 'application/octet-stream';
    await route.fulfill({ path, contentType, headers });
  });
  await page.goto('https://travel-public.test/');
  await expect(page.getByRole('heading', { name: '다녀온 여행을 다시 펼쳐보세요' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await loadLocalTimeline(page);
  await page.getByRole('button', { name: '사진 여정', exact: true }).click();
  await page.getByLabel('재생 위치').press('PageUp');
  // File blobs, workers and map resources must remain usable under the deployed CSP.
  await page.locator('.media-import-action input').setInputFiles({
    name: '20260410_090000.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
  });
  await expect(page.getByRole('button', { name: '재생', exact: true })).toBeEnabled();
  await page.locator('.settings-panel summary').click();
  await page.getByLabel('날짜 변경 표시', { exact: true }).uncheck();
  await page.locator('.settings-panel summary').click();
  await page.getByLabel('재생 위치').press('ArrowRight');
  await expect(page.locator('.media-scene-layer.is-current img')).toBeVisible();
  await expect.poll(() => page.locator('.media-scene-layer.is-current img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  expect(localRequests).toEqual([]);
  expect(policyErrors).toEqual([]);
});

test('a loopback SPA fallback never becomes a timeline parsing error', async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html>Static fallback</html>' }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '다녀온 여행을 다시 펼쳐보세요' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await loadLocalTimeline(page);
});

test('rejecting a file stops the player before showing its error', async ({ page }) => {
  await page.goto('/');
  await loadLocalTimeline(page);
  await page.getByRole('button', { name: '재생', exact: true }).click();
  await expect.poll(() => page.getByLabel('재생 위치').inputValue().then(Number)).toBeGreaterThan(0.2);
  await page.getByLabel('타임라인 파일 열기', { exact: true }).setInputFiles({ name: 'wrong.txt', mimeType: 'text/plain', buffer: Buffer.from('invalid') });
  await expect(page.getByRole('alert')).toBeVisible();
  const paused = await page.getByLabel('재생 위치').inputValue();
  // Sample several animation frames after the failure; a visually paused clock must not advance.
  await page.evaluate(() => new Promise<void>(resolveDone => {
    let count = 0;
    const frame = () => { if (++count === 20) resolveDone(); else requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
  }));
  await expect(page.getByLabel('재생 위치')).toHaveValue(paused);
  await page.getByRole('button', { name: '재생', exact: true }).click();
  await expect(page.getByRole('button', { name: '일시정지', exact: true })).toBeVisible();
});

test('small photo layouts keep the map controls clear of the toolbar and player', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/');
  await loadLocalTimeline(page);
  await page.getByRole('button', { name: '사진 여정', exact: true }).click();
  await page.getByLabel('재생 위치').press('PageUp');
  for (const height of [568, 844, 568]) {
    await page.setViewportSize({ width: height === 844 ? 390 : 320, height });
    await expect.poll(() => page.evaluate(() => {
      const settings = document.querySelector('.settings-panel')!.getBoundingClientRect();
      const dock = document.querySelector('.player-dock')!.getBoundingClientRect();
      return [...document.querySelectorAll('.maplibregl-ctrl-attrib-button,.maplibregl-ctrl-zoom-in,.maplibregl-ctrl-zoom-out')].every(button => {
        const rect = button.getBoundingClientRect();
        return rect.top >= settings.bottom + 4 && rect.bottom <= dock.top - 4;
      });
    })).toBe(true);
  }
  await page.getByRole('button', { name: '지도 확대', exact: true }).click();
  await page.getByRole('separator').press('Home');
  const separator = page.getByRole('separator');
  expect(await separator.getAttribute('aria-valuenow')).toBe(await separator.getAttribute('aria-valuemin'));
  await testInfo.attach('small-photo-layout', { body: await page.screenshot(), contentType: 'image/png' });
});
