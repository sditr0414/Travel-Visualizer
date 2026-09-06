# AI Project Context — Travel Camera Visualizer v3

## Product and runtime

Google Timeline의 semanticSegments JSON과 로컬 사진·영상을 재생하는 반응형 앱입니다. Node.js 24+, React 19, TypeScript, Vite 8, MapLibre를 사용합니다. 원본은 업로드하지 않고 배경 타일·글꼴만 외부에서 받습니다. 이 문서는 v2의 UI 지침을 대체합니다.

`npm start`/Windows 런처는 프로덕션 빌드를 사용합니다. `scripts/ensure-build.mjs`는 소스 fingerprint가 바뀌었을 때만 빌드합니다. `npm run dev`는 개발용입니다. 서버는 127.0.0.1에만 바인딩합니다. 모바일 UI는 직접 파일 선택을 지원하며, 다른 기기에서 접근하려면 별도의 HTTPS 정적 호스팅이 필요합니다. LAN 공개를 위해 로컬 개인 파일 API의 접근 제한을 완화하지 않습니다.

## Data flow

Timeline → TimelineWorkerClient → timeline.worker → domain/planner → PlaybackPlan → ROUTE/PHOTOS PlayerController → MapLibre.

사진 File[] 또는 local manifest → bounded metadata scan/sidecar → GPS·Timeline matching → media library → 제외 필터·대표 장면 재선정 → 사진·날짜 stops → preload buffer → MediaJourneyPane.

`src/types.ts`가 계약의 기준입니다. `PlaybackPlan`은 원래 viewport 크기와 선택한 날짜 범위를 메타데이터로 보관합니다. 날짜는 Asia/Seoul 기준이며 시간대가 없는 EXIF는 기기 시간대를 따릅니다. 자정을 넘는 이동은 선택 기간의 경계에서 보간해 잘라냅니다. 날짜 변경선을 지나는 경로는 연속된 경도로 unwrap합니다.

## UI and accessibility

- 사용자가 v2 디자인 계승을 명시했습니다. 전체 화면 지도, 반투명 topbar/HUD/player, 접히는 details 설정 패널, 기존 색상·간격을 유지합니다. 전면 재설계하지 않습니다.
- `styles.css`, `ux-polish.css`, `settings-polish.css`는 v2 기준을 복원했습니다. 설명·복구·도움말 등 제한된 추가 스타일은 `usability-fixes.css`에 둡니다.
- 설정 각 항목 아래 짧은 설명을 표시하고 aria-describedby로 연결합니다. 설정을 열면 일시정지하고 Esc로 닫아 summary에 포커스를 돌립니다.
- 도움말·사진 목록은 공통 native Dialog를 사용합니다. 개인 파일·날짜는 저장하지 않고 검증한 감상 설정만 저장합니다.
- 사진 목록은 촬영 정보 출처·위치 추정·감상 제외 기능을 유지합니다. 사진 여정 설정에서 엽니다.
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
- 위치 라벨은 이미 로드된 타일에서 도시/구 수준까지만 얻습니다. 정확한 장소가 없으면 추정 없이 안내하고 원시 좌표나 지나치게 세밀한 주소를 노출하지 않습니다.

## Media and local API

메타데이터 우선순위: Takeout sidecar → JPEG EXIF/QuickTime → 파일명 → 수정 시각. GPS와 촬영 시각은 서로 보완합니다. 표시한 시각 출처는 GPS만 포함된 내장 메타데이터로 잘못 덮어쓰지 않습니다.

직접 선택한 동일 File[]는 WeakMap으로 분석을 재사용합니다. 로컬 manifest는 메모리 캐시와 `.cache/media-metadata.json`을 사용합니다. 일시적인 Range 읽기 실패를 영구적으로 분석 완료 처리하지 않습니다. 캐시 저장은 500개씩 제한하고 타임아웃을 둡니다. 서버 파일 ID는 상대 경로·크기·mtime fingerprint이므로 파일 추가로 다른 사진을 가리키지 않습니다.

JPEG는 최대 256KB, 큰 MP4/MOV/M4V는 앞·뒤 최대 1MB씩만 분석합니다. WebM의 내장 촬영 정보는 분석하지 않습니다. preload는 현재 주변의 제한된 창만 소유하며 object URL을 해제합니다. 준비 중인 장면으로 즉시 전환해 빈 화면을 만들지 않습니다. 이전 장면 제거 타이머는 HUD 텍스트 갱신으로 취소되지 않아야 합니다.

- GET `/api/map-status`
- GET/HEAD `/api/local-timeline`, `/api/local-media-manifest`, `/api/local-media/:id`
- POST `/api/local-media-metadata-cache` (same-origin)
- GET/HEAD `/maps/*.pmtiles` (허용된 파일만)

로컬 데이터 기본 경로·환경변수는 README를 따릅니다. stream 오류·클라이언트 연결 종료를 처리합니다. 개인 데이터·캐시·지도는 커밋하지 않습니다.

## Validation

사용자가 지정한 범위가 우선입니다. 수정 후 App 핵심 검사와 lint/build를 확인하고, 배포 화면에서 초기 지도의 실제 렌더링을 확인했습니다. 390px 모바일 viewport의 가로 넘침도 확인했으며 실기기 검증과는 구별합니다. 변경별 검증과 남은 배포 확인은 V3_RELEASE_NOTES.md를 갱신합니다. 브라우저·Windows·접근성 실기기 검증 없이 완벽 또는 무결함이라고 표현하지 않습니다.
