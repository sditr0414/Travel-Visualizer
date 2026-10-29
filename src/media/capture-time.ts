const formatters = new Map<string, Intl.DateTimeFormat>();
export function validCaptureTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > 100) return false;
  if (value === 'DEVICE') return true;
  if (/^[+-](?:0\d|1[0-4]):[0-5]\d$/.test(value)) return Math.abs(offsetMinutes(value)) <= 14 * 60;
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
}
export function resolvedCaptureTimeZone(value = 'DEVICE'): string {
  return value === 'DEVICE' ? Intl.DateTimeFormat().resolvedOptions().timeZone : value;
}
function offsetMinutes(value: string) {
  return (Number(value.slice(1, 3)) * 60 + Number(value.slice(4))) * (value[0] === '-' ? -1 : 1);
}
/** Interpret only wall-clock values lacking an explicit offset. DST overlaps use the earlier instant; gaps are rejected. */
export function captureTimestamp(parts: number[], zone = 'DEVICE'): number | null {
  const [year, month, day, hour, minute, second] = parts;
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31 || hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return null;
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  if (new Date(wall).getUTCDate() !== day) return null;
  const timeZone = resolvedCaptureTimeZone(zone);
  if (/^[+-]\d{2}:\d{2}$/.test(timeZone)) return validCaptureTimeZone(timeZone) ? wall - offsetMinutes(timeZone) * 60_000 : null;
  if (!validCaptureTimeZone(timeZone)) return null;
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    formatters.set(timeZone, formatter);
  }
  const asWall = (ms: number) => {
    const p = Object.fromEntries(formatter!.formatToParts(ms).map(part => [part.type, Number(part.value)]));
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  };
  // Samples on both sides include both offsets at an ordinary daylight-saving transition.
  const offsets = new Set([-2, -1, 0, 1, 2].map(days => { const sample = wall + days * 86400000; return asWall(sample) - sample; }));
  const matches = [...offsets].map(offset => wall - offset).filter(value => asWall(value) === wall);
  return matches.length ? Math.min(...matches) : null;
}

export function parseCaptureDateText(value: string, zone = 'DEVICE'): number | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/);
  if (!match) return null;
  if (match[8]) { const result = Date.parse(value.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')); return Number.isFinite(result) ? result : null; }
  const time = captureTimestamp(match.slice(1, 7).map(Number), zone);
  return time == null ? null : time + Number(match[7] || 0) * 1000;
}
