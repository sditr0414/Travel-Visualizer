import { expect, test } from '@playwright/test';
import { attachLocalPhotoManifest, loadLocalTimeline } from './helpers';

test.use({ timezoneId: 'Asia/Seoul' });

test('travel settings aligns with neighbouring toolbar controls', async ({ page }, testInfo) => {
  await page.goto('/');
  await loadLocalTimeline(page);
  const settings = await page.locator('.settings-panel').boundingBox();
  const modes = await page.locator('.mode-switch').boundingBox();
  expect(settings!.height).toBe(modes!.height);
  expect(settings!.y).toBe(modes!.y);
  for (const button of await page.locator('.topbar .import-button:visible').all()) {
    const rect = await button.boundingBox();
    expect(rect!.height).toBe(settings!.height);
    expect(rect!.y).toBe(settings!.y);
  }
  await testInfo.attach('aligned-toolbar', { body: await page.screenshot(), contentType: 'image/png' });
});

test('hover help closes when the mouse moves onto its bubble', async ({ page, isMobile }, testInfo) => {
  test.skip(isMobile, 'Mouse hover is checked on desktop; tap and keyboard help have separate coverage.');
  await page.goto('/');
  await loadLocalTimeline(page);
  await page.locator('.settings-panel summary').click();
  const title = page.getByRole('button', { name: '지도 보기 방식 설명', exact: true });
  await title.hover();
  const tip = page.getByRole('tooltip');
  await expect(tip).toBeVisible();
  const rect = await tip.boundingBox();
  await page.mouse.move(rect!.x + 30, rect!.y + 25);
  await expect(tip).toBeHidden();
  await testInfo.attach('settings-hover', { body: await page.screenshot(), contentType: 'image/png' });
});

test('icon-only playback controls and familiar walking emoji remain accessible', async ({ page }, testInfo) => {
  await attachLocalPhotoManifest(page);
  await page.goto('/');
  await loadLocalTimeline(page);
  const play = page.getByRole('button', { name: '재생', exact: true });
  await expect(play).toHaveText('');
  await play.click();
  await expect(page.getByRole('button', { name: '일시정지', exact: true })).toHaveText('');
  await page.getByRole('button', { name: '일시정지', exact: true }).click();
  await page.getByRole('button', { name: '사진 여정', exact: true }).click();
  await page.locator('.settings-panel summary').click();
  await page.getByLabel('날짜 변경 표시', { exact: true }).uncheck();
  await page.locator('.settings-panel summary').click();
  await page.getByLabel('처음부터 보기', { exact: true }).click();
  await page.getByLabel('재생 위치').press('ArrowRight');
  const icon = page.locator('.is-current .movement-pictogram');
  await expect(icon).toHaveText('🚶');
  await expect(icon.locator('svg')).toHaveCount(0);
  const button = await play.boundingBox();
  expect(button!.width).toBeGreaterThanOrEqual(44);
  expect(button!.height).toBeGreaterThanOrEqual(44);
  await testInfo.attach('walking-and-controls', { body: await page.screenshot(), contentType: 'image/png' });
});

test('help follows the animated label and closes when its setting scrolls away', async ({ page, isMobile }, testInfo) => {
  // Trip dates precede camera controls, so a tall panel can retain this label
  // even at maximum scroll. Exercise actual clipping on both device layouts.
  await page.setViewportSize({ width: isMobile ? 390 : 1440, height: 600 });
  await page.goto('/');
  await loadLocalTimeline(page);
  await page.locator('.settings-panel summary').click();
  const title = page.getByRole('button', { name: '지도 보기 방식 설명', exact: true });
  // Trigger during the real entrance animation; locator.hover waits for stability
  // and would conceal the original stale-coordinate bug.
  await title.dispatchEvent('mouseover');
  const tip = page.getByRole('tooltip');
  await expect(tip).toBeVisible();
  for (let i = 0; i < 5; i += 1) {
    await page.waitForTimeout(60);
    const distance = await title.evaluate(node => {
      const label = node.getBoundingClientRect();
      const bubble = document.querySelector('.setting-tooltip:not([hidden])')!.getBoundingClientRect();
      return Math.min(Math.abs(bubble.top - label.bottom - 8), Math.abs(label.top - bubble.bottom - 8));
    });
    expect(distance).toBeLessThan(3);
  }
  await title.click();
  await testInfo.attach('anchored-help', { body: await page.screenshot(), contentType: 'image/png' });
  // Hover a second setting while the first is pinned: only one tooltip may exist.
  await page.getByRole('button', { name: '지도 확대 설명', exact: true }).dispatchEvent('mouseover');
  await expect(tip).toHaveCount(1);
  await expect(tip).toContainText('왼쪽은 넓게');
  await page.locator('.settings-content').evaluate(node => { node.scrollTop = node.scrollHeight; });
  await expect.poll(() => page.getByRole('button', { name: '지도 확대 설명', exact: true }).evaluate(node => {
    const label = node.getBoundingClientRect();
    const clip = node.closest('.settings-content')!.getBoundingClientRect();
    return label.bottom <= clip.top;
  })).toBe(true);
  await expect(tip).toBeHidden();
  await page.locator('.settings-panel summary').click();
  await expect(tip).toBeHidden();
});

test('route and head share display-rate worker updates without the old 30 Hz clock', async ({ page, isMobile }, testInfo) => {
  test.skip(isMobile, 'Cadence is measured once without device emulation; touch behavior is tested separately.');
  // Isolate the route renderer from network latency and background tile work.
  // This is not a claim about FPS on every GPU or online map.
  await page.route('https://tiles.openfreemap.org/styles/positron', route => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ version: 8, sources: {}, layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#d8d9d4' } }
    ] })
  }));
  await page.addInitScript(() => {
    const probe = { enabled: false, frames: [] as number[], updates: [] as number[], combined: 0, separateHeads: 0 };
    Object.assign(window, { routeCadenceProbe: probe });
    const original = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message: unknown, options?: StructuredSerializeOptions | Transferable[]) {
      const data = (message as { data?: { source?: string; data?: { features?: { geometry: { type: string } }[] } } })?.data;
      if (probe.enabled && data?.data?.features) {
        if (data.source === 'route-progress') {
          probe.updates.push(performance.now());
          const types = data.data.features.map(feature => feature.geometry.type);
          if (types.includes('LineString') && types.includes('Point')) probe.combined += 1;
        } else if (data.source === 'route-head') probe.separateHeads += 1;
      }
      original.call(this, message, options as StructuredSerializeOptions);
    };
    const sample = (time: number) => { if (probe.enabled) probe.frames.push(time); requestAnimationFrame(sample); };
    requestAnimationFrame(sample);
  });
  await page.goto('/');
  await loadLocalTimeline(page);
  await page.getByRole('button', { name: '재생', exact: true }).click();
  await page.waitForTimeout(1000);
  await page.evaluate(() => { (window as unknown as { routeCadenceProbe: { enabled: boolean } }).routeCadenceProbe.enabled = true; });
  await page.waitForTimeout(5000);
  const metrics = await page.evaluate(() => {
    const probe = (window as unknown as { routeCadenceProbe: { enabled: boolean; frames: number[]; updates: number[]; combined: number; separateHeads: number } }).routeCadenceProbe;
    probe.enabled = false;
    const span = (probe.frames.at(-1)! - probe.frames[0]) / 1000;
    return { sampleSeconds: span, frames: probe.frames.length, updates: probe.updates.length,
      rafHz: (probe.frames.length - 1) / span, routeUpdateHz: probe.updates.length / span,
      combined: probe.combined, separateHeads: probe.separateHeads };
  });
  expect(metrics.frames).toBeGreaterThan(20);
  expect(metrics.combined).toBe(metrics.updates);
  expect(metrics.separateHeads).toBe(0);
  expect(metrics.updates).toBeGreaterThan(metrics.frames * 0.65);
  await testInfo.attach('route-cadence', { body: JSON.stringify(metrics, null, 2), contentType: 'application/json' });
  console.log('ROUTE_CADENCE', JSON.stringify(metrics));
});
