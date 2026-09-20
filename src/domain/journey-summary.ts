import type { MobilityClass, PlaybackPlan } from '../types';
import { movementPresentation, visibleDistanceMeters } from './movement-presentation';

export interface JourneySummaryData {
  period: { startDate: string; endDate: string; days: number } | null;
  distanceMeters: number | null;
  movements: Array<{ mobilityClass: MobilityClass; distanceMeters: number; share: number }>;
}

/** Aggregate source distances once, using the same displayed transport as playback. */
export function buildJourneySummary(plan: PlaybackPlan): JourneySummaryData {
  const distances = new Map<MobilityClass, number>();
  let total: number | null = null;
  plan.segments.forEach((segment, index) => {
    const meters = visibleDistanceMeters(segment);
    if (meters === null) return;
    const { mobilityClass } = movementPresentation(plan.segments, index);
    distances.set(mobilityClass, (distances.get(mobilityClass) ?? 0) + meters);
    total = (total ?? 0) + meters;
  });
  return {
    period: journeyPeriod(plan),
    distanceMeters: total,
    movements: [...distances].map(([mobilityClass, distanceMeters]) => ({
      mobilityClass, distanceMeters, share: total && total > 0 ? distanceMeters / total : 0
    })).sort((a, b) => b.distanceMeters - a.distanceMeters)
  };
}

function journeyPeriod(plan: PlaybackPlan): JourneySummaryData['period'] {
  let startDate = plan.selectedRange?.startDate;
  let endDate = plan.selectedRange?.endDate;
  if (!startDate || !endDate) {
    let first = Infinity;
    let last = -Infinity;
    for (const segment of plan.segments) {
      if (Number.isFinite(segment.startMs)) first = Math.min(first, segment.startMs);
      if (Number.isFinite(segment.endMs)) last = Math.max(last, segment.endMs);
    }
    if (!Number.isFinite(first) || !Number.isFinite(last)) return null;
    startDate = seoulDate(first);
    endDate = seoulDate(last);
  }
  const days = Math.round((Date.parse(endDate) - Date.parse(startDate)) / 86_400_000) + 1;
  return Number.isFinite(days) && days > 0 ? { startDate, endDate, days } : null;
}

function seoulDate(ms: number): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(ms);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
