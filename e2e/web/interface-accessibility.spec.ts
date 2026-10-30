import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { loadLocalTimeline } from '../helpers';

const place = 'Frankfurt am Main Sachsenhausen-Süd';

test('photo details remain readable and the split can be changed without dragging', async ({ page, isMobile }, info) => {
  await page.route('https://tiles.openfreemap.org/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({
    version: 8,
    sources: { places: { type: 'geojson', data: { type: 'FeatureCollection', features: [
      { type: 'Feature', properties: { name: 'Frankfurt am Main', class: 'city' }, geometry: { type: 'Point', coordinates: [127.005, 37.505] } },
      { type: 'Feature', properties: { name: 'Sachsenhausen-Süd', class: 'district' }, geometry: { type: 'Point', coordinates: [127.0051, 37.5051] } }
    ] } } },
    layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#edeae2' } }, { id: 'city-label', type: 'circle', source: 'places', paint: { 'circle-radius': 1 } }]
  }) }));
  await page.goto('./');
  await page.getByRole('button', { name: '타임라인 준비 방법', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '사용 안내', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '사용 안내 닫기', exact: true }).click();
  await loadLocalTimeline(page);
  await page.getByRole('button', { name: '사진 여정', exact: true }).click();
  await page.locator('.media-import-row input[type=file]').first().setInputFiles({ name: '20260410_091500.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') });
  await expect(page.getByRole('button', { name: '재생', exact: true })).toBeEnabled();
  await page.locator('.settings-panel summary').click();
  await page.getByRole('button', { name: '사진 목록 관리', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: '사진 20260410 091500 감상에 포함', exact: true })).toBeChecked();
  await expect(page.locator('.library-kind')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('.library-kind')).not.toHaveAttribute('aria-label');
  await page.getByRole('button', { name: /장면 보기/ }).click();
  await expect(page.locator('.is-current .media-caption-place')).toHaveText(place);

  await page.locator('.settings-panel summary').click();
  const ratio = page.getByRole('slider', { name: '지도·사진 화면 비율', exact: true });
  const before = Number(await ratio.inputValue());
  await ratio.scrollIntoViewIfNeeded();
  const track = (await ratio.boundingBox())!;
  const point = { x: track.width * 0.8, y: track.height / 2 };
  if (isMobile) await ratio.tap({ position: point }); else await ratio.click({ position: point });
  await expect.poll(async () => Number(await ratio.inputValue())).toBeGreaterThan(before);
  await expect(page.getByRole('separator')).toHaveAttribute('aria-valuenow', await ratio.inputValue());
  await ratio.focus(); await page.keyboard.press('ArrowLeft');
  const changed = Number(await ratio.inputValue());
  await expect(page.getByRole('separator')).toHaveAttribute('aria-valuenow', String(changed));

  await page.getByRole('button', { name: '여행 저장·열기', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '프로젝트 파일 저장', exact: true }).click();
  const projectPath = info.outputPath('split.travel-camera.json'); await (await downloading).saveAs(projectPath);
  const project = JSON.parse(await readFile(projectPath, 'utf8'));
  expect(project.view[isMobile ? 'mobileMapShare' : 'desktopMapShare']).toBeCloseTo(changed / 100);
  await page.getByRole('button', { name: '여행 저장·열기 닫기', exact: true }).click();

  for (const size of [{ width: 320, height: 568 }, { width: 720, height: 450 }, { width: 821, height: 900 }]) {
    await page.setViewportSize(size);
    // The most constrained supported photo pane must still expose the full caption.
    await page.getByRole('separator').focus(); await page.keyboard.press('End');
    const caption = page.locator('.is-current .media-caption');
    await expect.poll(() => caption.evaluate(node => {
      const parent = node.closest('.media-card')!.getBoundingClientRect();
      return [...node.children].every(child => {
        const bounds = child.getBoundingClientRect();
        return child.scrollWidth <= child.clientWidth + 1 && bounds.left >= parent.left - 1 && bounds.right <= parent.right + 1 && bounds.bottom <= parent.bottom + 1;
      });
    })).toBe(true);
    await expect(caption).toContainText(place);
    await info.attach(`full-place-${size.width}`, { body: await page.screenshot(), contentType: 'image/png' });
  }
});
