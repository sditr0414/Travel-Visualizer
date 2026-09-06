import type { Map as MapLibreMap } from 'maplibre-gl';
import type { Coordinate } from '../types';

const DEFAULT_TILE_SIZE = 512;
const WARMUP_INTERVAL_MS = 320;
const WARMUP_CACHE_TTL_MS = 45_000;
const MAX_CONCURRENT_REQUESTS = 2;
const MAX_TASKS_PER_PASS = 36;
const NEXT_TILE_LEVEL_THRESHOLD = 0.62;
const MAX_MERCATOR_LAT = 85.05112878;

interface RuntimeTileSource {
  type?: string;
  tiles?: string[];
  url?: string;
  scheme?: 'xyz' | 'tms';
  tileSize?: number;
  minzoom?: number;
  maxzoom?: number;
}

interface WarmupTile {
  z: number;
  x: number;
  y: number;
}

interface WarmupTask {
  key: string;
  run: (signal: AbortSignal) => Promise<void>;
}

class MapTileWarmup {
  private readonly abort = new AbortController();
  private lastWarmAt = -Infinity;
  private queue: WarmupTask[] = [];
  private queuedKeys = new Set<string>();
  private inFlightKeys = new Set<string>();
  private recentlyWarmed = new Map<string, number>();

  constructor(private readonly map: MapLibreMap) {}

  warm(center: Coordinate, zoom: number): void {
    if (this.abort.signal.aborted) return;
    if (!Number.isFinite(center.lng) || !Number.isFinite(center.lat) || !Number.isFinite(zoom)) return;
    const now = nowMs();
    if (now - this.lastWarmAt < WARMUP_INTERVAL_MS) return;
    this.lastWarmAt = now;

    const canvas = this.map.getCanvas();
    const width = Math.max(1, canvas.clientWidth || canvas.width || 1);
    const height = Math.max(1, canvas.clientHeight || canvas.height || 1);
    const tasks = collectWarmupTasks(this.map, center, zoom, width, height);

    this.queue = [];
    this.queuedKeys.clear();
    this.pruneRecentlyWarmed(now);

    for (const task of tasks) {
      if (this.queue.length >= MAX_TASKS_PER_PASS) break;
      if (this.inFlightKeys.has(task.key) || this.queuedKeys.has(task.key)) continue;
      const warmedAt = this.recentlyWarmed.get(task.key);
      if (warmedAt !== undefined && now - warmedAt < WARMUP_CACHE_TTL_MS) continue;
      this.queue.push(task);
      this.queuedKeys.add(task.key);
    }
    this.pump();
  }

  dispose(): void {
    this.abort.abort();
    this.queue = [];
    this.queuedKeys.clear();
    this.recentlyWarmed.clear();
  }

  private pump(): void {
    while (!this.abort.signal.aborted && this.inFlightKeys.size < MAX_CONCURRENT_REQUESTS && this.queue.length) {
      const task = this.queue.shift()!;
      this.queuedKeys.delete(task.key);
      this.inFlightKeys.add(task.key);
      void task.run(this.abort.signal)
        .then(() => this.recentlyWarmed.set(task.key, nowMs()))
        .catch(() => undefined)
        .finally(() => {
          this.inFlightKeys.delete(task.key);
          this.pump();
        });
    }
  }

  private pruneRecentlyWarmed(now: number): void {
    for (const [key, warmedAt] of this.recentlyWarmed) {
      if (now - warmedAt >= WARMUP_CACHE_TTL_MS) this.recentlyWarmed.delete(key);
    }
  }
}

const warmups = new WeakMap<MapLibreMap, MapTileWarmup>();

export function disposeMapTileWarmup(map: MapLibreMap): void {
  warmups.get(map)?.dispose();
  warmups.delete(map);
}

export function warmMapTilesAhead(map: MapLibreMap, center: Coordinate, zoom: number): void {
  const candidate = map as Partial<MapLibreMap>;
  if (typeof candidate.getCanvas !== 'function' || typeof candidate.getStyle !== 'function' || typeof candidate.getSource !== 'function') return;
  let warmup = warmups.get(map);
  if (!warmup) {
    warmup = new MapTileWarmup(map);
    warmups.set(map, warmup);
  }
  warmup.warm(center, zoom);
}

function collectWarmupTasks(
  map: MapLibreMap,
  center: Coordinate,
  zoom: number,
  width: number,
  height: number
): WarmupTask[] {
  const tasks: WarmupTask[] = [];
  const style = map.getStyle();
  const sourceIds = Object.keys(style.sources ?? {});

  for (const sourceId of sourceIds) {
    if (!sourceHasVisibleLayer(map, sourceId, zoom)) continue;
    const source = map.getSource(sourceId) as unknown as RuntimeTileSource | undefined;
    if (!source || (source.type !== 'vector' && source.type !== 'raster')) continue;

    const minzoom = clampInteger(source.minzoom ?? 0, 0, 24);
    const maxzoom = clampInteger(source.maxzoom ?? 22, minzoom, 24);
    const tileSize = Math.max(128, Number(source.tileSize) || DEFAULT_TILE_SIZE);
    const levels = warmupZoomLevels(zoom, minzoom, maxzoom);
    const pmtilesUrl = source.url?.startsWith('pmtiles://') ? source.url.slice('pmtiles://'.length) : null;
    const templates = Array.isArray(source.tiles) ? source.tiles.filter(Boolean) : [];

    for (const tileZoom of levels) {
      const tiles = warmupTilesForViewport(center, zoom, tileZoom, width, height, tileSize);
      for (const tile of tiles) {
        if (pmtilesUrl) {
          const key = `pmtiles:${pmtilesUrl}:${tile.z}/${tile.x}/${tile.y}`;
          tasks.push({
            key,
            run: async () => {
              const { warmLocalPmtilesTile } = await import('./map-style-local');
              await warmLocalPmtilesTile(pmtilesUrl, tile.z, tile.x, tile.y);
            }
          });
          continue;
        }

        for (const template of templates) {
          if (!/^https?:\/\//i.test(template)) continue;
          const url = renderTileTemplate(template, tile, source.scheme ?? 'xyz', map.getPixelRatio());
          tasks.push({
            key: `http:${url}`,
            run: async signal => {
              const request = new AbortController();
              const abort = () => request.abort();
              signal.addEventListener('abort', abort, { once: true });
              const timeout = setTimeout(abort, 4000);
              try {
                if (signal.aborted) request.abort();
                const response = await fetch(url, { cache: 'force-cache', signal: request.signal, priority: 'low' });
                if (!response.ok) { await response.body?.cancel(); throw new Error(`Tile warmup failed: ${response.status}`); }
                // Headers alone do not mean the transfer or browser cache is ready.
                await response.arrayBuffer();
              } finally {
                clearTimeout(timeout);
                signal.removeEventListener('abort', abort);
              }
            }
          });
          break;
        }
      }
    }
  }

  return tasks.slice(0, MAX_TASKS_PER_PASS);
}

function sourceHasVisibleLayer(map: MapLibreMap, sourceId: string, zoom: number): boolean {
  const layers = map.getStyle().layers ?? [];
  return layers.some(layer => {
    if (!('source' in layer) || layer.source !== sourceId) return false;
    if (layer.layout?.visibility === 'none') return false;
    const minzoom = Number(layer.minzoom ?? 0);
    const maxzoom = Number(layer.maxzoom ?? 24);
    return zoom >= minzoom && zoom < maxzoom;
  });
}

export function warmupZoomLevels(zoom: number, minzoom: number, maxzoom: number): number[] {
  const safeMin = clampInteger(minzoom, 0, 24);
  const safeMax = clampInteger(maxzoom, safeMin, 24);
  const rawFloor = Math.floor(Number(zoom) || 0);
  const base = clampInteger(rawFloor, safeMin, safeMax);
  const result = [base];
  const fraction = (Number(zoom) || 0) - rawFloor;
  if (fraction >= NEXT_TILE_LEVEL_THRESHOLD && base < safeMax) result.push(base + 1);
  return result;
}

export function warmupTilesForViewport(
  center: Coordinate,
  cameraZoom: number,
  tileZoom: number,
  width: number,
  height: number,
  tileSize = DEFAULT_TILE_SIZE
): WarmupTile[] {
  const z = clampInteger(tileZoom, 0, 24);
  const scale = 2 ** z;
  const lng = normalizeLongitude(center.lng);
  const lat = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, center.lat));
  const centerX = ((lng + 180) / 360) * scale;
  const latRad = lat * Math.PI / 180;
  const centerY = (1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2 * scale;
  const tilePixels = Math.max(1, tileSize * 2 ** (cameraZoom - z));
  const halfTilesX = Math.max(0.5, width / (2 * tilePixels)) + 0.75;
  const halfTilesY = Math.max(0.5, height / (2 * tilePixels)) + 0.75;
  const minX = Math.floor(centerX - halfTilesX);
  const maxX = Math.floor(centerX + halfTilesX);
  const minY = Math.max(0, Math.floor(centerY - halfTilesY));
  const maxY = Math.min(scale - 1, Math.floor(centerY + halfTilesY));
  const tiles: Array<WarmupTile & { distance: number }> = [];
  const seen = new Set<string>();

  for (let rawX = minX; rawX <= maxX; rawX += 1) {
    const x = modulo(rawX, scale);
    for (let y = minY; y <= maxY; y += 1) {
      const key = `${x}/${y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const dx = rawX + 0.5 - centerX;
      const dy = y + 0.5 - centerY;
      tiles.push({ z, x, y, distance: dx * dx + dy * dy });
    }
  }

  tiles.sort((a, b) => a.distance - b.distance);
  return tiles.map(({ z: tileZ, x, y }) => ({ z: tileZ, x, y }));
}

export function renderTileTemplate(
  template: string,
  tile: WarmupTile,
  scheme: 'xyz' | 'tms' = 'xyz',
  pixelRatio = 1
): string {
  const scale = 2 ** tile.z;
  const flippedY = scale - tile.y - 1;
  const sourceY = scheme === 'tms' ? flippedY : tile.y;
  return template
    .replaceAll('{z}', String(tile.z))
    .replaceAll('{x}', String(tile.x))
    .replaceAll('{y}', String(sourceY))
    .replaceAll('{-y}', String(flippedY))
    .replaceAll('{ratio}', pixelRatio > 1 ? '@2x' : '');
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.trunc(Number(value) || 0)));
}

function normalizeLongitude(lng: number): number {
  return ((Number(lng) + 180) % 360 + 360) % 360 - 180;
}

function modulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
