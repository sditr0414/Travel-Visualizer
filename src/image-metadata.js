const JPEG_NAME = /\.jpe?g$/i;
const JPEG_METADATA_SCAN_BYTES = 128 * 1024;

export async function readLocalMediaMetadata(file) {
  if (!file) return null;
  const name = String(file.name || '');
  const type = String(file.type || '').toLowerCase();

  if (type === 'image/jpeg' || JPEG_NAME.test(name)) {
    try {
      const maxBytes = Math.min(Number(file.size) || 0, JPEG_METADATA_SCAN_BYTES);
      const buffer = await file.slice(0, maxBytes || undefined).arrayBuffer();
      const exif = parseJpegExifMetadata(buffer);
      if (exif?.takenMs) return { ...exif, source: 'embedded-exif' };
    } catch {}
  }

  const filenameTakenMs = parseFilenameTimestamp(name);
  if (Number.isFinite(filenameTakenMs)) {
    return {
      takenMs: filenameTakenMs,
      lat: null,
      lng: null,
      hasGps: false,
      source: 'filename-time'
    };
  }
  return null;
}

export function parseFilenameTimestamp(name) {
  const text = String(name || '');
  let match = text.match(/((?:19|20)\d{2})(\d{2})(\d{2})[_-]?(\d{2})(\d{2})(\d{2})/);
  if (!match) {
    match = text.match(/((?:19|20)\d{2})[-_.](\d{2})[-_.](\d{2})[ T_-](\d{2})[.:_-](\d{2})[.:_-](\d{2})/);
  }
  if (match) return localTimestamp(match.slice(1, 7).map(Number));

  match = text.match(/((?:19|20)\d{2})[-_.]?(\d{2})[-_.]?(\d{2})/);
  if (!match) return null;
  return localTimestamp([Number(match[1]), Number(match[2]), Number(match[3]), 12, 0, 0]);
}

export function parseJpegExifMetadata(arrayBuffer) {
  if (!(arrayBuffer instanceof ArrayBuffer) || arrayBuffer.byteLength < 16) return null;
  const view = new DataView(arrayBuffer);
  if (view.getUint16(0, false) !== 0xffd8) return null;

  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = view.getUint8(offset + 1);
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x00 || marker === 0xff) {
      offset += 1;
      continue;
    }
    if (offset + 4 > view.byteLength) break;
    const segmentLength = view.getUint16(offset + 2, false);
    if (segmentLength < 2) break;
    const dataStart = offset + 4;
    const dataEnd = offset + 2 + segmentLength;
    if (dataEnd > view.byteLength) break;

    if (marker === 0xe1 && dataStart + 6 <= dataEnd && isExifHeader(view, dataStart)) {
      return parseTiffExif(view, dataStart + 6, dataEnd);
    }
    offset = dataEnd;
  }
  return null;
}

function parseTiffExif(view, tiffStart, tiffEnd) {
  if (tiffStart + 8 > tiffEnd) return null;
  const byteOrder = String.fromCharCode(view.getUint8(tiffStart), view.getUint8(tiffStart + 1));
  if (byteOrder !== 'II' && byteOrder !== 'MM') return null;
  const little = byteOrder === 'II';

  const u16 = relative => {
    const absolute = tiffStart + relative;
    if (absolute < tiffStart || absolute + 2 > tiffEnd) return null;
    return view.getUint16(absolute, little);
  };
  const u32 = relative => {
    const absolute = tiffStart + relative;
    if (absolute < tiffStart || absolute + 4 > tiffEnd) return null;
    return view.getUint32(absolute, little);
  };
  if (u16(2) !== 42) return null;

  const firstIfdOffset = u32(4);
  if (!Number.isFinite(firstIfdOffset)) return null;
  const ifd0 = readIfd(view, tiffStart, tiffEnd, firstIfdOffset, little);
  if (!ifd0) return null;

  const exifOffset = entryNumber(view, tiffStart, tiffEnd, ifd0.get(0x8769), little);
  const gpsOffset = entryNumber(view, tiffStart, tiffEnd, ifd0.get(0x8825), little);
  const exifIfd = Number.isFinite(exifOffset) ? readIfd(view, tiffStart, tiffEnd, exifOffset, little) : null;
  const gpsIfd = Number.isFinite(gpsOffset) ? readIfd(view, tiffStart, tiffEnd, gpsOffset, little) : null;

  const dateText = asciiEntry(view, tiffStart, tiffEnd, exifIfd?.get(0x9003), little)
    || asciiEntry(view, tiffStart, tiffEnd, exifIfd?.get(0x9004), little)
    || asciiEntry(view, tiffStart, tiffEnd, ifd0.get(0x0132), little);
  const offsetText = asciiEntry(view, tiffStart, tiffEnd, exifIfd?.get(0x9011), little)
    || asciiEntry(view, tiffStart, tiffEnd, exifIfd?.get(0x9012), little);
  const takenMs = parseExifDate(dateText, offsetText);
  if (!Number.isFinite(takenMs)) return null;

  const gps = parseGps(view, tiffStart, tiffEnd, gpsIfd, little);
  return {
    takenMs,
    lat: gps?.lat ?? null,
    lng: gps?.lng ?? null,
    hasGps: !!gps
  };
}

function readIfd(view, tiffStart, tiffEnd, relativeOffset, little) {
  const start = tiffStart + Number(relativeOffset);
  if (!Number.isFinite(start) || start < tiffStart || start + 2 > tiffEnd) return null;
  const count = view.getUint16(start, little);
  const entries = new Map();
  for (let index = 0; index < count; index += 1) {
    const entryStart = start + 2 + index * 12;
    if (entryStart + 12 > tiffEnd) break;
    const tag = view.getUint16(entryStart, little);
    const type = view.getUint16(entryStart + 2, little);
    const valueCount = view.getUint32(entryStart + 4, little);
    entries.set(tag, { entryStart, type, count: valueCount });
  }
  return entries;
}

function entryNumber(view, tiffStart, tiffEnd, entry, little) {
  if (!entry || entry.count < 1) return null;
  if (entry.type === 3) return view.getUint16(entry.entryStart + 8, little);
  if (entry.type === 4) return view.getUint32(entry.entryStart + 8, little);
  return null;
}

function asciiEntry(view, tiffStart, tiffEnd, entry, little) {
  if (!entry || entry.type !== 2 || entry.count < 1) return null;
  const byteLength = entry.count;
  let start;
  if (byteLength <= 4) start = entry.entryStart + 8;
  else start = tiffStart + view.getUint32(entry.entryStart + 8, little);
  if (start < tiffStart || start + byteLength > tiffEnd) return null;
  let text = '';
  for (let index = 0; index < byteLength; index += 1) {
    const code = view.getUint8(start + index);
    if (!code) break;
    text += String.fromCharCode(code);
  }
  return text.trim() || null;
}

function rationalArray(view, tiffStart, tiffEnd, entry, little) {
  if (!entry || entry.type !== 5 || entry.count < 1) return null;
  const start = tiffStart + view.getUint32(entry.entryStart + 8, little);
  const byteLength = entry.count * 8;
  if (start < tiffStart || start + byteLength > tiffEnd) return null;
  const values = [];
  for (let index = 0; index < entry.count; index += 1) {
    const numerator = view.getUint32(start + index * 8, little);
    const denominator = view.getUint32(start + index * 8 + 4, little);
    if (!denominator) return null;
    values.push(numerator / denominator);
  }
  return values;
}

function parseGps(view, tiffStart, tiffEnd, gpsIfd, little) {
  if (!gpsIfd) return null;
  const latRef = asciiEntry(view, tiffStart, tiffEnd, gpsIfd.get(0x0001), little);
  const latValues = rationalArray(view, tiffStart, tiffEnd, gpsIfd.get(0x0002), little);
  const lngRef = asciiEntry(view, tiffStart, tiffEnd, gpsIfd.get(0x0003), little);
  const lngValues = rationalArray(view, tiffStart, tiffEnd, gpsIfd.get(0x0004), little);
  if (!latValues?.length || !lngValues?.length) return null;

  let lat = dmsToDecimal(latValues);
  let lng = dmsToDecimal(lngValues);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (/S/i.test(latRef || '')) lat *= -1;
  if (/W/i.test(lngRef || '')) lng *= -1;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

function dmsToDecimal(values) {
  if (!values?.length) return null;
  return Number(values[0] || 0) + Number(values[1] || 0) / 60 + Number(values[2] || 0) / 3600;
}

function parseExifDate(value, offsetValue) {
  const match = String(value || '').match(/^(\d{4}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (!match) return null;
  const parts = match.slice(1, 7).map(Number);
  if (!validDateParts(parts)) return null;

  const zone = String(offsetValue || '').match(/^([+-])(\d{2}):?(\d{2})$/);
  if (zone) {
    const offsetMinutes = (Number(zone[2]) * 60 + Number(zone[3])) * (zone[1] === '-' ? -1 : 1);
    return Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]) - offsetMinutes * 60_000;
  }
  return localTimestamp(parts);
}

function localTimestamp(parts) {
  if (!validDateParts(parts)) return null;
  const date = new Date(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5], 0);
  const value = date.getTime();
  return Number.isFinite(value) ? value : null;
}

function validDateParts(parts) {
  const [year, month, day, hour, minute, second] = parts;
  return year >= 1900 && year <= 2200
    && month >= 1 && month <= 12
    && day >= 1 && day <= 31
    && hour >= 0 && hour <= 23
    && minute >= 0 && minute <= 59
    && second >= 0 && second <= 60;
}

function isExifHeader(view, start) {
  return view.getUint8(start) === 0x45
    && view.getUint8(start + 1) === 0x78
    && view.getUint8(start + 2) === 0x69
    && view.getUint8(start + 3) === 0x66
    && view.getUint8(start + 4) === 0
    && view.getUint8(start + 5) === 0;
}
