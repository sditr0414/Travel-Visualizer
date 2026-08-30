# AI Project Context — Travel Camera Visualizer v2

## Product

Google Timeline JSON을 브라우저에서만 처리해 지도 위 여행 경로를 재생하는 개인 로컬용 반응형 웹앱입니다. 시작 화면에서 로컬 Timeline과 사진 폴더를 선택하며 개인 파일은 업로드하거나 영구 저장하지 않습니다.

## Architecture

- React 19 + strict TypeScript + Vite
- MapLibre GL, 온라인 OpenFreeMap 기본, 로컬 PMTiles 선택
- Timeline JSON 파싱과 재생 계획은 Web Worker에서 실행
- 앱 상태는 `idle/loading/ready/planning/playing/paused/complete/error` reducer로 관리
- 60fps 프레임 재생은 React 밖의 `PlayerController`가 담당
- Node 서버는 Vite middleware/정적 파일, `/api/map-status`, PMTiles Range만 제공

핵심 순수 알고리즘은 기존 검증 코드를 유지하며 TypeScript 도메인 경계로 감쌉니다.

```text
sample/file text
  -> TimelineWorkerClient
  -> timeline.worker.ts
  -> typed timeline/planner domain
  -> PlaybackPlan
  -> PlayerController
  -> MapLibre sources/camera
```

## Public types

`src/types.ts`가 다음 계약의 기준입니다.

- `TimelineSource`, `TimelineScanResult`, `ParsedTrip`
- `AnalysisOptions`, `PlaybackPlan`, `PlaybackFrame`
- `MapSourceConfig`, `MapStatus`
- `WorkerRequest`, `WorkerResponse`

Worker 요청은 `SCAN_TIMELINE`, `PLAN_TRIP`, `CANCEL`만 사용합니다. 플레이어 API는 `loadPlan`, `play`, `pause`, `seek`, `reset`, `dispose`로 제한합니다.

## UX invariants

- 첫 화면의 주인공은 전체 지도와 여행 경로다.
- 재생 컨트롤은 항상 하단에 유지한다.
- 설정은 접을 수 있고 모바일에서 핵심 지도를 가리지 않아야 한다.
- 개인 Timeline은 서버에 전송하지 않는다.
- 기본 지도는 온라인이며 로컬 지도 파일이 없을 때 빈 화면으로 전환하지 않는다.
- 카메라 전략은 복원된 AUTO를 기본값으로 제공하고 DAY·SEGMENT를 선택할 수 있다.
- `prefers-reduced-motion`을 존중한다.

## Out of scope

로컬 사진·영상 여정은 MVP에 포함됩니다. Google Photos, Takeout 전용 가져오기, 영상 파일 내보내기, PWA, 네이티브 앱은 이후 작업입니다. 관련 과거 구현은 Git 이력에서만 참고합니다.

## Commands

```bash
npm start
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

모든 검증을 통과한 뒤에만 `main` 병합 대상으로 판단합니다. 실제 Timeline과 PMTiles는 커밋하지 않습니다.
