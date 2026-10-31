import { expect, test } from '@playwright/test';
import { loadLocalTimeline } from '../helpers';

test('mode changes preserve independent cursors, stop the outgoing session and keep the latest selection', async ({ page }) => {
  await page.route('https://tiles.openfreemap.org/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 8, sources: {}, layers: [] }) }));
  await page.goto('./');
  await loadLocalTimeline(page);
  const position = page.getByLabel('재생 위치', { exact: true });
  const route = page.getByRole('button', { name: '경로 보기', exact: true });
  const photos = page.getByRole('button', { name: '사진 여정', exact: true });
  await position.fill('10');
  await photos.click(); await position.fill('18');
  for (let i = 0; i < 3; i += 1) {
    await route.click(); await expect(position).toHaveValue('10');
    await photos.click(); await expect(position).toHaveValue('18');
  }
  await page.getByRole('button', { name: '재생', exact: true }).click();
  await expect.poll(async () => Number(await position.inputValue())).toBeGreaterThan(18);
  await route.click();
  await expect(page.locator('main')).toHaveAttribute('data-playing-mode', 'NONE');
  await expect(position).toHaveValue('10');
  await photos.click();
  const pausedPhoto = await position.inputValue();
  await page.waitForTimeout(700);
  await expect(position).toHaveValue(pausedPhoto);
  await route.click(); await page.getByRole('button', { name: '처음부터 보기', exact: true }).click();
  await photos.click(); await expect(position).toHaveValue(pausedPhoto);
  await route.click(); await expect(position).toHaveValue('0');
  // Starting before the split settles must not be overridden by a late overview.
  await page.getByRole('button', { name: '재생', exact: true }).click();
  await page.waitForTimeout(700);
  await expect(page.locator('main')).toHaveAttribute('data-playing-mode', 'ROUTE');
  await expect.poll(async () => Number(await position.inputValue())).toBeGreaterThan(0);
});
