import { expect, test } from '@playwright/test';
import { attachLocalPhotoManifest, loadLocalTimeline } from './helpers';

test('offline background failure still permits local playback and map reconnection', async ({ page }) => {
  await page.route('https://tiles.openfreemap.org/**', route => route.abort());
  await page.goto('/');
  await loadLocalTimeline(page);
  await expect(page.getByText('배경 지도에 연결하지 못해 경로와 사진만 표시합니다.', { exact: false })).toBeVisible();
  await expect(page.locator('.map-loading')).toBeHidden();
  await page.getByRole('button', { name: '재생', exact: true }).click();
  await expect.poll(async () => Number(await page.getByLabel('재생 위치', { exact: true }).inputValue())).toBeGreaterThan(0);
  await page.getByRole('button', { name: '일시정지', exact: true }).click();
  await page.getByRole('button', { name: '지도 다시 연결', exact: true }).click();
  await expect(page.getByRole('button', { name: '재생', exact: true })).toBeEnabled();
});

test('local photo import can be aborted and retried without leaving playback busy', async ({ page }) => {
  let hold = true;
  let release: () => void = () => undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/local-media-manifest', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({
    available: true, rootName: '검사 사진', count: 1, totalBytes: 100,
    items: [{ id: 'slow-photo', name: '20260410_091500.jpg', size: 100, lastModified: Date.parse('2026-04-10T09:15:00+09:00'), kind: 'image' }]
  }) }));
  await page.route('**/api/local-media/slow-photo', async route => {
    if (hold) await gate;
    await route.fulfill({ contentType: 'image/jpeg', body: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) }).catch(() => undefined);
  });
  await page.goto('/');
  // loadLocalTimeline waits for playback, which is intentionally blocked by this slow import.
  await page.getByLabel('타임라인 파일 열기', { exact: true }).setInputFiles({ name: 'trip.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ semanticSegments: [{
    startTime: '2026-04-10T09:00:00+09:00', endTime: '2026-04-10T09:30:00+09:00',
    activity: { start: { latLng: '37.5, 127' }, end: { latLng: '37.51, 127.01' }, distanceMeters: 1800, topCandidate: { type: 'WALKING', probability: 0.9 } }
  }] })) });
  await page.getByRole('button', { name: '사진 연결 취소', exact: true }).click();
  await expect(page.getByRole('button', { name: '재생', exact: true })).toBeEnabled();
  await expect(page.locator('.status-card')).toBeHidden();
  hold = false; release();
  await page.getByRole('button', { name: '사진 여정', exact: true }).click();
  await page.locator('.settings-panel summary').click();
  await page.getByRole('button', { name: '사진 다시 연결', exact: true }).click();
  await expect(page.getByText('1개의 사진·영상을 연결했습니다.', { exact: true })).toBeAttached();
  await expect(page.getByRole('button', { name: '사진 연결 취소', exact: true })).toBeHidden();
});

test('unsupported folder preserves the existing library and supports recovery', async ({ page }) => {
  await attachLocalPhotoManifest(page);
  await page.goto('/');
  await loadLocalTimeline(page);
  await page.getByRole('button', { name: '사진 여정', exact: true }).click();
  await page.locator('.settings-panel summary').click();
  await page.locator('.media-import-row input[type=file]').first().setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a photo') });
  await expect(page.getByRole('alert')).toContainText('지원하는 사진·영상이 없습니다');
  await page.getByRole('button', { name: '기존 여행으로 돌아가기', exact: true }).click();
  await expect(page.getByRole('alert')).toBeHidden();
  await page.locator('.settings-panel summary').click();
  await page.getByRole('button', { name: '사진 목록 관리', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '사진 목록', exact: true }).getByRole('checkbox')).toHaveCount(1);
});
