# AI Start Here — Travel Camera Visualizer

새 AI 채팅/세션이 이 프로젝트 작업을 이어갈 때 사용하는 최소 진입 문서입니다.

## Canonical links

- Repository: https://github.com/sditr0414/travel-camera-visualizer
- Main branch: https://github.com/sditr0414/travel-camera-visualizer/tree/main
- AI project context: https://github.com/sditr0414/travel-camera-visualizer/blob/main/AI_PROJECT_CONTEXT.md
- README: https://github.com/sditr0414/travel-camera-visualizer/blob/main/README.md

> 이 저장소는 Private입니다. 새 채팅이 GitHub 연결 권한을 가지고 있어야 내용을 읽을 수 있습니다. 일반 웹 검색으로 접근하지 말고 GitHub 연결을 사용해야 합니다.

## New chat kickoff message

```text
다음 GitHub 저장소의 작업을 이어서 진행하자.

Repository:
https://github.com/sditr0414/travel-camera-visualizer

먼저 아래 인수인계 문서를 처음부터 끝까지 읽고:
https://github.com/sditr0414/travel-camera-visualizer/blob/main/AI_PROJECT_CONTEXT.md

그 다음 반드시 최신 main HEAD와 관련 파일의 현재 SHA를 확인해.
문서와 코드가 다르면 최신 main 코드를 기준으로 판단하고,
수정 후에는 테스트와 GitHub Actions까지 확인한 뒤 결과를 알려줘.
구조, import map, media pipeline, UX invariant, 기술부채가 바뀌면 AI_PROJECT_CONTEXT.md도 같은 작업에서 갱신해.
```

## Required order

1. `AI_PROJECT_CONTEXT.md` 전체 읽기
2. 최신 `main` HEAD 확인
3. 요청과 관련된 현재 파일 및 blob SHA 확인
4. 코드가 문서보다 최신이면 코드 우선
5. 기존 UX/아키텍처 invariant 확인
6. 최소한의 구조적 수정
7. 관련 테스트 추가/수정
8. GitHub Actions 최종 성공 여부 확인
9. 구조가 변했으면 `AI_PROJECT_CONTEXT.md` 갱신

이 파일은 링크/진입 절차만 담당합니다. 프로젝트의 실제 기술 인수인계 내용은 `AI_PROJECT_CONTEXT.md`가 기준입니다.
