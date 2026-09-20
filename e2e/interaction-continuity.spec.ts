import { expect, test } from '@playwright/test';
import { attachLocalPhotoManifest, loadLocalTimeline } from './helpers';

test('estimated transport appears consistently in the map and photo journey', async ({ page, isMobile }, testInfo) => {
  await attachLocalPhotoManifest(page);
  await page.goto('/');
  await page.getByLabel('타임라인 파일 열기', { exact: true }).setInputFiles({
    name: 'unknown-transport.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ semanticSegments: [{
      startTime: '2026-04-10T09:00:00+09:00', endTime: '2026-04-10T09:15:00+09:00',
      activity: { start: { latLng: '37.5000°, 127.0000°' }, end: { latLng: '37.5400°, 127.0400°' },
        distanceMeters: 8000, topCandidate: { type: 'UNKNOWN', probability: 0 } }
    }] }))
  });
  await expect(page.getByRole('button', { name: '재생', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '경로 보기', exact: true }).click();
  await expect(page.locator('.journey-hud > strong')).toHaveText('대중교통');
  await expect(page.locator('.journey-hud .movement-distance')).toHaveText('총 8 km');
  await page.getByRole('button', { name: '사진 여정', exact: true }).click();
  await page.locator('.settings-panel summary').click();
  await page.getByLabel('날짜 변경 표시', { exact: true }).uncheck();
  await page.locator('.settings-panel summary').click();
  await page.getByLabel('처음부터 보기', { exact: true }).click();
  await expect(page.locator('.is-current .movement-mode')).toHaveText('대중교통');
  await expect(page.locator('.is-current .movement-pictogram')).toHaveText('🚇');
  await expect(page.locator('.is-current .movement-distance')).toHaveText('총 8 km');
  await testInfo.attach(`estimated-transport-${isMobile ? 'mobile' : 'desktop'}`, { body: await page.screenshot(), contentType: 'image/png' });
});

test('checkbox whitespace and help never toggle values; the visible box and Space do', async ({ page }) => {
  await attachLocalPhotoManifest(page);
  await page.goto('/');
  await loadLocalTimeline(page);
  await page.getByRole('button', { name: '사진 여정', exact: true }).click();
  await page.locator('.settings-panel summary').click();
  await page.getByRole('combobox', { name: '영상 재생', exact: true }).selectOption('PLAY');
  for (const name of ['정확한 장소 온라인 확인', '날짜 변경 표시', '영상 소리 재생', '항공 경로 포함', '현재 위치 따라가기']) {
    const box = page.getByRole('checkbox', { name, exact: true });
    const initial = await box.isChecked();
    const row = box.locator('..');
    await row.scrollIntoViewIfNeeded();
    const bounds = (await row.boundingBox())!;
    await row.click({ position: { x: bounds.width - 2, y: bounds.height / 2 } });
    expect(await box.isChecked()).toBe(initial);
    await page.getByRole('button', { name: `${name} 설명`, exact: true }).click();
    expect(await box.isChecked()).toBe(initial);
    await expect(page.getByRole('tooltip')).toBeVisible();
    await page.keyboard.press('Escape');
    if (await box.isDisabled()) continue;
    const hit = (await box.boundingBox())!;
    expect(hit.width).toBe(24);
    expect(hit.height).toBe(24);
    await box.click();
    expect(await box.isChecked()).toBe(!initial);
    await box.focus();
    await page.keyboard.press('Space');
    expect(await box.isChecked()).toBe(initial);
  }
});

test('transport names retain the original column and natural emoji text box', async ({ page, isMobile }, testInfo) => {
  await attachLocalPhotoManifest(page);
  await page.goto('/');
  await loadLocalTimeline(page);
  await page.getByRole('button', { name: '사진 여정', exact: true }).click();
  await page.locator('.settings-panel summary').click();
  await page.getByLabel('날짜 변경 표시', { exact: true }).uncheck();
  await page.locator('.settings-panel summary').click();
  await page.getByLabel('처음부터 보기', { exact: true }).click();
  const icon = page.locator('.is-current .movement-pictogram');
  const name = page.locator('.is-current .movement-mode');
  await expect(icon).toHaveText('🚶');
  await expect(name).toHaveText('도보');
  const distance = page.locator('.is-current .movement-distance');
  await expect(distance).toHaveText('총 1.8 km');
  const distanceBox = (await distance.boundingBox())!;
  const paneBox = (await page.locator('.media-journey-pane').boundingBox())!;
  expect(distanceBox.x).toBeGreaterThanOrEqual(paneBox.x);
  expect(distanceBox.x + distanceBox.width).toBeLessThanOrEqual(paneBox.x + paneBox.width);
  await expect(icon).toHaveCSS('display', 'block');
  await expect.poll(async () => {
    const a = await icon.boundingBox();
    const b = await name.boundingBox();
    return a && b ? Math.abs(a.x + a.width / 2 - b.x - b.width / 2) : Infinity;
  }).toBeLessThan(1);
  const a = (await icon.boundingBox())!;
  const b = (await name.boundingBox())!;
  expect(b.y).toBeGreaterThan(a.y + a.height);
  await testInfo.attach(`transport-${isMobile ? 'mobile' : 'desktop'}`, { body: await page.screenshot(), contentType: 'image/png' });
});
