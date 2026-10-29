import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

export default defineConfig(({ mode }) => {
  const web = mode === 'pages';
  // Pages cannot apply _headers. Keep the supported CSP directives in the HTML
  // before any script; the full header policy still applies to local hosting.
  const policy = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8')
    .split(/\r?\n/).find(line => line.trimStart().startsWith('Content-Security-Policy:'))!
    .trim().slice('Content-Security-Policy:'.length).trim()
    .split(';').map(rule => rule.trim()).filter(rule => rule && !rule.startsWith('frame-ancestors ')).join('; ');
  return {
    root: fileURLToPath(new URL('..', import.meta.url)),
    base: web ? '/Travel-Visualizer/' : '/',
    plugins: [react(), ...(web ? [{
      name: 'pages-content-security-policy',
      transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy }, injectTo: 'head-prepend' as const }]
    }] : [])],
    build: { outDir: web ? 'dist-web' : 'dist', chunkSizeWarningLimit: 600 },
    optimizeDeps: { exclude: ['maplibre-gl'] },
    worker: { format: 'es' },
    test: {
      globals: true,
      include: ['src/**/*.test.{ts,tsx}'],
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json-summary'],
        include: ['src/**/*.{ts,tsx}'],
        exclude: ['src/main.tsx', 'src/**/*.d.ts', 'src/test/**']
      }
    }
  };
});
