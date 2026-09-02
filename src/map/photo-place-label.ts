import type { Coordinate } from '../types';
import type { CityLabelMap } from './city-label';

interface MapFeature {
  geometry?: { type?: string; coordinates?: unknown };
  layer?: { id?: string; source?: string; 'source-layer'?: string };
  properties?: Record<string, unknown> | null;
  source?: string;
  sourceLayer?: string;
}

const CITY_DISTANCE_KM = 45;
const DISTRICT_DISTANCE_KM = 12;

/**
 * Resolves a coarse administrative label for a photo coordinate without
 * sending the coordinate to an external reverse-geocoding service.
 *
 * The lookup uses already loaded vector-tile place data so it works with the
 * local PMTiles map as well as compatible online styles. Output is limited to
 * city and district/ward level. 읍/면/동/리/군, villages and smaller locality
 * labels are deliberately rejected even when a map style classifies them as
 * town, municipality or suburb. If a city-level feature is not close enough
 * to the photo coordinate, resolution intentionally fails instead of borrowing
 * a potentially unrelated nearby city.
 */
export function resolvePhotoPlaceLabel(map: CityLabelMap, coordinate: Coordinate): string | null {
  try {
    const features = collectPlaceFeatures(map, coordinate);
    const city = nearestNamedFeature(features, coordinate, isCityFeature, CITY_DISTANCE_KM);
    if (!city) return null;

    const district = nearestNamedFeature(features, coordinate, isDistrictFeature, DISTRICT_DISTANCE_KM);
    if (!district || district === city || city.includes(district) || district.includes(city)) return city;
    return `${city} ${district}`;
  } catch {
    return null;
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
    if (!source || !sourceLayer || !/place|city|municipal|district|ward|borough/i.test(`${id} ${sourceLayer}`)) continue;
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
  if (hasFineAdministrativeName(feature)) return false;
  const hint = featureHint(feature);
  if (/district|ward|borough|neighbou?rhood|suburb|quarter|village|hamlet|town|county/.test(hint)) return false;
  return /(^|\s)city(\s|$)/.test(hint)
    || /city.*label|label.*city/.test(hint);
}

function isDistrictFeature(feature: MapFeature): boolean {
  if (hasFineAdministrativeName(feature)) return false;
  const name = featureName(feature) ?? '';
  if (/구$|区$/.test(name)) return true;
  const hint = featureHint(feature);
  if (/neighbou?rhood|suburb|quarter|village|hamlet|town|locality|poi|address|road|county|region|province|prefecture|state/.test(hint)) return false;
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

function hasFineAdministrativeName(feature: MapFeature): boolean {
  const properties = feature.properties ?? {};
  return [properties['name:ko'], properties.name_ko, properties['name:ja'], properties.name_ja, properties.name]
    .some(value => typeof value === 'string' && isFineAdministrativeName(value.trim()));
}

function isFineAdministrativeName(name: string): boolean {
  return /(?:군|읍|면|동|리|가|로|길|마을|町|村|丁目)$/.test(name);
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
