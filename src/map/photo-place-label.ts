import type { Coordinate } from '../types';
import { resolveCityLabel, type CityLabelMap } from './city-label';

interface MapFeature {
  geometry?: { type?: string; coordinates?: unknown };
  layer?: { id?: string; source?: string; 'source-layer'?: string };
  properties?: Record<string, unknown> | null;
  source?: string;
  sourceLayer?: string;
}

const CITY_DISTANCE_KM = 100;
const DISTRICT_DISTANCE_KM = 35;

/**
 * Resolves a coarse administrative label for a photo coordinate without
 * sending the coordinate to an external reverse-geocoding service.
 *
 * The lookup uses already loaded vector-tile place data so it works with the
 * local PMTiles map as well as compatible online styles. Fine-grained
 * 읍/면/동/리, neighbourhood, suburb and POI labels are deliberately ignored.
 */
export function resolvePhotoPlaceLabel(map: CityLabelMap, coordinate: Coordinate): string | null {
  try {
    const features = collectPlaceFeatures(map, coordinate);
    const city = nearestNamedFeature(features, coordinate, isCityFeature, CITY_DISTANCE_KM)
      ?? resolveCityLabel(map, coordinate);
    if (!city) return null;

    const district = nearestNamedFeature(features, coordinate, isDistrictFeature, DISTRICT_DISTANCE_KM);
    if (!district || district === city || city.includes(district) || district.includes(city)) return city;
    return `${city} ${district}`;
  } catch {
    return resolveCityLabel(map, coordinate);
  }
}

function collectPlaceFeatures(map: CityLabelMap, coordinate: Coordinate): MapFeature[] {
  const features: MapFeature[] = [];
  const point = map.project([coordinate.lng, coordinate.lat]);
  features.push(...map.queryRenderedFeatures([
    [point.x - 96, point.y - 96],
    [point.x + 96, point.y + 96]
  ]));

  if (!map.getStyle || !map.querySourceFeatures) return features;
  const pairs = new Set<string>();
  for (const layer of map.getStyle().layers ?? []) {
    const source = typeof layer?.source === 'string' ? layer.source : '';
    const sourceLayer = typeof layer?.['source-layer'] === 'string' ? layer['source-layer'] : '';
    const id = String(layer?.id ?? '');
    if (!source || !sourceLayer || !/place|city|town|municipal|district|ward|borough/i.test(`${id} ${sourceLayer}`)) continue;
    const key = `${source}\0${sourceLayer}`;
    if (pairs.has(key)) continue;
    pairs.add(key);
    features.push(...map.querySourceFeatures(source, { sourceLayer }));
  }
  return features;
}

function nearestNamedFeature(
  features: MapFeature[],
  coordinate: Coordinate,
  accept: (feature: MapFeature) => boolean,
  maxDistanceKm: number
): string | null {
  return features
    .filter(accept)
    .map(feature => ({ name: featureName(feature), distance: featureDistanceKm(feature, coordinate) }))
    .filter((candidate): candidate is { name: string; distance: number } => Boolean(candidate.name) && candidate.distance !== null && candidate.distance <= maxDistanceKm)
    .sort((left, right) => left.distance - right.distance)[0]?.name ?? null;
}

function isCityFeature(feature: MapFeature): boolean {
  const hint = featureHint(feature);
  if (/district|ward|borough|neighbou?rhood|suburb|quarter|village|hamlet/.test(hint)) return false;
  return /(^|\s)(city|town|municipality)(\s|$)/.test(hint)
    || /(city|town|municipal).*label|label.*(city|town|municipal)/.test(hint);
}

function isDistrictFeature(feature: MapFeature): boolean {
  const name = featureName(feature) ?? '';
  if (/[읍면동리]$/.test(name)) return false;
  if (/구$|区$/.test(name)) return true;
  const hint = featureHint(feature);
  if (/neighbou?rhood|suburb|quarter|village|hamlet|locality|poi|address|road/.test(hint)) return false;
  return /district|ward|borough/.test(hint);
}

function featureHint(feature: MapFeature): string {
  const properties = feature.properties ?? {};
  return [
    properties.place,
    properties.class,
    properties.kind,
    properties.type,
    feature.sourceLayer,
    feature.layer?.['source-layer'],
    feature.layer?.id
  ].filter(value => typeof value === 'string').join(' ').toLowerCase();
}

function featureName(feature: MapFeature): string | null {
  const properties = feature.properties ?? {};
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
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(coordinate.lat)) * Math.cos(toRad(lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
