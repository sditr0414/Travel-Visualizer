export * from './route-player.js?core=1';

import {
  RoutePlayer as CoreRoutePlayer,
  routeHeadFeatureForFrame,
  tailFeatureCollectionForFrame,
  transportColor
} from './route-player.js?core=1';
import { mercatorProject, mercatorUnproject } from './geo.js';

const TILE_SIZE = 512;
const SPLIT_BREAKPOINT = 820;
const LAYOUT_ENTER_MS = 520;
const LAYOUT_EXIT_MS = 440;

/**
 * Photo journey keeps a stable map/media composition for the whole TRAVEL
 * section. The camera is biased into the visible map pane before media appears,
 * so showing or hiding a photo does not cause a full-screen -> split-screen jump.
 */
export class RoutePlayer extends CoreRoutePlayer {
  constructor(options) {
    super(options);
    this.photoLayoutActive = false;
    this.mediaCameraKey = null;
  }

  reset() {
    this.photoLayoutActive = false;
    this.mediaCameraKey = null;
    super.reset();
  }

  renderFrame(index, force = false) {
    const frames = this.plan?.frames || [];
    const clampedIndex = Math.max(0, Math.min(Number(index) || 0, Math.max(0, frames.length - 1)));
    const frame = frames[clampedIndex];
    const usePhotoLayout = !!(
      frame?.kind === 'TRAVEL' &&
      frame.position &&
      isPhotoJourneyMode()
    );

    syncPhotoJourneyLayout(usePhotoLayout);

    if (!usePhotoLayout) {
      if (!this.photoLayoutActive) {
        super.renderFrame(index, force);
        return;
      }

      const requestedCamera = captureCoreCameraRequest(this, () => super.renderFrame(index, force));
      this.photoLayoutActive = false;
      this.mediaCameraKey = null;
      if (requestedCamera) animateCamera(this.map, requestedCamera, LAYOUT_EXIT_MS);
      return;
    }

    const requestedCamera = captureCoreCameraRequest(this, () => super.renderFrame(index, force));
    const paneCamera = requestedCamera ? this.photoPaneCameraForFrame(frame, requestedCamera) : null;
    if (!paneCamera) return;

    const enteringLayout = !this.photoLayoutActive;
    this.photoLayoutActive = true;
    this.mediaCameraKey = frame.mediaHold ? String(frame.mediaBeatId || frame.mediaTakenMs || '') : null;
    this.trackedCenter = { lng: paneCamera.center[0], lat: paneCamera.center[1] };

    if (enteringLayout) animateCamera(this.map, paneCamera, LAYOUT_ENTER_MS);
    else applyCamera(this.map, paneCamera);
  }

  photoPaneCameraForFrame(frame, requestedCamera) {
    const canvas = this.map?.getCanvas?.();
    const width = Number(canvas?.clientWidth) || 0;
    const height = Number(canvas?.clientHeight) || 0;
    if (!(width > 0) || !(height > 0)) return null;

    const zoom = Number(requestedCamera.zoom);
    if (!Number.isFinite(zoom)) return null;

    const point = mercatorProject(frame.position);
    const scale = TILE_SIZE * 2 ** zoom;
    const narrow = width <= SPLIT_BREAKPOINT;
    const targetX = narrow ? 0.50 : 0.30;
    const targetY = narrow ? 0.26 : 0.50;
    const center = mercatorUnproject({
      x: point.x + (0.50 - targetX) * width / scale,
      y: point.y + (0.50 - targetY) * height / scale
    });

    return {
      ...requestedCamera,
      center: [center.lng, center.lat],
      zoom
    };
  }

  paintRoute(frameIndex, isOutro) {
    const frame = this.plan?.frames?.[frameIndex];
    if (!frame?.mediaHold || isOutro) {
      super.paintRoute(frameIndex, isOutro);
      return;
    }

    const routeSource = this.map.getSource('route-progress');
    const headSource = this.map.getSource('route-head');
    if (!routeSource) return;

    this.showingOutro = false;
    routeSource.setData(stationaryTrailFeatureCollection(this.plan, frameIndex, this.trailSeconds));
    headSource?.setData(routeHeadFeatureForFrame(this.plan, frameIndex));
  }
}

export function stationaryTrailFeatureCollection(plan, frameIndex, trailSeconds = 4.8) {
  const frames = plan?.frames || [];
  if (!frames.length) return emptyFeatureCollection();
  const currentIndex = Math.max(0, Math.min(Number(frameIndex) || 0, frames.length - 1));
  const current = frames[currentIndex];
  if (!current?.mediaHold || current.kind !== 'TRAVEL') {
    return tailFeatureCollectionForFrame(plan, currentIndex, trailSeconds);
  }

  let previousIndex = currentIndex - 1;
  while (previousIndex >= 0 && frames[previousIndex]?.mediaHold) previousIndex -= 1;
  if (previousIndex < 0 || frames[previousIndex]?.kind !== 'TRAVEL') {
    return {
      type: 'FeatureCollection',
      features: [lineFeature([current.position, current.position], current.mobilityClass)]
    };
  }

  const approach = tailFeatureCollectionForFrame(plan, previousIndex, Math.max(7.5, Number(trailSeconds) || 4.8));
  const previous = frames[previousIndex];
  const connector = lineFeature([previous.position, current.position], current.mobilityClass || previous.mobilityClass);
  return {
    type: 'FeatureCollection',
    features: [...(approach.features || []), connector].filter(Boolean)
  };
}

function captureCoreCameraRequest(player, render) {
  const map = player.map;
  if (!map || typeof map.jumpTo !== 'function') {
    render();
    return null;
  }

  const originalJumpTo = map.jumpTo;
  let requested = null;
  map.jumpTo = options => {
    requested = options ? { ...options } : null;
    return map;
  };

  try {
    render();
  } finally {
    map.jumpTo = originalJumpTo;
  }
  return requested;
}

function isPhotoJourneyMode() {
  return String(globalThis.document?.querySelector?.('#journeyMode')?.value || '') === 'PHOTOS';
}

function syncPhotoJourneyLayout(active) {
  const stage = globalThis.document?.querySelector?.('.stage');
  stage?.classList?.toggle('photo-journey-layout-active', !!active);
}

function applyCamera(map, options) {
  if (!map || !options) return;
  try { map.jumpTo(options); } catch {}
}

function animateCamera(map, options, duration) {
  if (!map || !options) return;
  const target = {
    ...options,
    duration,
    easing: smootherStep,
    essential: true
  };
  if (typeof map.easeTo === 'function') {
    try {
      map.easeTo(target);
      return;
    } catch {}
  }
  applyCamera(map, options);
}

function smootherStep(value) {
  const t = Math.max(0, Math.min(1, Number(value) || 0));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lineFeature(points, mobilityClass) {
  const clean = (points || []).filter(point => Number.isFinite(point?.lat) && Number.isFinite(point?.lng));
  if (!clean.length) return null;
  if (clean.length === 1) clean.push({ ...clean[0] });
  return {
    type: 'Feature',
    properties: {
      mobilityClass: mobilityClass || 'UNKNOWN',
      color: transportColor(mobilityClass)
    },
    geometry: {
      type: 'LineString',
      coordinates: clean.map(point => [point.lng, point.lat])
    }
  };
}

function emptyFeatureCollection() {
  return { type: 'FeatureCollection', features: [] };
}
