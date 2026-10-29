import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { loadLocalTimeline } from './helpers';

test.use({ timezoneId: 'UTC' });
test('search and date filters preserve exclusions, jump to a photo and restore capture zone', async ({ page }, info) => {
  test.setTimeout(60000);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  await page.goto('/'); await loadLocalTimeline(page);
  await page.getByRole('button', { name: '사진 여정', exact: true }).click();
  await page.locator('.media-import-row input[type=file]').first().setInputFiles([
    { name: '20260410_230500_sunset.png', mimeType: 'image/png', buffer: png },
    { name: '20260411_090500_cafe.png', mimeType: 'image/png', buffer: png },
    { name: '20260411_090510_cafe2.png', mimeType: 'image/png', buffer: png }
  ]);
  await expect(page.getByRole('button', { name: '재생', exact: true })).toBeEnabled();
  await page.locator('.settings-panel summary').click(); await page.getByRole('button', { name: '사진 목록 관리' }).click();
  const library = page.getByRole('dialog', { name: '사진 목록', exact: true });
  await expect(library).toContainText('3개 중 3개');
  await library.locator('.capture-time-settings summary').click();
  await page.getByLabel('촬영 시간대', { exact: true }).fill('Asia/Tokyo');
  await page.getByRole('button', { name: '촬영 시간대 적용' }).click();
  await expect(library).toContainText('촬영 시간대를 적용했습니다.');
  let release: () => void = () => undefined;
  let requested: () => void = () => undefined;
  const held = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { requested = resolve; });
  await page.route('**/*media.worker*', async route => { requested(); await held; await route.continue().catch(() => undefined); });
  await page.getByLabel('촬영 시간대', { exact: true }).fill('+05:30');
  await page.getByRole('button', { name: '촬영 시간대 적용' }).click(); await started;
  await page.getByRole('button', { name: '시간대 변경 취소' }).click(); release();
  await page.unroute('**/*media.worker*');
  await expect(library.locator('.capture-time-settings summary')).toContainText('Asia/Tokyo');
  await page.getByLabel('사진 날짜로 이동').selectOption('2026-04-10');
  await expect(library.locator('.library-row')).toHaveCount(1);
  await expect(library.locator('time')).toHaveAttribute('datetime', '2026-04-10T14:05:00.000Z');
  await library.getByRole('checkbox').uncheck();
  await page.getByLabel('사진 포함 상태').selectOption('EXCLUDED');
  await expect(library.locator('.library-row')).toHaveCount(1);
  await page.getByLabel('사진 파일명 검색').fill('missing'); await expect(library).toContainText('검색 조건에 맞는 사진이 없습니다.');
  await page.getByRole('button', { name: '검색 조건 지우기' }).click();
  await page.getByLabel('사진 파일명 검색').fill('CAFE2'); await expect(library.locator('.library-row')).toHaveCount(1);
  await library.getByRole('button', { name: /장면 보기/ }).click();
  await expect(library).toBeHidden(); await expect(page.locator('.is-current img')).toBeVisible();
  await expect(page.getByRole('button', { name: '사진 여정', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.settings-panel summary').click(); await page.getByRole('button', { name: '여행 저장·열기', exact: true }).click();
  const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: '프로젝트 파일 저장', exact: true }).click();
  const file = info.outputPath('search.travel-camera.json'); await (await downloading).saveAs(file);
  const body = await readFile(file, 'utf8'); const saved = JSON.parse(body);
  expect(saved.preferences.captureTimeZone).toBe('Asia/Tokyo'); expect(saved.media.filter((item: { excluded: boolean }) => item.excluded)).toHaveLength(1);
  expect(saved.preferences.photoViewMode).toBe('ALL');
  await page.getByLabel('여행 프로젝트 파일 열기').setInputFiles(file); await page.getByRole('button', { name: '이 여행 복원', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '여행 저장·열기', exact: true })).toBeHidden();
  await page.locator('.settings-panel summary').click(); await page.getByRole('button', { name: '사진 목록 관리' }).click();
  await page.getByRole('button', { name: '검색 조건 지우기' }).click();
  await page.getByLabel('사진 포함 상태').selectOption('EXCLUDED'); await expect(library.locator('.library-row')).toHaveCount(1);
  await expect(library.locator('time')).toHaveAttribute('datetime', '2026-04-10T14:05:00.000Z');
  await expect(library).toContainText('Asia/Tokyo');
  await info.attach('photo-search-timezone', { body: await page.screenshot(), contentType: 'image/png' });
});
