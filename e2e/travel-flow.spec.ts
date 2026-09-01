import { expect, test } from '@playwright/test';

test('local trip can be planned, played, paused and reset', async ({ page }) => {
  await page.goto('/');
  await expect.poll(async () => (await page.getByTestId('map-stage').boundingBox())?.height ?? 0).toBeGreaterThan(400);
  await expect(page.locator('.maplibregl-ctrl-attrib-inner')).not.toBeVisible();
  await loadLocalTimeline(page);
  const play = page.getByRole('button', { name: '재생' });
  await expect(play).toBeEnabled({ timeout: 20_000 });
  await play.click();
  await expect(page.getByRole('button', { name: '일시정지' })).toBeVisible();
  await page.getByRole('button', { name: '일시정지' }).click();
  await expect(page.getByRole('button', { name: '재생' })).toBeVisible();
  await page.getByRole('button', { name: '처음부터 보기' }).click();
  await expect(page.getByLabel('재생 위치')).toHaveValue('0');
});

test('top controls auto-hide during desktop playback and return on hover', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Hover reveal is a desktop interaction.');
  await page.goto('/');
  await loadLocalTimeline(page);
  const play = page.getByRole('button', { name: '재생' });
  await expect(play).toBeEnabled({ timeout: 20_000 });
  await play.click();

  const topbar = page.locator('.topbar');
  const settings = page.locator('.settings-panel');
  await expect(topbar).toHaveCSS('opacity', '0');
  await expect(settings).toHaveCSS('opacity', '0');

  await page.locator('.topbar-actions').hover();
  await expect(topbar).toHaveCSS('opacity', '1');
});

test('settings stay usable on a narrow screen', async ({ page }) => {
  await page.goto('/');
  await loadLocalTimeline(page);
  const settings = page.getByText('여행 설정');
  const settingsBox = await settings.boundingBox();
  const topbarBox = await page.locator('.topbar-actions').boundingBox();
  expect(settingsBox).not.toBeNull();
  expect(topbarBox).not.toBeNull();
  expect(settingsBox!.x).toBeGreaterThanOrEqual(topbarBox!.x + topbarBox!.width);
  await settings.click();
  await expect(page.getByLabel('여행 시작')).toBeVisible();
  const contentBox = await page.locator('.settings-content').boundingBox();
  expect(contentBox).not.toBeNull();
  expect(contentBox!.y).toBeGreaterThan(settingsBox!.y + settingsBox!.height);
  await expect(page.getByRole('button', { name: /경로 다시 만들기/ })).toBeVisible();
});

test('photo journey keeps playback controls inside the route pane', async ({ page }) => {
  await page.goto('/');
  await loadLocalTimeline(page);
  await page.getByRole('button', { name: '사진 여정' }).click();
  const mapBox = await page.getByTestId('map-stage').boundingBox();
  const mediaBox = await page.getByRole('complementary', { name: '사진 여정' }).boundingBox();
  const playerBox = await page.getByLabel('재생 컨트롤').boundingBox();
  expect(mapBox).not.toBeNull();
  expect(mediaBox).not.toBeNull();
  expect(playerBox).not.toBeNull();
  if (mediaBox!.x > 0) expect(playerBox!.x + playerBox!.width).toBeLessThanOrEqual(mediaBox!.x + 1);
  else expect(playerBox!.y + playerBox!.height).toBeLessThanOrEqual(mediaBox!.y + 1);
});

test('large local Timeline stays browser-local and produces a playable plan', async ({ page }) => {
  const timelinePath = process.env.REAL_TIMELINE_JSON;
  test.skip(!timelinePath, 'REAL_TIMELINE_JSON is only available for local validation.');
  test.setTimeout(120_000);
  await page.goto('/');
  await page.getByLabel('Timeline JSON 선택', { exact: true }).setInputFiles(timelinePath!);
  await page.getByText('여행 설정').click();
  await expect(page.getByText('타임라인.json')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: '재생' })).toBeEnabled({ timeout: 90_000 });
});

async function loadLocalTimeline(page: import('@playwright/test').Page) {
  await page.getByLabel('Timeline JSON 선택', { exact: true }).setInputFiles({
    name: 'local-timeline.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ semanticSegments: [{
      startTime: '2026-04-10T09:00:00+09:00',
      endTime: '2026-04-10T10:00:00+09:00',
      activity: {
        start: { latLng: '37.5000°, 127.0000°' },
        end: { latLng: '37.6000°, 127.2000°' },
        distanceMeters: 22000,
        topCandidate: { type: 'IN_TRAIN', probability: 0.95 },
        probability: 0.95
      }
    }] }))
  });
}
