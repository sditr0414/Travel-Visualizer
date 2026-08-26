import {
  applyCameraMode as applyCoreCameraMode,
  CameraMode,
  ZOOM_OFFSET_MAX,
  ZOOM_OFFSET_MIN
} from './camera-modes.js?core=1';

export { CameraMode, ZOOM_OFFSET_MAX, ZOOM_OFFSET_MIN };

const AUTO_TRAVEL_BIAS = 0.28;
const AUTO_LOCKED_EXTRA_BIAS = 0.18;
const MAX_ZOOM = 17.3;
const MIN_ZOOM = 4;

/**
 * Keep the existing automatic camera strategy, but make its practical framing
 * closer to DAY/SEGMENT. AUTO used to look noticeably wider because the
 * position-lock safety zoom-out stacked on top of long-distance framing.
 * Flights and the final overview remain unchanged.
 */
export function applyCameraMode(plan, options = {}) {
  const result = applyCoreCameraMode(plan, options);
  if (result?.cameraMode !== CameraMode.AUTO || !result?.frames?.length) return result;

  const travelFrames = result.frames.filter(frame => frame?.kind === 'TRAVEL');
  if (!travelFrames.length) return result;

  for (const frame of travelFrames) {
    if (frame.mobilityClass === 'FLIGHT') continue;

    frame.modeBaseTargetZoom = addZoom(frame.modeBaseTargetZoom, AUTO_TRAVEL_BIAS);
    frame.modeTargetZoom = addZoom(frame.modeTargetZoom, AUTO_TRAVEL_BIAS);
    frame.zoom = addZoom(frame.zoom, AUTO_TRAVEL_BIAS);

    // Position-locked AUTO previously added a comparatively strong zoom-out on
    // long rail/road/ferry segments. Add a little more back only to the locked
    // trajectory so the default checked "현재 위치에 카메라 고정" view stays useful.
    frame.lockedZoom = addZoom(frame.lockedZoom, AUTO_TRAVEL_BIAS + AUTO_LOCKED_EXTRA_BIAS);
  }

  reconnectOverview(result.frames, travelFrames.at(-1)?.zoom, Number(result.fps) || 60);
  return {
    ...result,
    autoCloserBias: AUTO_TRAVEL_BIAS,
    autoLockedCloserBias: AUTO_TRAVEL_BIAS + AUTO_LOCKED_EXTRA_BIAS
  };
}

function addZoom(value, delta) {
  if (!Number.isFinite(Number(value))) return value;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(value) + delta));
}

function reconnectOverview(frames, startZoom, fps) {
  if (!Number.isFinite(startZoom)) return;
  const outro = frames.filter(frame => frame?.kind === 'OUTRO');
  if (!outro.length) return;
  const finalZoom = Number(outro.at(-1)?.targetZoom ?? outro.at(-1)?.zoom);
  if (!Number.isFinite(finalZoom)) return;

  const transitionFrames = Math.max(
    1,
    Math.min(outro.length, Math.round(Math.min(3.2, outro.length / Math.max(1, fps) * 0.68) * Math.max(1, fps)))
  );
  for (let index = 0; index < outro.length; index += 1) {
    const linear = Math.min(1, Math.max(0, (index + 1) / transitionFrames));
    const t = linear * linear * linear * (linear * (linear * 6 - 15) + 10);
    outro[index].zoom = startZoom + (finalZoom - startZoom) * t;
  }
}
