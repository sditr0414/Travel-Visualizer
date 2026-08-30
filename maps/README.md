# Local map archives

`npm run map:setup`이 아래 파일을 생성합니다.

- `world-z5.pmtiles` — 전 세계 저배율 개요 지도
- `korea-japan-z14.pmtiles` — 한국·일본 상세 지도

`.pmtiles` 파일은 용량이 크므로 Git에는 커밋하지 않습니다.

준비가 끝나면 앱 설정의 **지도 소스**에서 **로컬 PMTiles**를 선택합니다. 상세 영역은 기본적으로 한국·일본이며, 준비 전에 `TRAVEL_MAP_BBOX` 환경 변수로 바꿀 수 있습니다.
