# AI Project Context — Travel Camera Visualizer v2

## Product

Google Timeline JSON과 로컬 사진·영상을 지도 위에서 시네마틱하게 재생하는 개인 로컬용 반응형 웹앱입니다. Google Photos나 외부 저장소를 사용하지 않습니다. 기본 데이터는 loopback 서버가 같은 PC의 브라우저에만 제공합니다.

## Current version

- `main`과 `v2` 태그: 현재 React/TypeScript 버전
- `v1` 태그: 이전 JavaScript 구현
- Node.js 24+, React 19, strict TypeScript, Vite 8

## Architecture

```text
Timeline file/text
  -> TimelineWorkerClient
  -> timeline.worker.ts
  -> timeline/planner domain
  -> PlaybackPlan
  -> PlayerController
  -> MapLibre sources and camera

Local media manifest
  -> sidecar/cache
  -> bounded embedded metadata scan (JPEG EXIF / MP4·MOV·M4V QuickTime)
  -> Timeline/GPS matching
  -> photo playback stops
```

- 앱 상태: `idle/loading/ready/planning/playing/paused/complete/error` reducer
- Timeline 파싱·계획: Web Worker
- 프레임 재생: React 밖의 `PlayerController`
- 지도: 온라인 OpenFreeMap 기본, PMTiles 코드는 선택 시 동적 로드
- 사진·영상: Takeout sidecar → JPEG EXIF / MP4·MOV·M4V QuickTime → 파일명 → 수정 시각
- QuickTime 스캔: 큰 영상 전체를 읽지 않고 앞·뒤 최대 1MB씩에서 Apple `creationdate`, `location.ISO6709`, `mvhd` 생성 시각을 확인
- 캐시: `.cache/media-metadata.json`, 파일 fingerprint와 parser version으로 무효화
- 서버: `127.0.0.1` 전용 Vite/정적 서버와 제한된 로컬 API

## Contracts

`src/types.ts`가 데이터 계약의 기준입니다.

- Timeline: `TimelineSource`, `TimelineScanResult`, `ParsedTrip`
- 계획: `AnalysisOptions`, `PlaybackPlan`, `PlaybackFrame`, `PlaybackStop`
- 미디어: `JourneyMedia`, `LocalMediaManifest`, `MediaMetadataRecord`
- 지도: `MapSourceConfig`, `MapStatus`
- Worker: `WorkerRequest`, `WorkerResponse`

Worker 요청은 `SCAN_TIMELINE`, `PLAN_TRIP`, `CANCEL`을 사용합니다. 플레이어의 핵심 제어는 `loadPlan`, `play`, `pause`, `seek`, `reset`, `dispose`이며 설정 동기화를 위한 `setStops`, `setLockToPosition`, `setTrackingSpeed`가 있습니다.

## Local API

- `GET /api/map-status`
- `GET|HEAD /api/local-timeline`
- `GET|HEAD /api/local-media-manifest`
- `GET|HEAD /api/local-media/:id` — Range 지원
- `POST /api/local-media-metadata-cache` — same-origin 전용
- `GET|HEAD /maps/*.pmtiles` — 허용된 두 파일만 Range 지원

기본 경로는 저장소 상위의 `타임라인.json`, `여행 사진`입니다. `TRAVEL_TIMELINE_PATH`, `TRAVEL_MEDIA_DIR`, `TRAVEL_METADATA_CACHE`, `PORT`로 바꿀 수 있습니다.

## UX invariants

- 전체 지도와 여행 경로가 첫 화면의 중심이다.
- 경로 재생 길이의 기본값은 해당 여행에 계산된 최소·최대 재생 시간의 중간값을 5초 단위로 맞춘 값으로 사용한다. 사용자가 직접 값을 바꾸면 그 값을 우선한다.
- 재생 컨트롤은 하단에 두되 사진 여정에서는 지도 영역 안에 배치한다. 데스크톱 재생 중에는 자동으로 숨기고 지도 하단에 포인터가 접근하거나 키보드 포커스가 오면 표시하며, 터치 화면에서는 항상 표시한다.
- 상단 바와 접힌 여행 설정도 데스크톱 재생 중에는 자동으로 숨기고 해당 영역에 포인터가 접근하거나 키보드 포커스가 오거나 설정 패널이 열려 있으면 다시 표시한다. 터치 화면에서는 항상 표시한다.
- 사진 여정에 들어갈 때 경로 영역은 허용된 최소 크기(데스크톱 38%, 모바일 34%)로 시작하고 사용자가 분할 핸들로 다시 확장할 수 있다.
- 접힌 여행 설정 버튼은 사진을 가리지 않도록 상단 바 높이에 두고, Timeline 선택 버튼과 시각적으로 분리된 간격을 유지한다.
- 모바일에서도 지도와 핵심 조작을 우선한다.
- 상단 조작과 설정 패널은 데스크톱에서 12~16px 중심의 읽기 크기를 사용하고, 모바일에서는 공간을 고려해 11~13px 중심으로 조정한다. 입력·선택·주요 버튼 높이는 40px 이상을 유지한다.
- AUTO 카메라를 기본으로 유지하고 검증된 카메라 계산을 임의로 단순화하지 않는다. `PlayerController`는 계획된 프레임 사이의 위치·센터·줌을 시간 비율로 보간해 경로 이동을 연속적으로 보여주며, 항공 구간은 같은 scene과 이동 수단 안에서 가장 넓은 화면을 보장하는 줌 값을 유지해 비행 중 반복적인 줌인·줌아웃이 발생하지 않게 한다.
- 정지 상태에서만 휠 확대를 허용한다.
- 지도 출처 정보는 법적 표기용 버튼만 남기고 기본 접힘 상태로 유지한다.
- 기본 지도 확대는 사용자 설정 `+0.7`이며, 사진 여정에서는 미디어 표시 여부와 무관하게 더 가까운 줌을 사용하고 30km 이하 이동 구간을 거리별로 추가 확대한다. 항공 구간은 추가 확대하지 않는다.
- 재생 전·일시정지에는 전체 경로, 재생 중에는 진행 경로를 표시한다.
- 사진 여정 영역은 그라데이션 없이 균형 잡힌 단색 차콜(`#272b2f`)을 사용한다. 별도 현재 장면 HUD는 표시하지 않고, 사진·영상이 활성화되지 않은 이동 구간에는 이동 수단 픽토그램과 일상적인 수단명(`도보`, `자전거`, `대중교통`, `기차`, `페리`, `비행기`, `차량`)을 함께 표시한다. 픽토그램과 날짜는 같은 윗줄, 이동 수단명과 `출발 → 도착`은 같은 아랫줄에 두며 날짜 아래 속도와 충분한 간격을 둔다. 속도와 출발·도착 텍스트는 보조 정보지만 한눈에 읽을 수 있는 크기를 유지한다. 지도에 시/도시급 출발·도착 라벨이 모두 확인될 때만 `출발 → 도착`을 표시하고 구·동·좌표는 이동 구간 라벨에 사용하지 않는다.
- 사진·영상은 불필요한 중첩 카드 프레임 없이 미디어 영역을 최대한 사용한다. 사진 아래에는 별도 `날짜`·`장소` 필드명이나 장소 아이콘을 두지 않고 `장소 → 촬영 날짜·시각` 순서로 같은 기준선에 가깝게 표시하며 시각은 `11시 11분`처럼 한국어 단위를 쓴다. 장소와 시각은 서로 붙어 보이지 않도록 충분한 가로 간격을 두고, 캡션 글자는 작은 보조 텍스트처럼 보이지 않도록 한 단계 크게 유지한다. 캡션은 사진 하단과 패널 최하단 사이의 가운데보다 약간 위쪽에 놓는다. 장소는 한국의 시·구, 일본의 시·구, 기타 국가의 도시·구역에 준하는 수준까지만 보여주며 읍·면·동·리·마을·도로처럼 지나치게 세부적인 이름은 주변 도시명으로 축약한다.
- 사진·영상과 이동 픽토그램 전환은 이전 장면과 다음 장면을 실제로 동시에 유지하는 cross-fade로 처리한다. 전환 길이는 직전 장면이 실제 화면에 머문 시간의 약 10%를 기준으로 계산한다. 일반 사진·영상 전환은 80~900ms 범위, 이동 픽토그램은 빠른 수단 변경을 방해하지 않도록 16~320ms 범위로 제한한다. 이동 장면의 identity는 이동 수단 자체만 사용해 출발·도착 텍스트가 늦게 해석되거나 바뀌는 것만으로 cross-fade를 다시 시작하지 않으며, `prefers-reduced-motion`을 존중한다.
- 두 미디어 stop 사이의 경로 시간이 짧으면 이동 픽토그램을 잠깐 삽입하지 않고 직전 사진·영상을 그대로 유지하면서 지도 경로 재생은 계속 진행한 뒤 다음 미디어로 직접 전환한다. 짧은 구간 기준은 인접 미디어 표시 시간의 2배이며 2.5~8초 사이로 제한하고, 그보다 긴 구간에서만 이동 픽토그램을 표시한다.
- 영상은 사진 여정에서 기본적으로 자동 재생을 선택한다. 소리는 별도 설정으로 켤 수 있으며 기본은 음소거로 두어 브라우저 자동 재생 정책과 갑작스러운 음성 재생을 피한다. 영상 자체 조작 UI는 포인터 접근 또는 키보드 포커스 때 표시한다.
- `src/ux-polish.css`는 `src/styles.css` 뒤에서 로드되는 후행 오버라이드이므로 `MediaJourneyPane`의 현재 클래스 구조와 항상 함께 갱신한다. 제거된 예전 구조(`media-caption-item`, `movement-meta` 등)를 대상으로 한 규칙을 남겨 현재 레이아웃을 다시 덮어쓰지 않는다.
- `prefers-reduced-motion`과 키보드 조작을 유지한다.
- 기존 시각 스타일을 수정할 때는 정보 위계와 조작성을 우선한다.

## Privacy and repository rules

- Timeline과 사진은 외부로 업로드하지 않는다.
- 서버 바인딩은 `127.0.0.1`을 유지한다.
- Google Photos API·OAuth를 추가하지 않는다.
- Timeline, 사진, PMTiles, `.env`, OAuth secret, `.cache`를 커밋하지 않는다.
- 저장소는 과거 위치 fixture 이력 때문에 비공개 상태를 유지한다.

## Known limitations

- WebM 영상의 내부 촬영 시각과 GPS 파싱은 미구현이다.
- MP4·MOV·M4V는 앞·뒤 제한 범위의 일반적인 QuickTime 메타데이터만 읽으므로 메타데이터가 매우 큰 `moov` 중간에만 있는 특이한 파일은 파일명·수정 시각으로 fallback할 수 있다.
- JPEG 이외 이미지의 내장 위치 메타데이터는 아직 읽지 않는다.
- 영상 내보내기, PWA, 네이티브 앱은 범위 밖이다.
- 로컬 49MB Timeline 검증은 파일을 커밋하지 않고 `REAL_TIMELINE_JSON` 환경 변수로 수행한다.
- Playwright 서버는 `--no-local-data`로 개인 기본 파일의 자동 로드를 차단한다.

## Commands

```powershell
npm start
npm run verify
npm run test:e2e
npm run map:setup
```

실제 데이터 없이 typecheck, lint, 단위·통합 테스트, build, 데스크톱·모바일 E2E가 모두 통과해야 합니다.
