import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const updateEnabled = !args.includes('--no-update');
const installEnabled = !args.includes('--no-install');
const serverArgs = args.filter(value => !['--dry-run', '--no-update', '--no-install'].includes(value));
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

main().catch(error => {
  console.error(`\n[Travel Camera] 실행 준비 중 오류가 발생했습니다: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

async function main() {
  assertSupportedNode();
  console.log('[Travel Camera] 로컬 실행 준비');

  if (updateEnabled) updateMainSafely();
  else console.log('[Travel Camera] 자동 업데이트를 건너뜁니다 (--no-update).');

  if (installEnabled) ensureDependencies();
  else console.log('[Travel Camera] 의존성 확인을 건너뜁니다 (--no-install).');

  const port = resolvePort(serverArgs, process.env.PORT);
  const url = `http://127.0.0.1:${port}`;

  if (dryRun) {
    console.log(`[Travel Camera] dry-run 완료. 서버 실행 예정 주소: ${url}`);
    return;
  }

  console.log(`[Travel Camera] 서버를 시작합니다: ${url}`);
  const child = spawn(npmCommand, ['start', '--', ...serverArgs], {
    cwd: root,
    env: process.env,
    stdio: 'inherit'
  });

  child.on('error', error => {
    console.error(`[Travel Camera] npm start 실행 실패: ${error.message}`);
  });

  if (await waitForServer(url, child)) {
    openBrowser(url);
  } else if (child.exitCode == null) {
    console.warn(`[Travel Camera] 브라우저 자동 열기 전에 서버 응답을 확인하지 못했습니다. 직접 ${url} 을 열어 주세요.`);
  }

  const exitCode = await new Promise(resolveExit => {
    child.once('exit', code => resolveExit(code ?? 1));
  });
  process.exitCode = exitCode;
}

function assertSupportedNode() {
  const major = Number(process.versions.node.split('.')[0]);
  if (!Number.isInteger(major) || major < 24) {
    throw new Error(`Node.js 24 이상이 필요합니다. 현재 버전: ${process.versions.node}`);
  }
}

function updateMainSafely() {
  if (!commandAvailable('git', ['--version'])) {
    console.warn('[Travel Camera] Git을 찾지 못해 자동 업데이트를 건너뜁니다. 현재 파일로 실행합니다.');
    return;
  }
  if (!existsSync(join(root, '.git'))) {
    console.warn('[Travel Camera] Git 저장소가 아니므로 자동 업데이트를 건너뜁니다.');
    return;
  }

  const branch = capture('git', ['branch', '--show-current']);
  if (branch !== 'main') {
    console.log(`[Travel Camera] 현재 브랜치가 ${branch || '(detached HEAD)'} 이므로 자동 업데이트를 건너뜁니다.`);
    return;
  }

  const trackedChanges = capture('git', ['status', '--porcelain', '--untracked-files=no']);
  if (trackedChanges) {
    console.log('[Travel Camera] 추적 중인 로컬 수정이 있어 자동 업데이트를 건너뜁니다.');
    return;
  }

  console.log('[Travel Camera] GitHub main의 최신 변경을 확인합니다...');
  const result = run('git', ['pull', '--ff-only', 'origin', 'main'], { allowFailure: true });
  if (result.status !== 0) {
    console.warn('[Travel Camera] GitHub 업데이트에 실패했습니다. 기존 로컬 버전으로 계속 실행합니다.');
  }
}

function ensureDependencies() {
  const lockPath = join(root, 'package-lock.json');
  if (!existsSync(lockPath)) throw new Error('package-lock.json을 찾을 수 없습니다.');

  const markerPath = join(root, '.cache', 'launcher-package-lock.sha256');
  const lockHash = createHash('sha256').update(readFileSync(lockPath)).digest('hex');
  const markerHash = existsSync(markerPath) ? readFileSync(markerPath, 'utf8').trim() : '';
  const needsInstall = !existsSync(join(root, 'node_modules')) || markerHash !== lockHash;

  if (!needsInstall) {
    console.log('[Travel Camera] npm 의존성은 최신 상태입니다.');
    return;
  }

  console.log('[Travel Camera] package-lock 변경을 반영합니다 (npm ci)...');
  if (dryRun) {
    console.log('[Travel Camera] dry-run: npm ci 생략');
    return;
  }

  run(npmCommand, ['ci']);
  mkdirSync(dirname(markerPath), { recursive: true });
  writeFileSync(markerPath, `${lockHash}\n`, 'utf8');
}

function resolvePort(values, environmentPort) {
  const portIndex = values.findIndex(value => value === '--port');
  const candidate = Number(environmentPort || (portIndex >= 0 ? values[portIndex + 1] : 5517));
  return Number.isInteger(candidate) && candidate > 0 && candidate <= 65_535 ? candidate : 5517;
}

async function waitForServer(url, child) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) return false;
    try {
      const response = await fetch(url, {
        method: 'HEAD',
        signal: AbortSignal.timeout(800)
      });
      if (response.status > 0) return true;
    } catch {
      // Server startup is still in progress.
    }
    await delay(250);
  }
  return false;
}

function openBrowser(url) {
  let command;
  let openArgs;
  if (process.platform === 'win32') {
    command = 'cmd.exe';
    openArgs = ['/d', '/s', '/c', `start "" "${url}"`];
  } else if (process.platform === 'darwin') {
    command = 'open';
    openArgs = [url];
  } else {
    command = 'xdg-open';
    openArgs = [url];
  }

  try {
    const opener = spawn(command, openArgs, { detached: true, stdio: 'ignore', windowsHide: true });
    opener.unref();
    console.log('[Travel Camera] 브라우저를 열었습니다. 이 창을 닫거나 Ctrl+C를 누르면 서버가 종료됩니다.');
  } catch {
    console.warn(`[Travel Camera] 브라우저를 자동으로 열지 못했습니다. 직접 ${url} 을 열어 주세요.`);
  }
}

function commandAvailable(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { cwd: root, stdio: 'ignore', windowsHide: true });
  return !result.error && result.status === 0;
}

function capture(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.error || result.status !== 0) return '';
  return String(result.stdout || '').trim();
}

function run(command, commandArgs, options = {}) {
  if (dryRun) {
    console.log(`[Travel Camera] dry-run: ${command} ${commandArgs.join(' ')}`);
    return { status: 0 };
  }
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    windowsHide: false
  });
  if (result.error) {
    if (options.allowFailure) return { status: 1 };
    throw result.error;
  }
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`${command} ${commandArgs.join(' ')} 명령이 종료 코드 ${result.status}로 실패했습니다.`);
  }
  return { status: result.status ?? 1 };
}

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}
