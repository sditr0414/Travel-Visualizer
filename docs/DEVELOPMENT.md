# 개발 안내

[프로그램 소개](../README.md) · [문서 목록](README.md) · [구현 계약](AI_PROJECT_CONTEXT.md)

## 환경과 실행

Node.js 24 이상을 사용합니다. React 19, TypeScript 5.9, Vite 8, MapLibre GL 6 기반이며 정확한 버전은 `package-lock.json`을 따릅니다.

```sh
npm ci
npm run dev
```

개발 서버는 `http://127.0.0.1:5517`에서 실행됩니다. 개인 원본 없이 테스트하려면 `npm run dev -- --no-local-data`를 사용하세요. 웹 배포 화면은 `npm run build:web` 후 `npm run preview:web`로 확인합니다. 로컬 서버용 배포 화면은 `npm start`로 실행합니다.

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
├── public/_headers           # 로컬 HTTP 헤더·웹 CSP의 정책 원본
├── server/index.mjs           # loopback 파일·장소·캐시 API
├── scripts/                   # 빌드 준비·런처·Windows 바로가기
├── src/                       # 앱 소스와 단위 테스트
├── e2e/                       # 브라우저 회귀 검사
├── docs/                      # 사용·개발 문서
│   ├── assets/screenshots/    # 기존 촬영 기록, 웹 배포 제외
│   ├── assets/demos/          # 기존 MP4·GIF 기록, 웹 배포 제외
│   └── archive/               # 보존 버전 기록
└── .github/workflows/         # CI
```

`dist/`, `dist-web/`, `node_modules/`, `.cache/`, `coverage/`, `test-results*/`, `playwright*-report/`는 생성물이며 커밋하지 않습니다. 최상위 TypeScript와 ESLint 파일은 편집기가 프로젝트를 자동으로 인식하도록 남겨둡니다.

서버·런처·빌드 준비 스크립트는 실행 위치가 아니라 자신의 파일 위치에서 저장소 루트를 찾습니다. 서버를 `server/`로 옮겨도 기본 개인 파일·캐시 위치는 바뀌지 않습니다. Windows 바로가기 설치 스크립트는 `scripts/`에 있고 실제 실행 대상 `TravelCamera.cmd`는 최상위에 있습니다.

## 소스 역할

| 경로 | 역할 |
| --- | --- |
| `src/App.tsx`, `src/ui/`, `src/settings/`, `src/projects/` | 파일 연결, UI, 도움말, 감상 설정 |
| `src/workers/`, `src/domain/` | 타임라인 분석, 기간 필터, 경로 계획, 이동 정보·요약 |
| `src/player/` | 모드별 독립 재생 세션, 시간·카메라 동기화 |
| `src/media/` | 촬영 정보, 대표 장면, 사진 목록, 미디어 전환 |
| `src/map/` | 지도 소스, MapLibre Worker, 경로 렌더링 |
| `src/types.ts` | 모듈 간 데이터 계약 |
| `server/index.mjs` | 로컬 원본 스트림·Range·메타데이터·장소 API |

기존 색상 토큰과 UI 골조를 유지합니다. 카메라와 재생 시간, 공백 구간, 요약 거리 계산을 변경하기 전에 [구현 계약](AI_PROJECT_CONTEXT.md)을 확인하세요.

## 검증 명령

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run test:runtime
npm audit --audit-level=high
# 위 다섯 검사를 한 번에 실행
npm run verify

npx playwright install --with-deps chromium firefox webkit
npm run test:e2e -- --workers=1
npm run test:web -- --workers=1
```

Vitest는 `config/vite.config.ts`, 로컬 E2E는 `config/playwright.config.ts`, 웹 E2E는 `config/playwright.web.config.ts`를 사용합니다. 개별 옵션은 npm 명령의 `--` 뒤에 전달합니다. TypeScript 프로젝트 참조는 최상위 `tsconfig.json`에서 연결합니다.

로컬 E2E는 개인 데이터 자동 연결을 끈 5518번 서버를 준비하고 데스크톱·모바일 Chromium에서 검사합니다. 웹 E2E는 Pages 빌드를 만든 뒤 `http://127.0.0.1:5521/Travel-Visualizer/`에서 데스크톱·모바일 Chromium, Firefox, WebKit을 검사합니다. Linux에서 브라우저 실행 라이브러리가 없으면 위 설치 명령의 `--with-deps`가 필요합니다.

웹 검사는 빈 첫 화면, 초기 지도·Worker 지연 로딩, 로컬 API 차단, 파일·사진 연결과 프로젝트 저장·복원, 잘못된 파일에서 복구, 지도 연결 실패·재연결과 WebGL 미지원 안내를 다룹니다. 개인 원본은 테스트 fixture에 넣지 않으며 테스트용 합성 데이터는 웹 빌드에 포함하지 않습니다.

CI는 다음 세 작업을 병렬로 실행합니다.

- `verify`: 타입·lint·단위·로컬 빌드·런타임 검사와 Chromium 회귀 검사.
- `runtime-windows`: Windows에서 로컬 빌드와 서버 시작·보안 헤더·포트 충돌 등 런타임 검사.
- `web`: Pages 빌드, 공개 파일 허용 목록 검사, 웹 브라우저 검사.

브라우저 로그와 보고서는 `browser-regression-evidence`, `web-regression-evidence` artifact에 3일간 보관합니다. 로컬 보고서는 각각 `playwright-report/`, `playwright-web-report/`에 생성됩니다. 검증 횟수와 최종 결과는 해당 커밋의 CI 기록을 기준으로 합니다. 자동 검사와 Windows·Android·iOS 실기기 동작은 구분하며 모든 장치의 고정 FPS를 보장하지 않습니다.

## 온라인 지도와 미리 불러오기

지도는 `src/map/map-style.ts`의 OpenFreeMap Positron 스타일만 사용합니다. PMTiles·설치 스크립트·지도 선택·지도 전용 로컬 API는 제거했습니다. 이전에 개인적으로 받은 지도 파일과 캐시는 자동으로 삭제하지 않습니다.

`PlayerController`는 약 1.4초 뒤의 경로 위치와 확대 수준, 전환 목적지를 `src/map/tile-warmup.ts`에 전달합니다. `MapStage`는 사용자 입력에 따른 `zoom` 이벤트를 연결해 확대·축소 방향의 다음 정수 단계를 준비합니다. 재생에 의한 카메라 갱신은 이 입력 처리에서 제외합니다.

- 320ms 간격, 동시에 2개, 한 번에 최대 36개를 낮은 우선순위로 요청합니다. 짧은 조작의 마지막 목적지도 예약해 처리합니다.
- 벡터·래스터의 타일 크기와 반올림을 MapLibre의 확대 단계 계산에 맞춥니다. 화면 중앙부터 주변 여유 영역을 요청하고, 중복을 제외한 뒤 수량을 제한해 다음 단계가 계속 밀리지 않도록 합니다.
- 본문 수신이 끝나야 완료로 취급합니다. 개별 요청은 4초 후 중단하고, 지도 제거 시 예약·진행 요청을 정리합니다. 완료한 요청은 45초 동안 중복 요청을 피하며 브라우저 HTTP 캐시의 보존 기간은 서버 응답 정책을 따릅니다.
- MapLibre의 `cancelPendingTileRequestsWhileZooming: false`와 `maxTileCacheZoomLevels: 8`을 유지합니다. 미리 불러온 데이터는 HTTP 캐시이고, 파싱·글꼴 처리·GPU 렌더링은 실제 지도 표시 시 이루어집니다. 비공개 MapLibre API나 숨겨진 두 번째 지도를 사용하지 않습니다.

실제 온라인 지도로 확대·축소 요청과 캐시 사용을 확인하고, 별도의 지연 응답 타일 서버에서는 확대·축소 목적지의 총 36개 타일을 미리 받은 후, 실제 MapLibre가 추가 네트워크 전송 없이 표시하는 것을 확인했습니다. 회귀 검사는 두 방향의 입력, 마지막 요청 보존, 큰 화면의 다음 단계 준비, 요청 중단을 포함합니다. 이 검증은 모든 회선에서 로딩 시간이 사라진다는 보장은 아닙니다.

## 웹 빌드와 배포

```sh
npm run build:web
npm run preview:web
# http://127.0.0.1:5521/Travel-Visualizer/
```

`build:web`는 TypeScript 검사 후 Vite의 `pages` 모드로 `dist-web/`을 생성합니다. 자산의 기준 경로는 `/Travel-Visualizer/`입니다. `test:web`도 같은 빌드를 준비하고 실제 하위 경로에서 검사합니다. Pages 모드는 `localhost`·`127.0.0.1`에서 실행해도 로컬 파일·장소 API를 호출하지 않습니다. 첫 화면에서는 지도 모듈과 타임라인 Worker를 불러오지 않고, 파일 선택·분석이 필요할 때 준비합니다.

`scripts/check-web-build.mjs`는 공개 파일을 `index.html`, `_headers`, `travel-camera.svg`, `assets/`의 JS·CSS·WOFF2로 제한합니다. 링크와 디렉터리 구조, 자산 경로, CSP도 확인합니다. 사진·영상·타임라인 원본, 샘플·미리보기, 문서·서버·캐시·테스트 결과를 `public/`이나 웹 빌드에 넣지 않습니다. 기존 `docs/assets/`와 `docs/MEDIA.md`는 저장소의 기록으로 보존하며 `dist-web/`에 포함하지 않습니다.

[Pages 워크플로](../.github/workflows/test.yml)는 `main` push의 `verify`, `runtime-windows`, `web`가 모두 성공한 뒤 테스트한 `dist-web/` artifact만 게시합니다. PR은 검증만 수행합니다. 저장소의 Pages source는 **GitHub Actions**를 사용하고 HTTPS를 적용합니다. `gh-pages` 브랜치는 만들지 않습니다. 실행 중인 main 배포는 끝까지 진행하고, 대기 중에는 최신 실행만 남깁니다. 배포 job에만 Pages 쓰기와 OIDC 권한을 부여합니다.

### 보안 정책

`public/_headers`가 정책 원본입니다. 로컬 프로덕션 서버는 HTTP 헤더로 적용합니다. GitHub Pages는 이 파일로 사용자 지정 응답 헤더를 설정하지 않으므로, 웹 빌드는 지원되는 CSP 지시문을 첫 스크립트보다 앞의 HTML `<meta>`에 넣습니다. 자체 코드·폰트·Worker·선택한 파일의 blob URL과 OpenFreeMap 요청을 허용하며, 인라인 스크립트와 eval은 차단합니다. 동적 화면 배치를 위해 인라인 스타일은 허용합니다.

`frame-ancestors`는 CSP meta에서 지원되지 않아 웹 빌드에서 제외합니다. `_headers`의 `X-Frame-Options`, `X-Content-Type-Options`, `Cross-Origin-Resource-Policy`, `Permissions-Policy`도 GitHub Pages에서 이 설정 파일을 통해 적용되지 않습니다. 프레임 삽입 방지와 해당 HTTP 헤더가 필요하면 응답 헤더를 설정할 수 있는 호스팅이 필요합니다. Referrer 제한은 별도의 HTML meta로 적용합니다. 지도 공급자를 변경하면 CSP 허용 출처도 갱신하세요.

### 로컬 서버용 빌드

`npm run build`의 결과는 `dist/`이며 로컬 서버용입니다. `npm start`의 `prestart`와 런처는 `scripts/ensure-build.mjs`를 실행합니다. 소스·공개 자산·설정·패키지 파일의 fingerprint가 달라졌거나 `dist/index.html`이 없으면 빌드하고 `.cache/production-build.sha256`에 기록합니다.

런처는 자식 서버의 listen 성공 IPC 메시지로 시작을 확인하며 다른 프로세스의 HTTP 200 응답으로 브라우저를 열지 않습니다. 개발 서버는 Vite HMR을 위해 별도의 기본 헤더만 적용합니다.

## 브랜치와 문서 관리

`main`은 현재 버전, `v3`는 UI 개선 전 `7dd7502`의 보존 브랜치입니다. 새 변경을 `v3`에 동기화하지 않습니다. `v1`·`v2`는 이전 버전 태그입니다.

README는 프로그램 소개로 유지합니다. 사용자 동작은 [사용 안내](USAGE.md), 파일·네트워크 동작은 [개인정보 문서](PRIVACY.md), 내부 계약은 [AI_PROJECT_CONTEXT.md](AI_PROJECT_CONTEXT.md)에 반영합니다. [v3 기록](archive/V3_RELEASE_NOTES.md)은 당시 상태로 보존합니다.

### 프로젝트 회귀 검사

`travel-project.test.ts`는 형식·날짜·설정 범위, SHA-256, 누락·수정·중복 사진과 제외 상태 재연결을 검사합니다. `project-roundtrip.spec.ts`는 데스크톱·모바일에서 실제 다운로드, 새로고침, 원본 재선택, 기간·설정·제외 상태·두 재생 위치 복원, 반복 복원, 잘못된 원본, 취소 후 기존 여행의 재생을 검사합니다. 원본 개인 자료는 테스트 fixture나 보고서 배포 대상에 넣지 않습니다.


촬영 시간대는 `capture-time.test.ts`에서 offset 없는 EXIF/QuickTime/파일명, 명시 offset 보존, Takeout epoch·파일 mtime, DST, cache 분리를 검사합니다. `photo-library.spec.ts`는 검색·날짜·제외·장면 이동·시간대 취소·프로젝트 복원을 데스크톱과 모바일에서 검사합니다. `video-copy.spec.ts`는 사본 UI의 명시적 시작·진행·닫기 취소를 검사하고 `video-conversion.test.mjs`는 임시 합성 영상으로 원본 hash·mtime, 사본 H.264·길이·metadata, 충돌 방지와 취소 정리를 검사합니다. FFmpeg가 없는 환경에서는 변환 runtime 검사만 조건부 제외합니다.

변환 도구 옵션은 [FFmpeg 공식 문서](https://ffmpeg.org/ffmpeg.html), 시간대 형식화는 [Intl.DateTimeFormat](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat)을 참고합니다. 앱의 변환 지원 여부와 각 실행 환경의 검증 결과는 구분합니다.
