import { createHash } from 'node:crypto';
import { access, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const partDir = join(root, 'data', 'timeline-parts');
const EXPECTED_SOURCE_SHA256 = '5cc05afe24602a2550a0a318999b033b472af014bea361abfd3051bb1dc5a2a0';
const EXPECTED_SEMANTIC_SEGMENTS = 8793;
const EXPECTED_RAW_SIGNALS = 45587;
const PART_CHARS = 180_000;

const explicitArg = process.argv.slice(2).find(arg => !arg.startsWith('--'));
const allowDifferent = process.argv.includes('--allow-different');
const source = await findSource(explicitArg);
if (!source) {
  throw new Error([
    '타임라인.json을 찾지 못했습니다.',
    '다음 중 하나에 원본 파일을 두고 다시 실행하세요:',
    '  1) 프로젝트 상위 폴더의 타임라인.json',
    '  2) 프로젝트 루트의 타임라인.json',
    '  3) data/타임라인.json',
    '또는 npm run timeline:setup -- "C:\\경로\\타임라인.json" 처럼 직접 경로를 지정하세요.'
  ].join('\n'));
}

console.log('Travel Camera Visualizer · 전체 Timeline 준비');
console.log(`원본: ${source}`);

const raw = await readFile(source);
const sha256 = createHash('sha256').update(raw).digest('hex');
let json;
try {
  json = JSON.parse(raw.toString('utf8'));
} catch (error) {
  throw new Error(`원본 Timeline JSON 파싱 실패: ${error.message}`);
}

const semanticSegments = Array.isArray(json?.semanticSegments) ? json.semanticSegments.length : 0;
const rawSignals = Array.isArray(json?.rawSignals) ? json.rawSignals.length : 0;
if (!semanticSegments) throw new Error('semanticSegments가 없는 Timeline 파일입니다.');

if (!allowDifferent) {
  if (sha256 !== EXPECTED_SOURCE_SHA256) {
    throw new Error([
      '첨부해 확인한 타임라인.json과 SHA-256이 다릅니다.',
      `기대값: ${EXPECTED_SOURCE_SHA256}`,
      `현재값: ${sha256}`,
      '다른 Timeline을 의도적으로 사용할 경우 --allow-different 옵션을 추가하세요.'
    ].join('\n'));
  }
  if (semanticSegments !== EXPECTED_SEMANTIC_SEGMENTS || rawSignals !== EXPECTED_RAW_SIGNALS) {
    throw new Error(`첨부 원본의 레코드 수와 다릅니다: semanticSegments=${semanticSegments}, rawSignals=${rawSignals}`);
  }
}

const compressed = gzipSync(raw, { level: 9 });
const base64 = compressed.toString('base64');
const parts = [];
for (let offset = 0; offset < base64.length; offset += PART_CHARS) {
  parts.push(base64.slice(offset, offset + PART_CHARS));
}

await mkdir(partDir, { recursive: true });
for (const name of await readdir(partDir)) {
  if (/^part-\d+\.txt$/i.test(name) || name === 'manifest.json') {
    await rm(join(partDir, name), { force: true });
  }
}

for (let index = 0; index < parts.length; index += 1) {
  const name = `part-${String(index + 1).padStart(2, '0')}.txt`;
  await writeFile(join(partDir, name), parts[index], 'utf8');
}

const manifest = {
  format: 'gzip-base64-v1',
  sourceName: basename(source),
  sourceSha256: sha256,
  rawBytes: raw.length,
  compressedBytes: compressed.length,
  base64Chars: base64.length,
  parts: parts.length,
  semanticSegments,
  rawSignals,
  hasUserLocationProfile: Boolean(json?.userLocationProfile),
  fullTimeline: semanticSegments >= 8000
};
await writeFile(join(partDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

console.log('완료');
console.log(`  semanticSegments: ${semanticSegments.toLocaleString()}`);
console.log(`  rawSignals: ${rawSignals.toLocaleString()}`);
console.log(`  원본: ${formatBytes(raw.length)}`);
console.log(`  gzip: ${formatBytes(compressed.length)}`);
console.log(`  fixture: ${parts.length} parts`);
console.log(`  SHA-256: ${sha256}`);
console.log('');
console.log('GitHub에도 반영하려면 다음을 실행하세요:');
console.log('  git add data/timeline-parts');
console.log('  git commit -m "Replace bundled Timeline with full source"');
console.log('  git push origin main');

async function findSource(explicit) {
  const candidates = [
    explicit,
    process.env.TIMELINE_JSON,
    join(root, '타임라인.json'),
    join(root, 'data', '타임라인.json'),
    resolve(root, '..', '타임라인.json')
  ].filter(Boolean);

  for (const candidate of candidates) {
    const path = resolve(candidate);
    try {
      await access(path);
      return path;
    } catch {}
  }
  return null;
}

function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = Number(bytes) || 0;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index ? 1 : 0)} ${units[index]}`;
}
