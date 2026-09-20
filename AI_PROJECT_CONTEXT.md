# AI Project Context — Travel Camera Visualizer

## Product and runtime

Google Timeline의 semanticSegments JSON과 로컬 사진·영상을 재생하는 반응형 앱입니다. Node.js 24+, React 19, TypeScript, Vite 8, MapLibre를 사용합니다. Timeline·사진 원본은 업로드하지 않습니다. 온라인 지도는 외부 타일을 사용하고 설치형 지도의 glyph는 최초 사용 후 로컬 서버 캐시에 보관합니다. 정확한 장소 온라인 확인은 기본 OFF이며 사용자가 설정한 역지오코딩 서비스가 있을 때만 신뢰 가능한 GPS 좌표를 보냅니다. main은 최신 구현이며 v3는 UI 개선 전 커밋 `7dd7502`의 보존 브랜치입니다.

`npm start`/Windows 런처는 프로덕션 빌드를 사용합니다. `scripts/ensure-build.mjs`는 소스 fingerprint가 바뀌었을 때만 빌드합니다. `npm run dev`는 개발용입니다. 서버는 127.0.0.1에만 바인딩합니다. 모바일 UI는 직접 파일 선택을 지원하며, 다른 기기에서 접근하려면 별도의 HTTPS 정적 호스팅이 필요합니다. LAN 공개를 위해 로컬 개인 파일 API의 접근 제한을 완화하지 않습니다.

## Data flow

Timeline → TimelineWorkerClient → timeline.worker → domain/planner → PlaybackPlan → ROUTE/PHOTOS PlayerController → MapLibre.

사진 File[] 또는 local manifest → bounded metadata scan/sidecar → GPS·Timeline matching → media library → 제외 필터·대표 장면 재선정 → 사진·날짜 stops → preload buffer → MediaJourneyPane.

`src/types.ts`가 계약의 기준입니다. `PlaybackPlan`은 원래 viewport 크기와 선택한 날짜 범위를 메타데이터로 보관합니다. 날짜는 Asia/Seoul 기준이며 시간대가 없는 EXIF는 기기 시간대를 따릅니다. 자정을 넘는 이동은 선택 기간의 경계에서 보간해 잘라냅니다. 날짜 변경선을 지나는 경로는 연속된 경도로 unwrap합니다.

## UI and accessibility

- 사용자 승인에 따라 기존 UI 골조를 유지하면서 레퍼런스를 참고해 개선합니다. 전체 화면 지도, 반투명 topbar/HUD/player, 접히는 details 설정 패널과 지도·사진 분할을 유지하되 정보 순서·타이포그래피·간격·문구는 개선할 수 있습니다. 색상 기준도 v2 토큰(`--ink #171a1d`, `--surface rgba(24,27,30,.92)`, `--paper #f7f3ed`, `--muted #aaa7a2`, `--accent #ff725d`)을 따르며 새 UI가 별도 청회색 팔레트를 만들지 않습니다. 지도 중심의 감상 경험과 기존 재생 동작을 보존합니다.
- `styles.css`의 토큰과 기존 CSS를 기준으로 하며 제품 UI 개선은 `usability-fixes.css`에 둡니다. 첫 화면은 타임라인 열기를 주 행동으로 제시하고, 설정은 여행 기간을 먼저 보여줍니다. 하단 적용 영역은 고정하고 재계산이 필요한 변경과 즉시 적용되는 변경을 구분합니다.
- 설정 이름의 hover·키보드 포커스·탭으로 설명을 표시하고 입력과 aria-describedby로 연결합니다. 추천 여행은 native select로 고릅니다. 설정을 열면 일시정지하고 Esc로 닫아 summary에 포커스를 돌립니다.
- 상단 설정·가져오기·모드 선택은 외곽 높이 48px와 같은 상단 위치를 사용합니다. 설정 그룹 전체에는 hover 배경 강조를 넣지 않습니다. 마우스로 연 설명은 이름에서 벗어나면 닫히며 설명 자체에 hover해도 유지하지 않습니다. 탭·키보드로 고정하는 동작은 유지합니다.
- 도움말·사진 목록은 공통 native Dialog를 사용합니다. 개인 파일·날짜는 저장하지 않고 검증한 감상 설정만 저장합니다.
- 사진 목록은 촬영 정보 출처·GPS/Timeline 위치 추정·가능한 경우 GPS 수평 오차·감상 제외 기능을 유지합니다. 사진 여정 설정에서 엽니다.
- PC 좌우/모바일 상하 분할과 모드별 커서는 유지합니다. 전체 경로 버튼은 커서 변경 없이 bounds를 맞춥니다.
- MapLibre 6의 기본 Worker 경로는 Vite 배포 청크 옆에 존재하지 않습니다. `MapStage.tsx`에서 `maplibre-gl-worker.mjs?worker&url`을 import하고 setWorkerUrl을 호출해야 합니다. 스타일 로드 성공만으로 실제 지도 표시를 보장하지 않습니다.
- 배포 Worker 누락 시 지도·GeoJSON 경로가 모두 비어 보일 수 있습니다. 첫 E2E에 Worker가 실제로 시작하는지 확인을 포함합니다. 존재하지 않는 정적 asset 요청을 index.html로 바꾸지 않습니다.
- 키보드 단축키, 입력 중 기본 키 동작, 탭 숨김 일시정지, 터치 환경 컨트롤 유지, 모션 줄이기 지원을 보존합니다.

## Playback and camera invariants

- ROUTE/PHOTOS는 같은 지도에 독립된 controller와 커서를 갖습니다. 모드 변경 시 현재를 멈추고 대상의 커서를 복원합니다. 새 계획은 둘 다 초기화하고 지도만 교체하면 커서를 보존합니다.
- `PlayerController`가 재생·탐색의 시간 기준입니다. 사진 stop과 날짜 stop 시간을 총 길이에 포함합니다. 날짜 marker가 같은 route time이면 사진보다 먼저 표시합니다.
- 영상 currentTime/play/pause를 활성 stop의 elapsed time과 맞춥니다. 이전 전환 장면은 정지합니다. 브라우저가 play를 거부하면 사용자가 직접 재생할 수 있습니다. 짧은 영상은 남은 stop 시간 동안 마지막 프레임을 유지합니다.
- 프레임은 React 밖에서 갱신하고 HUD 갱신은 약 90ms로 제한합니다. 날짜/사진 stop 중에도 HUD 시간을 갱신합니다.
- 검증된 AUTO/DAY/SEGMENT 경로·카메라 계산을 임의로 단순화하지 않습니다. 기본 모드는 AUTO입니다.
- 경로 길이는 여행 기간·활동일·이동 거리·지리 범위·구간 수에서 최소/추천/최대를 계산합니다. 자동 기본값은 최소·최대의 중앙값을 5초 간격으로 반올림한 값입니다. 수동 길이는 재계획 범위 안에서 유지합니다.
- 사용자 zoomOffset은 계획 프레임에 미리 합산하지 않습니다. controller가 기본/locked/항공/사진 보정 후 한 번만 적용합니다. 선택된 뷰포트와 실제 분할 뷰포트 차이도 최종 줌에 반영합니다.
- 잠금 해제 cinematic 모드는 planner center/zoom을 사용합니다. 따라가기 모드는 실제 frame.position을 중앙에 두고 lockedZoom/항공 안정 줌을 사용합니다.
- 사진 카메라의 smoothing/stop zoom은 route time이 멈춰도 진행되는 photo journey time을 사용합니다. seek/reset은 smoothing을 초기화합니다.
- live 설정은 활성 controller만 다시 그립니다. 비활성 controller가 공유 지도의 카메라를 덮지 않아야 합니다.
- `setStops`는 변경 시 route 진행 위치를 보존하고 같은 stop의 길이가 바뀌면 내부 진행 비율을 보존합니다.
- 재생 중 지도 휠 확대를 막고 정지 중 허용합니다. tile warmup은 기존 제한된 동시성·ahead·dedupe를 유지합니다. MapLibre private API는 사용하지 않습니다.
- 기본 위치 라벨은 이미 로드된 타일에서 도시/구 수준까지만 얻습니다. 정확한 장소 온라인 확인은 planner가 아닌 live 설정이며 경로 다시 만들기 dirty-state에 포함하지 않습니다. GPS가 신뢰 가능한 사진만 사용하고, 10분/80m의 안정된 연속 사진 cluster는 중앙값 좌표를 사용합니다. 단일 GPS 오차가 크거나 Timeline 위치와 5km 이상 어긋나면 정확한 장소를 확정하지 않습니다. FLIGHT와 안정되지 않은 FAST_GROUND/FERRY, 빠른 ROAD/URBAN_TRANSIT/UNKNOWN은 주변 POI 대신 이동 중 라벨을 우선합니다. 원시 좌표는 UI에 노출하지 않습니다.

## Media and local API

메타데이터 우선순위: Takeout sidecar → JPEG EXIF/QuickTime → 파일명 → 수정 시각. GPS와 촬영 시각은 서로 보완합니다. JPEG의 EXIF GPS IFD에 `GPSHPositioningError (0x001F)`가 있으면 미터 단위 수평 오차를 `gpsAccuracyM`으로 보존합니다. 표시한 시각 출처는 GPS만 포함된 내장 메타데이터로 잘못 덮어쓰지 않습니다.

직접 선택한 동일 File[]는 WeakMap으로 분석을 재사용합니다. 로컬 manifest는 메모리 캐시와 `.cache/media-metadata.json`을 사용합니다. 장소 판정 결과는 `.cache/photo-places.json`, 설치형 지도 glyph는 `.cache/map-glyphs/`에 저장합니다. 일시적인 Range 읽기 실패를 영구적으로 분석 완료 처리하지 않습니다. 메타데이터 캐시 저장은 500개씩 제한하고 타임아웃을 둡니다. 서버 파일 ID는 상대 경로·크기·mtime fingerprint이므로 파일 추가로 다른 사진을 가리키지 않습니다.

정확한 장소 공급자는 코드에 공개 서비스를 하드코딩하지 않습니다. `TRAVEL_PLACE_REVERSE_URL`로 사용자가 선택한 Nominatim 호환 reverse endpoint를 설정해야 `/api/photo-place-status`가 available이 됩니다. 공개 OSMF Nominatim은 개인 사진 좌표 때문에 기본 차단하며, 해당 호스트를 명시한 경우에도 `TRAVEL_ALLOW_PUBLIC_NOMINATIM=1`이 추가로 필요합니다. 서버는 공급자 요구에 맞춰 `TRAVEL_PLACE_USER_AGENT`, `TRAVEL_PLACE_MIN_INTERVAL_MS`, `TRAVEL_PLACE_PROVIDER_LABEL`을 지원하고 동일 좌표 결과를 영구 로컬 캐시합니다. 공급자 약관이 결과 저장을 허용하는지 사용자가 확인해야 합니다.

JPEG는 최대 256KB, 큰 MP4/MOV/M4V는 앞·뒤 최대 1MB씩만 분석합니다. WebM의 내장 촬영 정보는 분석하지 않습니다. preload는 현재 주변의 제한된 창만 소유하며 object URL을 해제합니다. 준비 중인 장면으로 즉시 전환해 빈 화면을 만들지 않습니다. 이전 장면 제거 타이머는 HUD 텍스트 갱신으로 취소되지 않아야 합니다.

- GET `/api/map-status`
- GET/HEAD `/api/photo-place-status`
- POST `/api/photo-place` (same-origin, configured provider only)
- GET/HEAD `/api/map-glyphs/{fontstack}/{range}.pbf` (first-use upstream fetch + local cache)
- GET/HEAD `/api/local-timeline`, `/api/local-media-manifest`, `/api/local-media/:id`
- POST `/api/local-media-metadata-cache` (same-origin)
- GET/HEAD `/maps/*.pmtiles` (허용된 파일만)

로컬 데이터 기본 경로·환경변수는 README를 따릅니다. v2처럼 저장소 루트의 `타임라인.json` / `여행 사진/`을 먼저 확인하고 없으면 상위 폴더를 확인하며, 환경변수 지정은 항상 이 자동 탐색보다 우선합니다. stream 오류·클라이언트 연결 종료를 처리합니다. 개인 데이터·캐시·지도는 커밋하지 않습니다.

## Validation

사용자가 지정한 범위가 우선입니다. 수정 후 App 핵심 검사와 lint/build를 확인하고, 배포 화면에서 초기 지도의 실제 렌더링을 확인했습니다. 390px 모바일 viewport의 가로 넘침도 확인했으며 실기기 검증과는 구별합니다. V3_RELEASE_NOTES.md는 보존 버전의 기록으로 유지하고 main의 변경 사항은 README에 정리합니다. 브라우저·Windows·접근성 실기기 검증 없이 완벽 또는 무결함이라고 표현하지 않습니다.

## 사진 여정 검토 후 유지할 계약

- 출처가 없는 좌표 공백은 엔진에서 `visual-gap`이며 UNKNOWN/속도 0으로 보존합니다. 화면에서 보완한 속도를 엔진에 다시 넣지 않으며, 1초짜리 위치 차이를 항공 증거로 사용하지 않습니다.
- 화면의 이동수단은 `movement-presentation.ts`에서 별도로 표시합니다. 가까운 공백은 앞뒤 이동수단·도보 환승으로 추정하고, 유효한 시간 간격이 있을 때만 거리와 속도를 참고합니다. 근거가 부족하면 앞뒤 구간 중 거리·유효 속도·방향이 더 비슷한 이동수단을 선택하고, 동점이면 이전 구간을 유지합니다. 사용자 요청에 따라 지도와 사진 여정에는 추정 접미사 없이 이동수단 이름과 아이콘만 표시하며 엔진의 UNKNOWN·속도·카메라·경로는 바꾸지 않습니다. 제외된 항공은 후보에서 빼고, 참고할 이동수단 자체가 없는 경우에만 ‘이동 중’으로 표시합니다.
- `movementSpeed`는 UNKNOWN/visual-gap의 표시 속도를 거리와 유효한 시간 간격으로 계산합니다. 시간이 불충분하거나 표시 수단의 속도 범위를 벗어나면, 거리 합산과 같은 인접 구간의 속도를 참고합니다. 원래 기록된 수단의 프레임 속도는 유지하고, 제외 구간이나 참고 정보가 전혀 없는 경우에는 ‘—’를 표시합니다. 화면에는 추정 접미사를 붙이지 않습니다.
- 공백 연결은 PlaybackPlan 안에서 재생 시간을 배분합니다. controller의 호환용 카메라 보간도 content clock을 멈추거나 경로 source를 비우지 않습니다. 마지막 전체 경로 전환에 별도 2초를 추가하지 않습니다.
- 속도 옆에는 현재 개별 이동 구간의 거리를 표시합니다. 같은 이동수단의 별도 기록은 합산하지 않습니다. `movementDistances`는 UNKNOWN에서 보완한 구간을 같은 표시 수단의 인접 기록 중 거리·유효 속도·방향이 더 비슷한 한쪽에만 연결해 해당 거리까지 포함하고, 동점이면 이전 구간에 붙입니다. 보완 구간에서도 연결된 이동과 같은 거리를 보여주며 중복 합산하지 않습니다. `hideRoute`·유효하지 않은 거리는 제외합니다. 컨트롤러 준비 시 계산해 두 감상 모드에서 공유합니다.
- 여정의 처음(정지 상태의 0초)과 마지막 OUTRO에서는 `JourneySummary`를 경로 HUD 또는 사진 패널 안에 표시합니다. 최초 불러오기·처음부터 보기·Home·0초 탐색 시 전체 경로를 맞추고 재생을 기다립니다. 재생을 누르면 기존 이동/날짜/사진 장면으로 이어지며 모드별 커서는 유지합니다.
- 여정 요약의 사진 패널은 기존 이동 정보 장면의 비율을 따릅니다. PC에서는 최대 720px/90% 폭에 제목 최대 34px·총거리 48px·수단별 정보 20px, 모바일에서는 제목 26px·총거리 40px·수단별 정보 16px로 표시합니다. 지도 위 HUD의 조밀한 크기를 사진 패널에 그대로 적용하지 않습니다.
- `buildJourneySummary`는 적용한 `plan.selectedRange`의 기간과 양 끝 날짜를 포함한 총 일수, 전체 거리, 이동 수단별 거리·비중을 계획마다 한 번 계산합니다. 날짜 범위가 없으면 원본 구간 시각의 Asia/Seoul 날짜를 사용합니다. 수단별 집계는 `movementPresentation`과 공유 이모지/이름을 사용하며 거리 내림차순으로 보여줍니다. 원래 각 구간과 보완 구간의 거리를 한 번씩 합산하고 `hideRoute`·유효하지 않은 거리는 제외합니다. 날짜별 요약은 넣지 않습니다. 요약은 낮은 화면에서 내부 스크롤과 키보드 포커스를 지원하고, 전환 중 이전 장면은 inert로 포커스에서 제외합니다.
- 명시적으로 제외한 항공 사이의 연결은 `hideRoute`로 표시해 비행 선을 재생성하지 않습니다.
- AUTO의 확대 bias는 비행 전후에 0.85초 envelope로 연결합니다. 기존 center/zoom 경로에 두 번째 추적 필터를 추가하지 않습니다.
- UI 분할 기준은 820px, canvas는 100dvh/min-height 0입니다. 열린 설정은 재생바보다 위에 표시합니다.
- 폰트는 @fontsource-variable/noto-sans-kr의 번들 파일, 이동수단 픽토그램은 걷는 사람·기차·페리 등 익숙한 컬러 이모지로 표시합니다. 도보에 접근성/휠체어 아이콘을 쓰지 않습니다. 개인 데이터·폰트 다운로드를 외부 API로 보내지 않습니다.

## 2026-09-15 재생 조작·도움말·프레임 후속 수정

- 재생/일시정지는 아이콘만 표시하되 동적 aria-label/title과 44px 조작 영역을 유지합니다.
- 설정 설명은 실제 이름의 화면 좌표를 매 프레임 추적합니다. 설정 진입 애니메이션·스크롤·글꼴 로딩 중에도 이름과 붙어 있고, 이름이 스크롤 영역 밖으로 나가거나 설정창이 닫히면 함께 닫습니다. 한 번에 설명 하나만 표시합니다.
- route-progress에 최근 4초 선과 현재 위치 Point를 함께 담습니다. route-head 레이어도 같은 source를 geometry-type 필터로 사용합니다. 이동 꼬리는 `trail` 속성으로 구분해 불투명도 60%로 표시하고, 현재 위치 원과 마지막 전체 경로의 진하기는 유지합니다. 카메라와 경로는 같은 requestAnimationFrame에서 갱신하며 30Hz geometry 제한은 사용하지 않습니다. 사진 정지 중 변하지 않은 geometry 재전송은 생략합니다.
- 지도 미리 읽기의 기존 동시성/시간 제한은 유지하고 각 pass에서 getStyle 결과를 한 번만 읽습니다.
- 60/120Hz 동기화 테스트는 렌더 제출 주기를 검사합니다. 실제 FPS는 GPU·타일·브라우저에 따라 달라지므로 자동 검사 통과를 모든 기기 60fps 보장으로 쓰지 않습니다.


## 이동수단 배치·설정 클릭·줌 연속성 유지 규칙

- 이동수단 이모지의 자연스러운 글자 상자와 기존 2열 배치를 유지합니다. 이모지 변경 때문에 아래 이동수단 이름의 위치를 다시 설계하지 않습니다.
- 설정 체크박스의 상태 변경은 실제 체크박스와 키보드 조작에서만 일어납니다. 설정 이름은 설명을 표시하며 빈 공간은 선택하지 않습니다. aria-label/aria-describedby를 보존합니다.
- 타일 레벨 관리 때문에 실제 camera zoom을 정수 경계에 고정하지 않습니다. ±0.001 고정 후 ±0.07 해제는 미세 정지/급변을 만들므로 다시 추가하지 않습니다. 기존 planner 경로와 최종 zoomOffset 1회 적용은 유지합니다.

## 제품 UI 문구와 레퍼런스

- 사용자에게는 ‘타임라인’, ‘사진·영상’, ‘여행 기간’, ‘경로 다시 만들기’를 일관되게 사용합니다. JSON 형식과 서비스 설정 같은 구현 설명은 도움말의 접힌 상세 안내와 README에 둡니다. 파일 원본 비업로드와 선택적 GPS 좌표 전송의 차이는 유지합니다.
- 도움말은 실제 추천 여행 선택 동작을 설명합니다. 사진 미선택·기간 불일치·전체 제외 상태는 서로 다른 안내와 복구 경로를 제공합니다.
- 안내 문구는 한국어 단어를 보존하며 화면 폭에 맞게 줄바꿈합니다. 행동 안내와 보충 설명은 문단으로 나누고, 짧은 버튼 이름·숫자와 단위는 조사까지 함께 묶습니다. 설정 설명 문자열의 `\n`은 문단 구분으로 렌더링합니다.
- 21st.dev의 [settings](https://21st.dev/@ln-dev7/components/settings)와 [upload](https://21st.dev/@ephraimduncan/components/upload-1) 공개 미리보기를 참고했습니다. 제목·설명 계층과 파일 선택 정보 배치를 직접 구현했으며 외부 컴포넌트 코드나 의존성을 가져오지 않았습니다.
