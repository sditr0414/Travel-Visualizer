import { expect, test } from '@playwright/test';
import { loadLocalTimeline } from './helpers';

test('video copy is explicit, reports progress and cancels when closed', async ({ page }) => {
  let cancelled = 0;
  await page.route('**/api/local-media-manifest', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ available: true, rootName: 'videos', count: 1, totalBytes: 1, items: [{ id: 'video', name: '20260410_091500.mp4', size: 1, lastModified: 1000, kind: 'video', metadata: { takenMs: Date.parse('2026-04-10T00:15:00Z'), lat: null, lng: null, source: 'takeout-sidecar', embeddedScanned: true } }] }) }));
  await page.route('**/api/local-media/video', route => route.fulfill({ contentType: 'video/mp4', body: 'unsupported-video' }));
  await page.route('**/api/video-copy', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ contentType: 'application/json', body: '{"available":true}' });
    expect(route.request().postDataJSON()).toMatchObject({ id: 'video', preview: true, takenMs: Date.parse('2026-04-10T00:15:00Z') });
    return route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ id: 'job', state: 'running', progress: 0.4, name: 'copy.mp4', preview: true, error: null }) });
  });
  await page.route('**/api/video-copy/job', route => {
    if (route.request().method() === 'DELETE') cancelled += 1;
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: 'job', state: cancelled ? 'cancelled' : 'running', progress: 0.4, name: 'copy.mp4', preview: true, error: null }) });
  });
  await page.goto('/'); await loadLocalTimeline(page);
  await page.getByRole('button', { name: '사진 여정', exact: true }).click();
  await page.locator('.settings-panel summary').click(); await page.getByRole('button', { name: '사진 목록 관리' }).click();
  await page.getByRole('button', { name: /호환 사본$/ }).click();
  const dialog = page.getByRole('dialog', { name: '호환 영상 사본', exact: true });
  await expect(dialog.getByLabel('영상 사본 범위')).toHaveValue('preview');
  await dialog.getByRole('button', { name: 'H.264 사본 만들기' }).click();
  await expect(dialog.getByRole('progressbar')).toHaveAttribute('value', '0.4');
  await expect(dialog.getByRole('button', { name: 'H.264 사본 만들기' })).toBeDisabled();
  await page.getByRole('button', { name: '호환 영상 사본 닫기' }).click();
  await expect.poll(() => cancelled).toBeGreaterThan(0);
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: '사진 목록 관리' }).click();
  await expect(page.getByRole('dialog', { name: '사진 목록', exact: true })).toContainText('1개 중 1개');
});
