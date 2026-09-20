# 개발 안내

[프로그램 소개](../README.md) · [문서 목록](README.md) · [구현 계약](AI_PROJECT_CONTEXT.md)

## 환경과 실행

Node.js 24 이상을 사용합니다. React 19, TypeScript 5.9, Vite 8, MapLibre GL 6 기반이며 정확한 버전은 `package-lock.json`을 따릅니다.

```sh
npm ci
npm run dev
```

개발 서버는 `http://127.0.0.1:5517`에서 실행됩니다. 배포 화면을 확인하려면 `npm start`를 사용합니다. 개인 원본 없이 테스트하려면 `npm run dev -- --no-local-data`로 실행하세요.

## 폴더 구조

```text
Travel-Visualizer/
├── README.md                 # 프로그램 소개
├── TravelCamera.cmd          # Windows 실행 진입점
├── package.json
├── package-lock.json
├── index.html
├── tsconfig.json              # 편집기·TypeScript 프로젝트 참조
├── eslint.config.js           # 편집기·ESLint 자동 탐색
├── config/                    # Vite·Vitest·Playwright·TS 세부 설정
├── server/index.mjs           # loopback 파일·지도·캐시 API
├── scripts/                   # 빌드 준비·런처·Windows 바로가기·지도 설치
├── src/                       # 앱 소스와 단위 테스트
├── e2e/                       # 브라우저 회귀 검사
├── maps/                      # 설치형 지도와 안내
├── docs/                      # 사용·개발 문서
│   ├── assets/screenshots/    # 공개 스크린샷
│   ├── assets/demos/          # 공개 MP4·GIF
│   └── archive/               # 보존 버전 기록
└── .github/workflows/         # CI
```

`dist/`, `node_modules/`, `.cache/`, `coverage/`, `test-results/`, `playwright-report/`는 생성물이며 커밋하지 않습니다. 최상위 TypeScript와 ESLint 파일은 편집기가 프로젝트를 자동으로 인식하도록 남겨둡니다.

서버·런처·빌드 준비 스크립트는 실행 위치가 아니라 자신의 파일 위치에서 저장소 루트를 찾습니다. 서버를 `server/`로 옮겨도 기본 개인 파일·지도·캐시 위치는 바뀌지 않습니다. Windows 바로가기 설치 스크립트는 `scripts/`에 있고 실제 실행 대상 `TravelCamera.cmd`는 최상위에 있습니다.

## 소스 역할

| 경로 | 역할 |
| --- | --- |
| `src/App.tsx`, `src/ui/`, `src/settings/` | 파일 연결, UI, 도움말, 감상 설정 |
| `src/workers/`, `src/domain/` | 타임라인 분석, 기간 필터, 경로 계획, 이동 정보·요약 |
| `src/player/` | 모드별 독립 재생 세션, 시간·카메라 동기화 |
| `src/media/` | 촬영 정보, 대표 장면, 사진 목록, 미디어 전환 |
| `src/map/` | 지도 소스, MapLibre Worker, 경로 렌더링 |
| `src/types.ts` | 모듈 간 데이터 계약 |
| `server/index.mjs` | 로컬 원본 스트림·Range·메타데이터·장소·glyph API |

기존 색상 토큰과 UI 골조를 유지합니다. 카메라와 재생 시간, 공백 구간, 요약 거리 계산을 변경하기 전에 [구현 계약](AI_PROJECT_CONTEXT.md)을 확인하세요.

## 검증 명령

```sh
npm run typecheck
npm run lint
npm test
npm run build
# 위 네 검사를 한 번에 실행
npm run verify

npx playwright install chromium
npm run test:e2e -- --workers=3
```

Vitest는 `config/vite.config.ts`, Playwright는 `config/playwright.config.ts`를 사용합니다. 개별 옵션은 npm 명령의 `--` 뒤에 전달합니다. TypeScript 프로젝트 참조는 최상위 `tsconfig.json`에서 연결합니다.

E2E는 개인 데이터 자동 연결을 끈 5518번 서버를 준비하고 데스크톱·모바일 Chromium에서 검사합니다. CPU·GPU 여유가 작은 PC에서는 worker 수를 줄이세요. CI는 1 worker로 실행하고 결과를 `browser-regression-evidence` artifact에 3일간 보관합니다.

현재 버전의 검증 기록은 아래와 같습니다.

- 타입 검사, ESLint, 단위 테스트 196개, 배포 빌드 통과.
- 데스크톱·모바일 Chromium 브라우저 회귀 검사 36개 통과, 환경별 중복·선택적 실제 파일 검사 6개 건너뜀.
- 다른 작업 폴더에서 개발 서버 실행, Vite 소스 응답, 개인 데이터 비활성 API, 런처 dry-run을 확인했습니다. Windows 바로가기는 경로 참조를 확인했으며 Windows 실기기 실행은 포함하지 않습니다.
- 문서 10개의 내부 파일 링크와 README의 이미지·GIF 렌더링을 확인했습니다. MP4 두 개는 1440×900·약 30초·60fps이며 브라우저 재생을 확인했습니다. 실제 캡처 프레임률은 [촬영 자료 안내](MEDIA.md)에 기록합니다.
- 일시정지 시 전체 경로 옵션의 기본 꺼짐·기존 설정 호환·저장·즉시 적용, 명시적 전체 경로와 처음·마지막 요약의 유지를 두 모드에서 검증했습니다. 실제 설정 화면은 1440×900과 390×844에서 확인했습니다.
- 로컬 PC의 실제 여행 기록·사진으로 두 감상 모드와 설정 화면을 촬영했습니다. 촬영은 전체 개인 파일의 호환성 검사와 구별합니다.

검증 범위는 변경 위험에 맞춥니다. 기존 검사를 재사용하고, 통과한 뒤 새 변경이나 우려 없이 반복하지 않습니다. Windows·Android·iOS 실기기 동작이나 모든 장치의 고정 FPS를 자동 검사 결과로 보장하지 않습니다.

## 빌드와 배포

`npm start`의 `prestart`와 런처는 `scripts/ensure-build.mjs`를 실행합니다. 소스·공개 자산·설정·패키지 파일의 fingerprint가 달라졌거나 `dist/index.html`이 없으면 빌드합니다. 결과 fingerprint는 `.cache/production-build.sha256`에 저장합니다.

브라우저 배포 결과는 `dist/`에 생성됩니다. HTTPS 정적 호스팅의 루트에 올리면 각 기기에서 타임라인과 사진을 직접 선택할 수 있습니다. 로컬 파일 자동 연결과 설치형 지도 API를 제공하는 Node 서버는 포함되지 않습니다. 이 저장소의 CI는 검증만 수행하며 사이트를 배포하지 않습니다.

## 브랜치와 문서 관리

`main`은 현재 버전, `v3`는 UI 개선 전 `7dd7502`의 보존 브랜치입니다. 새 변경을 `v3`에 동기화하지 않습니다. `v1`·`v2`는 이전 버전 태그입니다.

README는 프로그램 소개로 유지합니다. 사용자 동작은 [사용 안내](USAGE.md), 파일·네트워크 동작은 [개인정보 문서](PRIVACY.md), 내부 계약은 [AI_PROJECT_CONTEXT.md](AI_PROJECT_CONTEXT.md)에 반영합니다. [v3 기록](archive/V3_RELEASE_NOTES.md)은 당시 상태로 보존합니다.
