import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename, dirname, extname, isAbsolute, join, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const isProduction = process.argv.includes('--production') || process.env.NODE_ENV === 'production';
const localDataEnabled = !process.argv.includes('--no-local-data');
const portArg = process.argv.findIndex(value => value === '--port');
const configuredPort = Number(process.env.PORT || (portArg >= 0 ? process.argv[portArg + 1] : 5517));
const port = Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort <= 65_535 ? configuredPort : 5517;
const mapsDir = join(root, 'maps');
const distDir = join(root, 'dist');
const worldMap = join(mapsDir, 'world-z5.pmtiles');
const regionMap = join(mapsDir, 'korea-japan-z14.pmtiles');
const localTimeline = configuredPath('TRAVEL_TIMELINE_PATH', resolve(root, '..', '타임라인.json'));
const localMediaRoot = configuredPath('TRAVEL_MEDIA_DIR', resolve(root, '..', '여행 사진'));
const mediaMetadataCachePath = configuredPath('TRAVEL_METADATA_CACHE', join(root, '.cache', 'media-metadata.json'));
const MEDIA_CACHE_VERSION = 2;
let localMediaCache = null;

const vite = isProduction
  ? null
  : await (await import('vite')).createServer({ root, server: { middlewareMode: true }, appType: 'spa' });

const server = createServer((request, response) => {
  void handleRequest(request, response).catch(error => {
    console.error(error);
    if (!response.headersSent) json(response, 500, { error: 'Local server error' });
    else response.destroy();
  });
});

server.on('error', error => {
  if (error && typeof error === 'object' && (error.code === 'EADDRINUSE' || error.code === 'EACCES')) {
    console.error(`127.0.0.1:${port} 포트를 사용할 수 없습니다. npm start -- --port 5520 처럼 다른 포트를 지정하세요.`);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});

async function handleRequest(request, response) {
  setSecurityHeaders(response);
  if (!isAllowedHost(request.headers.host)) return text(response, 403, 'Loopback access only');
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);

  if (url.pathname === '/api/map-status') {
    const world = fileStatus(worldMap);
    const region = fileStatus(regionMap);
    return json(response, 200, {
      ready: world.exists && region.exists,
      world: world.exists,
      region: region.exists,
      worldBytes: world.bytes,
      regionBytes: region.bytes
    });
  }

  if (url.pathname === '/api/local-timeline') {
    if (!localDataEnabled) return json(response, 404, { available: false });
    return serveLocalTimeline(request, response);
  }

  if (url.pathname === '/api/local-media-manifest') {
    if (!localDataEnabled) return json(response, 404, { available: false, items: [] });
    return serveLocalMediaManifest(request, response);
  }

  if (url.pathname === '/api/local-media-metadata-cache') {
    if (!localDataEnabled) return json(response, 404, { saved: 0 });
    return serveLocalMediaMetadataCache(request, response);
  }

  if (url.pathname.startsWith('/api/local-media/')) {
    if (!localDataEnabled) return text(response, 404, 'Local media disabled');
    return serveLocalMedia(request, response, url.pathname.slice('/api/local-media/'.length));
  }

  if (url.pathname.startsWith('/api/')) {
    return json(response, 404, { error: 'API endpoint not found' });
  }

  if (url.pathname.startsWith('/maps/')) {
    const fileName = url.pathname.slice('/maps/'.length);
    if (!['world-z5.pmtiles', 'korea-japan-z14.pmtiles'].includes(fileName)) {
      return text(response, 404, 'Not found');
    }
    return serveRangeFile(request, response, join(mapsDir, fileName));
  }

  if (vite) {
    return vite.middlewares(request, response, error => {
      if (error) {
        console.error(error);
        text(response, 500, 'Development server error');
      }
    });
  }

  return serveStatic(request, response, url.pathname);
}

server.listen(port, '127.0.0.1', () => {
  console.log(`Travel Camera Visualizer: http://127.0.0.1:${port}`);
});

function fileStatus(path) {
  if (!existsSync(path)) return { exists: false, bytes: 0 };
  const stats = statSync(path);
  return { exists: stats.isFile(), bytes: stats.isFile() ? stats.size : 0 };
}

function serveRangeFile(request, response, path, contentType = 'application/vnd.pmtiles', cacheControl = 'public, max-age=3600') {
  if (!['GET', 'HEAD'].includes(request.method || 'GET')) {
    response.setHeader('Allow', 'GET, HEAD');
    return text(response, 405, 'Method not allowed');
  }
  if (!existsSync(path)) return text(response, 404, 'Map archive not found');
  const size = statSync(path).size;
  const range = request.headers.range;
  response.setHeader('Accept-Ranges', 'bytes');
  response.setHeader('Content-Type', contentType);
  response.setHeader('Cache-Control', cacheControl);
  response.setHeader('X-Content-Type-Options', 'nosniff');

  if (!range) {
    response.writeHead(200, { 'Content-Length': size });
    if (request.method === 'HEAD') return response.end();
    return createReadStream(path).pipe(response);
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) {
    response.writeHead(416, { 'Content-Range': `bytes */${size}` });
    return response.end();
  }
  let start;
  let end;
  if (!match[1] && match[2]) {
    const suffixLength = Number(match[2]);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      response.writeHead(416, { 'Content-Range': `bytes */${size}` });
      return response.end();
    }
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = match[1] ? Number(match[1]) : 0;
    end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  }
  if (start > end || start >= size) {
    response.writeHead(416, { 'Content-Range': `bytes */${size}` });
    return response.end();
  }
  response.writeHead(206, {
    'Content-Range': `bytes ${start}-${end}/${size}`,
    'Content-Length': end - start + 1
  });
  if (request.method === 'HEAD') return response.end();
  return createReadStream(path, { start, end }).pipe(response);
}

function serveLocalTimeline(request, response) {
  if (!['GET', 'HEAD'].includes(request.method || 'GET')) {
    response.setHeader('Allow', 'GET, HEAD');
    return text(response, 405, 'Method not allowed');
  }
  const status = fileStatus(localTimeline);
  if (!status.exists) return json(response, 404, { available: false });
  response.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': status.bytes,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  if (request.method === 'HEAD') return response.end();
  return createReadStream(localTimeline).pipe(response);
}

function serveLocalMediaManifest(request, response) {
  if (!['GET', 'HEAD'].includes(request.method || 'GET')) {
    response.setHeader('Allow', 'GET, HEAD');
    return text(response, 405, 'Method not allowed');
  }
  const cache = buildLocalMediaCache(true);
  if (!cache) return json(response, 404, { available: false, items: [] });
  const manifest = {
    available: true,
    rootName: basename(localMediaRoot),
    count: cache.items.length,
    totalBytes: cache.items.reduce((sum, item) => sum + item.size, 0),
    items: cache.items.map(publicMediaItem)
  };
  response.setHeader('Cache-Control', 'private, no-store');
  if (request.method === 'HEAD') return response.writeHead(200).end();
  return json(response, 200, manifest);
}

function serveLocalMedia(request, response, rawId) {
  if (!['GET', 'HEAD'].includes(request.method || 'GET')) {
    response.setHeader('Allow', 'GET, HEAD');
    return text(response, 405, 'Method not allowed');
  }
  const cache = buildLocalMediaCache();
  let id;
  try { id = decodeURIComponent(rawId); }
  catch { return text(response, 400, 'Invalid local media id'); }
  const item = cache?.byId.get(id);
  if (!item || !existsSync(item.path)) return text(response, 404, 'Local media not found');
  return serveRangeFile(request, response, item.path, mimeType(extname(item.path)), 'private, no-store');
}

async function serveLocalMediaMetadataCache(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return text(response, 405, 'Method not allowed');
  }
  if (!isSameOriginRequest(request)) return text(response, 403, 'Same-origin request required');
  const cache = buildLocalMediaCache();
  if (!cache) return json(response, 404, { saved: 0 });
  try {
    const payload = await readJsonBody(request, 2_000_000);
    const entries = Array.isArray(payload?.entries) ? payload.entries : [];
    let saved = 0;
    for (const value of entries) {
      const item = cache.byId.get(String(value?.id ?? ''));
      if (!item) continue;
      const metadata = validMediaMetadata(value);
      if (!metadata) continue;
      item.metadata = metadata;
      cache.metadata.entries[item.name] = {
        size: item.size,
        lastModified: item.lastModified,
        ...metadata
      };
      saved += 1;
    }
    if (saved) saveMediaMetadataCache(cache.metadata);
    return json(response, 200, { saved });
  } catch (error) {
    return json(response, 400, { error: error instanceof Error ? error.message : 'Invalid metadata cache payload' });
  }
}

function buildLocalMediaCache(refresh = false) {
  if (localMediaCache && !refresh) return localMediaCache;
  if (!existsSync(localMediaRoot) || !statSync(localMediaRoot).isDirectory()) return null;
  const paths = [];
  const sidecarPaths = [];
  const directories = [localMediaRoot];
  while (directories.length) {
    const directory = directories.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) directories.push(path);
      else if (entry.isFile() && /\.(?:jpe?g|png|webp|heic|heif|mp4|m4v|mov|webm)$/i.test(entry.name)) paths.push(path);
      else if (entry.isFile() && /(?:\.supplemental-metadata)?\.json$/i.test(entry.name) && statSync(path).size <= 3_000_000) sidecarPaths.push(path);
    }
  }
  paths.sort((a, b) => relative(localMediaRoot, a).localeCompare(relative(localMediaRoot, b), 'ko'));
  const metadata = loadMediaMetadataCache();
  const items = paths.map((path, index) => {
    const stats = statSync(path);
    const extension = extname(path).toLowerCase();
    const name = relative(localMediaRoot, path).replaceAll('\\', '/');
    const cached = metadata.entries[name];
    return {
      id: String(index),
      path,
      name,
      size: stats.size,
      lastModified: stats.mtimeMs,
      kind: /\.(?:mp4|m4v|mov|webm)$/i.test(extension) ? 'video' : 'image',
      metadata: cached && cached.size === stats.size && Math.abs(cached.lastModified - stats.mtimeMs) < 1
        ? validMediaMetadata(cached)
        : null
    };
  });
  const byName = new Map(items.map(item => [item.name.toLowerCase(), item]));
  const activeNames = new Set(items.map(item => item.name));
  let metadataChanged = false;
  for (const cachedName of Object.keys(metadata.entries)) {
    if (!activeNames.has(cachedName)) {
      delete metadata.entries[cachedName];
      metadataChanged = true;
    }
  }
  for (const sidecarPath of sidecarPaths) {
    const sidecarName = relative(localMediaRoot, sidecarPath).replaceAll('\\', '/');
    try {
      const value = JSON.parse(readFileSync(sidecarPath, 'utf8'));
      const parsed = parseTakeoutSidecar(value);
      if (!parsed) continue;
      const slash = sidecarName.lastIndexOf('/');
      const directory = slash >= 0 ? sidecarName.slice(0, slash + 1) : '';
      const stripped = sidecarName.replace(/(?:\.supplemental-metadata)?\.json$/i, '');
      const item = byName.get(stripped.toLowerCase()) ?? byName.get(`${directory}${parsed.title}`.toLowerCase());
      if (!item) continue;
      item.metadata = {
        ...parsed.metadata,
        lat: parsed.metadata.lat ?? item.metadata?.lat ?? null,
        lng: parsed.metadata.lng ?? item.metadata?.lng ?? null,
        embeddedScanned: parsed.metadata.lat != null || item.metadata?.embeddedScanned === true
      };
      metadata.entries[item.name] = { size: item.size, lastModified: item.lastModified, ...item.metadata };
      metadataChanged = true;
    } catch {
      // Invalid or unrelated JSON files are ignored.
    }
  }
  if (metadataChanged) saveMediaMetadataCache(metadata);
  localMediaCache = { items, byId: new Map(items.map(item => [item.id, item])), metadata };
  return localMediaCache;
}

function loadMediaMetadataCache() {
  try {
    const value = JSON.parse(readFileSync(mediaMetadataCachePath, 'utf8'));
    if (value?.version === MEDIA_CACHE_VERSION && value.entries && typeof value.entries === 'object') return value;
  } catch {
    // A missing or invalid cache is rebuilt from local media.
  }
  return { version: MEDIA_CACHE_VERSION, entries: {} };
}

function saveMediaMetadataCache(value) {
  mkdirSync(dirname(mediaMetadataCachePath), { recursive: true });
  const temporary = `${mediaMetadataCachePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, JSON.stringify(value), 'utf8');
  renameSync(temporary, mediaMetadataCachePath);
}

function validMediaMetadata(value) {
  const takenMs = Number(value?.takenMs);
  const lat = value?.lat == null ? null : Number(value.lat);
  const lng = value?.lng == null ? null : Number(value.lng);
  const sources = new Set(['takeout-sidecar', 'embedded-exif', 'filename-time', 'file-time']);
  if (!Number.isFinite(takenMs) || takenMs <= Date.UTC(2000, 0, 1) || !sources.has(value?.source)) return null;
  if ((lat == null) !== (lng == null)) return null;
  if (lat != null && (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180)) return null;
  return { takenMs, lat, lng, source: value.source, embeddedScanned: value?.embeddedScanned === true };
}

function parseTakeoutSidecar(value) {
  if (!value || typeof value !== 'object') return null;
  const timestamp = value.photoTakenTime?.timestamp ?? value.creationTime?.timestamp ?? value.creationTime;
  const numeric = /^\d+(?:\.\d+)?$/.test(String(timestamp ?? '')) ? Number(timestamp) : NaN;
  const takenMs = Number.isFinite(numeric) ? (numeric > 10_000_000_000 ? numeric : numeric * 1000) : Date.parse(String(timestamp ?? ''));
  const gps = validSidecarGps(value.geoDataExif) ?? validSidecarGps(value.geoData);
  const metadata = validMediaMetadata({ takenMs, lat: gps?.lat ?? null, lng: gps?.lng ?? null, source: 'takeout-sidecar' });
  return metadata ? { title: String(value.title || ''), metadata } : null;
}

function validSidecarGps(value) {
  const lat = Number(value?.latitude);
  const lng = Number(value?.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (Math.abs(lat) > 1e-7 || Math.abs(lng) > 1e-7)
    ? { lat, lng }
    : null;
}

function readJsonBody(request, maxBytes) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let bytes = 0;
    let exceeded = false;
    request.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > maxBytes) exceeded = true;
      else if (!exceeded) chunks.push(chunk);
    });
    request.on('end', () => {
      if (exceeded) return rejectBody(new Error('Metadata cache payload is too large'));
      try { resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { rejectBody(new Error('Metadata cache payload is not valid JSON')); }
    });
    request.on('error', rejectBody);
  });
}

function serveStatic(request, response, pathname) {
  if (!['GET', 'HEAD'].includes(request.method || 'GET')) {
    response.setHeader('Allow', 'GET, HEAD');
    return text(response, 405, 'Method not allowed');
  }
  const requested = pathname === '/' ? '/index.html' : pathname;
  const safePath = normalize(requested).replace(/^(\.\.[/\\])+/, '');
  let filePath = resolve(distDir, `.${safePath}`);
  const relativePath = relative(resolve(distDir), filePath);
  if (isAbsolute(relativePath) || relativePath.startsWith('..') || !existsSync(filePath) || !statSync(filePath).isFile()) {
    filePath = join(distDir, 'index.html');
  }
  if (!existsSync(filePath)) return text(response, 503, 'Run npm run build first');
  response.writeHead(200, {
    'Content-Type': mimeType(extname(filePath)),
    'Cache-Control': extname(filePath) === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable'
  });
  if (request.method === 'HEAD') return response.end();
  createReadStream(filePath).pipe(response);
}

function mimeType(extension) {
  extension = extension.toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.heic': 'image/heic',
    '.heif': 'image/heif',
    '.mp4': 'video/mp4',
    '.m4v': 'video/x-m4v',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm',
    '.ico': 'image/x-icon'
  }[extension] || 'application/octet-stream';
}

function setSecurityHeaders(response) {
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
}

function isAllowedHost(host) {
  try {
    const hostname = new URL(`http://${host || ''}`).hostname;
    return hostname === '127.0.0.1' || hostname === 'localhost';
  } catch {
    return false;
  }
}

function isSameOriginRequest(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.host && isAllowedHost(request.headers.host);
  } catch {
    return false;
  }
}

function configuredPath(environmentName, fallback) {
  const value = process.env[environmentName]?.trim();
  return value ? resolve(value) : fallback;
}

function publicMediaItem(item) {
  return {
    id: item.id,
    name: item.name,
    size: item.size,
    lastModified: item.lastModified,
    kind: item.kind,
    metadata: item.metadata
  };
}

function json(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  response.end(body);
}

function text(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end(body);
}
