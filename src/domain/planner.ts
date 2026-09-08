import { durationLimitsForMovements, planPlayback } from '../camera-planner.js';
import { applyCameraMode, ZOOM_OFFSET_MAX, ZOOM_OFFSET_MIN } from '../camera-modes.js';
import { haversineMeters, inferredBridgePath } from '../geo.js';
import type { AnalysisOptions, DurationLimits, Movement, PlaybackPlan, TravelFrame } from '../types';

const AUTO_ZOOM_BIAS = 0.28;
const DAY_MS = 86_400_000;
const DURATION_STEP_SEC = 5;
const VISUAL_GAP_MIN_METERS = 30;
const VISUAL_GAP_MAX_METERS = 50_000;

export function buildPlaybackPlan(movements: Movement[], options: AnalysisOptions): PlaybackPlan {
  const connectedMovements = connectVisualGaps(movements);
  const selectedDays = inclusiveDays(options.startDate, options.endDate);
  const durationLimits = durationLimitsForMovements(connectedMovements, { selectedDays });
  const requestedDurationSec = options.targetDurationSec > 0
    ? options.targetDurationSec
    : midpointDurationSeconds(durationLimits);
  const basePlan = planPlayback(connectedMovements, {
    fps: 60,
    targetTotalSeconds: requestedDurationSec,
    viewportWidth: options.viewportWidth,
    viewportHeight: options.viewportHeight,
    pacingMode: options.pacingMode,
    selectedDays
  }) as PlaybackPlan;

  // User map zoom is a presentation-level camera preference. Keep the planned
  // trajectory neutral so the same offset can be applied consistently to
  // TRAVEL, FLIGHT, and OUTRO frames by PlayerController without double-counting
  // after a re-plan.
  const resolvedZoomOffset = clampZoomOffset(options.zoomOffset);
  const plan = applyCameraMode(basePlan, {
    mode: options.cameraMode,
    zoomOffset: 0,
    viewportWidth: options.viewportWidth,
    viewportHeight: options.viewportHeight
  });
  plan.zoomOffset = resolvedZoomOffset;
  plan.selectedRange = { startDate: options.startDate, endDate: options.endDate };
  plan.viewportWidth = options.viewportWidth;
  plan.viewportHeight = options.viewportHeight;

  if (plan.cameraMode !== 'AUTO') return plan;
  for (const frame of plan.frames) {
    if (frame.kind !== 'TRAVEL' || frame.mobilityClass === 'FLIGHT') continue;
    const travel = frame as TravelFrame;
    travel.zoom = clampZoom(travel.zoom + AUTO_ZOOM_BIAS);
    if (Number.isFinite(travel.lockedZoom)) {
      travel.lockedZoom = clampZoom((travel.lockedZoom ?? travel.zoom) + AUTO_ZOOM_BIAS + 0.18);
    }
  }

  reconnectOverview(plan);
  return { ...plan, autoCloserBias: AUTO_ZOOM_BIAS, autoLockedCloserBias: AUTO_ZOOM_BIAS + 0.18 };
}

/**
 * Google can end one semantic activity and start the next at the same timestamp
 * while their coordinates disagree by tens of metres to a few kilometres.
 * Treat nearby disagreement as missing route evidence, not a camera cut: add a
 * short inferred movement so planner pacing, route geometry and camera zoom all
 * traverse the gap continuously without pausing playback.
 */
export function connectVisualGaps(movements: Movement[]): Movement[] {
  if (movements.length < 2) return movements;
  const connected: Movement[] = [];

  for (let index = 0; index < movements.length; index += 1) {
    const current = movements[index];
    connected.push(current);
    const next = movements[index + 1];
    if (!next) continue;

    const gapMeters = haversineMeters(current.end, next.start);
    if (gapMeters < VISUAL_GAP_MIN_METERS || gapMeters > VISUAL_GAP_MAX_METERS) continue;

    const gapSec = Math.max(0, (next.startMs - current.endMs) / 1000);
    const googleType = visualGapType(gapMeters, gapSec);
    const durationSec = visualGapDurationSec(gapMeters, googleType);
    const startMs = current.endMs;
    const endMs = next.startMs >= startMs ? next.startMs : startMs;
    const points = inferredBridgePath(current.end, next.start, {
      startMs,
      endMs,
      distanceMeters: gapMeters,
      mode: googleType
    });

    connected.push({
      startMs,
      endMs,
      start: { ...current.end },
      end: { ...next.start },
      points,
      distanceMeters: gapMeters,
      pathDistanceMeters: gapMeters,
      durationSec,
      avgSpeedKmh: gapMeters / Math.max(1, durationSec) * 3.6,
      googleType,
      googleProbability: 0,
      activityProbability: 0,
      inferred: true,
      inferenceSource: 'visual-gap'
    });
  }

  return connected;
}

export function midpointDurationSeconds(limits: Pick<DurationLimits, 'minSeconds' | 'maxSeconds'>): number {
  const min = Math.max(1, Number(limits.minSeconds) || 1);
  const max = Math.max(min, Number(limits.maxSeconds) || min);
  const midpoint = (min + max) / 2;
  const stepped = Math.round(midpoint / DURATION_STEP_SEC) * DURATION_STEP_SEC;
  return Math.min(max, Math.max(min, stepped));
}

function inclusiveDays(startDate: string, endDate: string): number {
  const startMs = Date.parse(`${startDate}T00:00:00Z`);
  const endMs = Date.parse(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return 1;
  return Math.max(1, Math.floor((endMs - startMs) / DAY_MS) + 1);
}

function visualGapType(distanceMeters: number, gapSec: number): string {
  const speedKmh = gapSec > 0 ? distanceMeters / gapSec * 3.6 : 0;
  if (distanceMeters >= 20_000 || speedKmh >= 80) return 'IN_TRAIN';
  if (distanceMeters >= 2_000 || speedKmh >= 22) return 'IN_BUS';
  if (distanceMeters >= 650 || speedKmh >= 8) return 'CYCLING';
  return 'WALKING';
}

function visualGapDurationSec(distanceMeters: number, googleType: string): number {
  const targetSpeedKmh = googleType === 'IN_TRAIN' ? 110
    : googleType === 'IN_BUS' ? 35
      : googleType === 'CYCLING' ? 16
        : 5;
  return Math.max(8, Math.min(180, distanceMeters / (targetSpeedKmh / 3.6)));
}

function clampZoom(value: number): number {
  return Math.min(17.3, Math.max(4, value));
}

function clampZoomOffset(value: number): number {
  const numeric = Number(value) || 0;
  return Math.min(ZOOM_OFFSET_MAX, Math.max(ZOOM_OFFSET_MIN, numeric));
}

function reconnectOverview(plan: PlaybackPlan): void {
  const travel = plan.frames.filter((frame): frame is TravelFrame => frame.kind === 'TRAVEL');
  const outro = plan.frames.filter(frame => frame.kind === 'OUTRO');
  const startZoom = travel.at(-1)?.zoom;
  const finalZoom = outro.at(-1)?.targetZoom ?? outro.at(-1)?.zoom;
  if (!Number.isFinite(startZoom) || !Number.isFinite(finalZoom) || !outro.length) return;
  const transitionFrames = Math.max(1, Math.min(outro.length, Math.round(Math.min(3.2, outro.length / plan.fps * 0.68) * plan.fps)));
  for (let index = 0; index < outro.length; index += 1) {
    const linear = Math.min(1, Math.max(0, (index + 1) / transitionFrames));
    const t = linear * linear * linear * (linear * (linear * 6 - 15) + 10);
    outro[index].zoom = startZoom! + (finalZoom! - startZoom!) * t;
  }
}
