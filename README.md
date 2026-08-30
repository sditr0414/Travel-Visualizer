# Travel Camera Visualizer

개인 Google Timeline JSON을 브라우저 안에서 분석해 여행 경로를 시네마틱하게 재생하는 로컬 우선 웹앱입니다.

## 실행

Node.js 24 이상이 필요합니다.

```bash
npm ci
npm start
```

`http://127.0.0.1:5517`을 열면 `E:\travel-camera-visualizer\타임라인.json`과 `E:\travel-camera-visualizer\여행 사진`을 자동으로 불러옵니다. 사진은 목록만 먼저 확인하고 현재 화면에 필요한 원본만 로컬에서 스트리밍하므로 15GB 이상의 폴더도 브라우저 메모리에 한꺼번에 올리지 않습니다. 기본 파일이 없으면 **Timeline JSON 선택**과 **사진 폴더 선택**을 사용할 수 있습니다. 데이터는 로컬 `127.0.0.1` 안에서만 처리되며 외부로 업로드되지 않습니다.

처음 실행할 때 사진의 EXIF 촬영 시각과 GPS를 헤더 구간에서 읽고 `.cache/media-metadata.json`에 저장합니다. 다음 실행부터는 파일 크기와 수정 시각이 같은 항목의 캐시를 사용하며 변경된 사진만 다시 분석합니다. Takeout sidecar가 있으면 그 정보를 우선 저장합니다.

Timeline에 기존 검증 여행 구간인 `2026-03-17`부터 `2026-03-31`까지의 데이터가 있으면 이 기간을 기본 선택합니다. 재생 전과 일시정지 상태에서는 전체 경로를 표시하고, 재생 중에는 진행 경로에 집중할 수 있도록 전체 경로를 자동으로 숨깁니다.

## 지도

기본값은 OpenFreeMap 온라인 지도입니다. 선택적으로 기존 로컬 PMTiles를 준비할 수 있습니다.

```bash
npm run map:setup
```

준비 후 설정에서 **로컬 PMTiles**를 선택합니다. 서버는 지도 파일에 대한 HTTP Range 요청만 제공합니다.

## 검증

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

## 개인정보

- 개인 Timeline과 위치 데이터는 커밋하지 않습니다.
- 앱에는 개인 Timeline이나 사진을 포함하지 않습니다.
- 기존 Git 이력에는 과거 위치 fixture가 남아 있으므로 저장소는 비공개로 유지해야 합니다.
- 저장소를 공개하려면 현재 파일 삭제만으로는 부족하며 Git 이력 정리가 필요합니다.

기본 사진 폴더는 파일명의 촬영 시각을 이용해 Timeline 경로에 연결합니다. 별도로 선택한 사진·영상은 촬영 시간·EXIF 위치와 폴더 안의 Google Takeout sidecar JSON을 브라우저에서 읽습니다. 설정에서 모든 사진을 재생하는 **전체 보기**와 묶음별 대표 사진만 재생하는 **미리보기**를 선택할 수 있습니다.

Google Photos API·OAuth 연결 기능은 보안을 위해 제공하지 않습니다. Takeout도 내려받은 로컬 폴더만 지원합니다. 영상 내보내기, PWA와 네이티브 앱은 현재 범위에 포함되지 않습니다.
