import { durationLimitsForMovements, planPlayback } from '../camera-planner.js';
import { applyCameraMode } from '../camera-modes.js';
import type { AnalysisOptions, Movement, PlaybackPlan, TravelFrame } from '../types';

const AUTO_ZOOM_BIAS = 0.28;

export function buildPlaybackPlan(movements: Movement[], options: AnalysisOptions): PlaybackPlan {
  const requestedDurationSec = options.targetDurationSec > 0
    ? options.targetDurationSec
    : midpointDuration(durationLimitsForMovements(movements));
  const basePlan = planPlayback(movements, {
    fps: 60,
    targetTotalSeconds: requestedDurationSec,
    viewportWidth: options.viewportWidth,
    viewportHeight: options.viewportHeight,
    pacingMode: options.pacingMode
  }) as PlaybackPlan;

  const plan = applyCameraMode(basePlan, {
    mode: options.cameraMode,
    zoomOffset: options.zoomOffset,
    viewportWidth: options.viewportWidth,
    viewportHeight: options.viewportHeight
  });

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

function midpointDuration(limits: { minSeconds: number; maxSeconds: number }): number {
  return Math.round(((limits.minSeconds + limits.maxSeconds) / 2) / 5) * 5;
}

function clampZoom(value: number): number {
  return Math.min(17.3, Math.max(4, value));
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
