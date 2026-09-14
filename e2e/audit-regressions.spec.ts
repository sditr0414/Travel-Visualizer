import { expect, test, type Page } from '@playwright/test';
import { attachLocalPhotoManifest, loadLocalTimeline } from './helpers';

async function setRange(page: Page, selector: string, value: number): Promise<void> {
  await page.locator(selector).evaluate((node, next) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(node, String(next));
    node.dispatchEvent(new Event('input', { bubbles: true }));
    node.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

test('audited layouts keep the player inside the map and settings above the player', async ({ page, isMobile }, testInfo) => {
  test.skip(isMobile, 'The dedicated touch case below covers mobile interaction.');
  test.setTimeout(120_000);
  await attachLocalPhotoManifest(page);
  await page.goto('/');
  await loadLocalTimeline(page);
  await page.getByRole('button', { name: '사진 여정', exact: true }).click();
  for (const [width, height] of [[1440, 900], [390, 844], [768, 1024], [820, 1180], [844, 390]]) {
    await page.setViewportSize({ width, height });
    const map = page.getByTestId('map-stage');
    const player = page.getByLabel('재생 컨트롤');
    await expect.poll(async () => {
      const a = await map.boundingBox();
      const b = await player.boundingBox();
      return Boolean(a && b && b.x >= a.x + 7 && b.y >= a.y + 7 && b.x + b.width <= a.x + a.width - 7 && b.y + b.height <= a.y + a.height - 7);
    }).toBe(true);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    expect(overflow).toBe(false);
    const summary = page.locator('.settings-panel summary');
    await summary.click();
    const start = page.getByLabel('여행 시작', { exact: true });
    await start.scrollIntoViewIfNeeded();
    await expect.poll(() => start.evaluate(node => {
      const r = node.getBoundingClientRect();
      return Boolean(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('.settings-panel'));
    })).toBe(true);
    await testInfo.attach(`settings-${width}x${height}`, { body: await page.screenshot(), contentType: 'image/png' });
    await summary.click();
  }
  const loadedFonts = await page.evaluate(async () => (await document.fonts.load('400 14px "Noto Sans KR Variable"', '한글 0123')).length);
  expect(loadedFonts).toBeGreaterThan(0);
});

test('setting-name help stays open after tap or click and dismisses predictably', async ({ page, isMobile }) => {
  await page.goto('/');
  await loadLocalTimeline(page);
  await page.locator('.settings-panel summary').click();
  const title = page.getByRole('button', { name: '지도 확대 설명', exact: true });
  if (isMobile) await title.tap(); else await title.click();
  await expect(page.getByRole('tooltip')).toContainText('왼쪽은 넓게');
  if (isMobile) await title.tap(); else await title.click();
  await expect(page.getByRole('tooltip')).toBeHidden();
  await title.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tooltip')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toBeHidden();
  await expect(page.locator('.settings-panel')).toHaveAttribute('open', '');
});

test('recommended trip selection remains one row after selecting a different trip', async ({ page }) => {
  const visit = (day: string) => ({ startTime: `${day}T00:00:00+09:00`, endTime: `${day}T23:00:00+09:00`, visit: {
    topCandidate: { placeLocation: { latLng: '37.000, 127.000' }, probability: 0.9 }
  } });
  const activity = (day: string, coordinate: string) => ({ startTime: `${day}T10:00:00+09:00`, endTime: `${day}T11:00:00+09:00`, activity: {
    start: { latLng: coordinate }, end: { latLng: coordinate }, distanceMeters: 100000,
    probability: 0.9, topCandidate: { type: 'IN_TRAIN', probability: 0.9 }
  } });
  await page.goto('/');
  await page.getByLabel('타임라인 파일 열기', { exact: true }).setInputFiles({ name: 'synthetic-trips.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ semanticSegments: [
    visit('2026-04-01'), visit('2026-04-02'), activity('2026-05-02', '37.750, 128.880'), activity('2026-07-01', '35.670, 139.650')
  ] })) });
  await expect(page.getByRole('button', { name: '재생', exact: true })).toBeEnabled({ timeout: 30000 });
  await page.locator('.settings-panel summary').click();
  const picker = page.getByRole('combobox', { name: '추천 여행', exact: true });
  const options = await picker.locator('option:not([disabled])').evaluateAll(nodes => nodes.map(node => (node as HTMLOptionElement).value));
  expect(options.length).toBeGreaterThanOrEqual(2);
  const before = await picker.boundingBox();
  await picker.selectOption(options[1]);
  await expect(picker).toHaveValue(options[1]);
  const after = await picker.boundingBox();
  expect(after!.height).toBeLessThanOrEqual(60);
  expect(Math.abs(after!.height - before!.height)).toBeLessThan(1);
  await expect(page.locator('.trip-candidate-list')).toHaveCount(0);
});

test('a real decoded short video pauses, seeks backward and holds its final frame', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.goto('/');
  await loadLocalTimeline(page);
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 160; canvas.height = 120;
    const ctx = canvas.getContext('2d')!;
    const stream = canvas.captureStream(12);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
    const chunks: Blob[] = [];
    const ended = new Promise<Blob>(resolve => {
      recorder.ondataavailable = event => chunks.push(event.data);
      recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
    });
    recorder.start();
    for (let frame = 0; frame < 12; frame += 1) {
      ctx.fillStyle = frame % 2 ? '#256f83' : '#cb7658';
      ctx.fillRect(0, 0, 160, 120);
      await new Promise(resolve => setTimeout(resolve, 90));
    }
    recorder.stop();
    const blob = await ended;
    stream.getTracks().forEach(track => track.stop());
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await page.getByRole('button', { name: '사진 여정', exact: true }).click();
  await page.locator('.settings-panel summary').click();
  await page.getByLabel('날짜 변경 표시', { exact: true }).uncheck();
  await page.getByRole('combobox', { name: '영상 재생', exact: true }).selectOption('PLAY');
  await setRange(page, '.settings-content input[type="range"][max="15"]', 5);
  await page.locator('.media-import-row input[type="file"]').first().setInputFiles({ name: '20260410_090000.webm', mimeType: 'video/webm', buffer: Buffer.from(bytes) });
  await page.locator('.settings-panel summary').click();
  const play = page.getByRole('button', { name: '재생', exact: true });
  await expect(play).toBeEnabled({ timeout: 30000 });
  await page.getByLabel('처음부터 보기', { exact: true }).click();
  await play.click();
  const video = page.locator('.media-scene-layer.is-current video');
  await expect(video).toBeVisible();
  await expect.poll(() => video.evaluate(node => (node as HTMLVideoElement).currentTime)).toBeGreaterThan(0.15);
  await page.getByRole('button', { name: '일시정지', exact: true }).click();
  const paused = await video.evaluate(node => (node as HTMLVideoElement).currentTime);
  await page.waitForTimeout(150);
  expect(Math.abs(await video.evaluate(node => (node as HTMLVideoElement).currentTime) - paused)).toBeLessThan(0.08);
  await setRange(page, 'input[aria-label="재생 위치"]', 0.1);
  await expect.poll(() => video.evaluate(node => (node as HTMLVideoElement).currentTime)).toBeLessThan(0.2);
  await play.click();
  await page.waitForTimeout(1800);
  const state = await video.evaluate(node => {
    const element = node as HTMLVideoElement;
    return { currentTime: element.currentTime, duration: element.duration, paused: element.paused, ended: element.ended };
  });
  expect(state.currentTime).toBeGreaterThan(0.8);
  expect(state.paused || state.ended).toBe(true);
  await testInfo.attach('video-sync', { body: JSON.stringify(state), contentType: 'application/json' });
});
