# Travel Camera Visualizer

Google Timeline JSON을 기반으로 여행 동선을 60fps로 재생하면서 거리·속도·이동 성격에 따라 카메라 줌과 경로 표현을 자동 계획하는 프로토타입입니다.

현재 기본 검증 구간은 2026-03-17 ~ 2026-03-31 여행이지만, 전체 Timeline을 준비하면 다른 날짜도 같은 데이터에서 선택할 수 있습니다.

## 처음 실행

Node.js 20 이상이 필요합니다.

먼저 고정된 버전의 브라우저 지도 런타임을 설치하고 로컬 지도를 한 번 준비합니다.

```bash
npm ci
npm run map:setup
```

이 명령은 공식 `go-pmtiles` CLI를 자동으로 준비한 뒤 Protomaps archive에서 필요한 부분만 추출합니다.

- `maps/world-z5.pmtiles`: 줌 0~5 전 세계 개요
- `maps/korea-japan-z14.pmtiles`: 한국·일본 여행 영역 상세 지도

전체 planet 파일을 다운로드하지 않습니다. PMTiles 원격 archive에서 필요한 타일 범위만 추출합니다.

`map:setup`은 먼저 현재 daily build 후보를 확인하고 실제로 읽을 수 있는지 `pmtiles show`로 검증합니다. Daily build가 보존 기간 때문에 사라졌으면 Protomaps의 Source Cooperative `v4.pmtiles` 고정 미러로 자동 fallback합니다. 직접 다른 archive를 쓰고 싶다면 `PROTOMAPS_BUILD_URL` 환경변수를 지정할 수 있습니다.

그 다음 서버를 실행합니다.

```bash
npm start
```

브라우저에서 다음 주소를 엽니다.

```text
http://localhost:5173
```

로컬 PMTiles 두 파일이 존재하면 자동으로 **로컬 하이브리드 지도**를 사용합니다. MapLibre, PMTiles, Protomaps 브라우저 런타임은 프로젝트가 직접 제공하며, 파일이 없으면 OpenFreeMap Positron 온라인 지도로 fallback합니다. 지도 글꼴은 Protomaps glyph 서비스를 사용하므로 완전한 오프라인 상태에서는 지명 없이 기본 지형과 경로가 표시될 수 있습니다.

페이지가 열리면 Timeline을 분석하고 첫 프레임만 준비합니다. 자동 재생하지 않으며 `재생` 버튼을 눌러야 영상이 시작됩니다.

## 사진 여정

사진 소스는 **기기 갤러리/로컬 파일을 기본**으로 사용합니다. 상단의 `기기 갤러리`에서 사진을 선택하면 자동으로 `사진 여정` 모드로 전환하고 촬영시각을 Timeline과 매칭합니다. 앱 버전에서는 네이티브 사진 라이브러리에서 촬영시각과 GPS를 직접 읽는 구조로 확장할 수 있습니다.

Google Photos는 웹에서 로컬 사진이 없을 때 쓰는 보조 입력입니다. Google Photos Picker API를 사용하므로 사용자가 Picker에서 승인한 사진만 앱에서 접근합니다.

### Google Photos 앱 설정

Google Cloud에서 다음을 한 번 구성합니다.

1. Google Cloud Console에서 프로젝트를 만듭니다.
2. **Google Photos Picker API**를 활성화합니다.
3. OAuth 동의 화면을 구성합니다.
4. `OAuth 클라이언트 ID > 웹 애플리케이션`을 만듭니다.
5. 승인된 JavaScript 원본에 `http://localhost:5173`을 추가합니다.
6. 생성된 Client ID를 서버 환경변수로 설정합니다.

PowerShell 예시:

```powershell
$env:GOOGLE_PHOTOS_CLIENT_ID="1234567890-xxxxxxxx.apps.googleusercontent.com"
npm start
```

Client ID는 공개 식별자이므로 브라우저에 전달해도 되지만 Client secret은 코드나 브라우저에 넣지 않습니다.

### Google Photos 사용자 흐름

1. 상단 `Google Photos 로그인` 클릭
2. Google 로그인 또는 기존 권한 재사용
3. Photos Picker에서 여행 사진 승인
4. Picker 결과 중 현재 Timeline의 시작일~종료일 범위 밖 사진 자동 제외
5. 촬영 시각을 Timeline과 매칭해 위치 계산
6. 사진 여정 생성

Google Photos의 현재 권한 모델에서는 로그인만으로 사용자의 전체 라이브러리를 날짜 검색해서 자동 가져올 수 없습니다. 따라서 여행 사진은 Picker에서 사용자가 직접 승인해야 합니다.

Picker API는 사진 GPS 위치를 제공하지 않으므로 Picker로 가져온 사진 위치는 Timeline 시각 위치를 사용합니다. GPS가 중요한 경우 `Takeout 폴더 선택`을 사용하면 sidecar JSON의 GPS를 우선 사용하고 GPS가 없는 사진만 Timeline으로 보완합니다.

Google Photos Picker의 `baseUrl`은 임시 URL이고 사진 바이트 요청에는 OAuth Bearer 토큰이 필요합니다. 앱은 Picker 세션이 살아 있는 동안 영상용 미리보기를 내려받고 다운로드가 끝난 뒤 세션을 정리합니다. **Google Photos 사진 미리보기는 IndexedDB 등 브라우저 영구 저장소에 보관하지 않으며 현재 실행에서만 사용합니다.** 이전 버전이 만든 사진 캐시 DB가 있으면 새 코드가 삭제를 요청합니다. 사진은 이 프로젝트 서버나 GitHub 저장소에 업로드되지 않습니다.

## 전체 Timeline 사용

프로젝트는 원본 `타임라인.json`을 다음 순서로 자동 탐색합니다.

1. `TIMELINE_JSON` 환경변수로 지정한 경로
2. 프로젝트 루트의 `타임라인.json`
3. `data/타임라인.json`
4. 프로젝트 상위 폴더의 `타임라인.json`

원본 JSON을 찾으면 압축 fixture보다 우선해서 직접 사용합니다. 원본 전체에는 `semanticSegments`, `rawSignals`, `userLocationProfile`을 그대로 유지하지만, 브라우저 플레이어는 실제 분석에 필요한 `semanticSegments`만 전달받습니다. 따라서 전체 원본을 사용해도 매번 약 49MB를 브라우저로 보내지 않습니다.

### 전체 원본을 GitHub fixture로 영구 반영

현재 검증한 원본은 다음 특성을 갖습니다.

- `semanticSegments`: 8,793
- `rawSignals`: 45,587
- SHA-256: `5cc05afe24602a2550a0a318999b033b472af014bea361abfd3051bb1dc5a2a0`

원본 파일이 프로젝트 상위 폴더, 루트, 또는 `data` 폴더에 있다면 다음 한 명령으로 기존 축소 fixture를 전체 원본 fixture로 교체하고 `main`에 push할 수 있습니다.

```bash
npm run timeline:setup -- --push
```

직접 경로를 지정할 수도 있습니다.

```bash
npm run timeline:setup -- "C:\경로\타임라인.json" --push
```

`timeline:setup`은 다음을 수행합니다.

1. 원본 JSON 파싱
2. SHA-256 및 레코드 수 검증
3. 원본 전체를 gzip으로 무손실 압축
4. `data/timeline-parts/part-*.txt`로 분할
5. `manifest.json` 생성
6. `--push` 사용 시 Git commit 및 `origin/main` push

원본 `타임라인.json` 자체는 `.gitignore` 대상이며, Git에는 압축된 전체 fixture만 저장합니다.

다른 Timeline을 의도적으로 fixture로 만들려면 `--allow-different` 옵션을 추가할 수 있습니다.

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

GitHub Actions는 모든 JavaScript 문법 검사, 내장 Timeline 서버 startup 검사, 정적 엔드포인트 확인, 단위 테스트를 실행합니다.

## 개인정보

저장소는 현재 **Private**입니다. 전체 Timeline fixture에는 원본의 위치 기록이 포함되므로 저장소 공개 전환이나 fixture 공유 시 위치 데이터가 노출될 수 있습니다.
