# AI Start Here — Travel Camera Visualizer v3

- Repository: https://github.com/sditr0414/travel-camera-visualizer
- 작업 시작 시 현재 브랜치·작업 트리·원격 main을 확인합니다. **main은 항상 최신 변경을 담는 기준 브랜치**입니다. v3 구현은 `codex/v3-release`에서 시작했지만, v3에 적용하는 후속 변경도 main과 v3 배포선이 서로 어긋나지 않게 반영합니다.
- `AI_PROJECT_CONTEXT.md`, `README.md`, `V3_RELEASE_NOTES.md`를 읽고 관련 데이터 계약을 확인합니다.
- 검증 범위는 사용자 요청을 우선합니다. 이번 v3 작업은 전체 테스트 반복 없이 변경한 핵심 흐름과 lint/build로 제한했습니다.
- 기존 경로·카메라 엔진을 유지합니다. 제품 UI는 v2의 색상·배치·반투명 패널을 계승하며 새 UI도 v2 팔레트 토큰을 사용합니다. 전면 재설계를 반복하지 않습니다. 도움말/사진 목록만 공통 Dialog를 사용합니다.
- 개인 Timeline·사진·위치 fixture·메타데이터 캐시를 커밋하거나 공개하지 않습니다. 샘플, OAuth, 외부 사진 업로드를 임의로 추가하지 않습니다.
