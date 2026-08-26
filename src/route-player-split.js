export * from './route-player.js?core=1';

import {
  RoutePlayer as CoreRoutePlayer,
  fullRouteFeatureCollection,
  routeHeadFeatureForFrame,
  tailFeatureCollectionForFrame,
  transportColor
} from './route-player.js?core=1';
import { mercatorProject, mercatorUnproject } from './geo.js';

const TILE_SIZE = 512;
const SPLIT_BREAKPOINT = 820;

/**
 * RoutePlayer variant used by the browser UI. During a photo/video hold it keeps
 * the approach route visible instead of letting the rolling trail collapse into
 * repeated stationary points. It also shifts the stopped location into the map
 * half of the split view.
 */
export class RoutePlayer extends CoreRoutePlayer {
  renderFrame(index, force = false) {
    super.renderFrame(index, force);

    const frames = this.plan?.frames || [];
    const clampedIndex = Math.max(0, Math.min(Number(index) || 0, Math.max(0, frames.length - 1)));
    const frame = frames[clampedIndex];
    if (!frame?.mediaHold || !frame.position || frame.kind !== 'TRAVEL') return;

    const canvas = this.map?.getCanvas?.();
    const width = Number(canvas?.clientWidth) || 0;
    const height = Number(canvas?.clientHeight) || 0;
    if (!(width > 0) || !(height > 0)) return;

    const zoom = Number(this.map?.getZoom?.());
    if (!Number.isFinite(zoom)) return;

    const point = mercatorProject(frame.position);
    const scale = TILE_SIZE * 2 ** zoom;
    const narrow = width <= SPLIT_BREAKPOINT;
    const targetX = narrow ? 0.50 : 0.28;
    const targetY = narrow ? 0.24 : 0.50;
    const center = mercatorUnproject({
      x: point.x + (0.50 - targetX) * width / scale,
      y: point.y + (0.50 - targetY) * height / scale
    });
    this.map.jumpTo({ center: [center.lng, center.lat], zoom });
    this.trackedCenter = { ...center };
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

  // Use a slightly longer stable approach trail while stopped so the left map
  // keeps meaningful route context even for a 5–15 second media hold.
  const approach = tailFeatureCollectionForFrame(plan, previousIndex, Math.max(7.5, Number(trailSeconds) || 4.8));
  const previous = frames[previousIndex];
  const connector = lineFeature([previous.position, current.position], current.mobilityClass || previous.mobilityClass);
  return {
    type: 'FeatureCollection',
    features: [...(approach.features || []), connector].filter(Boolean)
  };
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
