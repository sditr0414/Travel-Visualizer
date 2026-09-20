# AI Start Here — Travel Camera Visualizer

- Repository: https://github.com/sditr0414/Travel-Visualizer
- 작업 시작 시 현재 브랜치·작업 트리·원격 main을 확인합니다. **main은 최신 변경을 담고, v3는 UI 개선 전의 main(`7dd7502`)을 보존하는 브랜치**입니다. 상시 브랜치는 `main`과 `v3`만 사용하며 새 변경을 `v3`에 동기화하지 않습니다.
- `AI_PROJECT_CONTEXT.md`, `README.md`, `V3_RELEASE_NOTES.md`를 읽고 관련 데이터 계약을 확인합니다.
- 검증 범위는 사용자 요청과 변경 위험을 따릅니다. UI 변경은 관련 흐름의 실제 렌더링·접근성과 lint/build를 확인하고 기존 회귀 검사를 재사용합니다. 검사가 통과한 뒤 새 변경이나 우려 없이 반복하지 않습니다.
- 기존 지도·사진 분할과 경로·카메라 엔진을 유지합니다. UI의 골조와 따뜻한 팔레트를 기준으로 레퍼런스를 참고한 제품 수준의 개선을 허용합니다. 화면 구현과 `AI_PROJECT_CONTEXT.md`를 따르며 도움말/사진 목록은 공통 Dialog를 사용합니다.
- 개인 Timeline·사진·위치 fixture·메타데이터 캐시를 커밋하거나 공개하지 않습니다. 샘플, OAuth, 외부 사진 업로드를 임의로 추가하지 않습니다.
