import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 5173);
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml'
};

const timelinePartNames = Array.from({ length: 9 }, (_, index) =>
  `part-${String(index + 1).padStart(2, '0')}.txt`
);

async function buildTimelineModule() {
  const chunks = await Promise.all(timelinePartNames.map(name =>
    readFile(join(root, 'data', 'timeline-parts', name), 'utf8')
  ));
  const base64 = chunks.join('').replace(/\s+/g, '');
  if (!base64.startsWith('H4sI') || !base64.endsWith('=')) {
    throw new Error('Bundled Timeline data is incomplete.');
  }
  return `export const BUNDLED_TIMELINE_GZIP_BASE64 = ${JSON.stringify(base64)};\n`;
}

let timelineModule;
try {
  timelineModule = await buildTimelineModule();
} catch (error) {
  console.error(`Bundled Timeline fixture error: ${error.message}`);
  process.exitCode = 1;
  throw error;
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === '/data/timeline-bundle.js') {
      res.writeHead(200, {
        'content-type': 'text/javascript; charset=utf-8',
        'cache-control': 'no-store'
      });
      res.end(timelineModule);
      return;
    }

    const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
    const relative = normalize(pathname).replace(/^([/\\])+/, '');
    const file = join(root, relative);
    if (!file.startsWith(root)) throw new Error('invalid path');
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not a file');
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': mime[extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store'
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}).listen(port, () => {
  console.log(`Travel Camera Visualizer: http://localhost:${port}`);
  console.log(`Bundled Timeline: ${timelinePartNames.length} parts ready`);
});
