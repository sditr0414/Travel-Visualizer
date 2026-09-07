import { expect, test, type Page } from '@playwright/test';
import { attachLocalPhotoManifest, loadLocalTimeline } from './helpers';

async function shot(page: Page, name: string) {
  const project = test.info().project.name;
  await page.screenshot({ path: `ui-audit/${project}-${name}.png`, fullPage: true });
}

test('capture primary UI states', async ({ page }) => {
  await attachLocalPhotoManifest(page);
  await page.goto('/');
  await shot(page, '01-start');

  await page.getByRole('button', { name: '사용 방법' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await shot(page, '02-help');
  await page.getByRole('button', { name: '처음 사용하는 분을 위한 안내 닫기' }).click();

  await loadLocalTimeline(page);
  await shot(page, '03-trip-photo');

  await page.locator('.settings-panel summary').click();
  await expect(page.locator('.settings-panel .settings-content')).toBeVisible();
  await shot(page, '04-photo-settings');

  await page.getByRole('button', { name: /사진 목록/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await shot(page, '05-photo-library');
  await page.getByRole('button', { name: '사진 목록 닫기' }).click();

  await page.locator('.settings-panel summary').click();
  await page.getByRole('button', { name: '발자취' }).click();
  await shot(page, '06-route');

  await page.locator('.settings-panel summary').click();
  await expect(page.locator('.settings-panel .settings-content')).toBeVisible();
  await shot(page, '07-route-settings');
});
