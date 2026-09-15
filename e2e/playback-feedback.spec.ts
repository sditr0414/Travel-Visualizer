import { expect, test } from '@playwright/test';
import { attachLocalPhotoManifest, loadLocalTimeline } from './helpers';

interface FrameSamples { enabled: boolean; rafTimes: number[]; paintTimes: number[]; paintCosts: number[]; paintStart: number }

test('playback uses accessible icon-only buttons and a walking emoji', async ({ page }) => {
  await attachLocalPhotoManifest(page);
  await page.goto('/');
  await loadLocalTimeline(page);
  await page.getByRole('button', { name: '사진 여정', exact: true }).click();
  await page.locator('.settings-panel summary').click();
  await page.getByLabel('날짜 변경 표시', { exact: true }).uncheck();
  await page.locator('.settings-panel summary').click();
  const play = page.getByRole('button', { name: '재생', exact: true });
  await expect(play).toBeEnabled();
  expect((await play.textContent())?.trim()).toBe('');
  await page.getByLabel('처음부터 보기', { exact: true }).click();
  const walking = page.locator('.media-scene-layer.is-current .movement-pictogram');
  await expect(walking).toHaveAttribute('data-mobility', 'WALK');
  await expect(walking).toHaveText('🚶');
  await expect(walking.locator('svg')).toHaveCount(0);
  await play.click();
  const pause = page.getByRole('button', { name: '일시정지', exact: true });
  await expect(pause).toBeVisible();
  expect((await pause.textContent())?.trim()).toBe('');
  await pause.click();
});

test('help remains next to its setting after panel animation and disappears on scroll or close', async ({ page, isMobile }, testInfo) => {
  test.setTimeout(90_000);
  await attachLocalPhotoManifest(page);
  await page.goto('/');
  await loadLocalTimeline(page);
  await page.getByRole('button', { name: '사진 여정', exact: true }).click();
  const sizes = isMobile ? [[390, 844]] : [[1440, 900], [768, 1024], [844, 390]];
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    await page.locator('.settings-panel summary').click();
    const title = page.getByRole('button', { name: '지도 확대 설명', exact: true });
    await title.scrollIntoViewIfNeeded();
    if (isMobile) await title.tap(); else await title.hover();
    const tip = page.getByRole('tooltip');
    await expect(tip).toBeVisible();
    await expect.poll(async () => {
      const a = await title.boundingBox(); const b = await tip.boundingBox();
      if (!a || !b) return false;
      const placement = await tip.getAttribute('data-placement');
      const gap = placement === 'bottom' ? b.y - (a.y + a.height) : a.y - (b.y + b.height);
      return Math.abs(gap - 8) < 2 && b.x >= 11 && b.y >= 11 && b.x + b.width <= width - 11 && b.y + b.height <= height - 11;
    }).toBe(true);
    await testInfo.attach(`help-${width}x${height}`, { body: await page.screenshot(), contentType: 'image/png' });
    await page.locator('.settings-content').evaluate(node => { node.scrollTop += 120; node.dispatchEvent(new Event('scroll', { bubbles: true })); });
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await title.scrollIntoViewIfNeeded();
    await title.click();
    await expect(page.getByRole('tooltip')).toHaveCount(1);
    await page.locator('.settings-panel summary').click();
    await expect(page.getByRole('tooltip')).toHaveCount(0);
  }
});

test('production route paints follow display frames without worker-driven stepping', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  // A controlled MapLibre style isolates application rendering from network and
  // tile complexity. This is not a benchmark of a user's GPU or personal trip.
  await page.route('https://tiles.openfreemap.org/styles/positron', route => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ version: 8, sources: {},
      layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#d8d9d4' } }] })
  }));
  await page.addInitScript(() => {
    const samples: FrameSamples = { enabled: false, rafTimes: [], paintTimes: [], paintCosts: [], paintStart: 0 };
    Object.assign(window, { __journeyFrames: samples });
    const clear = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      if (samples.enabled && this.canvas.classList.contains('route-playback-overlay')) {
        samples.paintStart = performance.now(); samples.paintTimes.push(samples.paintStart);
      }
      return clear.apply(this, args);
    };
    const stroke = CanvasRenderingContext2D.prototype.stroke;
    CanvasRenderingContext2D.prototype.stroke = function (...args: [] | [Path2D]) {
      if (args.length) stroke.call(this, args[0]); else stroke.call(this);
      if (samples.enabled && this.canvas.classList.contains('route-playback-overlay')) samples.paintCosts.push(performance.now() - samples.paintStart);
    };
    const frame = (now: number) => { if (samples.enabled) samples.rafTimes.push(now); requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
  });
  await page.goto('/');
  await loadLocalTimeline(page);
  await page.getByRole('button', { name: '재생', exact: true }).click();
  await expect(page.locator('.route-playback-overlay')).toBeVisible();
  await page.waitForTimeout(900);
  await page.evaluate(() => { (window as unknown as { __journeyFrames: FrameSamples }).__journeyFrames.enabled = true; });
  await page.waitForTimeout(3200);
  const samples = await page.evaluate(() => {
    const value = (window as unknown as { __journeyFrames: FrameSamples }).__journeyFrames;
    value.enabled = false; return value;
  });
  const intervals = samples.paintTimes.slice(1).map((time, index) => time - samples.paintTimes[index]);
  const percentile = (values: number[], fraction: number) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * fraction))] ?? 0;
  const metrics = {
    project: testInfo.project.name, profile: 'controlled MapLibre background / production build',
    routeFrames: samples.paintTimes.length, displayCallbacks: samples.rafTimes.length,
    routeFps: 1000 * (samples.paintTimes.length - 1) / (samples.paintTimes.at(-1)! - samples.paintTimes[0]),
    frameIntervalP50Ms: percentile(intervals, 0.5), frameIntervalP95Ms: percentile(intervals, 0.95),
    routeDrawP95Ms: percentile(samples.paintCosts, 0.95),
    framesOver33Ms: intervals.filter(value => value > 33.4).length
  };
  console.log(`PLAYBACK_PERFORMANCE ${JSON.stringify(metrics)}`);
  await testInfo.attach('frame-cadence', { body: JSON.stringify(metrics, null, 2), contentType: 'application/json' });
  expect(samples.paintTimes.length).toBeGreaterThan(35);
  expect(samples.paintTimes.length / samples.rafTimes.length).toBeGreaterThan(0.8);
  const visiblePixels = await page.locator('.route-playback-overlay').evaluate(node => {
    const canvas = node as HTMLCanvasElement;
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let index = 3; index < data.length; index += 4) if (data[index] > 0) return true;
    return false;
  });
  expect(visiblePixels).toBe(true);
});
