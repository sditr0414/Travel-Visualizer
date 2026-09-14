import { durationLimitsForMovements, planPlayback } from '../camera-planner.js';
import { applyCameraMode, ZOOM_OFFSET_MAX, ZOOM_OFFSET_MIN } from '../camera-modes.js';
import { haversineMeters, inferredBridgePath } from '../geo.js';
import type { AnalysisOptions, DurationLimits, Movement, PlaybackPlan, TravelFrame } from '../types';

const AUTO_ZOOM_BIAS = 0.28;
const DAY_MS = 86_400_000;
const DURATION_STEP_SEC = 5;
const VISUAL_GAP_MIN_METERS = 30;
const BIAS_FADE_SECONDS = 0.85;

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

  // The user's zoom preference is applied exactly once by the active controller.
  const plan = applyCameraMode(basePlan, {
    mode: options.cameraMode,
    zoomOffset: 0,
    viewportWidth: options.viewportWidth,
    viewportHeight: options.viewportHeight
  });
  plan.zoomOffset = clampZoomOffset(options.zoomOffset);
  plan.selectedRange = { startDate: options.startDate, endDate: options.endDate };
  plan.viewportWidth = options.viewportWidth;
  plan.viewportHeight = options.viewportHeight;

  if (plan.cameraMode !== 'AUTO') return plan;
  applyContinuousAutoBias(plan);
  reconnectOverview(plan);
  return { ...plan, autoCloserBias: AUTO_ZOOM_BIAS, autoLockedCloserBias: AUTO_ZOOM_BIAS + 0.18 };
}

/**
 * A connection is presentation, not evidence of a train, flight or recorded speed.
 * Put it in the planned timeline so the head and camera traverse it together;
 * never stop the player clock or insert an uncounted camera transfer.
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
    if (!Number.isFinite(gapMeters) || gapMeters < VISUAL_GAP_MIN_METERS) continue;
    const startMs = current.endMs;
    const endMs = Math.max(startMs, next.startMs);
    const points = inferredBridgePath(current.end, next.start, { distanceMeters: gapMeters, mode: 'UNKNOWN' });
    connected.push({
      startMs,
      endMs,
      start: { ...current.end },
      end: { ...next.start },
      points,
      distanceMeters: gapMeters,
      pathDistanceMeters: gapMeters,
      durationSec: Math.max(0, (endMs - startMs) / 1000),
      avgSpeedKmh: 0,
      googleType: 'UNKNOWN',
      googleProbability: 0,
      activityProbability: 0,
      inferred: true,
      inferenceSource: 'visual-gap',
      hideRoute: next.connectionBefore === 'excluded-flight'
    });
  }
  return connected;
}

/** Apply only the visual bias envelope; do not add another filter to planner center/zoom. */
export function applyContinuousAutoBias(plan: PlaybackPlan): void {
  const travel = plan.frames.filter((frame): frame is TravelFrame => frame.kind === 'TRAVEL');
  const radius = Math.max(1, Math.round(plan.fps * BIAS_FADE_SECONDS));
  const distance = new Array<number>(travel.length).fill(radius);
  let lastFlight = -Infinity;
  for (let i = 0; i < travel.length; i += 1) {
    if (travel[i].mobilityClass === 'FLIGHT') lastFlight = i;
    distance[i] = Math.min(radius, i - lastFlight);
  }
  lastFlight = Infinity;
  for (let i = travel.length - 1; i >= 0; i -= 1) {
    if (travel[i].mobilityClass === 'FLIGHT') lastFlight = i;
    const linear = Math.min(distance[i], lastFlight - i, radius) / radius;
    const envelope = linear * linear * (3 - 2 * linear);
    const frame = travel[i];
    frame.zoom = clampZoom(frame.zoom + AUTO_ZOOM_BIAS * envelope);
    if (Number.isFinite(frame.lockedZoom)) {
      frame.lockedZoom = clampZoom(frame.lockedZoom! + (AUTO_ZOOM_BIAS + 0.18) * envelope);
    }
  }
}

export function midpointDurationSeconds(limits: Pick<DurationLimits, 'minSeconds' | 'maxSeconds'>): number {
  const min = Math.max(1, Number(limits.minSeconds) || 1);
  const max = Math.max(min, Number(limits.maxSeconds) || min);
  const stepped = Math.round((min + max) / 2 / DURATION_STEP_SEC) * DURATION_STEP_SEC;
  return Math.min(max, Math.max(min, stepped));
}

function inclusiveDays(startDate: string, endDate: string): number {
  const startMs = Date.parse(`${startDate}T00:00:00Z`);
  const endMs = Date.parse(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return 1;
  return Math.max(1, Math.floor((endMs - startMs) / DAY_MS) + 1);
}

function clampZoom(value: number): number {
  return Math.min(17.3, Math.max(4, value));
}

function clampZoomOffset(value: number): number {
  return Math.min(ZOOM_OFFSET_MAX, Math.max(ZOOM_OFFSET_MIN, Number(value) || 0));
}

function reconnectOverview(plan: PlaybackPlan): void {
  const travel = plan.frames.filter((frame): frame is TravelFrame => frame.kind === 'TRAVEL');
  const outro = plan.frames.filter(frame => frame.kind === 'OUTRO');
  const startZoom = travel.at(-1)?.zoom;
  const finalZoom = outro.at(-1)?.targetZoom ?? outro.at(-1)?.zoom;
  if (!Number.isFinite(startZoom) || !Number.isFinite(finalZoom) || !outro.length) return;
  const transitionFrames = Math.max(1, Math.min(outro.length, Math.round(Math.min(3.2, outro.length / plan.fps * 0.68) * plan.fps)));
  for (let index = 0; index < outro.length; index += 1) {
    const linear = Math.min(1, Math.max(0, index / transitionFrames));
    const t = linear * linear * linear * (linear * (linear * 6 - 15) + 10);
    outro[index].zoom = startZoom! + (finalZoom! - startZoom!) * t;
  }
}
