import type { StyleSpecification } from 'maplibre-gl';
import type { MapSourceConfig } from '../types';

export const ONLINE_STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';

export async function mapStyleFor(config: MapSourceConfig): Promise<string | StyleSpecification> {
  if (config.kind === 'online') return config.styleUrl;
  return (await import('./map-style-local')).localMapStyleFor(config);
}
