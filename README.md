# Travel Camera Visualizer

Google Timeline JSON을 기반으로 여행 동선을 60fps로 재생하면서 거리·속도·이동 성격에 따라 카메라 줌과 경로 표현을 자동 계획하는 프로토타입입니다.

현재 개발/검증 기준 데이터는 2026-03-17 ~ 2026-03-31 여행 Timeline입니다.

## 실행

Node.js 20 이상이 필요합니다.

```bash
npm start
```

브라우저에서 다음 주소를 엽니다.

```text
http://localhost:5173
```

페이지가 열리면 `data/timeline-parts/part-01.txt` ~ `part-09.txt`에 포함된 테스트 Timeline을 자동으로 합치고 압축 해제한 뒤 분석합니다. 별도 파일 선택 없이 최소 영상 길이로 자동 재생됩니다.

다른 Timeline을 시험하고 싶을 때만 왼쪽의 Google Timeline JSON 파일 선택기를 사용하면 됩니다.

## 테스트

```bash
npm test
```

## 내장 테스트 데이터

저장소에는 48MB Google Timeline 원본 전체를 넣지 않습니다. 현재 프로그램 검증에 필요한 2026-03-17 ~ 2026-03-31 구간의 이동 데이터만 압축 fixture로 포함합니다.

이 저장소는 public이므로 `data/timeline-parts`의 테스트 fixture도 공개 위치 데이터라는 점에 유의해야 합니다. 원본 Timeline 전체와 다른 날짜의 위치 기록은 저장소에 포함하지 않습니다.

## 지도

MapLibre GL JS와 OpenFreeMap Positron 벡터 스타일을 사용합니다. 지도 표시는 인터넷 연결이 필요하며, 지명은 가능한 경우 한국어 필드를 우선합니다.
