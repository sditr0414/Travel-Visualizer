import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import { clamp, mercatorProject, mercatorUnproject } from '../geo.js';
import { isDayMarkerId } from '../media/day-markers';
import type { Coordinate, MobilityClass, PlaybackFrame, PlaybackPlan, PlaybackStop, TravelFrame } from '../types';
import { heldMediaStopId } from './media-bridge';

const TILE_SIZE = 512;
const PHOTO_JOURNEY_BASE_ZOOM_BOOST = 0.62;

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

export interface PlayerCallbacks {
  onFrame?: (frame: PlaybackFrame, frameIndex: number, timeSec: number, activeStopId: string | null) => void;
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
  private startedAt = 0;
  private frameIndex = -1;
  private framePosition = -1;
  private raf: number | null = null;
  private lockToPosition = true;
  private trackingSpeed = 1;
  private trackedCenter: Coordinate | null = null;
  private displayedZoom: number | null = null;
  private displayedZoomTimelineSec = 0;
  private displayedPhotoStopBoost: number | null = null;
  private displayedPhotoStopBoostTimelineSec = 0;
  private stops: PlaybackStop[] = [];
  private stopSchedule: ScheduledStop[] = [];
  private stopDurationSec = 0;
  private fullRouteData: object = emptyCollection();
  private lastStopId: string | null = null;
  private stableFlightZooms = new Map<string, number>();

  constructor(private readonly map: MapLibreMap, private readonly callbacks: PlayerCallbacks = {}) {}

  loadPlan(plan: PlaybackPlan, stops: PlaybackStop[] = []): void {
    this.pause();
    this.plan = plan;
    this.timeSec = 0;
    this.frameIndex = -1;
    this.framePosition = -1;
    this.trackedCenter = null;
    this.displayedZoom = null;
    this.displayedZoomTimelineSec = 0;
    this.displayedPhotoStopBoost = null;
    this.displayedPhotoStopBoostTimelineSec = 0;
    this.replaceStops(stops);
    this.fullRouteData = fullRoute(plan);
    this.lastStopId = null;
    this.stableFlightZooms = buildStableFlightZooms(plan);
    this.setSource('route-all', this.fullRouteData);
    this.setSource('route-progress', emptyCollection());
    this.setSource('route-head', emptyCollection());
    this.render(0, true);
  }

  setStops(stops: PlaybackStop[]): void {
    const routeDurationSec = this.plan?.durationSec ?? 0;
    const remappedTimeSec = this.plan
      ? remapJourneyTimeForStops(this.timeSec, this.stops, stops, routeDurationSec)
      : this.timeSec;
    this.replaceStops(stops);
    this.timeSec = clamp(remappedTimeSec, 0, this.getDuration());
    this.startedAt = performance.now() - this.timeSec * 1000;
    this.renderForTime(true);
  }

  setLockToPosition(enabled: boolean): void {
    this.lockToPosition = enabled;
    this.trackedCenter = null;
    this.displayedZoom = null;
    this.renderForTime(true);
  }

  setTrackingSpeed(multiplier: number): void {
    this.trackingSpeed = clamp(Number(multiplier) || 1, 0.5, 2);
  }

  getDuration(): number {
    return (this.plan?.durationSec ?? 0) + this.stopDurationSec;
  }

  play(): void {
    if (!this.plan?.frames.length || this.playing) return;
    if (this.timeSec >= this.getDuration()) this.reset();
    this.playing = true;
    this.startedAt = performance.now() - this.timeSec * 1000;
    this.tick(performance.now());
  }

  pause(): void {
    this.playing = false;
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  seek(seconds: number): void {
    if (!this.plan) return;
    this.timeSec = Math.max(0, Math.min(this.getDuration(), Number(seconds) || 0));
    this.startedAt = performance.now() - this.timeSec * 1000;
    this.trackedCenter = null;
    this.displayedZoom = null;
    this.displayedZoomTimelineSec = this.timeSec;
    this.displayedPhotoStopBoost = null;
    this.displayedPhotoStopBoostTimelineSec = this.timeSec;
    this.renderForTime(true);
  }

  reset(): void {
    this.pause();
    this.timeSec = 0;
    this.frameIndex = -1;
    this.framePosition = -1;
    this.trackedCenter = null;
    this.displayedZoom = null;
    this.displayedZoomTimelineSec = 0;
    this.displayedPhotoStopBoost = null;
    this.displayedPhotoStopBoostTimelineSec = 0;
    this.lastStopId = null;
    this.render(0, true);
  }

  dispose(): void {
    this.pause();
    this.plan = null;
    this.stops = [];
    this.stopSchedule = [];
    this.stopDurationSec = 0;
    this.fullRouteData = emptyCollection();
    this.displayedZoom = null;
    this.displayedZoomTimelineSec = 0;
    this.displayedPhotoStopBoost = null;
    this.displayedPhotoStopBoostTimelineSec = 0;
    this.stableFlightZooms.clear();
  }

  isPlaying(): boolean {
    return this.playing;
  }

  private tick = (now: number): void => {
    if (!this.playing || !this.plan) return;
    this.timeSec = Math.min((now - this.startedAt) / 1000, this.getDuration());
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
      force || stopChanged || activeMediaStop,
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
    if (!force && Math.abs(clampedPosition - this.framePosition) < 0.001) return;
    const baseIndex = Math.floor(clampedPosition);
    const nextIndex = Math.min(baseIndex + 1, this.plan.frames.length - 1);
    const mix = clampedPosition - baseIndex;
    const baseFrame = this.plan.frames[baseIndex];
    const frame = interpolatePlaybackFrame(baseFrame, this.plan.frames[nextIndex], mix);
    let center: Coordinate;
    let zoom = frame.zoom;
    if (frame.kind !== 'TRAVEL') {
      center = frame.center;
      this.trackedCenter = null;
    } else if (this.lockToPosition) {
      center = frame.position;
      zoom = Number.isFinite(frame.lockedZoom) ? frame.lockedZoom! : frame.zoom;
      this.trackedCenter = { ...frame.position };
    } else {
      center = this.followCamera(frame, baseIndex, force || frame.sceneBreak);
    }
    if (frame.kind === 'TRAVEL' && frame.mobilityClass === 'FLIGHT') {
      zoom = this.stableFlightZooms.get(flightZoomKey(frame)) ?? zoom;
    }
    if (frame.kind === 'TRAVEL' && this.stops.length) {
      const segment = this.plan.segments[frame.segmentIndex];
      const photoDistanceMeters = segment?.pathDistanceMeters ?? segment?.distanceMeters ?? 0;
      zoom = photoJourneyZoom(zoom, photoDistanceMeters, frame.mobilityClass);
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
    zoom = this.stabilizeZoom(zoom, this.timeSec);
    this.map.jumpTo({ center: [center.lng, center.lat], zoom });
    this.frameIndex = baseIndex;
    this.framePosition = clampedPosition;

    if (frame.kind === 'TRAVEL') {
      this.setSource('route-progress', trailForFrame(this.plan, baseIndex));
      this.setSource('route-head', headForFrame(frame));
    } else {
      this.setSource('route-progress', this.fullRouteData);
      this.setSource('route-head', emptyCollection());
    }
    this.callbacks.onFrame?.(zoom === frame.zoom ? frame : { ...frame, zoom }, baseIndex, this.timeSec, activeStopId);
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

  private followCamera(frame: TravelFrame, frameIndex: number, reset = false): Coordinate {
    const target = trackingTargetProjected(frame);
    if (reset || !this.trackedCenter) {
      this.trackedCenter = { ...frame.position };
      return this.trackedCenter;
    }
    const current = mercatorProject(this.trackedCenter);
    const scale = TILE_SIZE * 2 ** frame.zoom;
    const dxPx = (target.x - current.x) * scale;
    const dyPx = (target.y - current.y) * scale;
    const lagPx = Math.hypot(dxPx, dyPx);
    const maxStepPx = trackingPanLimitPxPerSec(this.plan!, frameIndex, this.trackingSpeed, lagPx) / Math.max(1, this.plan?.fps || 60);
    const ratio = Math.min(Math.max(0, lagPx - 4), maxStepPx) / Math.max(lagPx, 1e-9);
    this.trackedCenter = mercatorUnproject({ x: current.x + dxPx * ratio / scale, y: current.y + dyPx * ratio / scale });
    return this.trackedCenter;
  }

  private setSource(id: string, data: object): void {
    (this.map.getSource(id) as GeoJSONSource | undefined)?.setData(data as never);
  }

  private replaceStops(stops: PlaybackStop[]): void {
    const next = buildStopSchedule(stops, this.plan?.durationSec ?? 0);
    this.stops = next.stops;
    this.stopSchedule = next.schedule;
    this.stopDurationSec = next.totalDurationSec;
    if (!next.stops.length) {
      this.displayedPhotoStopBoost = null;
      this.displayedPhotoStopBoostTimelineSec = this.timeSec;
    }
  }
}

export function photoJourneyZoom(baseZoom: number, distanceMeters: number, mobilityClass: MobilityClass): number {
  if (mobilityClass === 'FLIGHT') return baseZoom;
  const distanceKm = Math.max(0, Number(distanceMeters) || 0) / 1000;
  const shortRouteBoost = 1.08 * Math.exp(-distanceKm / 20);
  return clamp(baseZoom + PHOTO_JOURNEY_BASE_ZOOM_BOOST + shortRouteBoost, 4, 17.3);
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

function interpolatePlaybackFrame(frame: PlaybackFrame, next: PlaybackFrame, mix: number): PlaybackFrame {
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
  if (frame.sceneId !== next.sceneId) return frame;
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
  const projectedB = mercatorProject(b);
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

export function trackingDurationScale(plan: PlaybackPlan): number {
  const recommended = Number(plan.durationLimits?.recommendedSeconds);
  const actual = Number(plan.durationSec);
  return recommended > 0 && actual > 0 ? clamp(Math.sqrt(recommended / actual), 0.72, 1.85) : 1;
}

export function trackingDemandPxPerSec(plan: PlaybackPlan, frameIndex: number): number {
  const frames = plan.frames;
  const fps = Math.max(1, plan.fps || 60);
  const index = clamp(Math.round(frameIndex), 0, Math.max(0, frames.length - 1));
  const frame = frames[index];
  if (!frame || frame.kind !== 'TRAVEL') return 0;
  const radius = Math.max(1, Math.round(fps * 0.1));
  let left = index;
  let right = index;
  while (left > 0 && index - left < radius) {
    const candidate = frames[left - 1];
    if (candidate.kind !== 'TRAVEL' || candidate.sceneId !== frame.sceneId) break;
    left -= 1;
  }
  while (right < frames.length - 1 && right - index < radius) {
    const candidate = frames[right + 1];
    if (candidate.kind !== 'TRAVEL' || candidate.sceneId !== frame.sceneId) break;
    right += 1;
  }
  if (left === right) return 0;
  const first = frames[left];
  const last = frames[right];
  if (first.kind !== 'TRAVEL' || last.kind !== 'TRAVEL') return 0;
  const a = trackingTargetProjected(first);
  const b = trackingTargetProjected(last);
  const scale = TILE_SIZE * 2 ** frame.zoom;
  return Math.hypot((b.x - a.x) * scale, (b.y - a.y) * scale) / Math.max((right - left) / fps, 1 / fps);
}

export function trackingPanLimitPxPerSec(plan: PlaybackPlan, frameIndex: number, userMultiplier = 1, lagPx = 0): number {
  const frame = plan.frames[clamp(Math.round(frameIndex), 0, Math.max(0, plan.frames.length - 1))];
  const basePan = Math.max(120, Number(frame?.kind === 'TRAVEL' ? frame.maxPanPxPerSec : 0) || 240);
  const demand = trackingDemandPxPerSec(plan, frameIndex);
  const durationFloor = basePan * trackingDurationScale(plan) * 0.82;
  const synchronized = demand > 0 ? demand * 1.16 + 36 : 0;
  const catchUp = Math.max(0, lagPx - 36) * 2.8;
  const automatic = clamp(Math.max(basePan * 0.72, durationFloor, synchronized) + catchUp, 120, 2600);
  return clamp(automatic * clamp(userMultiplier, 0.5, 2), 80, 3600);
}

function trackingTargetProjected(frame: TravelFrame): { x: number; y: number } {
  return Number.isFinite(frame.targetCenterX) && Number.isFinite(frame.targetCenterY)
    ? { x: frame.targetCenterX!, y: frame.targetCenterY! }
    : mercatorProject(frame.center || frame.position);
}

function fullRoute(plan: PlaybackPlan): object {
  const travel = plan.frames.filter((frame): frame is TravelFrame => frame.kind === 'TRAVEL');
  return lineFeatures(travel);
}

function trailForFrame(plan: PlaybackPlan, index: number): object {
  const maxFrames = Math.max(2, Math.round(plan.fps * 4));
  const frames: TravelFrame[] = [];
  for (let cursor = index; cursor >= 0 && frames.length < maxFrames; cursor -= 1) {
    const frame = plan.frames[cursor];
    if (frame.kind !== 'TRAVEL') break;
    frames.push(frame);
  }
  return lineFeatures(frames.reverse());
}

function lineFeatures(frames: TravelFrame[]): object {
  if (!frames.length) return emptyCollection();
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
    if (frame.mobilityClass !== mode || frame.sceneId !== scene) {
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
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { color: COLORS[frame.mobilityClass] },
      geometry: { type: 'Point', coordinates: [frame.position.lng, frame.position.lat] }
    }]
  };
}

function emptyCollection(): object {
  return { type: 'FeatureCollection', features: [] };
}