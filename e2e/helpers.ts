import { access } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';

const E2E_TIMELINE = JSON.stringify({
  semanticSegments: [
    {
      startTime: '2026-04-10T09:00:00+09:00',
      endTime: '2026-04-10T09:30:00+09:00',
      activity: {
        start: { latLng: '37.5000°, 127.0000°' },
        end: { latLng: '37.5100°, 127.0100°' },
        distanceMeters: 1800,
        topCandidate: { type: 'WALKING', probability: 0.9 },
        probability: 0.9
      }
    },
    {
      startTime: '2026-04-11T10:00:00+09:00',
      endTime: '2026-04-11T10:20:00+09:00',
      activity: {
        start: { latLng: '37.5100°, 127.0100°' },
        end: { latLng: '37.5400°, 127.0400°' },
        distanceMeters: 5200,
        topCandidate: { type: 'IN_PASSENGER_VEHICLE', probability: 0.9 },
        probability: 0.9
      }
    }
  ]
});

const PHOTO_ID = 'e2e-photo';
const PHOTO_BODY = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

export async function loadLocalTimeline(page: Page, options: { real?: boolean } = {}): Promise<void> {
  const input = page.getByLabel('시작할 Timeline JSON 선택');
  if (options.real) {
    const path = process.env.REAL_TIMELINE_JSON;
    if (!path) throw new Error('REAL_TIMELINE_JSON is required for the real Timeline E2E case.');
    await access(path);
    await input.setInputFiles(path);
  } else {
    await input.setInputFiles({
      name: 'e2e-timeline.json',
      mimeType: 'application/json',
      buffer: Buffer.from(E2E_TIMELINE)
    });
  }

  await expect(page.getByRole('button', { name: '재생' })).toBeEnabled({ timeout: options.real ? 120_000 : 30_000 });
}

export async function attachLocalPhotoManifest(page: Page): Promise<void> {
  await page.route('**/api/local-media-manifest', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        available: true,
        rootName: 'E2E 사진',
        count: 1,
        totalBytes: PHOTO_BODY.byteLength,
        items: [{
          id: PHOTO_ID,
          name: '20260410_091500.png',
          size: PHOTO_BODY.byteLength,
          lastModified: Date.parse('2026-04-10T09:15:00+09:00'),
          kind: 'image',
          metadata: {
            takenMs: Date.parse('2026-04-10T09:15:00+09:00'),
            lat: 37.505,
            lng: 127.005,
            source: 'filename-time',
            embeddedScanned: true
          }
        }]
      })
    });
  });

  await page.route(`**/api/local-media/${PHOTO_ID}`, async route => {
    await route.fulfill({ status: 200, contentType: 'image/png', body: PHOTO_BODY });
  });
}
