import type { PlaybackPlan } from '../types';

export function simplePlan(): PlaybackPlan {
  return {
    fps: 2,
    durationSec: 1,
    travelDurationSec: 0.5,
    outroStartSec: 0.5,
    outroSec: 0.5,
    durationLimits: { minSeconds: 45, recommendedSeconds: 90, maxSeconds: 300, days: 1, distanceKm: 2 },
    routeRenderPoints: [],
    pacingMode: 'LOCAL_DAYS',
    cameraMode: 'AUTO',
    segments: [{
      index: 0,
      startMs: Date.parse('2026-04-10T00:00:00Z'),
      endMs: Date.parse('2026-04-10T00:10:00Z'),
      start: { lat: 37.5, lng: 127 },
      end: { lat: 37.51, lng: 127.01 },
      points: [{ lat: 37.5, lng: 127 }, { lat: 37.51, lng: 127.01 }],
      distanceMeters: 2000,
      durationSec: 600,
      avgSpeedKmh: 12,
      googleType: 'WALKING',
      googleProbability: 0.9,
      activityProbability: 0.9,
      inferred: false,
      videoSec: 0.5,
      startVideoSec: 0,
      endVideoSec: 0.5,
      sceneId: 0,
      inference: { mobilityClass: 'WALK', confidence: 0.9, speedKmh: 12, distanceKm: 2 }
    }],
    frames: [
      {
        kind: 'TRAVEL', timeSec: 0, segmentIndex: 0, sceneId: 0, progress: 0,
        position: { lat: 37.5, lng: 127 }, center: { lat: 37.5, lng: 127 }, zoom: 12,
        speedKmh: 12, mobilityClass: 'WALK'
      },
      {
        kind: 'OUTRO', timeSec: 1, center: { lat: 37.505, lng: 127.005 },
        position: { lat: 37.505, lng: 127.005 }, zoom: 9
      }
    ]
  };
}
