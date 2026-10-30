import { readFile, writeFile, utimes } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

// Entirely synthetic; personal Timeline exports must never enter test artifacts.
const positions = [0, 5, 10, 15].map(minute => ({ position: {
  LatLng: `${37.5 + minute * .001}°, 127.0000°`,
  timestamp: new Date(Date.parse('2026-04-10T09:00:00+09:00') + minute * 60_000).toISOString(),
  accuracyMeters: 10
} }));
const rawSignals = [...positions, ...Array.from({ length: 16 }, (_, minute) => ({ activityRecord: {
  timestamp: new Date(Date.parse('2026-04-10T09:00:00+09:00') + minute * 60_000).toISOString(),
  probableActivities: [{ type: 'IN_VEHICLE', confidence: .95 }, { type: 'IN_RAIL_VEHICLE', confidence: .95 }]
} }))];
const timeline = { name: 'raw-positions.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ rawSignals: [...rawSignals].reverse(), userLocationProfile: {} })) };

test('raw-only Timeline opens, plays, connects photos and restores from a saved trip', async ({ page }, info) => {
  await page.route('https://tiles.openfreemap.org/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#edeae2' } }] }) }));
  const errors: string[] = [];
  const uploads: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.method() !== 'GET' || request.url().includes('/api/')) uploads.push(request.method()); });
  await page.goto('./');
  await page.getByLabel('시작할 타임라인 파일 열기', { exact: true }).setInputFiles(timeline);
  const play = page.getByRole('button', { name: '재생', exact: true });
  await expect(play).toBeEnabled();
  await play.click();
  await expect.poll(async () => Number(await page.getByLabel('재생 위치', { exact: true }).inputValue())).toBeGreaterThan(0);
  await page.getByRole('button', { name: '일시정지', exact: true }).click();
  await page.getByLabel('재생 위치', { exact: true }).fill('5');
  await expect(page.locator('.bottom-scene-mobility, .route-persistent-hud').filter({ visible: true }).first()).toContainText('기차');
  await page.locator('.settings-panel summary').click();
  await expect(page.locator('.settings-content')).toContainText('원시 위치 기록으로 경로를 구성했습니다.');
  await page.locator('.settings-panel summary').click();

  const photo = { name: '20260410_090500.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') };
  const photoPath = info.outputPath(photo.name);
  await writeFile(photoPath, photo.buffer);
  await utimes(photoPath, new Date('2026-04-10T00:05:00Z'), new Date('2026-04-10T00:05:00Z'));
  await page.getByRole('button', { name: '사진 여정', exact: true }).click();
  await page.locator('.media-import-row input[type=file]').first().setInputFiles(photoPath);
  await expect(play).toBeEnabled();
  await page.locator('.settings-panel summary').click();
  await page.getByRole('button', { name: '사진 목록 관리', exact: true }).click();
  await page.getByRole('button', { name: /장면 보기/ }).click();
  await expect(page.locator('.is-current img')).toBeVisible();
  await page.locator('.settings-panel summary').click();
  await page.getByRole('button', { name: '여행 저장·열기', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '프로젝트 파일 저장', exact: true }).click();
  const projectPath = info.outputPath('raw.travel-camera.json');
  await (await download).saveAs(projectPath);
  expect(await readFile(projectPath, 'utf8')).not.toMatch(/"(?:rawSignals|LatLng|lat|lng|frames)"/);
  await page.reload();
  await page.getByRole('button', { name: '저장한 여행 열기', exact: true }).click();
  await page.getByLabel('여행 프로젝트 파일 열기').setInputFiles(projectPath);
  await page.getByLabel('프로젝트 타임라인 원본 선택').setInputFiles(timeline);
  await page.getByLabel('프로젝트 사진 파일 선택').setInputFiles(photoPath);
  await page.getByRole('button', { name: '이 여행 복원', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '여행 저장·열기', exact: true })).toBeHidden();
  await expect(play).toBeEnabled();
  await expect(page.locator('.is-current img')).toBeVisible();
  await page.getByLabel('타임라인 파일 열기', { exact: true }).setInputFiles({ name: 'no-positions.json', mimeType: 'application/json', buffer: Buffer.from('{"rawSignals":[{"wifiScan":{}}]}') });
  await expect(page.getByRole('alert')).toContainText('위치·시각 기록이 부족');
  await expect(play).toBeEnabled();
  expect(uploads).toEqual([]);
  expect(errors).toEqual([]);
});
