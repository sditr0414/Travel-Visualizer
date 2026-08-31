import type { Coordinate } from '../types';

interface MapFeature {
  geometry?: { type?: string; coordinates?: unknown };
  layer?: { id?: string; source?: string; 'source-layer'?: string };
  properties?: Record<string, unknown> | null;
  source?: string;
  sourceLayer?: string;
}

export interface CityLabelMap {
  project(coordinate: [number, number]): { x: number; y: number };
  queryRenderedFeatures(box: [[number, number], [number, number]]): MapFeature[];
  getStyle?(): { layers?: MapFeature['layer'][]; sources?: Record<string, unknown> };
  querySourceFeatures?(source: string, options?: { sourceLayer?: string }): MapFeature[];
}

export function resolveCityLabel(map: CityLabelMap, coordinate: Coordinate): string | null {
  try {
    const point = map.project([coordinate.lng, coordinate.lat]);
    const rendered = map.queryRenderedFeatures([
      [point.x - 72, point.y - 72],
      [point.x + 72, point.y + 72]
    ]);
    const renderedName = nearestCityName(rendered, coordinate);
    if (renderedName) return renderedName;

    const nearest = loadedSourceCities(map)
      .map(feature => ({ name: cityName(feature), distance: featureDistanceKm(feature, coordinate) }))
      .filter((candidate): candidate is { name: string; distance: number } => Boolean(candidate.name) && candidate.distance !== null && candidate.distance <= 80)
      .sort((left, right) => left.distance - right.distance)[0];
    return nearest?.name ?? null;
  } catch {
    return null;
  }
}

function loadedSourceCities(map: CityLabelMap): MapFeature[] {
  if (!map.getStyle || !map.querySourceFeatures) return [];
  const pairs = new Set<string>();
  const features: MapFeature[] = [];
  for (const layer of map.getStyle().layers ?? []) {
    const source = typeof layer?.source === 'string' ? layer.source : '';
    const sourceLayer = typeof layer?.['source-layer'] === 'string' ? layer['source-layer'] : '';
    const id = String(layer?.id ?? '');
    if (!source || !sourceLayer || !/place|city|town|municipal/i.test(`${id} ${sourceLayer}`)) continue;
    const key = `${source}\0${sourceLayer}`;
    if (pairs.has(key)) continue;
    pairs.add(key);
    features.push(...map.querySourceFeatures(source, { sourceLayer }));
  }
  return features;
}

function nearestCityName(features: MapFeature[], coordinate: Coordinate): string | null {
  return features
    .map(feature => ({ name: cityName(feature), distance: featureDistanceKm(feature, coordinate) }))
    .filter((candidate): candidate is { name: string; distance: number } => Boolean(candidate.name) && candidate.distance !== null && candidate.distance <= 80)
    .sort((left, right) => left.distance - right.distance)[0]?.name ?? null;
}

function cityName(feature: MapFeature): string | null {
  const properties = feature.properties ?? {};
  const classification = [properties.place, properties.class, properties.kind, properties.type]
    .filter(value => typeof value === 'string')
    .join(' ')
    .toLowerCase();
  const layerHint = `${feature.sourceLayer ?? ''} ${feature.layer?.['source-layer'] ?? ''} ${feature.layer?.id ?? ''}`.toLowerCase();
  if (/district|ward|borough|neighbou?rhood|suburb|quarter|village|hamlet|region|province|prefecture|state|county/.test(`${classification} ${layerHint}`)) return null;
  if (!/(^|\s)(city|town|municipality)(\s|$)/.test(classification) && !/(city|town|municipal).*label|label.*(city|town|municipal)/.test(layerHint)) return null;
  const name = properties['name:ko'] ?? properties.name_ko ?? properties['name:en'] ?? properties.name_en ?? properties.name;
  return typeof name === 'string' && name.trim() ? name.trim() : null;
}

function featureDistanceKm(feature: MapFeature, coordinate: Coordinate): number | null {
  if (feature.geometry?.type !== 'Point' || !Array.isArray(feature.geometry.coordinates)) return null;
  const [lng, lat] = feature.geometry.coordinates;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  const toRad = (value: number) => value * Math.PI / 180;
  const dLat = toRad(lat - coordinate.lat);
  const dLng = toRad(lng - coordinate.lng);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(coordinate.lat)) * Math.cos(toRad(lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
