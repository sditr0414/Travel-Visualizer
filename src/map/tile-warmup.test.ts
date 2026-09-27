import { bindMapTileWarmupInteractions, disposeMapTileWarmup, renderTileTemplate, warmMapTilesAhead, warmupTilesForViewport, warmupZoomLevels } from './tile-warmup';

describe('tile warmup', () => {
  it('prepares the current tile zoom and the next level before crossing the boundary', () => {
    expect(warmupZoomLevels(13.4, 0, 14)).toEqual([13]);
    expect(warmupZoomLevels(13.7, 0, 14)).toEqual([13, 14]);
    expect(warmupZoomLevels(15.2, 0, 14)).toEqual([14]);
  });

  it('builds a compact viewport-centered tile set', () => {
    const tiles = warmupTilesForViewport({ lat: 37.5665, lng: 126.978 }, 13.8, 13, 1200, 800);
    expect(tiles.length).toBeGreaterThan(0);
    expect(new Set(tiles.map(tile => `${tile.z}/${tile.x}/${tile.y}`)).size).toBe(tiles.length);
    expect(tiles.every(tile => tile.z === 13)).toBe(true);
    expect(tiles.every(tile => tile.x >= 0 && tile.x < 2 ** 13 && tile.y >= 0 && tile.y < 2 ** 13)).toBe(true);
  });

  it('matches raster tile size and rounding at MapLibre zoom boundaries', () => {
    expect(warmupZoomLevels(4.4, 0, 6, 256, true)).toEqual([5, 6]);
    expect(warmupZoomLevels(4.5, 0, 6, 256, true)[0]).toBe(6);
    expect(warmupZoomLevels(5.4, 0, 6, 256, true)).toEqual([6]);
    // At camera z=4, raster z=5 tiles occupy 256px in the 512px world.
    const tiles = warmupTilesForViewport({ lng: 0, lat: 0 }, 4, 5, 1024, 512);
    expect(tiles).toHaveLength(24);
  });

  it('renders XYZ, TMS and retina tile URL placeholders', () => {
    const tile = { z: 3, x: 2, y: 1 };
    expect(renderTileTemplate('https://tiles/{z}/{x}/{y}{ratio}.pbf', tile, 'xyz', 2))
      .toBe('https://tiles/3/2/1@2x.pbf');
    expect(renderTileTemplate('https://tiles/{z}/{x}/{y}.pbf', tile, 'tms', 1))
      .toBe('https://tiles/3/2/6.pbf');
    expect(renderTileTemplate('https://tiles/{z}/{x}/{-y}.pbf', tile, 'xyz', 1))
      .toBe('https://tiles/3/2/6.pbf');
  });
});

function fakeTileMap(width = 1200, height = 800): import('maplibre-gl').Map {
  return {
    getCanvas: () => ({ clientWidth: width, clientHeight: height }),
    getStyle: () => ({ sources: { tiles: {} }, layers: [{ source: 'tiles', type: 'line' }] }),
    getSource: () => ({ type: 'vector', tiles: ['https://example.com/{z}/{x}/{y}.pbf'] }),
    getPixelRatio: () => 1
  } as unknown as import('maplibre-gl').Map;
}

it('warms both manual zoom directions, keeps the final destination, and ignores playback zoom events', async () => {
  vi.useFakeTimers();
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) });
  vi.stubGlobal('fetch', fetchMock);
  let zoom = 12.4;
  let onZoom: (event: { originalEvent?: Event }) => void = () => {};
  const off = vi.fn();
  const map = Object.assign(fakeTileMap(), {
    getZoom: () => zoom, getCenter: () => ({ lng: 127, lat: 37 }),
    getMinZoom: () => 0, getMaxZoom: () => 18,
    on: (_type: string, handler: typeof onZoom) => { onZoom = handler; }, off
  });
  const unbind = bindMapTileWarmupInteractions(map);
  try {
    zoom = 12.5;
    onZoom({});
    expect(fetchMock).not.toHaveBeenCalled();
    zoom = 12.6;
    onZoom({ originalEvent: new Event('wheel') });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock.mock.calls.some(([url]) => url.includes('/13/'))).toBe(true);
    zoom = 12.5;
    onZoom({ originalEvent: new Event('wheel') });
    await vi.advanceTimersByTimeAsync(320);
    // Prepare z11 while the renderer still uses z12, before crossing z12.
    expect(fetchMock.mock.calls.some(([url]) => url.includes('/11/'))).toBe(true);
    expect(fetchMock.mock.calls.some(([url]) => url.includes('/12/'))).toBe(false);
    zoom = 11.8;
    onZoom({ originalEvent: new Event('wheel') });
    zoom = 10.8;
    onZoom({ originalEvent: new Event('wheel') });
    await vi.advanceTimersByTimeAsync(320);
    expect(fetchMock.mock.calls.some(([url]) => url.includes('/9/'))).toBe(true);
    expect(fetchMock.mock.calls.some(([url]) => url.includes('/10/'))).toBe(false);
    zoom = 9.8;
    onZoom({ originalEvent: new Event('wheel') });
    disposeMapTileWarmup(map);
    const count = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(count);
    unbind();
    expect(off).toHaveBeenCalledWith('zoom', onZoom);
  } finally { disposeMapTileWarmup(map); vi.useRealTimers(); vi.unstubAllGlobals(); }
});

it('reaches the next level on a large viewport after near tiles are already cached', async () => {
  vi.useFakeTimers();
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) });
  vi.stubGlobal('fetch', fetchMock);
  const map = fakeTileMap(3840, 2160);
  try {
    warmMapTilesAhead(map, { lng: 127, lat: 37 }, 12.7);
    await vi.advanceTimersByTimeAsync(0);
    warmMapTilesAhead(map, { lng: 127, lat: 37 }, 12.7);
    await vi.advanceTimersByTimeAsync(320);
    expect(fetchMock.mock.calls.some(([url]) => url.includes('/13/'))).toBe(true);
    const urls = fetchMock.mock.calls.map(([url]) => url);
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls.length).toBeLessThanOrEqual(72);
  } finally { disposeMapTileWarmup(map); vi.useRealTimers(); vi.unstubAllGlobals(); }
});

it('keeps prefetch slots occupied until bodies finish and aborts requests when the map is removed', async () => {
  const { warmMapTilesAhead, disposeMapTileWarmup } = await import('./tile-warmup');
  const transfers: Array<{ finish: () => void; signal: AbortSignal }> = [];
  const fetchMock = vi.fn((_url: string, options: RequestInit) => Promise.resolve({
    ok: true,
    arrayBuffer: () => new Promise<void>((resolve, reject) => {
      const signal = options.signal!;
      transfers.push({ finish: resolve, signal });
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    })
  }));
  vi.stubGlobal('fetch', fetchMock);
  const map = {
    getCanvas: () => ({ clientWidth: 1200, clientHeight: 800 }),
    getStyle: () => ({ sources: { tiles: {} }, layers: [{ source: 'tiles', type: 'line' }] }),
    getSource: () => ({ type: 'vector', tiles: ['https://example.com/{z}/{x}/{y}.pbf'] }),
    getPixelRatio: () => 1
  } as unknown as import('maplibre-gl').Map;
  try {
    warmMapTilesAhead(map, { lng: 127, lat: 37 }, 12);
    await vi.waitFor(() => expect(transfers).toHaveLength(2));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    transfers[0].finish();
    await vi.waitFor(() => expect(transfers).toHaveLength(3));
    disposeMapTileWarmup(map);
    expect(transfers[1].signal.aborted).toBe(true);
    expect(transfers[2].signal.aborted).toBe(true);
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  } finally { disposeMapTileWarmup(map); vi.unstubAllGlobals(); }
});
