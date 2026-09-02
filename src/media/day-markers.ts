import type { PlaybackPlan, PlaybackStop, TravelFrame } from '../types';

const DAY_MARKER_PREFIX = '__day__:';
const DAY_KEY_FORMATTER = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: 'Asia/Seoul'
});

export interface DayMarkerCue {
  dayNumber: number;
  dayKey: string;
}

export function buildDayMarkerStops(plan: PlaybackPlan, durationSec: number): PlaybackStop[] {
  const duration = Math.max(0, Number(durationSec) || 0);
  if (!(duration > 0)) return [];

  const stops: PlaybackStop[] = [];
  let previousDayKey = '';
  let dayNumber = 0;

  for (const frame of plan.frames) {
    if (frame.kind !== 'TRAVEL') continue;
    const dayKey = sourceDayKey(frame, plan);
    if (!dayKey || dayKey === previousDayKey) continue;
    previousDayKey = dayKey;
    dayNumber += 1;
    stops.push({
      id: dayMarkerId(dayNumber, dayKey),
      atSec: Math.max(0, frame.timeSec),
      durationSec: duration
    });
  }

  return stops;
}

export function dayMarkerCueFromId(id: string | null): DayMarkerCue | null {
  if (!id?.startsWith(DAY_MARKER_PREFIX)) return null;
  const match = /^__day__:(\d+):(\d{4}-\d{2}-\d{2})$/.exec(id);
  if (!match) return null;
  return { dayNumber: Number(match[1]), dayKey: match[2] };
}

export function isDayMarkerId(id: string | null | undefined): boolean {
  return Boolean(id?.startsWith(DAY_MARKER_PREFIX));
}

function dayMarkerId(dayNumber: number, dayKey: string): string {
  return `${DAY_MARKER_PREFIX}${dayNumber}:${dayKey}`;
}

function sourceDayKey(frame: TravelFrame, plan: PlaybackPlan): string {
  const segment = plan.segments[frame.segmentIndex];
  if (!segment) return '';
  const sourceMs = segment.startMs + (segment.endMs - segment.startMs) * frame.progress;
  const parts = DAY_KEY_FORMATTER.formatToParts(sourceMs);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(candidate => candidate.type === type)?.value ?? '';
  const year = part('year');
  const month = part('month');
  const day = part('day');
  return year && month && day ? `${year}-${month}-${day}` : '';
}
