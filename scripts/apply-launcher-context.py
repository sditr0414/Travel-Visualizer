from pathlib import Path

path = Path('AI_PROJECT_CONTEXT.md')
text = path.read_text(encoding='utf-8')

old_server = '- 서버: `127.0.0.1` 전용 Vite/정적 서버와 제한된 로컬 API\n'
new_server = old_server + '- Windows 개발 런처: 저장소 루트의 `TravelCamera.cmd` 또는 바탕 화면 바로가기가 `scripts/launch-local.mjs`를 실행한다. `main`이면서 추적 중인 로컬 수정이 없을 때만 `git pull --ff-only origin main`으로 안전하게 갱신하고, `package-lock.json` SHA-256이 마지막 실행과 달라졌거나 `node_modules`가 없을 때만 `npm ci`를 수행한 뒤 로컬 서버를 시작하고 브라우저를 연다. 다른 브랜치/로컬 수정/네트워크 실패에서는 업데이트를 건너뛰고 현재 작업 트리를 그대로 실행한다.\n'
if old_server not in text:
    raise SystemExit('server architecture marker missing')
text = text.replace(old_server, new_server, 1)

old_day = '- 사진 여정의 `날짜 변경 표시` 기본값은 **켜짐**이다. 켜져 있을 때만 `날짜 표시 시간` slider를 표시하며 현재 범위는 **1.0~3.5초**, 기본값은 **1.8초**다.'
new_day = '- 사진 여정의 `날짜 변경 표시` 기본값은 **켜짐**이다. 켜져 있을 때만 `날짜 표시 시간` slider를 표시하며 현재 범위는 **1.0~5.0초**, 기본값은 **2.5초**, step은 **0.5초**다.'
if old_day not in text:
    raise SystemExit('day marker contract marker missing')
text = text.replace(old_day, new_day, 1)

old_commands = '''```powershell
npm start
npm run verify
npm run test:e2e
npm run map:setup
```'''
new_commands = '''```powershell
npm run launch
npm run launch:no-update
npm start
npm run verify
npm run test:e2e
npm run map:setup
```'''
if old_commands not in text:
    raise SystemExit('commands marker missing')
text = text.replace(old_commands, new_commands, 1)

old_policy = '실제 데이터 없이 typecheck, lint, 단위·통합 테스트, build, 데스크톱·모바일 E2E가 모두 통과해야 합니다. 단, 사용자가 수정 단계에서 전체 테스트를 요청하지 않은 경우에는 관련 typecheck/단위 테스트만 먼저 실행하고 전체 verify/E2E는 별도 요청 시 진행합니다.'
new_policy = 'Windows의 일상 실행은 `TravelCamera.cmd` 또는 `npm run launch`를 우선 사용합니다. `npm run launch:no-update`는 개발 중 현재 브랜치/작업 트리를 그대로 실행하고 싶을 때 사용합니다. 실제 데이터 없이 typecheck, lint, 단위·통합 테스트, build, 데스크톱·모바일 E2E가 모두 통과해야 합니다. 단, 사용자가 수정 단계에서 전체 테스트를 요청하지 않은 경우에는 관련 typecheck/단위 테스트만 먼저 실행하고 전체 verify/E2E는 별도 요청 시 진행합니다.'
if old_policy not in text:
    raise SystemExit('test policy marker missing')
text = text.replace(old_policy, new_policy, 1)

path.write_text(text, encoding='utf-8')
