import { haversineMeters } from '../geo.js';
import type { JourneyMedia, MobilityClass, PlaybackFrame, PlaybackPlan } from '../types';
import { positionAtPlaybackSecond } from './media-library';

export interface PhotoPlaceLookupStatus {
  available: boolean;
  provider: string | null;
  cache: boolean;
}

export interface PhotoPlaceLookupResult {
  available: boolean;
  found: boolean;
  provider?: string | null;
  name?: string | null;
  address?: string | null;
  confidence?: 'HIGH' | 'MEDIUM' | 'LOW';
  distanceMeters?: number | null;
  cached?: boolean;
}

export type PhotoPlaceDecision =
  | { kind: 'movement'; label: string }
  | { kind: 'fallback'; coordinate?: { lat: number; lng: number } }
  | { kind: 'lookup'; lat: number; lng: number; gpsAccuracyM: number | null; clusterCount: number };

const CLUSTER_WINDOW_MS = 10 * 60_000;
const CLUSTER_RADIUS_M = 80;
const CLUSTER_MAX_SPREAD_M = 45;
const STALE_GPS_TIMELINE_DISTANCE_M = 5_000;

export function photoPlaceDecision(
  item: JourneyMedia,
  allMedia: JourneyMedia[],
  plan: PlaybackPlan,
  frame: PlaybackFrame
): PhotoPlaceDecision {
  if (item.positionSource !== 'gps' || item.lat == null || item.lng == null) return { kind: 'fallback' };

  const cluster = stableGpsCluster(item, allMedia);
  const movement = movementLabel(frame);
  if (movement && (frame.kind === 'TRAVEL' && frame.mobilityClass === 'FLIGHT' || !cluster.stable)) {
    return { kind: 'movement', label: movement };
  }

  const accuracy = item.gpsAccuracyM;
  if (accuracy != null && accuracy > 100) return { kind: 'fallback' };
  if (!cluster.stable && accuracy != null && accuracy > 60) return { kind: 'fallback' };

  const timeline = positionAtPlaybackSecond(item.playbackSec, plan);
  const gps = { lat: item.lat, lng: item.lng };
  if (!cluster.stable && haversineMeters(gps, timeline) > STALE_GPS_TIMELINE_DISTANCE_M) {
    return { kind: 'fallback', coordinate: timeline };
  }

  return {
    kind: 'lookup',
    lat: cluster.stable ? cluster.lat : item.lat,
    lng: cluster.stable ? cluster.lng : item.lng,
    gpsAccuracyM: accuracy,
    clusterCount: cluster.count
  };
}

export async function loadPhotoPlaceLookupStatus(): Promise<PhotoPlaceLookupStatus> {
  try {
    const response = await fetch('/api/photo-place-status', { cache: 'no-store', signal: AbortSignal.timeout(5_000) });
    if (!response.ok) return { available: false, provider: null, cache: true };
    const value = await response.json() as Partial<PhotoPlaceLookupStatus>;
    return {
      available: value.available === true,
      provider: typeof value.provider === 'string' ? value.provider : null,
      cache: value.cache !== false
    };
  } catch {
    return { available: false, provider: null, cache: true };
  }
}

export async function lookupOnlinePhotoPlace(decision: Extract<PhotoPlaceDecision, { kind: 'lookup' }>): Promise<PhotoPlaceLookupResult | null> {
  try {
    const response = await fetch('/api/photo-place', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat: decision.lat, lng: decision.lng, gpsAccuracyM: decision.gpsAccuracyM }),
      signal: AbortSignal.timeout(12_000)
    });
    if (!response.ok) return null;
    const value = await response.json() as PhotoPlaceLookupResult;
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

export function gpsAccuracyLabel(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value) || value < 0) return null;
  if (value < 10) return `수평 오차 약 ${Math.max(1, Math.round(value))}m`;
  if (value < 100) return `수평 오차 약 ${Math.round(value / 5) * 5}m`;
  return `수평 오차 약 ${Math.round(value / 10) * 10}m`;
}

function stableGpsCluster(item: JourneyMedia, media: JourneyMedia[]): { stable: boolean; lat: number; lng: number; count: number } {
  const origin = { lat: item.lat!, lng: item.lng! };
  const candidates = media.filter(candidate => candidate.positionSource === 'gps'
    && candidate.lat != null
    && candidate.lng != null
    && Math.abs(candidate.takenMs - item.takenMs) <= CLUSTER_WINDOW_MS
    && haversineMeters(origin, { lat: candidate.lat, lng: candidate.lng }) <= CLUSTER_RADIUS_M);
  if (candidates.length < 2) return { stable: false, ...origin, count: 1 };

  const lat = median(candidates.map(candidate => candidate.lat!));
  const lng = median(candidates.map(candidate => candidate.lng!));
  const center = { lat, lng };
  const spread = Math.max(...candidates.map(candidate => haversineMeters(center, { lat: candidate.lat!, lng: candidate.lng! })));
  return spread <= CLUSTER_MAX_SPREAD_M
    ? { stable: true, lat, lng, count: candidates.length }
    : { stable: false, ...origin, count: 1 };
}

function movementLabel(frame: PlaybackFrame): string | null {
  if (frame.kind !== 'TRAVEL') return null;
  const labels: Partial<Record<MobilityClass, string>> = {
    FLIGHT: '비행 중',
    FAST_GROUND: '기차 이동 중',
    FERRY: '페리 이동 중'
  };
  if (labels[frame.mobilityClass]) return labels[frame.mobilityClass]!;
  if (frame.mobilityClass === 'URBAN_TRANSIT' && frame.speedKmh >= 8) return '대중교통 이동 중';
  if (frame.mobilityClass === 'ROAD' && frame.speedKmh >= 15) return '차량 이동 중';
  if (frame.mobilityClass === 'UNKNOWN' && frame.speedKmh >= 15) return '이동 중';
  return null;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
