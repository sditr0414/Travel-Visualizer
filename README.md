# Travel Camera Visualizer v2

개인 Google Timeline과 로컬 사진·영상을 지도 위에서 재생하는 로컬 우선 반응형 웹앱입니다. Google Photos API나 OAuth 없이 이 PC의 파일만 사용합니다.

## 빠른 시작

Node.js 24 이상이 필요합니다.

```powershell
npm ci
npm start
```

브라우저에서 `http://127.0.0.1:5517`을 엽니다. 기본값은 다음과 같습니다.

| 데이터 | 기본 위치 |
| --- | --- |
| Timeline | 저장소 상위 폴더의 `타임라인.json` |
| 사진·영상 | 저장소 상위 폴더의 `여행 사진` |
| 메타데이터 캐시 | 저장소의 `.cache/media-metadata.json` |

현재 작업 폴더에서는 각각 `E:\travel-camera-visualizer\타임라인.json`, `E:\travel-camera-visualizer\여행 사진`에 해당합니다. 기본 파일이 없으면 앱의 파일·폴더 선택기를 사용합니다.

다른 위치를 기본값으로 사용하려면 실행 전에 지정합니다.

```powershell
$env:TRAVEL_TIMELINE_PATH = 'D:\My Travel\timeline.json'
$env:TRAVEL_MEDIA_DIR = 'D:\My Travel\photos'
npm start
```

기본 포트를 바꾸려면 `npm start -- --port 5520` 또는 `$env:PORT=5520`을 사용합니다.

## 주요 기능

- Timeline 파싱과 재생 계획 계산을 Web Worker에서 수행
- 복원된 AUTO 카메라와 DAY·SEGMENT 카메라 선택
- 온라인 OpenFreeMap 기본, 로컬 PMTiles 선택 가능
- 재생 전·일시정지에는 전체 경로 표시, 재생 중에는 진행 경로에 집중
- 사진 전체 보기와 대표 장면 미리보기
- 사진·영상 표시 시간, 항공 포함 여부, 재생 길이, 화면 분할 조절
- 재생 중 지도 휠 확대 방지, 정지 상태에서는 직접 확대·축소 가능

Timeline과 사진은 외부 서비스로 전송되지 않습니다. 자동 경로를 사용할 때는 `127.0.0.1`에 바인딩된 로컬 서버가 파일을 같은 PC의 브라우저에 제공합니다.

## 사진 메타데이터와 캐시

메타데이터는 다음 순서로 결합합니다.

1. Google Takeout sidecar의 촬영 시각·GPS
2. JPEG EXIF의 촬영 시각·GPS
3. 파일명에 포함된 촬영 시각
4. 파일 수정 시각

Sidecar에 GPS가 없고 EXIF에 GPS가 있으면 두 정보를 결합합니다. 최초 분석에서는 JPEG 전체가 아니라 최대 256KB의 헤더만 읽습니다. 결과는 `.cache/media-metadata.json`에 저장하며 파일 크기·수정 시각 또는 파서 버전이 바뀐 항목만 다시 분석합니다. 캐시와 원본 데이터는 `.gitignore`에서 제외됩니다.

현재 MP4·MOV 등 영상의 내부 촬영 시각과 GPS는 아직 분석하지 않습니다. Sidecar 또는 파일명 시각을 사용하고, 둘 다 없으면 수정 시각을 사용합니다.

## 지도

온라인 지도가 기본값입니다. 오프라인 지도가 필요하면 다음 명령으로 PMTiles를 준비합니다.

```powershell
npm run map:setup
```

준비 후 설정에서 **로컬 PMTiles**를 선택합니다. 로컬 지도 전용 코드는 선택할 때만 로드됩니다.

## 구조

- `src/workers/timeline.worker.ts`: Timeline 스캔·계획 Worker
- `src/player/player-controller.ts`: React 밖의 프레임 재생과 지도 갱신
- `src/media/`: sidecar·EXIF 분석, Timeline 매칭, 사진 여정 구성
- `src/map/`: MapLibre와 온라인·PMTiles 지도 스타일
- `server.mjs`: 로컬 정적 서버, Timeline·미디어·PMTiles Range 제공, 메타데이터 캐시

로컬 서버의 API는 `/api/map-status`, `/api/local-timeline`, `/api/local-media-manifest`, `/api/local-media/:id`, `/api/local-media-metadata-cache`로 제한됩니다.

## 검증

```powershell
npm run verify
npm run test:e2e
```

`verify`는 typecheck, lint, 단위·통합 테스트, 프로덕션 빌드를 순서대로 실행합니다. E2E는 데스크톱과 모바일 viewport에서 계획·재생·일시정지·탐색 흐름을 확인합니다.

## 버전과 개인정보

- `main`, `v2`: 현재 React/TypeScript 재구축 버전
- `v1`: 이전 JavaScript 버전 보존 태그
- Google Photos API·OAuth, 영상 내보내기, PWA, 네이티브 앱은 현재 범위 밖입니다.
- Timeline, 사진, PMTiles, 환경 파일, OAuth secret, 메타데이터 캐시는 커밋하지 않습니다.
- 과거 Git 이력에는 위치 fixture가 남아 있으므로 저장소를 공개하려면 이력 정리가 별도로 필요합니다.
