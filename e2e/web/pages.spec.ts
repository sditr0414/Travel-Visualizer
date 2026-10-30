import { readFile, utimes, writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { E2E_TIMELINE, loadLocalTimeline } from '../helpers';

const timeline = { name: 'private-trip.json', mimeType: 'application/json', buffer: Buffer.from(E2E_TIMELINE) };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

async function lightweightMap(page: Page) {
  // Keep CI independent from the provider. The live deployment is also checked
  // with the actual online map; these fixtures are never part of the web build.
  await page.route('https://tiles.openfreemap.org/**', route => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#edeae2' } }] })
  }));
}

test('first visit has no previews, local API calls or map downloads and supports small screens', async ({ page }, info) => {
  const requests: string[] = [];
  page.on('request', request => requests.push(request.url()));
  await page.goto('./');
  await expect(page.getByRole('heading', { name: '다녀온 여행을 다시 펼쳐보세요' })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('canvas, img, video')).toHaveCount(0);
  await expect(page.getByLabel('시작할 타임라인 파일 열기', { exact: true })).toBeEnabled();
  expect(requests.some(url => /\/api\/|openfreemap|MapStage-|worker-/i.test(url))).toBe(false);
  expect(requests.filter(url => url.startsWith('http')).every(url => new URL(url).pathname.startsWith('/Travel-Visualizer/'))).toBe(true);
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain("script-src 'self'");
  expect(csp).toContain('worker-src');
  for (const size of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(size);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    const links = await page.locator('.welcome-links button').evaluateAll(nodes => nodes.map(node => {
      const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    }));
    expect(links[0].right <= links[1].left || links[0].bottom <= links[1].top).toBe(true);
    await page.getByRole('button', { name: '타임라인 준비 방법', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '사용 안내', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '사용 안내 닫기', exact: true }).click();
  }
  await info.attach('empty-web-entry', { body: await page.screenshot(), contentType: 'image/png' });
});

test('files stay in the browser and a saved photo journey reopens after refresh', async ({ page }, info) => {
  await lightweightMap(page);
  const requests: Array<{ url: string; method: string }> = [];
  const errors: string[] = [];
  page.on('request', r => requests.push({ url: r.url(), method: r.method() }));
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && /content security|refused to/i.test(m.text())) errors.push(m.text()); });
  const photoPath = info.outputPath('20260410_091500.png');
  await writeFile(photoPath, png);
  await utimes(photoPath, new Date('2026-04-10T00:15:00Z'), new Date('2026-04-10T00:15:00Z'));
  await page.goto('./');
  await loadLocalTimeline(page);
  await page.getByRole('button', { name: '재생', exact: true }).click();
  await expect.poll(async () => Number(await page.getByLabel('재생 위치', { exact: true }).inputValue())).toBeGreaterThan(0);
  await page.getByRole('button', { name: '일시정지', exact: true }).click();
  await page.getByRole('button', { name: '사진 여정', exact: true }).click();
  await page.locator('.media-import-row input[type=file]').first().setInputFiles(photoPath);
  await expect(page.getByRole('button', { name: '재생', exact: true })).toBeEnabled();
  await page.locator('.settings-panel summary').click();
  await expect(page.getByRole('checkbox', { name: '정확한 장소 온라인 확인', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '사진 목록 관리', exact: true }).click();
  await page.getByRole('button', { name: /장면 보기/ }).click();
  await expect(page.locator('.is-current img')).toBeVisible();
  await expect.poll(() => page.locator('.is-current img').evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true);
  await page.locator('.settings-panel summary').click();
  await page.getByRole('button', { name: '여행 저장·열기', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '프로젝트 파일 저장', exact: true }).click();
  const projectPath = info.outputPath('journey.travel-camera.json');
  await (await downloading).saveAs(projectPath);
  const body = await readFile(projectPath, 'utf8');
  expect(body).not.toMatch(/"(?:lat|lng|semanticSegments|frames|sourceUrl)"/);
  await page.reload();
  await expect(page.locator('canvas')).toHaveCount(0);
  await page.getByRole('button', { name: '저장한 여행 열기', exact: true }).click();
  await page.getByLabel('여행 프로젝트 파일 열기').setInputFiles(projectPath);
  await page.getByLabel('프로젝트 타임라인 원본 선택').setInputFiles(timeline);
  await page.getByLabel('프로젝트 사진 파일 선택').setInputFiles(photoPath);
  await page.getByRole('button', { name: '이 여행 복원', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '여행 저장·열기', exact: true })).toBeHidden();
  await expect(page.getByRole('button', { name: '재생', exact: true })).toBeEnabled();
  await expect(page.locator('.is-current img')).toBeVisible();
  expect(requests.some(r => r.url.includes('/api/') || r.method !== 'GET')).toBe(false);
  expect(errors).toEqual([]);
});

test('invalid imports recover and a failed replacement preserves the current journey', async ({ page }) => {
  await lightweightMap(page);
  await page.goto('./');
  await page.getByLabel('시작할 타임라인 파일 열기', { exact: true }).setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{broken') });
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByLabel('다른 타임라인 선택', { exact: true }).setInputFiles(timeline);
  await expect(page.getByRole('button', { name: '재생', exact: true })).toBeEnabled();
  await page.getByLabel('타임라인 파일 열기', { exact: true }).setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: '기존 여행으로 돌아가기', exact: true }).click();
  await page.getByRole('button', { name: '재생', exact: true }).click();
  await expect.poll(async () => Number(await page.getByLabel('재생 위치', { exact: true }).inputValue())).toBeGreaterThan(0);
});

test('a failed map connection still allows playback and reconnection', async ({ page }) => {
  await page.route('https://tiles.openfreemap.org/**', route => route.abort());
  await page.goto('./');
  await loadLocalTimeline(page);
  await expect(page.locator('.map-recovery')).toContainText('경로와 사진만 표시');
  await page.getByRole('button', { name: '재생', exact: true }).click();
  await expect.poll(async () => Number(await page.getByLabel('재생 위치', { exact: true }).inputValue())).toBeGreaterThan(0);
  await page.getByRole('button', { name: '일시정지', exact: true }).click();
  await page.unroute('https://tiles.openfreemap.org/**');
  await lightweightMap(page);
  await page.getByRole('button', { name: '지도 다시 연결', exact: true }).click();
  await expect(page.getByRole('button', { name: '재생', exact: true })).toBeEnabled();
  await expect(page.locator('.map-recovery')).toBeHidden();
});

test('unsupported WebGL ends the import with a recoverable error instead of waiting forever', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (...args: Parameters<typeof original>) {
      if (String(args[0]).includes('webgl')) return null;
      return original.apply(this, args);
    } as typeof original;
  });
  await page.goto('./');
  await page.getByLabel('시작할 타임라인 파일 열기', { exact: true }).setInputFiles(timeline);
  await expect(page.getByRole('alert')).toContainText('지도를 시작하지 못했습니다');
  await expect(page.getByRole('button', { name: '타임라인 연결 취소', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('다른 타임라인 선택', { exact: true })).toBeEnabled();
});
