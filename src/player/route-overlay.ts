import type { Map as MapLibreMap } from 'maplibre-gl';
import { haversineMeters, mercatorProject, mercatorUnproject, shortestLongitudeDelta } from '../geo.js';
import type { Coordinate, MobilityClass, PlaybackFrame, PlaybackPlan, TravelFrame } from '../types';

export interface TrailPoint {
  position: Coordinate;
  mobilityClass: MobilityClass;
  breakBefore: boolean;
}

/** Bounded four-second trail, with a fractional tail as well as a fractional head. */
export function collectRouteTrail(plan: PlaybackPlan, framePosition: number, current: TravelFrame): TrailPoint[] {
  const end = Math.min(Math.floor(framePosition), plan.frames.length - 1);
  const start = Math.max(0, framePosition - plan.fps * 4);
  const firstIndex = Math.floor(start);
  const result: TrailPoint[] = [];
  let previous: TravelFrame | null = null;
  const append = (frame: PlaybackFrame) => {
    if (frame.kind !== 'TRAVEL' || plan.segments[frame.segmentIndex]?.hideRoute) { previous = null; return; }
    const connected = previous !== null && previous.sceneId === frame.sceneId && (
      previous.segmentIndex === frame.segmentIndex ||
      haversineMeters(plan.segments[previous.segmentIndex].end, plan.segments[frame.segmentIndex].start) <= 30
    );
    result.push({ position: frame.position, mobilityClass: frame.mobilityClass, breakBefore: !connected });
    previous = frame;
  };
  const first = plan.frames[firstIndex];
  const next = plan.frames[firstIndex + 1];
  if (start > firstIndex && first?.kind === 'TRAVEL' && next?.kind === 'TRAVEL' &&
    first.sceneId === next.sceneId && first.segmentIndex === next.segmentIndex) {
    const a = mercatorProject(first.position);
    const b = mercatorProject({ ...next.position, lng: first.position.lng + shortestLongitudeDelta(first.position.lng, next.position.lng) });
    const t = start - firstIndex;
    append({ ...first, position: mercatorUnproject({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }) });
  }
  for (let index = Math.ceil(start); index <= end; index += 1) {
    // The interpolated current point may be a compatibility scene transition.
    append(index === end ? current : plan.frames[index]);
  }
  if (!result.length && !plan.segments[current.segmentIndex]?.hideRoute) append(current);
  return result;
}

interface OverlayState {
  owner: object;
  plan: PlaybackPlan;
  framePosition: number;
  frame: TravelFrame | null;
  colors: Record<MobilityClass, string>;
}
interface Overlay {
  canvas: HTMLCanvasElement;
  state: OverlayState | null;
  draw: () => void;
  dispose: () => void;
  lastKey: string;
}
const overlays = new WeakMap<MapLibreMap, Overlay>();

/** Uses only MapLibre public APIs. Returns false when a 2D overlay is unavailable. */
export function updateRouteOverlay(map: MapLibreMap, owner: object, plan: PlaybackPlan, framePosition: number,
  frame: PlaybackFrame, colors: Record<MobilityClass, string>): boolean {
  let overlay = overlays.get(map);
  if (!overlay) {
    // Minimal maps in unit tests and non-DOM consumers retain the GeoJSON path.
    if (typeof document === 'undefined' || typeof map.getCanvasContainer !== 'function' || typeof map.project !== 'function') return false;
    const canvas = document.createElement('canvas');
    let context: CanvasRenderingContext2D | null;
    try { context = canvas.getContext('2d'); } catch { return false; }
    if (!context) return false;
    canvas.className = 'route-playback-overlay';
    canvas.setAttribute('aria-hidden', 'true');
    Object.assign(canvas.style, { position: 'absolute', left: '0', top: '0', pointerEvents: 'none' });
    map.getCanvasContainer().appendChild(canvas);
    const ctx = context;
    const entry: Overlay = {
      canvas, state: null, lastKey: '',
      draw: () => {
        const state = entry.state;
        if (!state?.frame) return;
        const baseCanvas = map.getCanvas();
        const width = baseCanvas.clientWidth;
        const height = baseCanvas.clientHeight;
        if (width <= 0 || height <= 0) return;
        const center = map.getCenter();
        const zoom = map.getZoom();
        const ratio = Math.min(2, Math.max(1, baseCanvas.width / width));
        const key = [state.framePosition, state.frame.position.lng, state.frame.position.lat, center.lng, center.lat,
          zoom, map.getBearing(), map.getPitch(), width, height, ratio].join(':');
        if (entry.lastKey === key) return;
        entry.lastKey = key;
        const pixelWidth = Math.round(width * ratio);
        const pixelHeight = Math.round(height * ratio);
        if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
          canvas.width = pixelWidth; canvas.height = pixelHeight;
          canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
        }
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        ctx.clearRect(0, 0, width, height);
        const trail = collectRouteTrail(state.plan, state.framePosition, state.frame);
        const scale = Math.max(0, Math.min(1, (zoom - 3) / 9));
        const longitudeShift = 360 * Math.round((center.lng - state.frame.position.lng) / 360);
        ctx.lineWidth = 2.4 + 3.6 * scale;
        ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.globalAlpha = 0.94;
        let mode: MobilityClass | null = null;
        let last: { x: number; y: number } | null = null;
        let pathOpen = false;
        for (const sample of trail) {
          const point = map.project([sample.position.lng + longitudeShift, sample.position.lat]);
          if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) { last = null; continue; }
          if (!last || sample.breakBefore || sample.mobilityClass !== mode) {
            if (pathOpen) ctx.stroke();
            ctx.beginPath();
            ctx.strokeStyle = state.colors[sample.mobilityClass];
            // Changes in transport color must not introduce a one-frame hole.
            if (last && !sample.breakBefore) ctx.moveTo(last.x, last.y);
            else ctx.moveTo(point.x, point.y);
            pathOpen = true;
          }
          ctx.lineTo(point.x, point.y);
          mode = sample.mobilityClass;
          last = point;
        }
        if (pathOpen) ctx.stroke();
        if (!state.plan.segments[state.frame.segmentIndex]?.hideRoute) {
          const point = map.project([state.frame.position.lng + longitudeShift, state.frame.position.lat]);
          if (Number.isFinite(point.x) && Number.isFinite(point.y)) {
            ctx.globalAlpha = 1;
            ctx.beginPath(); ctx.arc(point.x, point.y, 4.5 + 2.5 * scale, 0, Math.PI * 2);
            ctx.fillStyle = '#fff7ee'; ctx.fill();
            ctx.lineWidth = 3; ctx.strokeStyle = state.colors[state.frame.mobilityClass]; ctx.stroke();
          }
        }
      },
      dispose: () => {
        map.off('render', entry.draw);
        map.off('remove', entry.dispose);
        canvas.remove();
        if (overlays.get(map) === entry) overlays.delete(map);
      }
    };
    map.on('render', entry.draw);
    map.on('remove', entry.dispose);
    overlays.set(map, entry);
    overlay = entry;
  }
  if (overlay.state?.owner !== owner || overlay.state.plan !== plan) overlay.lastKey = '';
  overlay.state = { owner, plan, framePosition, frame: frame.kind === 'TRAVEL' ? frame : null, colors };
  const hidden = frame.kind !== 'TRAVEL';
  if (overlay.canvas.hidden !== hidden) { overlay.canvas.hidden = hidden; overlay.lastKey = ''; }
  // The map's render event paints the overlay after its camera has been drawn.
  // Never schedule an independent animation clock or send per-frame GeoJSON.
  map.triggerRepaint();
  return true;
}

export function releaseRouteOverlay(map: MapLibreMap, owner: object): void {
  const overlay = overlays.get(map);
  if (overlay?.state?.owner === owner) overlay.dispose();
}
