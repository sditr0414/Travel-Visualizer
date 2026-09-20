import { expect, test } from '@playwright/test';
import { attachLocalPhotoManifest, loadLocalTimeline } from './helpers';

test('individual movements keep separate distances and include their assigned estimated gap', async ({ page }) => {
  await attachLocalPhotoManifest(page);
  await page.goto('/');
  await page.getByLabel('타임라인 파일 열기', { exact: true }).setInputFiles({
    name: 'individual-distances.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ semanticSegments: [
      { startTime: '2026-04-10T09:00:00+09:00', endTime: '2026-04-10T09:30:00+09:00',
        activity: { start: { latLng: '37.5000°, 127.0000°' }, end: { latLng: '37.5100°, 127.0100°' },
          distanceMeters: 1800, topCandidate: { type: 'WALKING', probability: 0.95 } } },
      { startTime: '2026-04-10T09:30:00+09:00', endTime: '2026-04-10T09:40:00+09:00',
        activity: { start: { latLng: '37.5110°, 127.0110°' }, end: { latLng: '37.5140°, 127.0140°' },
          distanceMeters: 650, topCandidate: { type: 'WALKING', probability: 0.95 } } }
    ] }))
  });
  await expect(page.getByRole('button', { name: '재생', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '사진 여정', exact: true }).click();
  await page.locator('.settings-panel summary').click();
  await page.getByLabel('날짜 변경 표시', { exact: true }).uncheck();
  await page.locator('.settings-panel summary').click();
  for (const [mode, selector] of [['경로 보기', '.journey-hud'], ['사진 여정', '.is-current .media-transit']]) {
    await page.getByRole('button', { name: mode, exact: true }).click();
    await page.getByLabel('처음부터 보기', { exact: true }).click();
    await page.getByLabel('재생 위치').press('ArrowRight');
    await expect(page.locator(`${selector} .movement-distance`)).toHaveText('1.8 km');
    const position = page.getByLabel('재생 위치');
    const box = (await position.boundingBox())!;
    await position.click({ position: { x: box.width * 0.8, y: box.height / 2 } });
    // The second 650 m walk owns the approximately 142 m coordinate gap.
    await expect(page.locator(`${selector} .movement-distance`)).toHaveText('792 m');
    await position.press('End');
    const summary = page.getByRole('region', { name: '전체 여정 분석' });
    await expect(summary.locator('.journey-summary-total strong')).toHaveText('2.6 km');
    await expect(summary.locator('.journey-summary-distance')).toHaveText('2.6 km');
    await expect(summary).not.toContainText('km/h');
  }
});

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
  await page.getByLabel('재생 위치').press('ArrowRight');
  await expect(page.locator('.journey-hud .hud-mobility-label')).toHaveText('대중교통');
  await expect(page.locator('.journey-hud .hud-mobility-icon')).toHaveText('🚇');
  await expect(page.locator('.journey-hud .movement-distance')).toHaveText('8 km');
  await page.getByRole('button', { name: '사진 여정', exact: true }).click();
  await page.locator('.settings-panel summary').click();
  await page.getByLabel('날짜 변경 표시', { exact: true }).uncheck();
  await page.locator('.settings-panel summary').click();
  await page.getByLabel('처음부터 보기', { exact: true }).click();
  await page.getByLabel('재생 위치').press('ArrowRight');
  await expect(page.locator('.is-current .movement-mode')).toHaveText('대중교통');
  await expect(page.locator('.is-current .movement-pictogram')).toHaveText('🚇');
  await expect(page.locator('.is-current .movement-distance')).toHaveText('8 km');
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
  await page.getByLabel('재생 위치').press('ArrowRight');
  const icon = page.locator('.is-current .movement-pictogram');
  const name = page.locator('.is-current .movement-mode');
  await expect(icon).toHaveText('🚶');
  await expect(name).toHaveText('도보');
  const distance = page.locator('.is-current .movement-distance');
  await expect(distance).toHaveText('1.8 km');
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


test('opening, reset and closing views share the complete trip summary in both modes', async ({ page }, testInfo) => {
  await attachLocalPhotoManifest(page);
  await page.goto('/');
  await loadLocalTimeline(page);
  const position = page.getByLabel('재생 위치');
  for (const mode of ['경로 보기', '사진 여정']) {
    await page.getByRole('button', { name: mode, exact: true }).click();
    const summary = page.getByRole('region', { name: '전체 여정 분석' });
    await expect(summary).toBeVisible();
    await expect(position).toHaveValue('0');
    await expect(summary.locator('.journey-summary-period')).toHaveText('2026.4.10 – 2026.4.11총 2일');
    await expect(summary.locator('.journey-summary-total strong')).toHaveText('7 km');
    await expect(summary.locator('.journey-summary-mode')).toHaveText(['🚗차량', '🚶도보']);
    await expect(summary.locator('.journey-summary-distance')).toHaveText(['5.2 km', '1.8 km']);
    await expect(summary.locator('.journey-summary-share')).toHaveText(['74.3%', '25.7%']);
    const original = (await summary.textContent())!;
    await page.getByRole('button', { name: '재생', exact: true }).click();
    await expect(summary).toHaveCount(0);
    await page.getByRole('button', { name: '일시정지', exact: true }).click();
    await page.getByLabel('처음부터 보기', { exact: true }).click();
    await expect(position).toHaveValue('0');
    await expect(summary).toHaveText(original);
    await position.press('End');
    await expect(summary).toHaveText(original);
    await expect(summary).not.toContainText('km/h');
    const box = (await summary.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    expect(await summary.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await testInfo.attach(`journey-summary-${mode}`, { body: await page.screenshot(), contentType: 'image/png' });
  }
});
