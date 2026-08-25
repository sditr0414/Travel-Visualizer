import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, inflateRawSync } from 'node:zlib';

const root = fileURLToPath(new URL('.', import.meta.url));
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
  let recoveredChecksum = false;
  try {
    const compressed = Buffer.from(base64, 'base64');
    let text;
    try {
      text = gunzipSync(compressed).toString('utf8');
    } catch (gunzipError) {
      text = inflateGzipPayloadIgnoringTrailer(compressed).toString('utf8');
      recoveredChecksum = true;
      console.warn(`Bundled Timeline gzip checksum mismatch recovered: ${gunzipError.message}`);
    }
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`Bundled Timeline decompression failed: ${error.message}`);
  }

  if (!Array.isArray(json?.semanticSegments) || json.semanticSegments.length < 100) {
    throw new Error('Bundled Timeline data is invalid or incomplete.');
  }

  return {
    module: `export const BUNDLED_TIMELINE = ${JSON.stringify(json)};\n`,
    segmentCount: json.semanticSegments.length,
    recoveredChecksum
  };
}

function inflateGzipPayloadIgnoringTrailer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 18 || buffer[0] !== 0x1f || buffer[1] !== 0x8b || buffer[2] !== 0x08) {
    throw new Error('invalid gzip header');
  }

  const flags = buffer[3];
  let offset = 10;
  const trailerStart = buffer.length - 8;

  if (flags & 0x04) {
    if (offset + 2 > trailerStart) throw new Error('invalid gzip extra field');
    const extraLength = buffer.readUInt16LE(offset);
    offset += 2 + extraLength;
  }
  if (flags & 0x08) offset = skipNullTerminatedGzipField(buffer, offset, trailerStart, 'filename');
  if (flags & 0x10) offset = skipNullTerminatedGzipField(buffer, offset, trailerStart, 'comment');
  if (flags & 0x02) offset += 2;

  if (offset >= trailerStart) throw new Error('gzip payload is empty or truncated');
  return inflateRawSync(buffer.subarray(offset, trailerStart));
}

function skipNullTerminatedGzipField(buffer, offset, limit, label) {
  while (offset < limit && buffer[offset] !== 0) offset += 1;
  if (offset >= limit) throw new Error(`invalid gzip ${label} field`);
  return offset + 1;
}

let timelineModule;
let timelineSegmentCount = 0;
let timelineRecoveredChecksum = false;
try {
  const builtTimeline = await buildTimelineModule();
  timelineModule = builtTimeline.module;
  timelineSegmentCount = builtTimeline.segmentCount;
  timelineRecoveredChecksum = builtTimeline.recoveredChecksum;
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
    const file = join(root, relative);
    if (!file.startsWith(root)) throw new Error('invalid path');
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
  console.log(`Bundled Timeline: ${timelinePartNames.length} parts · ${timelineSegmentCount} segments ready${timelineRecoveredChecksum ? ' · checksum recovered' : ''}`);
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
