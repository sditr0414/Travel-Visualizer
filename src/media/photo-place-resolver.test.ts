import { describe, expect, it } from 'vitest';
import type { JourneyMedia, PlaybackPlan, TravelFrame } from '../types';
import { gpsAccuracyLabel, photoPlaceDecision } from './photo-place-resolver';

const plan = {
  frames: [{ kind: 'TRAVEL', timeSec: 0, segmentIndex: 0, sceneId: 0, progress: 0, position: { lat: 37.5, lng: 127 }, center: { lat: 37.5, lng: 127 }, zoom: 12, speedKmh: 4, mobilityClass: 'WALK' }],
  segments: [{ start: { lat: 37.5, lng: 127 }, end: { lat: 37.5, lng: 127 } }],
  fps: 1
} as unknown as PlaybackPlan;

function media(overrides: Partial<JourneyMedia> = {}): JourneyMedia {
  return {
    id: 'a', file: null, kind: 'image', title: 'photo', takenMs: 1_700_000_000_000,
    lat: 37.5, lng: 127, gpsAccuracyM: 8, metadataSource: 'embedded-exif', playbackSec: 0,
    matchedLat: 37.5, matchedLng: 127, positionSource: 'gps', groupId: '', groupIndex: 0,
    groupCount: 1, sourceCount: 1, ...overrides
  };
}

function frame(overrides: Partial<TravelFrame> = {}): TravelFrame {
  return { ...(plan.frames[0] as TravelFrame), ...overrides };
}

describe('photo place confidence decision', () => {
  it('uses a good GPS coordinate for online lookup', () => {
    expect(photoPlaceDecision(media(), [media()], plan, frame())).toMatchObject({ kind: 'lookup', clusterCount: 1 });
  });

  it('does not resolve a single low-accuracy GPS fix as an exact place', () => {
    expect(photoPlaceDecision(media({ gpsAccuracyM: 85 }), [media({ gpsAccuracyM: 85 })], plan, frame())).toEqual({ kind: 'fallback' });
  });

  it('uses a stable nearby photo cluster even when one fix has moderate error', () => {
    const first = media({ gpsAccuracyM: 85 });
    const second = media({ id: 'b', takenMs: first.takenMs + 60_000, lat: 37.50005, lng: 127.00004, gpsAccuracyM: 20 });
    expect(photoPlaceDecision(first, [first, second], plan, frame())).toMatchObject({ kind: 'lookup', clusterCount: 2 });
  });

  it('labels flight photos as in transit instead of choosing a nearby POI', () => {
    expect(photoPlaceDecision(media(), [media()], plan, frame({ mobilityClass: 'FLIGHT', speedKmh: 700 }))).toEqual({ kind: 'movement', label: '비행 중' });
  });

  it('falls back to the Timeline coordinate when a lone GPS fix is implausibly far away', () => {
    const far = media({ lat: 35, lng: 129, matchedLat: 35, matchedLng: 129 });
    expect(photoPlaceDecision(far, [far], plan, frame())).toEqual({ kind: 'fallback', coordinate: { lat: 37.5, lng: 127 } });
  });

  it('formats EXIF horizontal accuracy conservatively', () => {
    expect(gpsAccuracyLabel(7.4)).toBe('수평 오차 약 7m');
    expect(gpsAccuracyLabel(23)).toBe('수평 오차 약 25m');
    expect(gpsAccuracyLabel(null)).toBeNull();
  });
});
