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
  -> route PlayerController / photo PlayerController
  -> MapLibre sources and camera

Local media manifest
  -> sidecar/cache
  -> bounded embedded metadata scan (JPEG EXIF / MP4·MOV·M4V QuickTime)
  -> Timeline/GPS matching
  -> photo playback stops
  -> bounded media preload buffer
  -> MediaJourneyPane scene transition
```

- 앱 상태: `idle/loading/ready/planning/playing/paused/complete/error` reducer
- Timeline 파싱·계획: Web Worker
- 프레임 재생: React 밖의 `PlayerController`; 발자취와 사진 여정은 같은 MapLibre 지도를 공유하되 서로 다른 controller 인스턴스를 사용
- 발자취/사진 여정 재생 커서: `App`이 모드별 controller와 위치를 별도 보관하고 활성 모드 전환 시 해당 위치만 복원
- 재생 길이 계획: `camera-planner.js`가 선택 기간, 실제 이동 거리, 지리적 이동 범위(extent), 활동일 수, 이동 구간 수를 함께 사용해 `DurationLimits`의 최소/추천/최대 길이를 계산한다. 기간은 로그 스케일로 완만하게 반영하고 지리적 범위를 더 강하게 반영해 장기간 좁은 지역 여행도 짧게 압축할 수 있다.
- playback chrome 표시 상태: `src/ui/playback-chrome.ts`의 React hook이 포인터·키보드·설정 열림 상태와 지연 시간을 조정
- 지도: 온라인 OpenFreeMap 기본, PMTiles 코드는 선택 시 동적 로드
- 사진·영상: Takeout sidecar → JPEG EXIF / MP4·MOV·M4V QuickTime → 파일명 → 수정 시각
- 위치 라벨: 이동 출발·도착은 `src/map/city-label.ts`, 사진 위치는 `src/map/photo-place-label.ts`가 이미 로드된 벡터 타일의 place 데이터를 사용해 해석한다. 모든 사용자 표시 위치의 최대 세분도는 시/도시 → 구/ward이며 군·읍·면·동·리·町·村 등 더 작은 행정/생활권 단위는 출력하지 않는다. 사진 위치는 충분히 가까운 시급 feature가 없으면 다른 도시를 빌려 쓰지 않고 해석 실패로 처리한다. 외부 reverse-geocoding 서비스로 좌표를 보내지 않는다.
- 미디어 위치 매칭: GPS가 없는 미디어는 촬영 시각을 route-time에 매핑하고 해당 시점의 TRAVEL frame 위치를 사용한다. 촬영 시각이 이동 종료 시각과 정확히 겹쳐 frame rounding이 OUTRO로 넘어가더라도 가장 가까운 직전 TRAVEL frame을 사용해 여행 시작점으로 잘못 되돌아가지 않는다.
- 미디어 사전 로드: `MediaJourneyPane`가 현재 위치를 기준으로 현재/다음 미디어 최대 5개를 제한된 창으로 미리 준비한다. 이미지는 load 후 `decode()`까지, 자동 재생 영상은 `loadeddata`까지 준비한 뒤 장면 전환에 사용한다. 로컬 `File`의 object URL은 이 사전 로드 창이 소유하고 창에서 빠질 때 revoke한다.
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

Worker 요청은 `SCAN_TIMELINE`, `PLAN_TRIP`, `CANCEL`을 사용합니다. 플레이어의 핵심 제어는 `loadPlan`, `play`, `pause`, `seek`, `reset`, `dispose`이며 설정 동기화를 위한 `setStops`, `setLockToPosition`, `setTrackingSpeed`가 있습니다. `setStops`는 사진 stop 추가·제거·길이 변경 시 현재 경로 진행 위치를 보존하고, 같은 stop의 길이만 바뀌면 해당 stop 내부의 진행 비율도 보존합니다. `DurationLimits`는 `minSeconds/recommendedSeconds/maxSeconds` 외에 계산 근거인 `days`, `activeDays`, `distanceKm`, `extentKm`, `movementCount`를 보관합니다.

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
- **경로 재생 길이의 최소·추천·최대는 고정값이 아니다.** 선택한 여행 기간, 실제 이동 거리, 지리적 이동 범위, 활동일 수와 이동 구간 수를 함께 사용한다. 달력 기간은 로그 스케일로 완만하게 반영하고 지리적 범위를 더 강하게 반영하므로, 예를 들어 2026-07-20~2026-08-05처럼 긴 기간이라도 한 도시권 안에서 반복 이동한 경우 최소 재생 길이는 30~40초대까지 내려갈 수 있다. 반대로 국가/도시를 크게 가로지르는 여행은 최소·추천·최대가 모두 증가한다. 자동 기본값은 최소/최대의 단순 중간값이 아니라 계산된 `recommendedSeconds`를 사용한다. 사용자가 재생 길이 슬라이더를 직접 조정하지 않은 상태에서는 기간을 바꾸고 재계획할 때 추천 길이를 다시 계산하며, 직접 조정한 값은 새 최소·최대 범위 안에서 최대한 유지한다.
- 발자취와 사진 여정은 같은 지도와 계획 데이터를 공유하지만 **서로 다른 `PlayerController` 재생 세션**이다. 한 모드에서 재생하거나 탐색해도 다른 controller는 일시정지 상태이며 다른 모드의 커서는 진행하지 않는다. `발자취 ↔ 사진 여정` 전환 시 현재 controller를 즉시 일시정지하고 현재 커서를 저장한 뒤, 대상 controller가 마지막으로 저장한 커서를 복원한다. 새 Timeline/계획으로 교체되면 두 controller와 두 커서를 모두 0으로 초기화한다. 단, 사용자가 현재 탭에서 `경로 다시 만들기`를 실행했을 때 미디어 재연결 때문에 다른 탭으로 강제 전환하지 않고 현재 발자취/사진 여정 탭을 유지한다.
- 재생 컨트롤은 하단에 두되 사진 여정에서는 지도 영역 안에 배치한다. 데스크톱 재생 중에는 상단 바·접힌 여행 설정·하단 재생바를 하나의 playback chrome으로 취급해 함께 숨긴다. **발자취 모드의 현재 이동수단 HUD는 사진 여정에서 대체하기 어려운 정보이므로 playback chrome과 별개로 항상 표시한다.** playback chrome은 CSS `:has()` hover 판정이 아니라 React 상태로 통합 관리한다. 재생을 누른 직후 약 900ms 동안은 보인 뒤 숨김을 시작하고, 하단 재생바의 reveal target은 **숨기기 전 재생바와 같은 위치·폭·높이의 footprint**만 사용한다. 사용자가 재생바가 있던 자리에 포인터를 약 220ms 올리거나 키보드 포커스가 오면 숨겨진 playback chrome을 복원하며, 그 footprint 밖의 넓은 하단 영역은 reveal target으로 사용하지 않는다. reveal target에 들어온 뒤의 미세한 포인터 움직임은 dwell 타이머를 다시 시작하지 않으며, 영역을 벗어날 때만 대기 중 reveal을 취소한다. 포인터가 모든 chrome에서 벗어난 뒤에는 약 650ms 기다렸다 다시 숨긴다. 설정 패널이 열려 있는 동안은 항상 표시하며 터치 화면에서도 항상 표시한다.
- playback chrome의 숨김·복원은 blur 없이 opacity와 작은 translate/scale을 약 320~360ms easing으로 함께 처리해 상태 변화가 눈에 보이면서도 지도를 방해하지 않게 한다. playback chrome에 적용하는 일회성 입장 keyframe은 종료 뒤 `opacity`나 `transform`을 유지하는 fill mode를 사용하지 않아 React의 visible/hidden 상태가 최종 스타일을 소유하게 한다. 중앙 정렬 상태 카드처럼 기본 transform이 위치를 결정하는 UI는 입장 keyframe에서 그 transform을 덮지 않는다. 버튼·선택·설정 패널·카드형 상태 UI도 hover/focus/press/open 상태에 절제된 이동·색·테두리·그림자 애니메이션을 사용한다. 모든 모션은 `prefers-reduced-motion`을 존중한다.
- 여행 기간 설정은 하나의 `여행 기간` 그룹으로 묶고 현재 선택 범위를 한 줄로 보여준다. `추천 기간`과 Timeline 전체 범위를 즉시 선택하는 `전체 기간` 프리셋을 제공한다. 시작일과 마지막 날은 좁은 3열 구조가 아니라 **서로 같은 폭의 전체 너비 2행**으로 배치한다. native date input의 날짜 텍스트는 키보드로 직접 수정할 수 있고 달력 indicator의 클릭 영역도 넉넉하게 유지한다. 설정 패널의 주요 라벨·입력·버튼은 작은 보조 텍스트가 되지 않도록 한 단계 크게 유지한다.
- 발자취/사진 여정의 설정 패널은 scrollbar 유무 때문에 실제 콘텐츠 폭이 달라지지 않도록 `scrollbar-gutter: stable`을 사용해 scrollbar 공간을 예약한다.
- 사진 여정의 `사진 표시 범위` 기본값은 **미리보기**이며 사용자가 필요할 때 전체 보기로 바꾼다.
- 사진 여정에 들어갈 때 경로 영역은 허용된 최소 크기(데스크톱 38%, 모바일 34%)로 시작하고 사용자가 분할 핸들로 다시 확장할 수 있다.
- 접힌 여행 설정 버튼은 사진을 가리지 않도록 상단 바 높이에 두고, Timeline 선택 버튼과 시각적으로 분리된 간격을 유지한다.
- 모바일에서도 지도와 핵심 조작을 우선한다.
- 상단 조작과 설정 패널은 데스크톱에서 12~16px 중심의 읽기 크기를 사용하고, 모바일에서는 공간을 고려해 11~13px 중심으로 조정한다. 입력·선택·주요 버튼 높이는 40px 이상을 유지한다.
- AUTO 카메라를 기본으로 유지하고 검증된 카메라 계산을 임의로 단순화하지 않는다. `PlayerController`는 계획된 프레임 사이의 위치·센터·줌을 시간 비율로 보간해 경로 이동을 연속적으로 보여준다. 이동수단별 목표 줌 차이는 허용하지만 `camera-modes.js`의 최종 줌 궤적은 앞쪽 zoom-out을 미리 예측하고 속도/가속도를 제한하며, 작은 반대 방향 요청은 약 0.7~1초 지속되기 전에는 방향을 뒤집지 않는다. 가속도 제한 단계는 현재 목표 줌을 지나쳐 overshoot하지 않으며, 목표를 통과한 뒤 되돌아오는 ringing을 만들지 않는다. 따라서 짧은 구간에서 `줌아웃 → 줌인 → 줌아웃`을 반복하지 않는다. `PlayerController`도 사진 여정 거리 확대와 항공 고정 줌까지 적용된 최종 값을 MapLibre에 보내기 직전에 저속 추종으로 한 번 더 평활화하며, 안전한 화면 확보가 필요한 줌아웃은 줌인보다 약간 빠르게 허용한다. 수동 seek/reset은 사용자가 요청한 위치를 즉시 보여주기 위해 이 최종 추종 상태를 초기화한다. 항공 구간은 같은 scene과 이동 수단 안에서 가장 넓은 화면을 보장하는 줌 값을 유지한다.
- 정지 상태에서만 휠 확대를 허용한다.
- 지도 출처 정보는 법적 표기용 버튼만 남기고 기본 접힘 상태로 유지한다.
- 기본 지도 확대는 사용자 설정 `+0.7`이며, 사진 여정에서는 미디어 표시 여부와 무관하게 더 가까운 줌을 사용하고 30km 이하 이동 구간을 거리별로 추가 확대한다. 이 추가 확대는 2/8/30km 계단식 값이 아니라 거리 증가에 따라 연속적으로 감소하는 곡선을 사용해 구간 경계에서 줌이 튀지 않게 한다. 항공 구간은 추가 확대하지 않는다.
- 재생 전·일시정지에는 전체 경로, 재생 중에는 진행 경로를 표시한다.
- 사진 여정 영역은 그라데이션 없이 균형 잡힌 단색 차콜(`#272b2f`)을 사용한다. 별도 현재 장면 HUD는 표시하지 않고, 사진·영상이 활성화되지 않은 이동 구간에는 이동 수단 픽토그램과 일상적인 수단명(`도보`, `자전거`, `대중교통`, `기차`, `페리`, `비행기`, `차량`)을 함께 표시한다. 이동 정보는 **날짜 → 속도 → 이동수단/출발→도착**의 세 세로 단계로 정렬해 속도가 날짜와 출발·도착 사이의 시각적 중앙에 오도록 한다. 이동 수단명과 `출발 → 도착`은 같은 아랫줄에 놓고 서로 같은 중심선/베이스라인으로 정렬한다. 속도와 출발·도착 텍스트는 보조 정보지만 한눈에 읽을 수 있는 크기를 유지한다. 출발·도착 라벨은 현재 city resolver가 확인한 시/도시급 이름만 사용하고 `군·읍·면·동·리` 또는 좌표는 절대 표시하지 않는다. 따라서 `고촌읍 → 북도면`처럼 지도에서 town으로 분류된 하위 단위가 이동 경로명으로 승격되어서는 안 되며, 유효한 시급 라벨을 찾지 못한 쪽이 있으면 `출발 → 도착` 자체를 생략한다.
- 사진·영상은 불필요한 중첩 카드 프레임 없이 미디어 영역을 최대한 사용한다. 사진 아래에는 별도 `날짜`·`장소` 필드명이나 장소 아이콘을 두지 않고 `장소 → 촬영 날짜·시각` 순서로 같은 기준선에 가깝게 표시하며 시각은 `11시 11분`처럼 한국어 단위를 쓴다. 장소와 시각은 서로 붙어 보이지 않도록 충분한 가로 간격을 두고, 캡션 글자는 작은 보조 텍스트처럼 보이지 않도록 한 단계 크게 유지한다. 캡션의 세로 중심은 사진 프레임 하단과 패널 최하단 사이의 중앙에 맞추고, 사진 모드 재생 UI는 슬라이더가 아니라 **재생 UI 박스 전체의 세로 중심**이 캡션 중심선과 같은 높이에 오도록 함께 조정한다. 장소는 사진의 `matchedLat/matchedLng`를 별도 위치 해석 입력으로 사용해 현재 로드된 벡터 타일의 place feature에서 **시/도시 → 구/ward까지만** 보여준다. `군·읍·면·동·리·町·村·丁目`처럼 더 작은 단위는 지도 스타일이 `town`, `municipality`, `suburb` 등으로 분류하더라도 출력하지 않는다. 구/ward 라벨은 사진 좌표에 충분히 가까워 해당 구일 가능성이 높은 경우에만 시와 결합한다. 사진용 city resolver도 보수적인 근거리 범위(현재 최대 약 45km) 안의 시급 feature만 인정하며 그 범위에 유효한 도시가 없으면 더 멀리 있는 도시를 임의로 가져오지 않는다. 위치를 해석하지 못하거나 좌표/하위 지명만 얻은 경우에는 원시 좌표나 주변 이동 경로의 도시명을 억지로 대신 사용하지 않고 **`알 수 없음`**으로 표시한다. 이 해석을 위해 사진 좌표를 외부 reverse-geocoding API로 전송하지 않는다.
- 사진·영상 전환은 이전 장면 DOM과 다음 장면 DOM을 실제로 동시에 유지하는 keyed cross-dissolve로 처리한다. 사진 전환은 위치 이동 없이 opacity와 매우 작은 scale만 사용하고, 사진 표시 시간이 달라도 체감이 크게 흔들리지 않도록 약 420~540ms 범위에서 완만하게 시간 영향을 받는다. 이동 픽토그램은 빠른 수단 변경을 방해하지 않도록 직전 실제 표시 시간의 약 10%를 사용하되 16~320ms 범위로 제한한다. 이동 장면의 identity는 이동 수단 자체만 사용해 출발·도착 텍스트가 늦게 해석되거나 바뀌는 것만으로 cross-fade를 다시 시작하지 않으며, `prefers-reduced-motion`을 존중한다.
- 사진·영상 장면은 재생 위치가 도달하기 전에 **현재 미디어와 다음 4개를 제한된 사전 로드 창에서 준비**한다. 이미지는 네트워크/파일 load와 `decode()`가 끝나야 ready로 보고, 자동 재생 영상은 첫 프레임을 그릴 수 있는 `loadeddata`, 대표 장면 모드는 metadata 준비를 기준으로 한다. 대상 미디어가 아직 loading이면 현재 사진 또는 이동 픽토그램을 그대로 유지하고 빈 미디어 프레임으로 먼저 전환하지 않는다. 준비가 끝난 시점에 기존 keyed cross-dissolve를 시작한다. 미지원·손상 파일 때문에 화면이 영구 정지하지 않도록 한 자산의 준비 대기는 최대 6초로 제한하며, 이후에는 기존 미디어 오류 UI가 처리할 수 있게 장면 진입을 허용한다. 사전 로드 창에서 벗어난 로컬 `File` object URL과 detached preload element는 즉시 정리한다.
- 두 미디어 stop 사이의 경로 시간이 짧으면 이동 픽토그램을 잠깐 삽입하지 않고 직전 사진·영상을 그대로 유지하면서 지도 경로 재생은 계속 진행한 뒤 다음 미디어로 직접 전환한다. 짧은 구간 기준은 인접 미디어 표시 시간의 2배이며 2.5~8초 사이로 제한하고, 그보다 긴 구간에서만 이동 픽토그램을 표시한다.
- 영상은 사진 여정에서 기본적으로 자동 재생을 선택한다. 소리는 별도 설정으로 켤 수 있으며 기본은 음소거로 두어 브라우저 자동 재생 정책과 갑작스러운 음성 재생을 피한다. 영상 자체 조작 UI는 포인터 접근 또는 키보드 포커스 때 표시한다.
- `src/ux-polish.css`는 `src/styles.css` 뒤에서 로드되는 후행 오버라이드이므로 `MediaJourneyPane`의 현재 클래스 구조와 항상 함께 갱신한다. `src/styles.css`에는 현재 구조의 기본 레이아웃만 두고, 제거된 예전 구조(`media-caption-divider`, `movement-identity`, `movement-details`, 구형 playback hover reveal 등)의 selector를 남겨 후행 규칙과 경쟁시키지 않는다.
- `prefers-reduced-motion`과 키보드 조작을 유지한다.
- 기존 시각 스타일을 수정할 때는 정보 위계와 조작성을 우선한다.

## V2 review status

2026-09-02 기준으로 v2 핵심 경로를 전체 재검토했습니다.

- `App`/reducer: 발자취와 사진 여정은 별도 `PlayerController` 인스턴스와 별도 재생 커서를 사용한다. 모드 전환 시 현재 controller를 멈춘 뒤 대상 controller의 커서를 복원하며 한 모드의 재생·탐색이 다른 모드의 진행 위치를 변경하지 않는다. 미디어가 이미 연결된 상태에서 같은 Timeline을 재계획할 때는 미디어를 새 계획에 다시 매칭하되 현재 여정 탭을 강제로 바꾸지 않는다. 경로 재생 길이는 사용자가 슬라이더를 직접 조정했는지 별도 ref로 기억해, 자동 상태에서는 기간 변경 후 재계획 시 새 추천 길이를 다시 적용하고 수동 상태에서는 사용자의 값을 우선한다.
- `PlayerController`: 프레임 보간, 항공 안정 줌, stop 스케줄 재매핑과 재생 시간 기준을 검토했다. 최종 카메라 줌은 planner 출력에 사진용 거리 확대/항공 안정 줌을 적용한 뒤에도 route-time 기반 저속 추종을 거쳐 MapLibre로 전달하므로 이동수단 또는 사진 구간 경계의 갑작스러운 줌 변화를 완충한다.
- `camera-modes`/camera planner: 이동수단별 목표 view span과 AUTO/DAY/SEGMENT 의미는 유지하되, 최종 zoom trajectory에 긴 zoom-out preview, 비대칭 smoothing, 속도/가속도 제한과 방향 반전 hysteresis를 적용한다. 전체 테스트 중 kinematic limiter가 목표를 지나친 뒤 되돌아오며 미세한 줌 왕복을 만드는 실제 결함을 발견해, 현재 목표를 overshoot하지 않도록 수정했다. 재생 길이는 선택 기간, 지리적 extent, 총 이동 거리, 활동일 수, movement 수의 조합으로 계산하며 자동 기본 길이는 `recommendedSeconds`를 사용한다.
- `MediaJourneyPane`/media bridge: 짧은 이동 구간 사진 유지, keyed outgoing scene, 사진/픽토그램 전환 identity와 시간 정책을 검토했다. 현재/다음 4개 미디어를 bounded preload window로 준비하고, 이미지 decode 또는 영상 first-frame readiness 전에는 기존 장면을 유지해 빈 사진 프레임이 노출되지 않게 한다. 사진 위치 문자열은 원시 좌표를 노출하지 않으며 coarse place label만 사용하고 해석 실패 시 `알 수 없음`을 표시한다.
- `media-library`: GPS가 없는 미디어의 촬영 시각을 route-time으로 매칭할 때 exact route end가 OUTRO frame으로 반올림되는 경우를 검토했다. 기존에는 이 경우 첫 TRAVEL frame으로 fallback해 여행 끝 사진이 시작점에 붙을 수 있었으나, 현재는 가장 가까운 직전 TRAVEL frame을 사용해 목적지 위치를 유지한다.
- `city-label`/`photo-place-label`/MapLibre: 위치 출력은 시/도시 → 구/ward를 공통 상한으로 둔다. 이동용 city resolver는 `town`을 도시로 인정하지 않고 이름 변형 중 하나라도 `군·읍·면·동·리·町·村` 계열이면 후보에서 제외한다. 사진 resolver도 같은 하위 단위를 거부하며, source feature의 구 라벨은 사진 좌표에서 보수적인 근거리 범위 안에 있을 때만 시와 결합한다. 사진 resolver의 광범위한 city fallback을 제거해 유효한 근거리 city가 없으면 `null → 알 수 없음`으로 끝낸다. 로컬 PMTiles와 온라인 벡터 지도 모두 같은 표시 계약을 사용한다.
- `styles.css`/`ux-polish.css`: 전체 리뷰 중 예전 3열 여행 기간 UI, 작은 기간 글꼴, speed/date 묶음, scrollbar 폭 차이 같은 오래된 후행 override가 다시 남아 있는 것을 확인해 현재 UX 계약으로 정리했다. 시작/마지막 날짜는 동일 폭 2행, 설정 scrollbar gutter는 stable, 속도는 날짜와 route 사이의 독립 행, 사진 캡션과 재생 UI 박스 중심은 동일 기준으로 유지한다. 하단 reveal target은 숨기기 전 `.player-dock`과 동일한 위치·크기만 차지하고 발자취 이동 HUD는 playback chrome 숨김에서 제외해 상시 표시한다.
- `server.mjs`/privacy: 서버는 `127.0.0.1`에만 bind하고 Host를 localhost/127.0.0.1로 제한한다. 로컬 미디어 API는 manifest ID를 통해서만 파일을 제공하고 Range를 지원하며, metadata cache POST는 same-origin과 2MB body 한계를 유지한다. PMTiles 제공 파일도 allowlist 두 개로 제한한다. 개인 Timeline/사진/캐시의 외부 전송 경로는 추가되지 않았다.
- `media-analysis`/metadata scanner: JPEG는 제한된 앞부분, MP4/MOV/M4V QuickTime은 앞·뒤 최대 1MB만 읽는 bounded scan을 유지한다. 대용량 영상을 전체 메모리에 읽는 회귀는 없다.
- 테스트 계약도 현재 제품 요구와 동기화했다. `DurationLimits` fixture에 새 통계 필드를 반영하고, unresolved 사진 위치는 주변 도시를 빌려 쓰지 않는 것을 검증하며, 사진용 거리 줌은 계단식 고정값이 아니라 연속 곡선임을 검증한다. E2E는 발자취 HUD가 재생 중에도 상시 표시되는 것과 여행 시작/마지막 날짜가 동일 폭 2행인 것을 검증한다.
- GitHub Actions는 Node 24 기반 `actions/checkout@v5`, `actions/setup-node@v5`를 사용한다. CI는 `npm run verify` 뒤 Chromium desktop/mobile Playwright를 실행한다.
- 전체 리뷰 기준 `npm run verify`에서 typecheck, ESLint(max warnings 0), 13개 test file의 67개 단위·통합 테스트, production build가 통과했다. desktop/mobile Playwright는 실제 Timeline 환경변수가 필요한 검증과 desktop 전용 hover case를 제외하고 9개가 통과했으며 3개가 의도적으로 skip되었다.

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
- 사진 좌표의 행정구역 라벨은 현재 로드된 지도 벡터 타일 안에서만 해석하며 구/ward containment polygon을 직접 계산하지 않는다. 사진용 city 후보도 근거리 feature만 인정하므로 적절한 city/district feature가 타일에 없으면 의도적으로 `알 수 없음`을 표시할 수 있다.
- 미디어 사전 로드는 현재/다음 4개로 제한된다. 매우 느리거나 손상된 미디어는 최대 6초 뒤 기존 오류 처리 경로로 넘겨 영구적인 장면 정지를 피한다.
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