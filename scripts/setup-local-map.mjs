import { createWriteStream } from 'node:fs';
import { access, chmod, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const mapDir = join(root, 'maps');
const cacheDir = join(root, '.cache', 'pmtiles');
const force = process.argv.includes('--force');

const WORLD_FILE = join(mapDir, 'world-z5.pmtiles');
const REGION_FILE = join(mapDir, 'korea-japan-z14.pmtiles');
const REGION_BBOX = process.env.TRAVEL_MAP_BBOX || '125.3,32.3,137.5,38.3';
const SOURCE_COOP_V4_URL = 'https://data.source.coop/protomaps/openstreetmap/v4.pmtiles';

await mkdir(mapDir, { recursive: true });
await mkdir(cacheDir, { recursive: true });

console.log('Travel Camera Visualizer · 로컬 지도 준비');
console.log(`상세 영역 bbox: ${REGION_BBOX}`);

const pmtilesBin = await ensurePmtilesCli();
console.log(`pmtiles CLI: ${pmtilesBin}`);

const planetUrl = await resolvePlanetUrl(pmtilesBin);
console.log(`Protomaps source: ${planetUrl}`);

if (force) {
  await rm(WORLD_FILE, { force: true });
  await rm(REGION_FILE, { force: true });
}

if (!(await exists(WORLD_FILE))) {
  console.log('\n[1/2] 세계 개요 지도(z0~5) 추출 중…');
  await extractArchive(pmtilesBin, planetUrl, WORLD_FILE, [
    '--maxzoom=5',
    '--download-threads=8',
    '--overfetch=0.05'
  ]);
} else {
  console.log('\n[1/2] world-z5.pmtiles 이미 존재 · 건너뜀');
}

if (!(await exists(REGION_FILE))) {
  console.log('\n[2/2] 한국·일본 상세 지도(z0~14 archive, 화면에서는 z6부터 사용) 추출 중…');
  await extractArchive(pmtilesBin, planetUrl, REGION_FILE, [
    `--bbox=${REGION_BBOX}`,
    '--maxzoom=14',
    '--download-threads=8',
    '--overfetch=0.05'
  ]);
} else {
  console.log('\n[2/2] korea-japan-z14.pmtiles 이미 존재 · 건너뜀');
}

const [worldStat, regionStat] = await Promise.all([stat(WORLD_FILE), stat(REGION_FILE)]);
console.log('\n완료');
console.log(`  세계 개요: ${formatBytes(worldStat.size)}`);
console.log(`  한국·일본 상세: ${formatBytes(regionStat.size)}`);
console.log('  npm start 후 설정의 지도 소스에서 로컬 PMTiles를 선택하세요.');

async function resolvePlanetUrl(pmtilesBin) {
  const explicit = process.env.PROTOMAPS_BUILD_URL;
  if (explicit) {
    console.log(`지정된 PROTOMAPS_BUILD_URL 확인 중: ${explicit}`);
    if (archiveIsReadable(pmtilesBin, explicit)) return explicit;
    throw new Error(`PROTOMAPS_BUILD_URL에 접근할 수 없습니다: ${explicit}`);
  }

  const candidates = [];
  const daily = await discoverLatestDailyBuildUrl();
  if (daily) candidates.push({ label: '최신 daily build', url: daily });
  candidates.push({ label: 'Source Cooperative v4 미러', url: SOURCE_COOP_V4_URL });

  for (const candidate of candidates) {
    process.stdout.write(`${candidate.label} 확인 중: ${candidate.url} ... `);
    if (archiveIsReadable(pmtilesBin, candidate.url)) {
      console.log('사용 가능');
      return candidate.url;
    }
    console.log('사용 불가 · 다음 후보 사용');
  }

  throw new Error(
    '사용 가능한 Protomaps archive를 찾지 못했습니다. 네트워크 연결을 확인하거나 PROTOMAPS_BUILD_URL을 지정하세요.'
  );
}

async function discoverLatestDailyBuildUrl() {
  try {
    const response = await fetch('https://maps.protomaps.com/builds/', {
      headers: { 'user-agent': 'travel-camera-visualizer/0.1' },
      redirect: 'follow'
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    const dates = [...html.matchAll(/build\.protomaps\.com\/(\d{8})\.pmtiles/g)]
      .map(match => match[1])
      .sort();
    if (!dates.length) return null;
    return `https://build.protomaps.com/${dates.at(-1)}.pmtiles`;
  } catch (error) {
    console.warn(`최신 daily build 목록 확인 실패 (${error.message}) · 고정 미러를 확인합니다.`);
    return null;
  }
}

function archiveIsReadable(pmtilesBin, url) {
  const result = spawnSync(pmtilesBin, ['show', url, '--header-json'], {
    cwd: root,
    stdio: 'ignore',
    shell: false,
    windowsHide: true,
    timeout: 30_000
  });
  return !result.error && result.status === 0;
}

async function ensurePmtilesCli() {
  const explicit = process.env.PMTILES_BIN;
  if (explicit && commandWorks(explicit)) return explicit;
  if (commandWorks('pmtiles')) return 'pmtiles';

  const releaseResponse = await fetch('https://api.github.com/repos/protomaps/go-pmtiles/releases/latest', {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'travel-camera-visualizer/0.1'
    }
  });
  if (!releaseResponse.ok) throw new Error(`pmtiles CLI release 확인 실패: HTTP ${releaseResponse.status}`);
  const release = await releaseResponse.json();

  const os = process.platform;
  const arch = process.arch;
  const platformToken = {
    win32: 'Windows',
    linux: 'Linux',
    darwin: 'Darwin'
  }[os];
  const archToken = {
    x64: 'x86_64',
    arm64: 'arm64'
  }[arch];

  if (!platformToken || !archToken) {
    throw new Error(`지원하지 않는 플랫폼: ${os}/${arch}. PMTILES_BIN 환경변수로 pmtiles 실행파일을 지정하세요.`);
  }

  const asset = (release.assets || []).find(item => {
    const name = String(item.name || '');
    return name.includes(`_${platformToken}_${archToken}.`) || name.includes(`-${release.tag_name?.replace(/^v/, '')}_${platformToken}_${archToken}.`);
  });
  if (!asset?.browser_download_url) {
    throw new Error(`pmtiles CLI 다운로드 파일을 찾지 못했습니다: ${platformToken}/${archToken}`);
  }

  const archive = join(cacheDir, asset.name);
  const extractDir = join(cacheDir, `go-pmtiles-${release.tag_name}-${platformToken}-${archToken}`);
  await mkdir(dirname(archive), { recursive: true });

  if (!(await exists(archive))) {
    console.log(`pmtiles CLI 다운로드: ${asset.name}`);
    await download(asset.browser_download_url, archive);
  }

  await rm(extractDir, { recursive: true, force: true });
  await mkdir(extractDir, { recursive: true });
  extractArchiveFile(archive, extractDir);

  const executableName = os === 'win32' ? 'pmtiles.exe' : 'pmtiles';
  const executable = await findFile(extractDir, executableName);
  if (!executable) throw new Error(`압축에서 ${executableName}을 찾지 못했습니다.`);
  if (os !== 'win32') await chmod(executable, 0o755);
  if (!commandWorks(executable)) throw new Error('다운로드한 pmtiles CLI를 실행할 수 없습니다.');
  return executable;
}

function extractArchiveFile(archive, targetDir) {
  if (process.platform === 'win32') {
    run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Expand-Archive -LiteralPath "${archive}" -DestinationPath "${targetDir}" -Force`
    ]);
    return;
  }
  if (process.platform === 'darwin') {
    run('ditto', ['-x', '-k', archive, targetDir]);
    return;
  }
  run('tar', ['-xzf', archive, '-C', targetDir]);
}

async function extractArchive(pmtilesBin, inputUrl, outputFile, extraArgs) {
  const temporary = `${outputFile}.partial`;
  await rm(temporary, { force: true });
  run(pmtilesBin, [
    'extract',
    inputUrl,
    temporary,
    ...extraArgs
  ]);
  await rename(temporary, outputFile);
}

function commandWorks(command) {
  const result = spawnSync(command, ['version'], {
    stdio: 'ignore',
    shell: false,
    windowsHide: true
  });
  return !result.error && result.status === 0;
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: false,
    windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} 종료 코드 ${result.status}`);
}

async function download(url, destination) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: { 'user-agent': 'travel-camera-visualizer/0.1' }
  });
  if (!response.ok || !response.body) throw new Error(`다운로드 실패: HTTP ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
}

async function findFile(directory, filename) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === filename.toLowerCase()) return path;
    if (entry.isDirectory()) {
      const nested = await findFile(path, filename);
      if (nested) return nested;
    }
  }
  return null;
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
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
