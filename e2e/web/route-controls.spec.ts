import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { E2E_TIMELINE, loadLocalTimeline } from '../helpers';

async function prepare(page: Page) {
  await page.route('https://tiles.openfreemap.org/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#edeae2' } }] }) }));
  await page.goto('./');
  await loadLocalTimeline(page);
}

async function toggleSettings(page: Page) { await page.locator('.settings-panel summary').click(); }

// Real input events exercise the canvas instead of calling React handlers directly.
test('map taps toggle the active mode while drags, zoom and controls preserve playback', async ({ page, isMobile }) => {
  await prepare(page);
  const canvas = page.locator('.maplibregl-canvas');
  const tap = async () => isMobile ? canvas.tap({ position: { x: 180, y: 600 } }) : canvas.click({ position: { x: 600, y: 400 } });
  const playing = page.locator('main');
  await tap(); await expect(playing).toHaveAttribute('data-playing-mode', 'ROUTE');
  await tap(); await expect(playing).toHaveAttribute('data-playing-mode', 'NONE');
  const before = Number(await page.getByLabel('재생 위치', { exact: true }).inputValue());
  if (!isMobile) {
    await canvas.dblclick({ position: { x: 600, y: 400 }, delay: 90 });
    await page.mouse.move(600, 400); await page.mouse.down(); await page.mouse.move(700, 440, { steps: 8 }); await page.mouse.up();
    await page.mouse.wheel(0, -100);
  } else {
    await tap(); await page.waitForTimeout(100); await tap();
    const session = await page.context().newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 150, y: 560, id: 1 }, { x: 220, y: 640, id: 2 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 110, y: 520, id: 1 }, { x: 260, y: 680, id: 2 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await session.detach();
  }
  await page.getByRole('button', { name: '지도 확대', exact: true }).click();
  await page.waitForTimeout(650); // Beyond the single/double-tap arbitration window.
  await expect(playing).toHaveAttribute('data-playing-mode', 'NONE');
  expect(Number(await page.getByLabel('재생 위치', { exact: true }).inputValue())).toBeCloseTo(before, 1);
  if (!isMobile) {
    await toggleSettings(page);
    await tap(); await page.waitForTimeout(650);
    await expect(playing).toHaveAttribute('data-playing-mode', 'NONE');
    await toggleSettings(page);
  }
  await page.getByRole('button', { name: '사진 여정', exact: true }).click();
  const position = { x: 120, y: 140 }; // Inside the map before and after the split transition.
  if (isMobile) await canvas.tap({ position }); else await canvas.click({ position });
  await expect(playing).toHaveAttribute('data-playing-mode', 'PHOTOS');
});

test('desktop bottom scene fits the player, persists and restores with a saved trip', async ({ page, isMobile }, info) => {
  test.skip(isMobile, 'Bottom scene is a desktop-only option.');
  await prepare(page);
  const panel = page.getByRole('region', { name: '하단 현재 장면 정보' });
  await expect(panel).toHaveCount(0);
  await page.getByLabel('재생 위치', { exact: true }).fill('10');
  await expect(panel).toBeVisible();
  await toggleSettings(page);
  await page.getByRole('button', { name: '경로 재생 설정', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: '현재 장면 하단에도 표시' })).toBeChecked();
  await expect(page.getByRole('button', { name: '경로 다시 만들기', exact: true })).toBeDisabled();
  await toggleSettings(page);
  await page.getByLabel('재생 위치', { exact: true }).fill('10');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('이동 지역'); await expect(panel).toContainText('한국 시간');
  await expect(panel.locator('time')).toHaveAttribute('datetime', /^2026-/);
  for (const width of [1920, 1440, 821]) {
    await page.setViewportSize({ width, height: 900 });
    const bottom = await panel.boundingBox(), player = await page.locator('.player-dock').boundingBox();
    expect(Math.abs(bottom!.width - player!.width)).toBeLessThan(2);
    expect(bottom!.y + bottom!.height).toBeLessThan(player!.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await info.attach(`bottom-scene-${width}`, { body: await page.screenshot(), contentType: 'image/png' });
  }
  await page.locator('.maplibregl-canvas').click({ position: { x: 450, y: 300 } });
  await expect(page.locator('main')).toHaveAttribute('data-playing-mode', 'ROUTE');
  await expect(page.locator('main')).toHaveAttribute('data-playback-chrome', 'hidden');
  await expect(panel).toBeVisible();
  await expect.poll(() => panel.evaluate(node => Math.round(innerHeight - node.getBoundingClientRect().bottom))).toBe(16);
  const lowered = await panel.boundingBox();
  const zoom = await page.locator('.maplibregl-ctrl-group').boundingBox();
  expect(zoom!.y + zoom!.height).toBeLessThan(lowered!.y);
  await info.attach('bottom-scene-player-hidden', { body: await page.screenshot(), contentType: 'image/png' });
  await page.mouse.move(400, 860);
  await expect(page.locator('main')).toHaveAttribute('data-playback-chrome', 'visible');
  await expect.poll(() => panel.evaluate(node => Math.round(innerHeight - node.getBoundingClientRect().bottom))).toBe(96);
  await info.attach('bottom-scene-player-revealed', { body: await page.screenshot(), contentType: 'image/png' });
  await page.mouse.move(450, 300);
  await expect(page.locator('main')).toHaveAttribute('data-playback-chrome', 'hidden');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await panel.evaluate(node => parseFloat(getComputedStyle(node).transitionDuration))).toBeLessThanOrEqual(0.001);
  await page.locator('.maplibregl-canvas').click({ position: { x: 450, y: 300 } });
  await expect(page.locator('main')).toHaveAttribute('data-playing-mode', 'NONE');
  await expect.poll(() => panel.evaluate(node => Math.round(innerHeight - node.getBoundingClientRect().bottom))).toBe(96);
  await page.setViewportSize({ width: 390, height: 844 }); await expect(panel).toHaveCount(0);
  await toggleSettings(page); await expect(page.getByRole('checkbox', { name: '현재 장면 하단에도 표시' })).toHaveCount(0); await toggleSettings(page);
  await page.setViewportSize({ width: 1440, height: 900 }); await expect(panel).toBeVisible();
  await toggleSettings(page); await page.getByRole('button', { name: '여행 저장·열기', exact: true }).click();
  const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: '프로젝트 파일 저장', exact: true }).click();
  const path = info.outputPath('scene.travel-camera.json'); await (await downloading).saveAs(path);
  expect(JSON.parse(await readFile(path, 'utf8')).preferences.showBottomScene).toBe(true);
  await page.reload(); await loadLocalTimeline(page);
  await page.getByLabel('재생 위치', { exact: true }).fill('10'); await expect(panel).toBeVisible();
  await toggleSettings(page); await page.getByRole('button', { name: '경로 재생 설정', exact: true }).click();
  await page.getByRole('checkbox', { name: '현재 장면 하단에도 표시' }).uncheck();
  await page.getByRole('button', { name: '여행 저장·열기', exact: true }).click();
  await page.getByLabel('여행 프로젝트 파일 열기').setInputFiles(path);
  await page.getByRole('button', { name: '이 여행 복원', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '여행 저장·열기', exact: true })).toBeHidden();
  await expect(panel).toBeVisible();
  await page.getByRole('button', { name: '사진 여정', exact: true }).click(); await expect(panel).toHaveCount(0);
  // Older v1 projects should still open after the optional preference was added.
  const older = JSON.parse(await readFile(path, 'utf8')); delete older.preferences.showBottomScene;
  await toggleSettings(page); await page.getByRole('button', { name: '여행 저장·열기', exact: true }).click();
  await page.getByLabel('여행 프로젝트 파일 열기').setInputFiles({ name: 'old.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(older)) });
  await page.getByLabel('프로젝트 타임라인 원본 선택').setInputFiles({ name: 'e2e-timeline.json', mimeType: 'application/json', buffer: Buffer.from(E2E_TIMELINE) });
  await page.getByRole('button', { name: '이 여행 복원', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '여행 저장·열기', exact: true })).toBeHidden();
  await expect(panel).toBeVisible();
});
