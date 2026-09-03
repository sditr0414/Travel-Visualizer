import { renderTileTemplate, warmupTilesForViewport, warmupZoomLevels } from './tile-warmup';

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
