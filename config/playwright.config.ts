import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  testDir: '../e2e',
  outputDir: '../test-results',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: { baseURL: 'http://127.0.0.1:5518', trace: 'retain-on-failure' },
  webServer: {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    command: 'npm run build && npm start -- --production --no-local-data --port 5518',
    url: 'http://127.0.0.1:5518',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } }
  ]
});
