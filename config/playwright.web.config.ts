import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  testDir: '../e2e/web',
  outputDir: '../test-results-web',
  timeout: 45_000,
  expect: { timeout: 12_000 },
  fullyParallel: true,
  reporter: [['list'], ['html', { open: 'never', outputFolder: fileURLToPath(new URL('../playwright-web-report', import.meta.url)) }]],
  use: { baseURL: 'http://127.0.0.1:5521/Travel-Visualizer/', timezoneId: 'Asia/Seoul', trace: 'retain-on-failure' },
  webServer: {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    command: 'npm run build:web && npm run preview:web',
    url: 'http://127.0.0.1:5521/Travel-Visualizer/',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    { name: 'firefox', use: {
      ...devices['Desktop Firefox'],
      // GPU-less Linux runners need a virtual display and real Mesa software GL.
      // This temporary test profile does not change the app or users' browsers.
      launchOptions: process.env.CI ? {
        firefoxUserPrefs: { 'webgl.force-enabled': true },
        env: { ...process.env, LIBGL_ALWAYS_SOFTWARE: '1' }
      } : undefined
    } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } }
  ]
});
