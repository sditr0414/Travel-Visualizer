import { layers, namedFlavor } from '@protomaps/basemaps';
import * as maplibregl from 'maplibre-gl';
import type { StyleSpecification } from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import type { MapSourceConfig } from '../types';

type LocalMapSource = Extract<MapSourceConfig, { kind: 'local-pmtiles' }>;

const GLYPHS_URL = 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf';
let protocolRegistered = false;

export function localMapStyleFor(config: LocalMapSource): StyleSpecification {
  registerPmtilesProtocol();
  const flavor = namedFlavor('grayscale');
  const worldLayers = prepareLayers(layers('world', flavor, { lang: 'ko' }), 'world', 'world-', { maxzoom: 6 });
  const regionLayers = prepareLayers(layers('region', flavor, { lang: 'ko' }), 'region', 'region-', { minzoom: 6 });
  return {
    version: 8,
    glyphs: GLYPHS_URL,
    sources: {
      world: { type: 'vector', url: `pmtiles://${config.worldUrl}`, attribution: '© OpenStreetMap contributors · Protomaps' },
      region: { type: 'vector', url: `pmtiles://${config.regionUrl}`, attribution: '© OpenStreetMap contributors · Protomaps' }
    },
    layers: [
      { id: 'local-background', type: 'background', paint: { 'background-color': flavor.background || '#e8e8e4' } },
      ...worldLayers,
      ...regionLayers
    ]
  } as unknown as StyleSpecification;
}

function registerPmtilesProtocol(): void {
  if (protocolRegistered) return;
  const protocol = new Protocol();
  maplibregl.addProtocol('pmtiles', protocol.tile);
  protocolRegistered = true;
}

function prepareLayers(
  sourceLayers: ReturnType<typeof layers>,
  sourceName: string,
  prefix: string,
  limits: { minzoom?: number; maxzoom?: number }
): ReturnType<typeof layers> {
  return sourceLayers.flatMap(layer => {
    if (layer.type === 'background') return [];
    if (layer.type === 'symbol' && layer.layout?.['icon-image']) return [];
    const id = String(layer.id || '').toLowerCase();
    if (/poi|housenumber|house_number|address|airport_gate|aeroway_gate/.test(id)) return [];
    const copy = structuredClone(layer);
    const minzoom = Math.max(Number(copy.minzoom ?? 0), limits.minzoom ?? 0);
    const maxzoom = Math.min(Number(copy.maxzoom ?? 24), limits.maxzoom ?? 24);
    if (minzoom >= maxzoom) return [];
    copy.id = `${prefix}${copy.id}`;
    if ('source' in copy && copy.source) copy.source = sourceName;
    if (minzoom > 0) copy.minzoom = minzoom;
    if (maxzoom < 24) copy.maxzoom = maxzoom;
    return [copy];
  }) as ReturnType<typeof layers>;
}
