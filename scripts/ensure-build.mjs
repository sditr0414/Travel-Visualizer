import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = createHash('sha256');
const inputs = ['src', 'public', 'config', 'index.html', 'package.json', 'package-lock.json', 'tsconfig.json'];
function collect(path) {
  if (!existsSync(path)) return;
  const files = readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const file of files) {
    const child = join(path, file.name);
    if (file.isDirectory()) collect(child);
    else if (file.isFile()) hash.update(child).update(readFileSync(child));
  }
}
for (const input of inputs) {
  const path = join(root, input);
  if (!existsSync(path)) continue;
  if (input === 'src' || input === 'public' || input === 'config') collect(path);
  else hash.update(input).update(readFileSync(path));
}
const fingerprint = hash.digest('hex');
const marker = join(root, '.cache', 'production-build.sha256');
if (!existsSync(join(root, 'dist', 'index.html')) || !existsSync(marker) || readFileSync(marker, 'utf8') !== fingerprint) {
  console.log('[Travel Camera] 배포 화면을 준비합니다. 처음 실행하거나 앱이 바뀐 경우에만 진행합니다.');
  const npmCli = process.env.npm_execpath;
  let result;
  if (npmCli?.endsWith('.js')) result = spawnSync(process.execPath, [npmCli, 'run', 'build'], { cwd: root, stdio: 'inherit' });
  else if (process.platform === 'win32') result = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd run build'], { cwd: root, stdio: 'inherit' });
  else result = spawnSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });
  if (result.error || result.status !== 0) { console.error('[Travel Camera] 화면 준비에 실패했습니다. Node.js 버전과 의존성 설치를 확인해 주세요.'); process.exit(1); }
  mkdirSync(dirname(marker), { recursive: true });
  writeFileSync(marker, fingerprint);
}
