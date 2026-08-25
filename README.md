# Travel Camera Visualizer

Google Timeline JSON을 기반으로 여행 동선을 60fps로 재생하면서 거리·속도·이동 성격에 따라 카메라 줌과 경로 표현을 자동 계획하는 프로토타입입니다.

현재 개발/검증 기준 데이터는 2026-03-17 ~ 2026-03-31 여행 Timeline입니다.

## 처음 실행

Node.js 20 이상이 필요합니다.

먼저 로컬 지도를 한 번 준비합니다.

```bash
npm run map:setup
```

이 명령은 공식 `go-pmtiles` CLI를 자동으로 준비한 뒤 Protomaps archive에서 필요한 부분만 추출합니다.

- `maps/world-z5.pmtiles`: 줌 0~5 전 세계 개요
- `maps/korea-japan-z14.pmtiles`: 한국·일본 여행 영역 상세 지도

전체 planet 파일을 다운로드하지 않습니다. PMTiles 원격 archive에서 필요한 타일 범위만 추출합니다.

`map:setup`은 먼저 현재 daily build 후보를 확인하고 실제로 읽을 수 있는지 `pmtiles show`로 검증합니다. Daily build는 보존 기간 때문에 URL이 사라질 수 있으므로, 사용할 수 없으면 Protomaps의 Source Cooperative `v4.pmtiles` 고정 미러로 자동 fallback합니다. 직접 다른 archive를 쓰고 싶다면 `PROTOMAPS_BUILD_URL` 환경변수를 지정할 수 있습니다.

그 다음 서버를 실행합니다.

```bash
npm start
```

브라우저에서 다음 주소를 엽니다.

```text
http://localhost:5173
```

로컬 PMTiles 두 파일이 존재하면 자동으로 **로컬 하이브리드 지도**를 사용합니다. 파일이 없으면 OpenFreeMap Positron 온라인 지도로 fallback합니다.

페이지가 열리면 `data/timeline-parts/part-01.txt` ~ `part-09.txt`에 포함된 테스트 Timeline을 자동으로 합치고 압축 해제한 뒤 분석합니다. 별도 파일 선택 없이 최소 영상 길이로 자동 재생됩니다.

다른 Timeline을 시험하고 싶을 때만 왼쪽의 Google Timeline JSON 파일 선택기를 사용하면 됩니다.

## 지도 구조

기본 로컬 지도는 같은 Protomaps/OSM 벡터 데이터와 단순한 grayscale 스타일을 사용하며 줌 수준에 따라 소스를 나눕니다.

```text
zoom 0 ~ 5   → world-z5.pmtiles
zoom 6 ~ 14  → korea-japan-z14.pmtiles
```

세계 개요에서는 국가·해안선·주요 지명을 빠르게 표시하고, 도시 확대에서는 도로·철도·지역명을 상세 archive에서 읽습니다. 한국어 지명을 우선 표시합니다.

PMTiles는 한 파일 전체를 매번 읽지 않습니다. 브라우저가 필요한 바이트만 HTTP Range Request로 요청하며, `server.mjs`가 `206 Partial Content`를 지원합니다.

지도 archive는 크기가 크므로 Git에 커밋하지 않으며 `.gitignore`에서 `maps/*.pmtiles`를 제외합니다.

로컬 지도를 새 데이터로 다시 만들려면:

```bash
npm run map:setup:force
```

상세 영역을 바꾸고 싶으면 환경변수 `TRAVEL_MAP_BBOX=minLng,minLat,maxLng,maxLat`를 지정할 수 있습니다.

## 테스트

```bash
npm test
```

## 내장 테스트 데이터

저장소에는 48MB Google Timeline 원본 전체를 넣지 않습니다. 현재 프로그램 검증에 필요한 2026-03-17 ~ 2026-03-31 구간의 이동 데이터만 압축 fixture로 포함합니다.

이 저장소는 public이므로 `data/timeline-parts`의 테스트 fixture도 공개 위치 데이터라는 점에 유의해야 합니다. 원본 Timeline 전체와 다른 날짜의 위치 기록은 저장소에 포함하지 않습니다.
