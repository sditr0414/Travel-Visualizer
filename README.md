# Travel Camera Visualizer

Google Timeline JSON을 기반으로 여행 동선을 재생하면서 **거리·속도·이동 성격에 따라 카메라 줌과 중심점을 자동 계획**하는 프로토타입입니다.

이 프로젝트의 1순위 목표는 "정확한 교통수단 표시"가 아니라 **전철 ↔ 도보처럼 이동 성격이 자주 바뀌어도 줌 전환이 자연스러운 영상 카메라**입니다.

## 실행

Node.js 20 이상이 필요합니다.

```bash
npm start
```

브라우저에서 다음 주소를 엽니다.

```text
http://localhost:5173
```

Google Timeline JSON 파일을 선택하고 날짜를 설정한 뒤 **경로 분석**을 누릅니다.

> 지도 표시에는 인터넷 연결이 필요합니다. 지도 타일은 OpenStreetMap, 렌더러는 MapLibre GL JS CDN을 사용합니다.

## 테스트

```bash
npm test
```

## 개인정보

Google Timeline 원본에는 매우 민감한 위치 정보가 포함될 수 있습니다. `data/*.json`은 `.gitignore`에 포함되어 있으므로 원본 타임라인을 저장소에 커밋하지 마세요.
