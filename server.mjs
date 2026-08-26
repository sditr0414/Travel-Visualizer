import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, readFile, readdir, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { basename, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('.', import.meta.url));
const rootPrefix = root.endsWith(sep) ? root : `${root}${sep}`;
const port = Number(process.env.PORT || 5173);
const googlePhotosClientId = String(process.env.GOOGLE_PHOTOS_CLIENT_ID || '').trim();
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.pmtiles': 'application/octet-stream'
};

const timelinePartDir = join(root, 'data', 'timeline-parts');
const localMapFiles = {
  world: join(root, 'maps', 'world-z5.pmtiles'),
  region: join(root, 'maps', 'korea-japan-z14.pmtiles')
};
const vendorFiles = new Map([
  ['/vendor/maplibre-gl.js', join(root, 'node_modules', 'maplibre-gl', 'dist', 'maplibre-gl.js')],
  ['/vendor/maplibre-gl.css', join(root, 'node_modules', 'maplibre-gl', 'dist', 'maplibre-gl.css')],
  ['/vendor/pmtiles.js', join(root, 'node_modules', 'pmtiles', 'dist', 'pmtiles.js')],
  ['/vendor/basemaps.js', join(root, 'node_modules', '@protomaps', 'basemaps', 'dist', 'basemaps.js')]
]);

async function buildTimelineModule() {
  const directSource = await findDirectTimelineSource();
  if (directSource) {
    const raw = await readFile(directSource);
    return buildTimelineFromRaw(raw, {
      sourceType: 'original-json',
      sourceName: basename(directSource),
      partCount: 0
    });
  }

  const partNames = (await readdir(timelinePartDir))
    .filter(name => /^part-\d+\.txt$/i.test(name))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  if (!partNames.length) throw new Error('Bundled Timeline parts were not found. Run npm run timeline:setup.');

  const chunks = await Promise.all(partNames.map(name =>
    readFile(join(timelinePartDir, name), 'utf8')
  ));
  const base64 = chunks.join('').replace(/\s+/g, '');
  if (!base64.startsWith('H4sI') || !base64.endsWith('=')) {
    throw new Error('Bundled Timeline data is incomplete.');
  }

  let raw;
  try {
    raw = gunzipSync(Buffer.from(base64, 'base64'));
  } catch (error) {
    throw new Error(`Bundled Timeline decompression failed: ${error.message}`);
  }

  const manifest = await readTimelineManifest();
  if (!manifest) {
    throw new Error('Bundled Timeline manifest is missing. Run npm run timeline:setup.');
  }
  const built = buildTimelineFromRaw(raw, {
    sourceType: manifest?.fullTimeline ? 'full-fixture' : 'fixture',
    sourceName: manifest?.sourceName || '타임라인.json',
    partCount: partNames.length,
    manifest
  });

  if (!manifest.sourceSha256 || manifest.sourceSha256 !== built.meta.sourceSha256) {
    throw new Error('Bundled Timeline manifest SHA-256 does not match the fixture.');
  }
  if (!Number.isFinite(manifest.semanticSegments) || manifest.semanticSegments !== built.meta.semanticSegments) {
    throw new Error('Bundled Timeline manifest segment count does not match the fixture.');
  }
  if (!Number.isFinite(manifest.rawSignals) || manifest.rawSignals !== built.meta.rawSignals) {
    throw new Error('Bundled Timeline manifest rawSignals count does not match the fixture.');
  }
  return built;
}

function buildTimelineFromRaw(raw, { sourceType, sourceName, partCount, manifest = null }) {
  let json;
  try {
    json = JSON.parse(raw.toString('utf8'));
  } catch (error) {
    throw new Error(`Bundled Timeline JSON parsing failed: ${error.message}`);
  }

  if (!Array.isArray(json?.semanticSegments) || json.semanticSegments.length < 100) {
    throw new Error('Bundled Timeline data is invalid or incomplete.');
  }

  const semanticSegments = json.semanticSegments.length;
  const rawSignals = Array.isArray(json.rawSignals) ? json.rawSignals.length : 0;
  const sourceSha256 = createHash('sha256').update(raw).digest('hex');
  const fullTimeline = manifest?.fullTimeline ?? semanticSegments >= 8000;
  const meta = {
    sourceType,
    sourceName,
    fullTimeline,
    semanticSegments,
    rawSignals,
    sourceSha256
  };

  // rawSignals and userLocationProfile remain preserved in the compressed source,
  // but the browser player only needs semanticSegments. Sending only the data the
  // parser consumes keeps the full Timeline usable without a ~49 MB browser payload.
  const browserJson = { semanticSegments: json.semanticSegments };
  return {
    module: [
      `export const BUNDLED_TIMELINE = ${JSON.stringify(browserJson)};`,
      `export const BUNDLED_TIMELINE_META = ${JSON.stringify(meta)};`,
      ''
    ].join('\n'),
    meta,
    partCount
  };
}

async function findDirectTimelineSource() {
  const candidates = [
    process.env.TIMELINE_JSON,
    join(root, '타임라인.json'),
    join(root, 'data', '타임라인.json'),
    resolve(root, '..', '타임라인.json')
  ].filter(Boolean);

  for (const candidate of candidates) {
    const file = resolve(candidate);
    try {
      await access(file);
      return file;
    } catch {}
  }
  return null;
}

async function readTimelineManifest() {
  try {
    return JSON.parse(await readFile(join(timelinePartDir, 'manifest.json'), 'utf8'));
  } catch {
    return null;
  }
}

let timelineModule;
let timelineMeta;
let timelinePartCount = 0;
try {
  const builtTimeline = await buildTimelineModule();
  timelineModule = builtTimeline.module;
  timelineMeta = builtTimeline.meta;
  timelinePartCount = builtTimeline.partCount;
} catch (error) {
  console.error(`Bundled Timeline fixture error: ${error.message}`);
  process.exitCode = 1;
  throw error;
}

try {
  await Promise.all([...vendorFiles.values()].map(file => access(file)));
} catch {
  throw new Error('Browser map dependencies are missing. Run npm ci before npm start.');
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

    if (url.pathname === '/api/timeline-status') {
      const body = JSON.stringify(timelineMeta);
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(body),
        'cache-control': 'no-store'
      });
      if (req.method !== 'HEAD') res.end(body);
      else res.end();
      return;
    }

    if (url.pathname === '/api/google-photos-config') {
      const body = JSON.stringify({
        configured: !!googlePhotosClientId,
        clientId: googlePhotosClientId || null
      });
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

    if (vendorFiles.has(url.pathname)) {
      const file = vendorFiles.get(url.pathname);
      const body = await readFile(file);
      res.writeHead(200, {
        'content-type': mime[extname(file)] || 'application/octet-stream',
        'content-length': body.length,
        'cache-control': 'public, max-age=31536000, immutable'
      });
      if (req.method !== 'HEAD') res.end(body);
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
  if (timelineMeta.sourceType === 'original-json') {
    console.log(`Timeline: ${timelineMeta.sourceName} · ${timelineMeta.semanticSegments} semantic segments · original JSON`);
  } else {
    console.log(`Bundled Timeline: ${timelinePartCount} parts · ${timelineMeta.semanticSegments} semantic segments · ${timelineMeta.fullTimeline ? 'full' : 'reduced fixture'}`);
  }
  console.log(`Google Photos: ${googlePhotosClientId ? 'login ready' : 'not configured · set GOOGLE_PHOTOS_CLIENT_ID'}`);
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
