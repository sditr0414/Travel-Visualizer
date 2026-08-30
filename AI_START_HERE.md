# AI Start Here — Travel Camera Visualizer v2

- Repository: https://github.com/sditr0414/travel-camera-visualizer
- Active rebuild branch: `rebuild/v2`
- Runtime context: `AI_PROJECT_CONTEXT.md`

새 작업은 다음 순서로 시작합니다.

1. `AI_PROJECT_CONTEXT.md` 전체 확인
2. 최신 브랜치와 작업 트리 확인
3. 관련 TypeScript 인터페이스와 테스트 확인
4. 변경 후 typecheck, lint, unit/integration, build, E2E 실행

현재 앱은 개인 로컬용 경로·사진 여정 MVP입니다. 로컬 사진·영상은 React 구조 안에서 처리하며, Google Photos 기능이나 레거시 wrapper를 되살리지 않습니다.
앱 시작 시 샘플을 로드하지 않습니다. 로컬 Timeline JSON과 사진 폴더 선택이 첫 진입 경로입니다.
