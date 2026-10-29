import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { attachLocalPhotoManifest, E2E_TIMELINE, loadLocalTimeline } from './helpers';

async function seek(page: Page, value: number) {
  await page.getByLabel('재생 위치', { exact: true }).evaluate((node, next) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, String(next));
    node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}
async function openProject(page: Page) {
  await page.locator('.settings-panel summary').click();
  await page.getByRole('button', { name: '여행 저장·열기', exact: true }).click();
}
async function loadProject(page: Page, body: string) {
  await page.getByLabel('여행 프로젝트 파일 열기').setInputFiles({ name: 'saved.travel-camera.json', mimeType: 'application/json', buffer: Buffer.from(body) });
}

test('project download restores range, exclusions, both cursors and preferences after reload', async ({ page }, testInfo) => {
  await attachLocalPhotoManifest(page);
  await page.goto('/'); await loadLocalTimeline(page);
  await page.getByRole('button', { name: '사진 여정', exact: true }).click();
  await page.locator('.settings-panel summary').click();
  await page.getByLabel('여행 마지막 날', { exact: true }).fill('2026-04-10');
  await page.getByRole('button', { name: '경로 다시 만들기', exact: true }).click();
  await expect(page.getByRole('button', { name: '재생', exact: true })).toBeEnabled();
  await page.locator('.settings-panel summary').click();
  await page.getByRole('button', { name: '경로 재생 설정', exact: true }).click();
  await page.getByLabel('일시정지 시 전체 경로 표시', { exact: true }).check();
  await page.getByRole('button', { name: '사진 목록 관리' }).click();
  const library = page.getByRole('dialog', { name: '사진 목록', exact: true });
  await library.getByRole('checkbox').uncheck();
  await page.getByRole('button', { name: '사진 목록 닫기' }).click();
  await page.locator('.settings-panel summary').click();
  await page.getByRole('button', { name: '경로 보기', exact: true }).click(); await seek(page, 4);
  await page.getByRole('button', { name: '사진 여정', exact: true }).click(); await seek(page, 8);
  await openProject(page);
  await page.getByLabel('저장할 여행 이름').fill('회귀 여행');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '프로젝트 파일 저장', exact: true }).click();
  const download = await downloaded; const path = testInfo.outputPath('saved.travel-camera.json'); await download.saveAs(path);
  const body = await readFile(path, 'utf8'); const saved = JSON.parse(body);
  expect(saved.range).toEqual({ startDate: '2026-04-10', endDate: '2026-04-10' });
  expect(saved.view.cursors.ROUTE).toBeCloseTo(4); expect(saved.view.cursors.PHOTOS).toBeCloseTo(8);
  expect(saved.media).toHaveLength(1); expect(saved.media[0].excluded).toBe(true);
  expect(body).not.toMatch(/"(?:lat|lng|sourceUrl|frames|semanticSegments)"/);
  await page.getByRole('button', { name: '여행 저장·열기 닫기' }).click();
  await page.locator('.settings-panel summary').click(); await page.getByLabel('일시정지 시 전체 경로 표시', { exact: true }).uncheck();
  await page.reload();
  await page.getByRole('button', { name: '저장한 여행 열기', exact: true }).click();
  await loadProject(page, body);
  await page.getByRole('button', { name: '이 여행 복원', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '여행 저장·열기', exact: true }).getByRole('alert')).toContainText('타임라인 원본');
  await page.getByLabel('프로젝트 타임라인 원본 선택').setInputFiles({ name: 'renamed.json', mimeType: 'application/json', buffer: Buffer.from(E2E_TIMELINE) });
  await page.getByRole('button', { name: '이 여행 복원', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '여행 저장·열기', exact: true })).toBeHidden();
  await expect(page.getByLabel('재생 위치', { exact: true })).toHaveValue('8');
  await expect(page.getByRole('button', { name: '사진 여정', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '경로 보기', exact: true }).click(); await expect(page.getByLabel('재생 위치', { exact: true })).toHaveValue('4');
  await page.getByRole('button', { name: '사진 여정', exact: true }).click();
  await page.locator('.settings-panel summary').click();
  await expect(page.getByLabel('여행 마지막 날', { exact: true })).toHaveValue('2026-04-10');
  await expect(page.getByRole('button', { name: '경로 재생 설정', exact: true })).toContainText('변경 1개');
  await page.getByRole('button', { name: '경로 재생 설정', exact: true }).click();
  await expect(page.getByLabel('일시정지 시 전체 경로 표시', { exact: true })).toBeChecked();
  await page.getByRole('button', { name: '사진 목록 관리' }).click(); await expect(library.getByRole('checkbox')).not.toBeChecked();
  await page.getByRole('button', { name: '사진 목록 닫기' }).click(); await page.locator('.settings-panel summary').click();
  // Importing the same project replaces the session, never appends duplicate media.
  await openProject(page); await loadProject(page, body); await loadProject(page, body);
  await page.getByRole('button', { name: '이 여행 복원', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '여행 저장·열기', exact: true })).toBeHidden();
  await expect(page.getByLabel('재생 위치', { exact: true })).toHaveValue('8');
  await testInfo.attach('project-restored', { body: await page.screenshot(), contentType: 'image/png' });
});

test('failed and cancelled replacements keep the current trip usable', async ({ page }, testInfo) => {
  await attachLocalPhotoManifest(page); await page.goto('/'); await loadLocalTimeline(page);
  await page.getByRole('button', { name: '경로 보기', exact: true }).click(); await seek(page, 4);
  await openProject(page);
  const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: '프로젝트 파일 저장', exact: true }).click();
  const download = await downloading; const path = testInfo.outputPath('source.travel-camera.json'); await download.saveAs(path);
  const body = await readFile(path, 'utf8');
  await loadProject(page, '{invalid'); await expect(page.getByRole('dialog', { name: '여행 저장·열기', exact: true }).getByRole('alert')).toBeVisible();
  await loadProject(page, body);
  await page.getByLabel('프로젝트 타임라인 원본 선택').setInputFiles({ name: 'timeline.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
  await page.getByRole('button', { name: '이 여행 복원', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '여행 저장·열기', exact: true }).getByRole('alert')).toContainText('내용이 다르거나');
  await loadProject(page, body);
  await page.getByLabel('프로젝트 사진 파일 선택').setInputFiles({ name: 'wrong.png', mimeType: 'image/png', buffer: Buffer.from('wrong') });
  await page.getByRole('button', { name: '이 여행 복원', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '여행 저장·열기', exact: true }).getByRole('alert')).toContainText('원본 사진·영상 1개');
  await page.getByRole('button', { name: '여행 저장·열기 닫기' }).click();
  await expect(page.getByLabel('재생 위치', { exact: true })).toHaveValue('4');
  // Invalid replacement Timeline JSON also keeps the loaded plan and worker intact.
  await page.getByLabel('타임라인 파일 열기', { exact: true }).setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{bad') });
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: '기존 여행으로 돌아가기', exact: true }).click();
  await expect(page.getByLabel('재생 위치', { exact: true })).toHaveValue('4');
  await openProject(page); await loadProject(page, body);
  let release: () => void = () => undefined;
  let requested: () => void = () => undefined;
  const held = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { requested = resolve; });
  await page.route('**/*timeline.worker*', async route => { requested(); await held; await route.continue().catch(() => undefined); });
  await page.getByRole('button', { name: '이 여행 복원', exact: true }).click(); await started;
  await page.getByRole('button', { name: '복원 취소', exact: true }).click(); release();
  await expect(page.getByRole('dialog', { name: '여행 저장·열기', exact: true })).toBeHidden();
  await expect(page.getByLabel('재생 위치', { exact: true })).toHaveValue('4');
  await page.getByRole('button', { name: '재생', exact: true }).click();
  await expect.poll(async () => Number(await page.getByLabel('재생 위치', { exact: true }).inputValue())).toBeGreaterThan(4);
});

test('cancelling a replacement timeline preserves the active worker for replanning', async ({ page }) => {
  await page.goto('/'); await loadLocalTimeline(page); await seek(page, 4);
  let release: () => void = () => undefined;
  let requested: () => void = () => undefined;
  const held = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { requested = resolve; });
  await page.route('**/*timeline.worker*', async route => { requested(); await held; await route.continue().catch(() => undefined); });
  await page.getByLabel('타임라인 파일 열기', { exact: true }).setInputFiles({ name: 'replacement.json', mimeType: 'application/json', buffer: Buffer.from(E2E_TIMELINE) });
  await started;
  await page.getByRole('button', { name: '타임라인 연결 취소', exact: true }).click(); release();
  await expect(page.getByLabel('재생 위치', { exact: true })).toHaveValue('4');
  await page.locator('.settings-panel summary').click();
  await expect(page.locator('.source-summary')).toContainText('e2e-timeline.json');
  await page.getByLabel('여행 마지막 날', { exact: true }).fill('2026-04-10');
  await page.getByRole('button', { name: '경로 다시 만들기', exact: true }).click();
  await expect(page.getByRole('button', { name: '재생', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '재생', exact: true }).click();
  await expect.poll(async () => Number(await page.getByLabel('재생 위치', { exact: true }).inputValue())).toBeGreaterThan(0);
});
