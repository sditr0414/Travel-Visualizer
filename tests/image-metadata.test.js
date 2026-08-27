import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFilenameTimestamp,
  parseJpegExifMetadata,
  readLocalMediaMetadata
} from '../src/image-metadata.js';

test('JPEG EXIF DateTimeOriginal, timezone and GPS are parsed for device gallery matching', async () => {
  const buffer = buildExifJpeg();
  const parsed = parseJpegExifMetadata(buffer);
  assert.ok(parsed);
  assert.equal(parsed.takenMs, Date.parse('2026-03-25T14:05:06+09:00'));
  assert.ok(Math.abs(parsed.lat - 34.675) < 1e-8);
  assert.ok(Math.abs(parsed.lng - 135.5) < 1e-8);
  assert.equal(parsed.hasGps, true);

  const blob = new Blob([buffer], { type: 'image/jpeg' });
  const file = {
    name: 'IMG_0001.JPG',
    type: 'image/jpeg',
    size: blob.size,
    slice: (...args) => blob.slice(...args)
  };
  const metadata = await readLocalMediaMetadata(file);
  assert.equal(metadata.source, 'embedded-exif');
  assert.equal(metadata.takenMs, parsed.takenMs);
  assert.ok(metadata.hasGps);
});

test('common camera filenames provide a capture-time fallback when EXIF is absent', () => {
  const compact = parseFilenameTimestamp('IMG_20260325_140506.jpg');
  const separated = parseFilenameTimestamp('2026-03-25 14.05.06.jpg');
  const expected = new Date(2026, 2, 25, 14, 5, 6, 0).getTime();
  assert.equal(compact, expected);
  assert.equal(separated, expected);
});

function buildExifJpeg() {
  const tiffLength = 197;
  const payloadLength = 6 + tiffLength;
  const segmentLength = 2 + payloadLength;
  const buffer = new ArrayBuffer(2 + 2 + 2 + payloadLength + 2);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  view.setUint16(0, 0xffd8, false);
  view.setUint16(2, 0xffe1, false);
  view.setUint16(4, segmentLength, false);
  bytes.set([0x45, 0x78, 0x69, 0x66, 0, 0], 6);
  const base = 12;
  const u16 = (rel, value) => view.setUint16(base + rel, value, true);
  const u32 = (rel, value) => view.setUint32(base + rel, value, true);

  bytes[base] = 0x49;
  bytes[base + 1] = 0x49;
  u16(2, 42);
  u32(4, 8);

  // IFD0 -> Exif IFD + GPS IFD
  u16(8, 2);
  writeEntry(10, 0x8769, 4, 1, 38);
  writeEntry(22, 0x8825, 4, 1, 68);
  u32(34, 0);

  // Exif IFD -> DateTimeOriginal + OffsetTimeOriginal
  u16(38, 2);
  writeEntry(40, 0x9003, 2, 20, 122);
  writeEntry(52, 0x9011, 2, 7, 142);
  u32(64, 0);

  // GPS IFD -> N 34°40'30", E 135°30'0"
  u16(68, 4);
  writeEntry(70, 0x0001, 2, 2, 0);
  bytes.set([0x4e, 0, 0, 0], base + 78);
  writeEntry(82, 0x0002, 5, 3, 149);
  writeEntry(94, 0x0003, 2, 2, 0);
  bytes.set([0x45, 0, 0, 0], base + 102);
  writeEntry(106, 0x0004, 5, 3, 173);
  u32(118, 0);

  writeAscii(122, '2026:03:25 14:05:06\0');
  writeAscii(142, '+09:00\0');
  writeRational(149, 34, 1);
  writeRational(157, 40, 1);
  writeRational(165, 3000, 100);
  writeRational(173, 135, 1);
  writeRational(181, 30, 1);
  writeRational(189, 0, 1);

  view.setUint16(buffer.byteLength - 2, 0xffd9, false);
  return buffer;

  function writeEntry(rel, tag, type, count, value) {
    u16(rel, tag);
    u16(rel + 2, type);
    u32(rel + 4, count);
    u32(rel + 8, value);
  }

  function writeAscii(rel, text) {
    for (let index = 0; index < text.length; index += 1) bytes[base + rel + index] = text.charCodeAt(index);
  }

  function writeRational(rel, numerator, denominator) {
    u32(rel, numerator);
    u32(rel + 4, denominator);
  }
}
