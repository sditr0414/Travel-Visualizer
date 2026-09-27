import { expect, test } from '@playwright/test';
import { loadLocalTimeline } from './helpers';

test('online tiles are prefetched for manual zoom in and out without a map installation', async ({ page }) => {
  await page.route('https://tiles.openfreemap.org/**', route => {
    if (route.request().url().includes('/styles/')) return route.fulfill({
      contentType: 'application/json', body: JSON.stringify({
        version: 8,
        sources: { online: { type: 'vector', tiles: ['https://tiles.openfreemap.org/test/{z}/{x}/{y}.pbf'], maxzoom: 14 } },
        layers: [{ id: 'land', type: 'fill', source: 'online', 'source-layer': 'land' }]
      })
    });
    return route.fulfill({ contentType: 'application/x-protobuf', body: Buffer.alloc(0) });
  });
  // A warmup runs on the main thread; the map renderer also requests tiles in workers.
  await page.addInitScript(() => {
    const warmed: string[] = [];
    Object.assign(window, { warmedTiles: warmed });
    const original = window.fetch;
    window.fetch = (input, init) => {
      if (init?.priority === 'low') warmed.push(String(input));
      return original(input, init);
    };
  });
  const requests: string[] = [];
  page.on('request', request => requests.push(request.url()));
  await page.goto('/');
  await expect(page.locator('.map-loading')).toBeHidden();
  const warmCount = () => page.evaluate(() => (window as unknown as { warmedTiles: string[] }).warmedTiles.length);
  expect(await warmCount()).toBe(0);
  await page.getByRole('button', { name: '지도 확대', exact: true }).click();
  await expect.poll(warmCount).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => (window as unknown as { warmedTiles: string[] }).warmedTiles.some(url => /\/test\/7\//.test(url)))).toBe(true);
  await page.getByRole('button', { name: '지도 축소', exact: true }).click();
  // The camera finishes at z5.4: z4 must already be ready for further zoom out.
  await expect.poll(() => page.evaluate(() => (window as unknown as { warmedTiles: string[] }).warmedTiles.some(url => /\/test\/4\//.test(url)))).toBe(true);
  await loadLocalTimeline(page);
  await page.locator('.settings-panel summary').click();
  await expect(page.getByRole('combobox', { name: '배경 지도', exact: true })).toHaveCount(0);
  expect(requests.some(url => url.includes('/api/map-status') || url.includes('/maps/') || url.includes('/api/map-glyphs/'))).toBe(false);
});
