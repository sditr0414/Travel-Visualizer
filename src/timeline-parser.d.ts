import type { ParsedTrip } from './types';

export function parseLatLng(value: unknown): { lat: number; lng: number } | null;
export function parseTimeline(
  json: unknown,
  options?: { startDate?: string; endDate?: string; includeFlights?: boolean }
): Omit<ParsedTrip, 'availableRange'>;
