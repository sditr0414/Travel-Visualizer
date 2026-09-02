import { expect, test } from '@playwright/test';
import { attachLocalPhotoManifest, loadLocalTimeline } from './helpers';

const CURSOR_RESTORE_TOLERANCE_SEC = 0.12;

test('local trip can be planned, played, paused and reset', async ({ page }) => {
  await page.goto('/');
  await loadLocalTimeline(page);
  const play = page.getByRole('button', { name: '재생' });
  const position = page.getByLabel('재생 위치');
  await expect(play).toBeVisible();
  await play.click();
  await expect(page.getByRole('button', { name: '일시정지' })).toBeVisible();
  await expect.poll(async () => Number(await position.inputValue())).toBeGreaterThan(0.05);
  await page.getByRole('button', { name: '일시정지' }).click();
  const paused = Number(await position.inputValue());
  await page.waitForTimeout(180);
  expect(Math.abs(Number(await position.inputValue()) - paused)).toBeLessThan(0.06);
  await page.getByLabel('처음부터 보기').click();
  await expect(position).toHaveValue('0');
});

test('desktop playback chrome hides and reveals while route HUD stays persistent', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Desktop hover chrome behavior is not applicable to touch layout.');
  await page.goto('/');
  await loadLocalTimeline(page);
  const play = page.getByRole('button', { name: '재생' });
  await play.click();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-playback-chrome', 'visible');
  await expect(page.locator('.route-persistent-hud')).toBeVisible();
  // Clicking Play leaves the pointer over playback chrome, which intentionally keeps it visible.
  await page.mouse.move(1, 1);
  await expect(page.locator('.app-shell')).toHaveAttribute('data-playback-chrome', 'hidden', { timeout: 3000 });
  await expect(page.locator('.route-persistent-hud')).toBeVisible();

  const reveal = page.locator('.player-reveal-zone');
  const player = page.getByLabel('재생 컨트롤');
  const revealBox = await reveal.boundingBox();
  const playerBox = await player.boundingBox();
  expect(revealBox).not.toBeNull();
  expect(playerBox).not.toBeNull();
  expect(Math.abs(revealBox!.x - playerBox!.x)).toBeLessThan(2);
  expect(Math.abs(revealBox!.y - playerBox!.y)).toBeLessThan(2);
  expect(Math.abs(revealBox!.width - playerBox!.width)).toBeLessThan(2);
  expect(Math.abs(revealBox!.height - playerBox!.height)).toBeLessThan(2);
  await reveal.hover();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-playback-chrome', 'visible', { timeout: 1200 });
  await expect(page.locator('.route-persistent-hud')).toBeVisible();

  await page.mouse.move(1, 1);
  await expect(page.locator('.app-shell')).toHaveAttribute('data-playback-chrome', 'hidden', { timeout: 1800 });
  await expect(page.locator('.route-persistent-hud')).toBeVisible();
  const inside = { x: revealBox!.x + revealBox!.width / 2, y: revealBox!.y + revealBox!.height / 2 };
  await page.mouse.move(inside.x, inside.y);
  await page.waitForTimeout(90);
  await page.mouse.move(inside.x + 3, inside.y + 2);
  await page.waitForTimeout(90);
  await page.mouse.move(inside.x - 2, inside.y - 2);
  await expect(page.locator('.app-shell')).toHaveAttribute('data-playback-chrome', 'visible', { timeout: 900 });
});

test('route and photo journeys keep playback state and cursors separate', async ({ page }) => {
  await attachLocalPhotoManifest(page);
  await page.goto('/');
  await loadLocalTimeline(page);
  const play = page.getByRole('button', { name: '재생' });
  const position = page.getByLabel('재생 위치');

  await expect(page.getByRole('button', { name: '사진 여정' })).toHaveClass(/active/);
  await play.click();
  await expect(page.getByRole('button', { name: '일시정지' })).toBeVisible();
  await expect.poll(async () => Number(await position.inputValue())).toBeGreaterThan(0.05);
  const firstPhotoPosition = Number(await position.inputValue());
  await page.getByRole('button', { name: '발자취' }).click();
  await expect(page.getByRole('button', { name: '재생' })).toBeVisible();
  const initialRoutePosition = Number(await position.inputValue());

  await play.click();
  await expect(page.getByRole('button', { name: '일시정지' })).toBeVisible();
  await expect.poll(async () => Number(await position.inputValue())).toBeGreaterThan(initialRoutePosition + 0.05);
  const firstRoutePosition = Number(await position.inputValue());
  await page.getByRole('button', { name: '사진 여정' }).click();
  await expect(page.getByRole('button', { name: '재생' })).toBeVisible();
  await expect.poll(async () => Math.abs(Number(await position.inputValue()) - firstPhotoPosition)).toBeLessThan(CURSOR_RESTORE_TOLERANCE_SEC);

  await play.click();
  await expect(page.getByRole('button', { name: '일시정지' })).toBeVisible();
  await expect.poll(async () => Number(await position.inputValue())).toBeGreaterThan(firstPhotoPosition + 0.05);
  const secondPhotoPosition = Number(await position.inputValue());
  await page.getByRole('button', { name: '발자취' }).click();
  await expect(page.getByRole('button', { name: '재생' })).toBeVisible();
  await expect.poll(async () => Math.abs(Number(await position.inputValue()) - firstRoutePosition)).toBeLessThan(CURSOR_RESTORE_TOLERANCE_SEC);

  await play.click();
  await expect(page.getByRole('button', { name: '일시정지' })).toBeVisible();
  await expect.poll(async () => Number(await position.inputValue())).toBeGreaterThan(firstRoutePosition + 0.05);
  await page.getByRole('button', { name: '사진 여정' }).click();
  await expect(page.getByRole('button', { name: '재생' })).toBeVisible();
  await expect.poll(async () => Math.abs(Number(await position.inputValue()) - secondPhotoPosition)).toBeLessThan(CURSOR_RESTORE_TOLERANCE_SEC);
});

test('settings stay usable on a narrow screen with full-width trip dates', async ({ page }) => {
  await page.goto('/');
  await loadLocalTimeline(page);
  const settings = page.getByText('여행 설정');
  const settingsBox = await settings.boundingBox();
  const topbarBox = await page.locator('.topbar-actions').boundingBox();
  expect(settingsBox).not.toBeNull();
  expect(topbarBox).not.toBeNull();
  expect(settingsBox!.x).toBeGreaterThanOrEqual(topbarBox!.x + topbarBox!.width);
  await settings.click();
  const startDate = page.getByLabel('여행 시작');
  const endDate = page.getByLabel('여행 마지막 날');
  await expect(startDate).toBeVisible();
  await expect(endDate).toBeVisible();
  // Geometry must be measured after the settings panel's opening scale animation settles.
  await page.waitForTimeout(380);
  const startBox = await startDate.boundingBox();
  const endBox = await endDate.boundingBox();
  expect(startBox).not.toBeNull();
  expect(endBox).not.toBeNull();
  expect(Math.abs(startBox!.width - endBox!.width)).toBeLessThanOrEqual(1);
  expect(endBox!.y).toBeGreaterThan(startBox!.y + startBox!.height);
  const contentBox = await page.locator('.settings-content').boundingBox();
  expect(contentBox).not.toBeNull();
  expect(contentBox!.y).toBeGreaterThan(settingsBox!.y + settingsBox!.height);
  await expect(page.getByRole('button', { name: /경로 다시 만들기/ })).toBeVisible();
});

test('photo journey keeps playback controls inside the route pane', async ({ page, isMobile }) => {
  await page.goto('/');
  await loadLocalTimeline(page);
  await page.getByRole('button', { name: '사진 여정' }).click();
  const mapBox = await page.getByTestId('map-stage').boundingBox();
  const mediaBox = await page.getByRole('complementary', { name: '사진 여정' }).boundingBox();
  const playerBox = await page.getByLabel('재생 컨트롤').boundingBox();
  expect(mapBox).not.toBeNull();
  expect(mediaBox).not.toBeNull();
  expect(playerBox).not.toBeNull();
  expect(playerBox!.x).toBeGreaterThanOrEqual(mapBox!.x + 8);
  expect(playerBox!.x + playerBox!.width).toBeLessThanOrEqual(mapBox!.x + mapBox!.width - 8);
  expect(playerBox!.y).toBeGreaterThanOrEqual(mapBox!.y + 8);
  expect(playerBox!.y + playerBox!.height).toBeLessThanOrEqual(mapBox!.y + mapBox!.height - 8);
  if (isMobile) {
    expect(playerBox!.y + playerBox!.height).toBeLessThanOrEqual(mediaBox!.y + 1);
  } else {
    expect(playerBox!.x + playerBox!.width).toBeLessThanOrEqual(mediaBox!.x + 1);
  }
});

test('large local Timeline stays browser-local and produces a playable plan', async ({ page, isMobile }) => {
  test.skip(!process.env.REAL_TIMELINE_JSON, 'REAL_TIMELINE_JSON is not configured.');
  test.skip(isMobile, 'The expensive real-data fixture only needs one browser viewport.');
  await page.goto('/');
  await loadLocalTimeline(page, { real: true });
  await expect(page.getByRole('button', { name: '재생' })).toBeVisible({ timeout: 120_000 });
  const position = page.getByLabel('재생 위치');
  const max = Number(await position.getAttribute('max'));
  expect(max).toBeGreaterThan(0);
});