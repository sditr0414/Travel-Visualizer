import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('.', import.meta.url));
const rootPrefix = root.endsWith(sep) ? root : `${root}${sep}`;
const port = Number(process.env.PORT || 5173);
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.pmtiles': 'application/octet-stream'
};

const timelinePartNames = Array.from({ length: 9 }, (_, index) =>
  `part-${String(index + 1).padStart(2, '0')}.txt`
);
const localMapFiles = {
  world: join(root, 'maps', 'world-z5.pmtiles'),
  region: join(root, 'maps', 'korea-japan-z14.pmtiles')
};

async function buildTimelineModule() {
  const chunks = await Promise.all(timelinePartNames.map(name =>
    readFile(join(root, 'data', 'timeline-parts', name), 'utf8')
  ));
  const base64 = chunks.join('').replace(/\s+/g, '');
  if (!base64.startsWith('H4sI') || !base64.endsWith('=')) {
    throw new Error('Bundled Timeline data is incomplete.');
  }

  let json;
  try {
    const compressed = Buffer.from(base64, 'base64');
    const text = gunzipSync(compressed).toString('utf8');
    json = JSON.parse(text);
  } catch (error) {
    // Never ignore gzip CRC/trailer errors. A corrupt fixture must fail in CI/startup
    // rather than silently producing a possibly wrong trip.
    throw new Error(`Bundled Timeline decompression failed: ${error.message}`);
  }

  if (!Array.isArray(json?.semanticSegments) || json.semanticSegments.length < 100) {
    throw new Error('Bundled Timeline data is invalid or incomplete.');
  }

  return {
    module: `export const BUNDLED_TIMELINE = ${JSON.stringify(json)};\n`,
    segmentCount: json.semanticSegments.length
  };
}

let timelineModule;
let timelineSegmentCount = 0;
try {
  const builtTimeline = await buildTimelineModule();
  timelineModule = builtTimeline.module;
  timelineSegmentCount = builtTimeline.segmentCount;
} catch (error) {
  console.error(`Bundled Timeline fixture error: ${error.message}`);
  process.exitCode = 1;
  throw error;
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === '/api/map-status') {
      const status = await getMapStatus();
      const body = JSON.stringify(status);
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(body),
        'cache-control': 'no-store'
      });
      if (req.method !== 'HEAD') res.end(body);
      else res.end();
      return;
    }

    if (url.pathname === '/data/timeline-bundle.js') {
      res.writeHead(200, {
        'content-type': 'text/javascript; charset=utf-8',
        'content-length': Buffer.byteLength(timelineModule),
        'cache-control': 'no-store'
      });
      if (req.method !== 'HEAD') res.end(timelineModule);
      else res.end();
      return;
    }

    const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
    const relative = normalize(pathname).replace(/^([/\\])+/, '');
    const file = resolve(root, relative);
    if (file !== root && !file.startsWith(rootPrefix)) throw new Error('invalid path');
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not a file');

    if (extname(file) === '.pmtiles') {
      serveRangeFile(req, res, file, info);
      return;
    }

    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': mime[extname(file)] || 'application/octet-stream',
      'content-length': body.length,
      'cache-control': 'no-store'
    });
    if (req.method !== 'HEAD') res.end(body);
    else res.end();
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}).listen(port, () => {
  console.log(`Travel Camera Visualizer: http://localhost:${port}`);
  console.log(`Bundled Timeline: ${timelinePartNames.length} parts · ${timelineSegmentCount} segments ready`);
  printMapStatus();
});

function serveRangeFile(req, res, file, info) {
  const size = info.size;
  const etag = `"${size}-${Math.floor(info.mtimeMs)}"`;
  const common = {
    'content-type': mime['.pmtiles'],
    'accept-ranges': 'bytes',
    'cache-control': 'public, max-age=31536000, immutable',
    etag
  };

  if (req.method === 'HEAD') {
    res.writeHead(200, { ...common, 'content-length': size });
    res.end();
    return;
  }

  const range = parseRange(req.headers.range, size);
  if (!range) {
    res.writeHead(200, { ...common, 'content-length': size });
    createReadStream(file).pipe(res);
    return;
  }

  if (range.invalid) {
    res.writeHead(416, {
      ...common,
      'content-range': `bytes */${size}`
    });
    res.end();
    return;
  }

  const { start, end } = range;
  res.writeHead(206, {
    ...common,
    'content-range': `bytes ${start}-${end}/${size}`,
    'content-length': end - start + 1
  });
  createReadStream(file, { start, end }).pipe(res);
}

function parseRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!match) return { invalid: true };

  let start;
  let end;
  if (match[1] === '' && match[2] !== '') {
    const suffix = Number(match[2]);
    if (!Number.isFinite(suffix) || suffix <= 0) return { invalid: true };
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Number(match[2]);
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= size || end < start) {
    return { invalid: true };
  }
  return { start, end: Math.min(end, size - 1) };
}

async function getMapStatus() {
  const [world, region] = await Promise.all([
    fileStatus(localMapFiles.world),
    fileStatus(localMapFiles.region)
  ]);
  return {
    ready: world.exists && region.exists,
    world: world.exists,
    region: region.exists,
    worldBytes: world.size,
    regionBytes: region.size
  };
}

async function fileStatus(file) {
  try {
    const info = await stat(file);
    return { exists: info.isFile() && info.size > 0, size: info.size };
  } catch {
    return { exists: false, size: 0 };
  }
}

async function printMapStatus() {
  const status = await getMapStatus();
  if (status.ready) {
    console.log(`Local basemap: ready (${formatBytes(status.worldBytes)} + ${formatBytes(status.regionBytes)})`);
  } else {
    console.log('Local basemap: not installed · run npm run map:setup');
  }
}

function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = Number(bytes) || 0;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index ? 1 : 0)} ${units[index]}`;
}
