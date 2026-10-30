import { haversineMeters } from '../geo.js';
import type { Coordinate, MobilityClass } from '../types';

type Mode = Extract<MobilityClass, 'WALK' | 'BIKE' | 'ROAD' | 'FAST_GROUND'>;
interface Activity { timeMs: number; mode: Mode; confidence: number }
export interface RawMobilityEvidence { mobilityClass: Mode; confidence: number }
const MAX_SPEED: Record<Mode, number> = { WALK: 18, BIKE: 55, ROAD: 220, FAST_GROUND: 360 };
const MINUTE = 60_000;

/** Sensor candidates overlap (vehicle/rail, foot/walking); never add them together. */
export function readRawActivities(signals: unknown[]): Activity[] {
  const activities: Activity[] = [];
  for (const signal of signals) {
    if (!signal || typeof signal !== 'object') continue;
    const record = (signal as { activityRecord?: { timestamp?: unknown; probableActivities?: unknown } }).activityRecord;
    if (!record || typeof record.timestamp !== 'string' || !Array.isArray(record.probableActivities)) continue;
    const timeMs = Date.parse(record.timestamp);
    if (!Number.isFinite(timeMs)) continue;
    const scores = new Map<string, number>();
    for (const candidate of record.probableActivities) {
      if (!candidate || typeof candidate.type !== 'string' || typeof candidate.confidence !== 'number'
        || !Number.isFinite(candidate.confidence) || candidate.confidence < 0 || candidate.confidence > 1) continue;
      scores.set(candidate.type, Math.max(scores.get(candidate.type) ?? 0, candidate.confidence));
    }
    const rail = scores.get('IN_RAIL_VEHICLE') ?? 0;
    const road = scores.get('IN_ROAD_VEHICLE') ?? 0;
    const modes: Array<[Mode, number]> = [
      ['WALK', Math.max(scores.get('ON_FOOT') ?? 0, scores.get('WALKING') ?? 0, scores.get('RUNNING') ?? 0)],
      ['BIKE', scores.get('ON_BICYCLE') ?? 0],
      ['FAST_GROUND', rail],
      ['ROAD', Math.max(road, rail >= .7 ? 0 : scores.get('IN_VEHICLE') ?? 0)]
    ];
    modes.sort((a, b) => b[1] - a[1]);
    const [mode, confidence] = modes[0];
    if (confidence < .7 || confidence - modes[1][1] < .15
      || confidence < Math.max(scores.get('STILL') ?? 0, scores.get('UNKNOWN') ?? 0)) continue;
    activities.push({ timeMs, mode, confidence });
  }
  activities.sort((a, b) => a.timeMs - b.timeMs || b.confidence - a.confidence);
  // A repeated sensor packet cannot establish a sustained transport change.
  return activities.filter((activity, index) => !index || activity.timeMs !== activities[index - 1].timeMs);
}

/** Split at sustained sensor changes; short glitches and stale records cannot set a mode. */
export function splitRawMobility<T extends Coordinate & { timeMs: number }>(points: T[], activities: Activity[]): Array<{ points: T[]; evidence?: RawMobilityEvidence }> {
  const edges = points.slice(1).map((point, index) => {
    const previous = points[index];
    const start = previous.timeMs, end = point.timeMs;
    const distance = haversineMeters(previous, point);
    const speed = distance / (end - start) * 3600;
    const evidence = end - start <= 5 * MINUTE
      ? intervalEvidence(activities, Math.max(points[0].timeMs, start - MINUTE), Math.min(points.at(-1)!.timeMs, end + MINUTE), speed) : undefined;
    return { start, end, distance, evidence };
  });
  // Require a sustained run, not a single bicycle/vehicle detection while walking.
  for (let start = 0; start < edges.length;) {
    let end = start + 1;
    while (end < edges.length && edges[end].evidence?.mobilityClass === edges[start].evidence?.mobilityClass) end++;
    const distance = edges.slice(start, end).reduce((sum, e) => sum + e.distance, 0);
    if (edges[end - 1].end - edges[start].start < minimumDuration(edges[start].evidence?.mobilityClass) || distance < 100) {
      for (let i = start; i < end; i++) edges[i].evidence = undefined;
    }
    start = end;
  }
  // Bridge only short uncertainty within the same mode, never a real transfer or a long silence.
  for (let start = 0; start < edges.length;) {
    if (edges[start].evidence) { start++; continue; }
    let end = start + 1;
    while (end < edges.length && !edges[end].evidence) end++;
    const before = edges[start - 1]?.evidence, after = edges[end]?.evidence;
    if (before && after && before.mobilityClass === after.mobilityClass && edges[end - 1].end - edges[start].start <= 5 * MINUTE) {
      for (let i = start; i < end; i++) edges[i].evidence = { mobilityClass: before.mobilityClass, confidence: Math.min(before.confidence, after.confidence) };
    }
    start = end;
  }
  // Sparse location fixes can miss short sensor windows. Aggregate evidence
  // within each still-unlabelled interval, never borrow a later train's mode.
  for (let start = 0; start < edges.length;) {
    if (edges[start].evidence) { start++; continue; }
    let end = start + 1;
    while (end < edges.length && !edges[end].evidence) end++;
    const duration = edges[end - 1].end - edges[start].start;
    const distance = edges.slice(start, end).reduce((sum, edge) => sum + edge.distance, 0);
    const evidence = intervalEvidence(activities, edges[start].start, edges[end - 1].end, distance / duration * 3600);
    if (evidence && duration >= minimumDuration(evidence.mobilityClass) && distance >= 100) {
      for (let i = start; i < end; i++) edges[i].evidence = evidence;
    }
    start = end;
  }
  // Filling uncertainty must not create a new, sub-minute mode between two
  // matching walking/vehicle runs.
  for (let start = 0; start < edges.length;) {
    let end = start + 1;
    while (end < edges.length && edges[end].evidence?.mobilityClass === edges[start].evidence?.mobilityClass) end++;
    const before = edges[start - 1]?.evidence, after = edges[end]?.evidence;
    if (before && after && before.mobilityClass === after.mobilityClass && edges[end - 1].end - edges[start].start < 90_000) {
      for (let i = start; i < end; i++) edges[i].evidence = { ...before, confidence: Math.min(before.confidence, after.confidence) };
    }
    start = end;
  }
  const groups: Array<{ points: T[]; evidence?: RawMobilityEvidence }> = [];
  for (let start = 0; start < edges.length;) {
    let end = start + 1;
    while (end < edges.length && edges[end].evidence?.mobilityClass === edges[start].evidence?.mobilityClass) end++;
    const evidence = edges[start].evidence;
    groups.push({ points: points.slice(start, end + 1), evidence: evidence && { mobilityClass: evidence.mobilityClass,
      confidence: edges.slice(start, end).reduce((sum, e) => sum + e.evidence!.confidence, 0) / (end - start) } });
    start = end;
  }
  return groups;
}

function intervalEvidence(activities: Activity[], start: number, end: number, speed: number): RawMobilityEvidence | undefined {
  const votes = new Map<Mode, Activity[]>();
  let low = 0, high = activities.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (activities[middle].timeMs < start) low = middle + 1;
    else high = middle;
  }
  for (let i = low; i < activities.length && activities[i].timeMs <= end; i++) {
    const activity = activities[i];
    if (speed > MAX_SPEED[activity.mode] * 1.5) continue;
    const list = votes.get(activity.mode) ?? [];
    list.push(activity); votes.set(activity.mode, list);
  }
  const ranked = [...votes.entries()].sort((a, b) => b[1].length - a[1].length);
  const best = ranked[0];
  const total = [...votes.values()].reduce((sum, list) => sum + list.length, 0);
  if (!best || best[1].length < 2 || best[1].at(-1)!.timeMs - best[1][0].timeMs < 30_000
    || best[1].length / total < .65 || best[1].length * 2 * MINUTE < (end - start) * .3) return undefined;
  return { mobilityClass: best[0], confidence: best[1].reduce((sum, a) => sum + a.confidence, 0) / best[1].length };
}

function minimumDuration(mode?: Mode): number { return mode === 'BIKE' || mode === 'FAST_GROUND' ? 3 * MINUTE : 90_000; }
