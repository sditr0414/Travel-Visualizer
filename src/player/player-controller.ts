import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import { clamp, haversineMeters, mercatorProject, mercatorUnproject, shortestLongitudeDelta } from '../geo.js';
import { warmMapTilesAhead } from '../map/tile-warmup';
import { isDayMarkerId } from '../media/day-markers';
import type { Coordinate, MobilityClass, PlaybackFrame, PlaybackPlan, PlaybackStop, TravelFrame } from '../types';
import { heldMediaStopId } from './media-bridge';

const PHOTO_JOURNEY_BASE_ZOOM_BOOST = 0.62;
const TILE_WARMUP_LOOKAHEAD_SEC = 1.4;
const TILE_ZOOM_HYSTERESIS = 0.07;
const ZOOM_OFFSET_MIN = -1.5;
const ZOOM_OFFSET_MAX = 1.5;
const PHOTO_DETAIL_ZOOM_STRENGTH_MAX = 1.5;
const PHOTO_JOURNEY_MAX_ZOOM_BOOST = 3.5;

const COLORS: Record<MobilityClass, string> = {
  WALK: '#ff725d',
  BIKE: '#e0a43f',
  URBAN_TRANSIT: '#20a99a',
  FAST_GROUND: '#507fd4',
  FERRY: '#1b91c7',
  FLIGHT: '#8f6bd8',
  ROAD: '#75808a',
  UNKNOWN: '#64748b'
};

const cameraOwners = new WeakMap<MapLibreMap, PlayerController>();

export interface PlayerCallbacks {
  onFrame?: (frame: PlaybackFrame, frameIndex: number, timeSec: number, activeStopId: string | null, stopElapsedSec?: number) => void;
  onTransitionChange?: (message: string | null) => void;
  onComplete?: () => void;
}

interface ScheduledStop extends PlaybackStop {
  journeyStartSec: number;
  journeyEndSec: number;
  addedThroughSec: number;
}

interface StopSchedule {
  stops: PlaybackStop[];
  schedule: ScheduledStop[];
  totalDurationSec: number;
}

interface ScheduledJourneyTime {
  routeTimeSec: number;
  activeStopId: string | null;
  activeStopProgress: number;
}

export class PlayerController {
  private plan: PlaybackPlan | null = null;
  private playing = false;
  private timeSec = 0;
  private lastTickAt = 0;
  private lastCamera: { center: Coordinate; zoom: number } | null = null;
  private lastFrame: PlaybackFrame | null = null;
  private transition: { from: { center: Coordinate; zoom: number }; position: Coordinate | null; startSec: number; duration: number } | null = null;
  private lastGeometryPosition = -1;
  private frameIndex = -1;
  private framePosition = -1;
  private raf: number | null = null;
  private lockToPosition = true;
  private zoomOffset = 0;
  private photoDetailZoomStrength = 0;
  private displayedZoom: number | null = null;
  private displayedZoomTimelineSec = 0;
  private displayedFreeJourneyZoomBoost: number | null = null;
  private displayedFreeJourneyZoomBoostTimelineSec = 0;
  private displayedPhotoStopBoost: number | null = null;
  private displayedPhotoStopBoostTimelineSec = 0;
  private tileZoomLevel: number | null = null;
  private stops: PlaybackStop[] = [];
  private stopSchedule: ScheduledStop[] = [];
  private stopById = new Map<string, ScheduledStop>();
  private stopDurationSec = 0;
  private mediaStopDurationSec = 0;
  private fullRouteData: object = emptyCollection();
  private lastStopId: string | null = null;
  private stableFlightZooms = new Map<string, number>();

  constructor(private readonly map: MapLibreMap, private readonly callbacks: PlayerCallbacks = {}) {}

  loadPlan(plan: PlaybackPlan, stops: PlaybackStop[] = []): void {
    this.pause();
    this.cancelTransition();
    this.lastCamera = null;
    this.lastFrame = null;
    this.lastGeometryPosition = -1;
    this.plan = plan;
    this.timeSec = 0;
    this.frameIndex = -1;
    this.framePosition = -1;
    this.displayedZoom = null;
    this.displayedZoomTimelineSec = 0;
    this.displayedFreeJourneyZoomBoost = null;
    this.displayedFreeJourneyZoomBoostTimelineSec = this.timeSec;
    this.displayedPhotoStopBoost = null;
    this.displayedPhotoStopBoostTimelineSec = 0;
    this.tileZoomLevel = null;
    this.replaceStops(stops);
    this.fullRouteData = fullRoute(plan);
    this.lastStopId = null;
    this.stableFlightZooms = buildStableFlightZooms(plan);
    this.setSource('route-all', this.fullRouteData);
    this.setSource('route-progress', emptyCollection());
    this.render(0, true);
  }

  setStops(stops: PlaybackStop[]): void {
    const routeDurationSec = this.plan?.durationSec ?? 0;
    const remappedTimeSec = this.plan
      ? remapJourneyTimeForStops(this.timeSec, this.stops, stops, routeDurationSec)
      : this.timeSec;
    this.cancelTransition();
    this.replaceStops(stops);
    this.timeSec = clamp(remappedTimeSec, 0, this.getDuration());
    this.lastTickAt = performance.now();
    this.renderForTime(true);
  }

  setLockToPosition(enabled: boolean): void {
    this.lockToPosition = enabled;
    this.displayedZoom = null;
    this.displayedFreeJourneyZoomBoost = null;
    this.displayedFreeJourneyZoomBoostTimelineSec = this.timeSec;
    this.tileZoomLevel = null;
    if (this.ownsCamera()) this.renderForTime(true);
  }

  setZoomOffset(offset: number): void {
    this.zoomOffset = clamp(Number(offset) || 0, ZOOM_OFFSET_MIN, ZOOM_OFFSET_MAX);
    this.displayedZoom = null;
    this.displayedZoomTimelineSec = this.timeSec;
    this.tileZoomLevel = null;
    if (this.ownsCamera()) this.renderForTime(true);
  }

  setPhotoDetailZoomStrength(strength: number): void {
    this.photoDetailZoomStrength = clamp(Number(strength) || 0, 0, PHOTO_DETAIL_ZOOM_STRENGTH_MAX);
    this.displayedFreeJourneyZoomBoost = null;
    this.displayedFreeJourneyZoomBoostTimelineSec = this.timeSec;
    this.displayedZoom = null;
    this.displayedZoomTimelineSec = this.timeSec;
    this.tileZoomLevel = null;
    if (this.ownsCamera()) this.renderForTime(true);
  }

  getDuration(): number {
    return (this.plan?.durationSec ?? 0) + this.stopDurationSec;
  }

  play(): void {
    if (!this.plan?.frames.length || this.playing) return;
    if (this.timeSec >= this.getDuration()) this.reset();
    this.playing = true;
    const actualCenter = this.map.getCenter?.();
    const actualZoom = this.map.getZoom?.();
    if (!this.transition && this.lastCamera && actualCenter && actualZoom !== undefined &&
      (haversineMeters(actualCenter, this.lastCamera.center) > 5 || Math.abs(actualZoom - this.lastCamera.zoom) > 0.05)) {
      const destination = this.lastCamera;
      this.lastCamera = { center: { lng: actualCenter.lng, lat: actualCenter.lat }, zoom: actualZoom };
      this.beginTransition(destination, false);
    }
    this.lastTickAt = performance.now();
    this.tick(performance.now());
  }

  pause(): void {
    this.playing = false;
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  seek(seconds: number): void {
    if (!this.plan) return;
    this.cancelTransition();
    this.lastFrame = null;
    this.timeSec = Math.max(0, Math.min(this.getDuration(), Number(seconds) || 0));
    this.lastTickAt = performance.now();
    this.displayedZoom = null;
    this.displayedZoomTimelineSec = this.timeSec;
    this.displayedFreeJourneyZoomBoost = null;
    this.displayedFreeJourneyZoomBoostTimelineSec = this.timeSec;
    this.displayedPhotoStopBoost = null;
    this.displayedPhotoStopBoostTimelineSec = this.timeSec;
    this.tileZoomLevel = null;
    this.renderForTime(true);
  }

  reset(): void {
    this.pause();
    this.cancelTransition();
    this.lastFrame = null;
    this.timeSec = 0;
    this.frameIndex = -1;
    this.framePosition = -1;
    this.displayedZoom = null;
    this.displayedZoomTimelineSec = 0;
    this.displayedFreeJourneyZoomBoost = null;
    this.displayedFreeJourneyZoomBoostTimelineSec = this.timeSec;
    this.displayedPhotoStopBoost = null;
    this.displayedPhotoStopBoostTimelineSec = 0;
    this.tileZoomLevel = null;
    this.lastStopId = null;
    this.render(0, true);
  }

  dispose(): void {
    this.pause();
    this.cancelTransition();
    if (cameraOwners.get(this.map) === this) cameraOwners.delete(this.map);
    this.plan = null;
    this.stops = [];
    this.stopSchedule = [];
    this.stopById.clear();
    this.stopDurationSec = 0;
    this.mediaStopDurationSec = 0;
    this.fullRouteData = emptyCollection();
    this.displayedZoom = null;
    this.displayedZoomTimelineSec = 0;
    this.displayedFreeJourneyZoomBoost = null;
    this.displayedFreeJourneyZoomBoostTimelineSec = this.timeSec;
    this.displayedPhotoStopBoost = null;
    this.displayedPhotoStopBoostTimelineSec = 0;
    this.tileZoomLevel = null;
    this.stableFlightZooms.clear();
  }

  isPlaying(): boolean {
    return this.playing;
  }

  private tick = (now: number): void => {
    if (!this.playing || !this.plan) return;
    // Drop catch-up after decoding, background suspension or a slow map frame.
    // Content time is preserved instead of skipping unseen route sections.
    const dt = clamp((now - this.lastTickAt) / 1000, 0, 0.05);
    this.lastTickAt = now;
    this.timeSec = Math.min(this.timeSec + dt, this.getDuration());
    this.renderForTime();
    if (this.timeSec >= this.getDuration()) {
      this.pause();
      this.callbacks.onComplete?.();
      return;
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  private renderForTime(force = false): void {
    if (!this.plan) return;
    const mapped = mapScheduledJourneyTime(this.timeSec, this.stopSchedule, this.plan.durationSec);
    const displayStopId = mapped.activeStopId ?? heldMediaStopId(mapped.routeTimeSec, this.stops);
    const activeMediaStop = Boolean(mapped.activeStopId && !isDayMarkerId(mapped.activeStopId));
    const stopChanged = displayStopId !== this.lastStopId;
    this.lastStopId = displayStopId;
    this.renderAtPosition(
      mapped.routeTimeSec * this.plan.fps,
      force || stopChanged || Boolean(mapped.activeStopId),
      displayStopId,
      activeMediaStop ? mapped.activeStopProgress : 0,
      activeMediaStop
    );
  }

  private render(index: number, force = false, activeStopId: string | null = null): void {
    this.renderAtPosition(index, force, activeStopId, 0, false);
  }

  private renderAtPosition(
    framePosition: number,
    force = false,
    activeStopId: string | null = null,
    activeMediaProgress = 0,
    activeMediaStop = false
  ): void {
    if (!this.plan?.frames.length) return;
    const clampedPosition = clamp(framePosition, 0, this.plan.frames.length - 1);
    if (!force && !this.transition && Math.abs(clampedPosition - this.framePosition) < 0.001) return;
    const baseIndex = Math.floor(clampedPosition);
    const nextIndex = Math.min(baseIndex + 1, this.plan.frames.length - 1);
    const mix = clampedPosition - baseIndex;
    const baseFrame = this.plan.frames[baseIndex];
    let frame = interpolatePlaybackFrame(baseFrame, this.plan.frames[nextIndex], mix, this.plan);
    let center: Coordinate;
    let zoom = frame.zoom;
    if (frame.kind !== 'TRAVEL') {
      center = frame.center;
    } else if (this.lockToPosition) {
      center = frame.position;
      zoom = Number.isFinite(frame.lockedZoom) ? frame.lockedZoom! : frame.zoom;
    } else {
      // The planner already solves a scene-aware cinematic camera path. Re-chasing
      // its raw look-ahead target here caused a second, frame-rate-dependent pan
      // filter that drifted out of phase with the planned zoom trajectory.
      center = frame.center;
    }
    if (frame.kind === 'TRAVEL' && frame.mobilityClass === 'FLIGHT' && this.lockToPosition) {
      zoom = this.stableFlightZooms.get(flightZoomKey(frame)) ?? zoom;
    }
    if (frame.kind === 'TRAVEL' && this.stops.length) {
      const segment = this.plan.segments[frame.segmentIndex];
      const photoDistanceMeters = segment?.pathDistanceMeters ?? segment?.distanceMeters ?? 0;
      const journeyBoostTarget = this.photoJourneyBoost(photoDistanceMeters, frame.mobilityClass);
      zoom = clamp(zoom + (this.lockToPosition
        ? journeyBoostTarget
        : this.stabilizeFreeJourneyZoomBoost(journeyBoostTarget, this.timeSec)), 4, 17.3);
      if (frame.mobilityClass === 'FLIGHT') {
        this.displayedPhotoStopBoost = 0;
        this.displayedPhotoStopBoostTimelineSec = this.timeSec;
      } else {
        const rawStopBoost = activeMediaStop
          ? photoStopZoomBoost(photoDistanceMeters, activeMediaProgress, frame.mobilityClass)
          : 0;
        const stopBoostTarget = activeMediaStop && this.displayedPhotoStopBoost !== null
          ? Math.max(rawStopBoost, this.displayedPhotoStopBoost)
          : rawStopBoost;
        zoom += this.stabilizePhotoStopZoomBoost(stopBoostTarget, this.timeSec);
      }
    }
    const viewportAdjustment = this.viewportZoomAdjustment();
    zoom = applyUserZoomOffset(zoom + viewportAdjustment, this.zoomOffset);
    if (this.lockToPosition) {
      zoom = this.stabilizeZoom(zoom, this.timeSec);
    } else {
      // Unlocked playback replays the already-smoothed planned zoom directly.
      // Only photo-specific overlays have their own smoothing above.
      this.displayedZoom = zoom;
      this.displayedZoomTimelineSec = this.timeSec;
    }
    const tileZoom = stabilizeTileZoomBoundary(zoom, this.tileZoomLevel);
    zoom = tileZoom.zoom;
    this.tileZoomLevel = tileZoom.level;
    const previous = this.lastFrame;
    const gap = previous?.kind === 'TRAVEL' && frame.kind === 'TRAVEL' && previous.segmentIndex !== frame.segmentIndex
      ? haversineMeters(this.plan.segments[previous.segmentIndex].end, this.plan.segments[frame.segmentIndex].start) : 0;
    const changesScene = previous?.kind === 'TRAVEL' && frame.kind === 'TRAVEL' && previous.sceneId !== frame.sceneId;
    const beginsOverview = previous?.kind === 'TRAVEL' && frame.kind === 'OUTRO';
    if (this.playing && this.lastCamera && (gap > 30 || changesScene || beginsOverview)) {
      this.beginTransition({ center, zoom }, !beginsOverview);
    }
    this.lastFrame = frame;
    const blending = Boolean(this.transition);
    if (this.transition) {
      const blend = this.transition;
      const ratio = clamp((this.timeSec - blend.startSec) / blend.duration, 0, 1);
      const t = ratio * ratio * (3 - 2 * ratio);
      center = interpolateCoordinate(blend.from.center, center, t);
      zoom = lerp(blend.from.zoom, zoom, t);
      if (frame.kind === 'TRAVEL' && blend.position) {
        frame = { ...frame, position: interpolateCoordinate(blend.position, frame.position, t) };
      }
      if (ratio >= 1) this.transition = null;
    }
    this.lastCamera = { center, zoom };
    this.map.jumpTo({ center: [center.lng, center.lat], zoom });
    cameraOwners.set(this.map, this);
    this.warmTilesAhead(viewportAdjustment);
    this.frameIndex = baseIndex;
    this.framePosition = clampedPosition;

    const geometryChanged = this.lastGeometryPosition !== clampedPosition || blending;
    // A separate 30 Hz geometry clock made the trail lag behind the rAF camera.
    // Keep one bounded (four-second) source update per rendered playback frame.
    if (!this.playing || geometryChanged) {
      this.lastGeometryPosition = clampedPosition;
      if (frame.kind === 'TRAVEL') {
        const trail = trailForFrame(this.plan, baseIndex, frame) as { type: string; features: object[] };
        if (!this.plan.segments[frame.segmentIndex]?.hideRoute) trail.features.push(headForFrame(frame));
        this.setSource('route-progress', trail);
      } else {
        this.setSource('route-progress', this.fullRouteData);
      }
    }
    const stop = activeStopId ? this.stopById.get(activeStopId) : null;
    const elapsed = stop ? clamp(this.timeSec - stop.journeyStartSec, 0, stop.durationSec) : 0;
    this.callbacks.onFrame?.(zoom === frame.zoom ? frame : { ...frame, zoom }, baseIndex, this.timeSec, activeStopId, elapsed);
  }

  private cancelTransition(): void {
    this.transition = null;
    this.lastGeometryPosition = -1;
  }

  private beginTransition(to: { center: Coordinate; zoom: number }, moveHead: boolean): void {
    if (!this.lastCamera) return;
    this.transition = {
      from: this.lastCamera,
      position: moveHead && this.lastFrame?.kind === 'TRAVEL' ? this.lastFrame.position : null,
      startSec: this.timeSec,
      duration: Math.max(1 / (this.plan?.fps || 60), Math.min(2, this.getDuration() - this.timeSec))
    };
    warmMapTilesAhead(this.map, to.center, to.zoom);
  }

  private photoJourneyBoost(distanceMeters: number, mobilityClass: MobilityClass): number {
    const baseBoost = photoJourneyZoomBoost(distanceMeters, mobilityClass);
    if (!this.plan) return baseBoost;
    return baseBoost + photoJourneyDetailZoomBoost(
      this.plan.durationLimits?.extentKm ?? this.plan.durationLimits?.distanceKm ?? 0,
      this.plan.durationSec,
      this.mediaStopDurationSec,
      this.photoDetailZoomStrength,
      mobilityClass
    );
  }

  private stabilizeFreeJourneyZoomBoost(targetBoost: number, timelineSec: number): number {
    const target = clamp(Number(targetBoost) || 0, 0, PHOTO_JOURNEY_MAX_ZOOM_BOOST);
    if (this.displayedFreeJourneyZoomBoost === null || timelineSec + 0.001 < this.displayedFreeJourneyZoomBoostTimelineSec) {
      this.displayedFreeJourneyZoomBoost = target;
      this.displayedFreeJourneyZoomBoostTimelineSec = timelineSec;
      return target;
    }

    const elapsed = timelineSec - this.displayedFreeJourneyZoomBoostTimelineSec;
    this.displayedFreeJourneyZoomBoostTimelineSec = timelineSec;
    if (!(elapsed > 0)) return this.displayedFreeJourneyZoomBoost;

    const dt = clamp(elapsed, 1 / 240, 0.25);
    const delta = target - this.displayedFreeJourneyZoomBoost;
    if (Math.abs(delta) < 0.001) {
      this.displayedFreeJourneyZoomBoost = target;
      return target;
    }
    const zoomingOut = delta < 0;
    const tauSec = zoomingOut ? 0.82 : 1.35;
    const maxRate = zoomingOut ? 0.72 : 0.52;
    const easedStep = delta * (1 - Math.exp(-dt / tauSec));
    const step = clamp(easedStep, -maxRate * dt, maxRate * dt);
    this.displayedFreeJourneyZoomBoost = clamp(this.displayedFreeJourneyZoomBoost + step, 0, PHOTO_JOURNEY_MAX_ZOOM_BOOST);
    return this.displayedFreeJourneyZoomBoost;
  }

  private stabilizePhotoStopZoomBoost(targetBoost: number, timelineSec: number): number {
    const target = clamp(Number(targetBoost) || 0, 0, 0.5);
    if (this.displayedPhotoStopBoost === null || timelineSec + 0.001 < this.displayedPhotoStopBoostTimelineSec) {
      this.displayedPhotoStopBoost = target;
      this.displayedPhotoStopBoostTimelineSec = timelineSec;
      return target;
    }

    const elapsed = timelineSec - this.displayedPhotoStopBoostTimelineSec;
    this.displayedPhotoStopBoostTimelineSec = timelineSec;
    if (!(elapsed > 0)) return this.displayedPhotoStopBoost;

    this.displayedPhotoStopBoost = smoothPhotoStopZoomBoost(this.displayedPhotoStopBoost, target, elapsed);
    return this.displayedPhotoStopBoost;
  }

  private stabilizeZoom(targetZoom: number, timelineSec: number): number {
    const target = clamp(Number(targetZoom) || 0, 4, 17.3);
    if (this.displayedZoom === null || timelineSec + 0.001 < this.displayedZoomTimelineSec) {
      this.displayedZoom = target;
      this.displayedZoomTimelineSec = timelineSec;
      return target;
    }

    const elapsed = timelineSec - this.displayedZoomTimelineSec;
    this.displayedZoomTimelineSec = timelineSec;
    if (!(elapsed > 0)) return this.displayedZoom;

    const dt = clamp(elapsed, 1 / 240, 0.25);
    const delta = target - this.displayedZoom;
    if (Math.abs(delta) < 0.004) {
      this.displayedZoom = target;
      return target;
    }

    const zoomingOut = delta < 0;
    const tauSec = zoomingOut ? 0.70 : 1.25;
    const maxRate = zoomingOut ? 0.78 : 0.62;
    const easedStep = delta * (1 - Math.exp(-dt / tauSec));
    const step = clamp(easedStep, -maxRate * dt, maxRate * dt);
    this.displayedZoom = clamp(this.displayedZoom + step, 4, 17.3);
    return this.displayedZoom;
  }

  private warmTilesAhead(viewportAdjustment: number): void {
    if (!this.plan?.frames.length) return;
    const lookAheadTimeSec = Math.min(this.getDuration(), this.timeSec + TILE_WARMUP_LOOKAHEAD_SEC);
    const mapped = mapScheduledJourneyTime(lookAheadTimeSec, this.stopSchedule, this.plan.durationSec);
    const framePosition = clamp(mapped.routeTimeSec * this.plan.fps, 0, this.plan.frames.length - 1);
    const baseIndex = Math.floor(framePosition);
    const nextIndex = Math.min(baseIndex + 1, this.plan.frames.length - 1);
    const frame = interpolatePlaybackFrame(this.plan.frames[baseIndex], this.plan.frames[nextIndex], framePosition - baseIndex, this.plan);
    let center = frame.center;
    let zoom = frame.zoom;

    if (frame.kind === 'TRAVEL') {
      if (this.lockToPosition) {
        center = frame.position;
        zoom = Number.isFinite(frame.lockedZoom) ? frame.lockedZoom! : frame.zoom;
      }
      if (this.lockToPosition && frame.mobilityClass === 'FLIGHT') {
        zoom = this.stableFlightZooms.get(flightZoomKey(frame)) ?? zoom;
      }
    }
    if (frame.kind === 'TRAVEL' && this.stops.length) {
      const segment = this.plan.segments[frame.segmentIndex];
      const photoDistanceMeters = segment?.pathDistanceMeters ?? segment?.distanceMeters ?? 0;
      zoom = clamp(zoom + this.photoJourneyBoost(photoDistanceMeters, frame.mobilityClass), 4, 17.3);
      const futureMediaStop = Boolean(mapped.activeStopId && !isDayMarkerId(mapped.activeStopId));
      if (futureMediaStop && frame.mobilityClass !== 'FLIGHT') {
        zoom += photoStopZoomBoost(photoDistanceMeters, mapped.activeStopProgress, frame.mobilityClass);
      }
    }
    zoom = applyUserZoomOffset(zoom + viewportAdjustment, this.zoomOffset);

    warmMapTilesAhead(this.map, center, clamp(zoom, 4, 17.3));
  }

  private viewportZoomAdjustment(): number {
    if (!this.plan?.viewportWidth || !this.plan.viewportHeight) return 0;
    const canvas = this.map.getCanvas();
    const width = canvas.clientWidth || this.plan.viewportWidth;
    const height = canvas.clientHeight || this.plan.viewportHeight;
    return Math.log2(Math.min(width / this.plan.viewportWidth, height / this.plan.viewportHeight));
  }

  private ownsCamera(): boolean {
    return cameraOwners.get(this.map) === this;
  }

  private setSource(id: string, data: object): void {
    (this.map.getSource(id) as GeoJSONSource | undefined)?.setData(data as never);
  }

  private replaceStops(stops: PlaybackStop[]): void {
    const next = buildStopSchedule(stops, this.plan?.durationSec ?? 0);
    this.stops = next.stops;
    this.stopSchedule = next.schedule;
    this.stopById = new Map(next.schedule.map(stop => [stop.id, stop]));
    this.stopDurationSec = next.totalDurationSec;
    this.mediaStopDurationSec = next.stops.reduce((sum, stop) =>
      isDayMarkerId(stop.id) ? sum : sum + Math.max(0, Number(stop.durationSec) || 0), 0);
    if (!next.stops.length) {
      this.displayedFreeJourneyZoomBoost = null;
    this.displayedFreeJourneyZoomBoostTimelineSec = this.timeSec;
    this.displayedPhotoStopBoost = null;
      this.displayedPhotoStopBoostTimelineSec = this.timeSec;
    }
  }
}

export function applyUserZoomOffset(baseZoom: number, currentOffset: number): number {
  const current = clamp(Number(currentOffset) || 0, ZOOM_OFFSET_MIN, ZOOM_OFFSET_MAX);
  return clamp((Number(baseZoom) || 0) + current, 4, 17.3);
}

export function photoJourneyZoomBoost(distanceMeters: number, mobilityClass: MobilityClass): number {
  if (mobilityClass === 'FLIGHT') return 0;
  const distanceKm = Math.max(0, Number(distanceMeters) || 0) / 1000;
  return PHOTO_JOURNEY_BASE_ZOOM_BOOST + 1.08 * Math.exp(-distanceKm / 20);
}

export function photoJourneyDetailZoomBoost(
  extentKm: number,
  routeDurationSec: number,
  mediaStopDurationSec: number,
  strength: number,
  mobilityClass: MobilityClass
): number {
  if (mobilityClass === 'FLIGHT') return 0;
  const resolvedStrength = clamp(Number(strength) || 0, 0, PHOTO_DETAIL_ZOOM_STRENGTH_MAX);
  const stopSeconds = Math.max(0, Number(mediaStopDurationSec) || 0);
  if (!(resolvedStrength > 0) || !(stopSeconds > 0)) return 0;

  const extent = Math.max(0, Number(extentKm) || 0);
  const routeSeconds = Math.max(1, Number(routeDurationSec) || 1);
  const dwellRatio = stopSeconds / routeSeconds;
  const smallAreaFactor = Math.exp(-extent / 24);
  const dwellFactor = 1 - Math.exp(-dwellRatio / 0.55);
  return clamp(1.35 * smallAreaFactor * dwellFactor * resolvedStrength, 0, 1.8);
}

export function photoJourneyZoom(baseZoom: number, distanceMeters: number, mobilityClass: MobilityClass): number {
  return clamp(baseZoom + photoJourneyZoomBoost(distanceMeters, mobilityClass), 4, 17.3);
}

export function photoStopZoomBoost(distanceMeters: number, progress: number, mobilityClass: MobilityClass): number {
  if (mobilityClass === 'FLIGHT') return 0;
  const distanceKm = Math.max(0, Number(distanceMeters) || 0) / 1000;
  const shortRouteFactor = Math.exp(-distanceKm / 18);
  const maxBoost = 0.08 + 0.18 * shortRouteFactor;
  const normalized = clamp(Number(progress) || 0, 0, 1);
  const eased = 1 - Math.pow(1 - normalized, 2.0);
  return maxBoost * eased;
}

export function smoothPhotoStopZoomBoost(currentBoost: number, targetBoost: number, elapsedSec: number): number {
  const current = clamp(Number(currentBoost) || 0, 0, 0.5);
  const target = clamp(Number(targetBoost) || 0, 0, 0.5);
  const dt = clamp(Number(elapsedSec) || 0, 0, 0.25);
  if (!(dt > 0) || Math.abs(target - current) < 0.0005) return target;

  const releasing = target < current;
  const tauSec = releasing ? 4.8 : 0.75;
  const maxRate = releasing ? 0.09 : 0.34;
  const delta = target - current;
  const easedStep = delta * (1 - Math.exp(-dt / tauSec));
  const step = clamp(easedStep, -maxRate * dt, maxRate * dt);
  return clamp(current + step, 0, 0.5);
}

export function stabilizeTileZoomBoundary(zoom: number, currentLevel: number | null): { zoom: number; level: number } {
  const target = clamp(Number(zoom) || 0, 4, 17.3);
  if (currentLevel === null || !Number.isFinite(currentLevel)) {
    return { zoom: target, level: Math.floor(target) };
  }

  let level = Math.floor(currentLevel);
  if (target >= level + 1 + TILE_ZOOM_HYSTERESIS || target < level - TILE_ZOOM_HYSTERESIS) {
    level = Math.floor(target);
    return { zoom: target, level };
  }

  const targetLevel = Math.floor(target);
  if (targetLevel > level) return { zoom: Math.min(target, level + 0.999), level };
  if (targetLevel < level) return { zoom: Math.max(target, level + 0.001), level };
  return { zoom: target, level };
}

function interpolatePlaybackFrame(frame: PlaybackFrame, next: PlaybackFrame, mix: number, plan: PlaybackPlan): PlaybackFrame {
  const ratio = clamp(mix, 0, 1);
  if (ratio <= 0 || frame.kind !== next.kind) return frame;
  if (frame.kind !== 'TRAVEL' || next.kind !== 'TRAVEL') {
    return {
      ...frame,
      center: interpolateCoordinate(frame.center, next.center, ratio),
      position: interpolateCoordinate(frame.position, next.position, ratio),
      zoom: lerp(frame.zoom, next.zoom, ratio)
    };
  }
  if (framesDisconnected(plan, frame, next)) return frame;
  const targetA = trackingTargetProjected(frame);
  const targetB = trackingTargetProjected(next);
  const lockedCenter = frame.lockedCenter && next.lockedCenter
    ? interpolateCoordinate(frame.lockedCenter, next.lockedCenter, ratio)
    : frame.lockedCenter;
  const lockedZoom = Number.isFinite(frame.lockedZoom) && Number.isFinite(next.lockedZoom)
    ? lerp(frame.lockedZoom!, next.lockedZoom!, ratio)
    : frame.lockedZoom;
  return {
    ...frame,
    position: interpolateCoordinate(frame.position, next.position, ratio),
    center: interpolateCoordinate(frame.center, next.center, ratio),
    lockedCenter,
    lockedZoom,
    zoom: lerp(frame.zoom, next.zoom, ratio),
    targetCenterX: lerp(targetA.x, targetB.x, ratio),
    targetCenterY: lerp(targetA.y, targetB.y, ratio),
    speedKmh: lerp(frame.speedKmh, next.speedKmh, ratio),
    progress: frame.segmentIndex === next.segmentIndex ? lerp(frame.progress, next.progress, ratio) : frame.progress
  };
}

function interpolateCoordinate(a: Coordinate, b: Coordinate, mix: number): Coordinate {
  const projectedA = mercatorProject(a);
  const projectedB = mercatorProject({ ...b, lng: a.lng + shortestLongitudeDelta(a.lng, b.lng) });
  return mercatorUnproject({
    x: lerp(projectedA.x, projectedB.x, mix),
    y: lerp(projectedA.y, projectedB.y, mix)
  });
}

function lerp(a: number, b: number, mix: number): number {
  return a + (b - a) * mix;
}

function buildStableFlightZooms(plan: PlaybackPlan): Map<string, number> {
  const result = new Map<string, number>();
  for (const frame of plan.frames) {
    if (frame.kind !== 'TRAVEL' || frame.mobilityClass !== 'FLIGHT') continue;
    const candidate = Number.isFinite(frame.lockedZoom) ? frame.lockedZoom! : frame.zoom;
    const key = flightZoomKey(frame);
    const previous = result.get(key);
    result.set(key, previous === undefined ? candidate : Math.min(previous, candidate));
  }
  return result;
}

function flightZoomKey(frame: TravelFrame): string {
  return `${frame.sceneId}:${frame.mobilityClass}`;
}

function buildStopSchedule(stops: PlaybackStop[], routeDurationSec: number): StopSchedule {
  const sorted = [...stops].sort((a, b) => {
    const time = a.atSec - b.atSec;
    if (Math.abs(time) > 1e-9) return time;
    return Number(isDayMarkerId(b.id)) - Number(isDayMarkerId(a.id));
  });
  let added = 0;
  const schedule = sorted.map(stop => {
    const duration = Math.max(0, Number(stop.durationSec) || 0);
    const routeTimeSec = clamp(stop.atSec, 0, routeDurationSec);
    const journeyStartSec = routeTimeSec + added;
    added += duration;
    return { ...stop, atSec: routeTimeSec, durationSec: duration, journeyStartSec, journeyEndSec: journeyStartSec + duration, addedThroughSec: added };
  });
  return { stops: sorted, schedule, totalDurationSec: added };
}

function mapScheduledJourneyTime(timeSec: number, schedule: ScheduledStop[], routeDurationSec: number): ScheduledJourneyTime {
  let low = 0;
  let high = schedule.length - 1;
  let index = -1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    if (schedule[middle].journeyStartSec <= timeSec) {
      index = middle;
      low = middle + 1;
    } else high = middle - 1;
  }
  if (index < 0) return { routeTimeSec: clamp(timeSec, 0, routeDurationSec), activeStopId: null, activeStopProgress: 0 };
  const stop = schedule[index];
  if (timeSec < stop.journeyEndSec) {
    const duration = Math.max(stop.journeyEndSec - stop.journeyStartSec, 1e-9);
    return {
      routeTimeSec: clamp(stop.atSec, 0, routeDurationSec),
      activeStopId: stop.id,
      activeStopProgress: clamp((timeSec - stop.journeyStartSec) / duration, 0, 1)
    };
  }
  return { routeTimeSec: clamp(timeSec - stop.addedThroughSec, 0, routeDurationSec), activeStopId: null, activeStopProgress: 0 };
}

function journeyTimeForRouteTime(routeTimeSec: number, schedule: ScheduledStop[], routeDurationSec: number): number {
  const routeTime = clamp(routeTimeSec, 0, routeDurationSec);
  let added = 0;
  for (const stop of schedule) {
    if (stop.atSec >= routeTime) break;
    added = stop.addedThroughSec;
  }
  return routeTime + added;
}

export function remapJourneyTimeForStops(timeSec: number, previousStops: PlaybackStop[], nextStops: PlaybackStop[], routeDurationSec: number): number {
  const previous = buildStopSchedule(previousStops, routeDurationSec);
  const next = buildStopSchedule(nextStops, routeDurationSec);
  const mapped = mapScheduledJourneyTime(timeSec, previous.schedule, routeDurationSec);
  if (mapped.activeStopId) {
    const oldStop = previous.schedule.find(stop => stop.id === mapped.activeStopId);
    const newStop = next.schedule.find(stop => stop.id === mapped.activeStopId);
    if (oldStop && newStop) {
      const oldDuration = Math.max(oldStop.journeyEndSec - oldStop.journeyStartSec, 1e-9);
      const progress = clamp((timeSec - oldStop.journeyStartSec) / oldDuration, 0, 1);
      return newStop.journeyStartSec + (newStop.journeyEndSec - newStop.journeyStartSec) * progress;
    }
  }
  return journeyTimeForRouteTime(mapped.routeTimeSec, next.schedule, routeDurationSec);
}

export function mapJourneyTime(timeSec: number, stops: PlaybackStop[], routeDurationSec: number): { routeTimeSec: number; activeStopId: string | null } {
  let added = 0;
  for (const stop of stops) {
    const start = clamp(stop.atSec, 0, routeDurationSec) + added;
    const duration = Math.max(0, stop.durationSec);
    if (timeSec < start) break;
    if (timeSec < start + duration) return { routeTimeSec: clamp(stop.atSec, 0, routeDurationSec), activeStopId: stop.id };
    added += duration;
  }
  return { routeTimeSec: clamp(timeSec - added, 0, routeDurationSec), activeStopId: null };
}

function trackingTargetProjected(frame: TravelFrame): { x: number; y: number } {
  return Number.isFinite(frame.targetCenterX) && Number.isFinite(frame.targetCenterY)
    ? { x: frame.targetCenterX!, y: frame.targetCenterY! }
    : mercatorProject(frame.center || frame.position);
}

function fullRoute(plan: PlaybackPlan): object {
  const travel = plan.frames.filter((frame): frame is TravelFrame => frame.kind === 'TRAVEL');
  return lineFeatures(travel, plan);
}

function trailForFrame(plan: PlaybackPlan, index: number, current?: TravelFrame): object {
  const maxFrames = Math.max(2, Math.round(plan.fps * 4));
  const frames: TravelFrame[] = [];
  for (let cursor = index; cursor >= 0 && frames.length < maxFrames; cursor -= 1) {
    const frame = plan.frames[cursor];
    if (frame.kind !== 'TRAVEL') break;
    frames.push(frame);
  }
  frames.reverse();
  if (current && frames.length) frames[frames.length - 1] = current;
  return lineFeatures(frames, plan);
}

function framesDisconnected(plan: PlaybackPlan, a: TravelFrame, b: TravelFrame): boolean {
  if (a.sceneId !== b.sceneId) return true;
  return a.segmentIndex !== b.segmentIndex && haversineMeters(plan.segments[a.segmentIndex].end, plan.segments[b.segmentIndex].start) > 30;
}

function lineFeatures(frames: TravelFrame[], plan: PlaybackPlan): object {
  if (!frames.length) return emptyCollection();
  if (frames.some(frame => plan.segments[frame.segmentIndex]?.hideRoute)) {
    const groups: TravelFrame[][] = [];
    let group: TravelFrame[] = [];
    for (const frame of frames) {
      if (plan.segments[frame.segmentIndex]?.hideRoute) {
        if (group.length) groups.push(group);
        group = [];
      } else group.push(frame);
    }
    if (group.length) groups.push(group);
    return { type: 'FeatureCollection', features: groups.flatMap(items =>
      (lineFeatures(items, plan) as { features: object[] }).features) };
  }
  const features: object[] = [];
  let mode = frames[0].mobilityClass;
  let scene = frames[0].sceneId;
  let coordinates: number[][] = [[frames[0].position.lng, frames[0].position.lat]];

  const flush = () => {
    if (coordinates.length === 1) coordinates.push([...coordinates[0]]);
    features.push({
      type: 'Feature',
      properties: { mobilityClass: mode, color: COLORS[mode] },
      geometry: { type: 'LineString', coordinates }
    });
  };

  for (let index = 1; index < frames.length; index += 1) {
    const frame = frames[index];
    if (frame.mobilityClass !== mode || frame.sceneId !== scene || framesDisconnected(plan, frames[index - 1], frame)) {
      flush();
      mode = frame.mobilityClass;
      scene = frame.sceneId;
      coordinates = [[frame.position.lng, frame.position.lat]];
    } else {
      coordinates.push([frame.position.lng, frame.position.lat]);
    }
  }
  flush();
  return { type: 'FeatureCollection', features };
}

function headForFrame(frame: TravelFrame): object {
  return {
    type: 'Feature',
    properties: { color: COLORS[frame.mobilityClass] },
    geometry: { type: 'Point', coordinates: [frame.position.lng, frame.position.lat] }
  };
}

function emptyCollection(): object {
  return { type: 'FeatureCollection', features: [] };
}