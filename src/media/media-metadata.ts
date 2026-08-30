const JPEG_SCAN_BYTES = 256 * 1024;

export interface EmbeddedMetadata {
  takenMs: number;
  lat: number | null;
  lng: number | null;
}

export function parseFilenameTimestamp(name: string): number | null {
  const text = String(name || '');
  let match = text.match(/((?:19|20)\d{2})(\d{2})(\d{2})[_-]?(\d{2})(\d{2})(\d{2})/)
    ?? text.match(/((?:19|20)\d{2})[-_.](\d{2})[-_.](\d{2})[ T_-](\d{2})[.:_-](\d{2})[.:_-](\d{2})/);
  if (match) return localTimestamp(match.slice(1, 7).map(Number));
  match = text.match(/((?:19|20)\d{2})[-_.]?(\d{2})[-_.]?(\d{2})/);
  return match ? localTimestamp([Number(match[1]), Number(match[2]), Number(match[3]), 12, 0, 0]) : null;
}

export async function readEmbeddedMetadata(file: File): Promise<EmbeddedMetadata | null> {
  if (!(file.type === 'image/jpeg' || /\.jpe?g$/i.test(file.name))) return null;
  try {
    const buffer = await file.slice(0, Math.min(file.size, JPEG_SCAN_BYTES)).arrayBuffer();
    return parseJpegExif(buffer);
  } catch {
    return null;
  }
}

function parseJpegExif(buffer: ArrayBuffer): EmbeddedMetadata | null {
  if (buffer.byteLength < 16) return null;
  const view = new DataView(buffer);
  if (view.getUint16(0, false) !== 0xffd8) return null;
  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) { offset += 1; continue; }
    const marker = view.getUint8(offset + 1);
    if (marker === 0xda || marker === 0xd9) break;
    const length = view.getUint16(offset + 2, false);
    const start = offset + 4;
    const end = offset + 2 + length;
    if (end > view.byteLength || length < 2) break;
    if (marker === 0xe1 && String.fromCharCode(...new Uint8Array(buffer, start, 4)) === 'Exif') return parseTiff(view, start + 6, end);
    offset = end;
  }
  return null;
}

function parseTiff(view: DataView, base: number, end: number): EmbeddedMetadata | null {
  if (base + 8 > end) return null;
  const order = String.fromCharCode(view.getUint8(base), view.getUint8(base + 1));
  if (order !== 'II' && order !== 'MM') return null;
  const little = order === 'II';
  const ifd0 = readIfd(view, base, end, view.getUint32(base + 4, little), little);
  if (!ifd0) return null;
  const exifOffset = entryNumber(view, ifd0.get(0x8769), little);
  const gpsOffset = entryNumber(view, ifd0.get(0x8825), little);
  const exif = exifOffset != null ? readIfd(view, base, end, exifOffset, little) : null;
  const gps = gpsOffset != null ? readIfd(view, base, end, gpsOffset, little) : null;
  const dateText = readAscii(view, base, end, exif?.get(0x9003) ?? exif?.get(0x9004) ?? ifd0.get(0x0132), little);
  const zone = readAscii(view, base, end, exif?.get(0x9011) ?? exif?.get(0x9012), little);
  const takenMs = parseExifDate(dateText, zone);
  if (takenMs == null) return null;
  const coordinate = readGps(view, base, end, gps, little);
  return { takenMs, lat: coordinate?.lat ?? null, lng: coordinate?.lng ?? null };
}

interface IfdEntry { start: number; type: number; count: number }

function readIfd(view: DataView, base: number, end: number, relative: number, little: boolean): Map<number, IfdEntry> | null {
  const start = base + relative;
  if (start < base || start + 2 > end) return null;
  const entries = new Map<number, IfdEntry>();
  const count = view.getUint16(start, little);
  for (let index = 0; index < count; index += 1) {
    const entryStart = start + 2 + index * 12;
    if (entryStart + 12 > end) break;
    entries.set(view.getUint16(entryStart, little), { start: entryStart, type: view.getUint16(entryStart + 2, little), count: view.getUint32(entryStart + 4, little) });
  }
  return entries;
}

function entryNumber(view: DataView, entry: IfdEntry | undefined, little: boolean): number | null {
  if (!entry || entry.count < 1) return null;
  if (entry.type === 3) return view.getUint16(entry.start + 8, little);
  if (entry.type === 4) return view.getUint32(entry.start + 8, little);
  return null;
}

function readAscii(view: DataView, base: number, end: number, entry: IfdEntry | undefined, little: boolean): string | null {
  if (!entry || entry.type !== 2 || entry.count < 1) return null;
  const start = entry.count <= 4 ? entry.start + 8 : base + view.getUint32(entry.start + 8, little);
  if (start < base || start + entry.count > end) return null;
  let result = '';
  for (let index = 0; index < entry.count; index += 1) {
    const code = view.getUint8(start + index);
    if (!code) break;
    result += String.fromCharCode(code);
  }
  return result.trim() || null;
}

function readRationals(view: DataView, base: number, end: number, entry: IfdEntry | undefined, little: boolean): number[] | null {
  if (!entry || entry.type !== 5 || entry.count < 1) return null;
  const start = base + view.getUint32(entry.start + 8, little);
  if (start < base || start + entry.count * 8 > end) return null;
  const values: number[] = [];
  for (let index = 0; index < entry.count; index += 1) {
    const denominator = view.getUint32(start + index * 8 + 4, little);
    if (!denominator) return null;
    values.push(view.getUint32(start + index * 8, little) / denominator);
  }
  return values;
}

function readGps(view: DataView, base: number, end: number, gps: Map<number, IfdEntry> | null, little: boolean): { lat: number; lng: number } | null {
  if (!gps) return null;
  const latParts = readRationals(view, base, end, gps.get(2), little);
  const lngParts = readRationals(view, base, end, gps.get(4), little);
  if (!latParts || !lngParts) return null;
  let lat = latParts[0] + latParts[1] / 60 + latParts[2] / 3600;
  let lng = lngParts[0] + lngParts[1] / 60 + lngParts[2] / 3600;
  if (/S/i.test(readAscii(view, base, end, gps.get(1), little) || '')) lat *= -1;
  if (/W/i.test(readAscii(view, base, end, gps.get(3), little) || '')) lng *= -1;
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

function parseExifDate(value: string | null, zoneValue: string | null): number | null {
  const match = String(value || '').match(/^(\d{4}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (!match) return null;
  const parts = match.slice(1, 7).map(Number);
  const zone = String(zoneValue || '').match(/^([+-])(\d{2}):?(\d{2})$/);
  if (!zone) return localTimestamp(parts);
  const offset = (Number(zone[2]) * 60 + Number(zone[3])) * (zone[1] === '-' ? -1 : 1);
  return Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]) - offset * 60_000;
}

function localTimestamp(parts: number[]): number | null {
  const [year, month, day, hour, minute, second] = parts;
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31 || hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 60) return null;
  const value = new Date(year, month - 1, day, hour, minute, second).getTime();
  return Number.isFinite(value) ? value : null;
}
