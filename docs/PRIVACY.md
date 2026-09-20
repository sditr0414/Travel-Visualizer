# 파일과 개인정보

[프로그램 소개](../README.md) · [문서 목록](README.md)

Travel Camera는 타임라인과 사진·영상 원본을 로컬에서 읽습니다. 온라인 지도와 선택적인 장소 확인에는 네트워크를 사용합니다.

## 파일 위치

아래의 상대 경로는 `server/`가 아닌 **저장소 최상위** 기준입니다.

| 데이터 | 기본 위치 | 경로 변경 환경변수 |
| --- | --- | --- |
| 타임라인 | `타임라인.json`, 없으면 상위 폴더 | `TRAVEL_TIMELINE_PATH` |
| 사진·영상 | `여행 사진/`, 없으면 상위 폴더 | `TRAVEL_MEDIA_DIR` |
| 촬영 정보 캐시 | `.cache/media-metadata.json` | `TRAVEL_METADATA_CACHE` |
| 확인한 장소 캐시 | `.cache/photo-places.json` | `TRAVEL_PLACE_CACHE` |
| 설치형 지도 글꼴 | `.cache/map-glyphs/` | `TRAVEL_GLYPH_CACHE_DIR` |

환경변수 지정이 자동 탐색보다 우선합니다. 환경변수의 상대 경로는 서버를 실행한 작업 폴더 기준입니다. 저장소에서 npm 명령으로 실행하면 저장소 최상위 기준이 되며, 다른 위치에서 직접 실행할 때는 절대 경로를 권장합니다. 자동 파일 연결은 `npm start -- --no-local-data`로 끌 수 있습니다.

```sh
TRAVEL_TIMELINE_PATH='/path/to/timeline.json' TRAVEL_MEDIA_DIR='/path/to/photos' npm start
```

Windows PowerShell:

```powershell
$env:TRAVEL_TIMELINE_PATH = 'D:\My Travel\timeline.json'
$env:TRAVEL_MEDIA_DIR = 'D:\My Travel\photos'
npm start
```

브라우저에는 검증된 감상 설정만 저장합니다. 직접 선택한 파일과 날짜는 저장하지 않습니다. 사진 목록의 제외 상태도 새로고침하면 초기화됩니다. 로컬 서버의 캐시는 다음 실행에서도 재사용합니다.

## 촬영 정보와 지원 형식

촬영 시각과 GPS는 **Takeout JSON 보조 파일 → JPEG EXIF/QuickTime → 파일명 → 파일 수정 시각** 순서로 보완합니다. GPS가 없으면 타임라인에서 위치를 연결합니다. JPEG의 GPS 수평 오차 정보가 있으면 장소 판정에 사용합니다.

화면 날짜는 한국 시간으로 표시합니다. 시간대가 없는 EXIF 등은 기기 시간대를 따릅니다. JPEG는 최대 256KB, 큰 MP4/MOV/M4V는 앞·뒤 최대 1MB씩 메타데이터를 읽습니다. WebM의 내장 촬영 정보는 분석하지 않습니다. 따라서 모든 파일의 촬영 정보를 복구한다고 보장하지 않습니다.

사진·영상의 실제 표시 가능 여부는 브라우저에 달려 있습니다. HEIC/HEIF와 일부 영상 코덱은 표시되지 않을 수 있습니다. 해당 파일은 JPEG·PNG 또는 브라우저가 지원하는 영상으로 변환해 연결하세요. 원본 파일의 변경·삭제 기능은 없습니다.

## 외부 통신

| 기능 | 외부로 나가는 요청 |
| --- | --- |
| 기본 온라인 지도 | 지도 서버에 타일·스타일 요청. 지도에 표시하는 영역이 요청에 반영됨 |
| 설치형 지도 | 지도 설치 시 다운로드, 캐시되지 않은 지명 글꼴의 최초 요청 |
| 정확한 장소 온라인 확인 | 직접 설정한 서비스에 신뢰 가능한 사진 GPS 좌표 요청. 기본 OFF |
| 런처 자동 업데이트 | GitHub `main` 확인, 필요한 경우 npm 패키지 설치 |

사진·영상 원본과 타임라인 파일 전체를 외부로 업로드하지 않습니다. UI의 Noto Sans KR 글꼴은 앱에 포함되며 폰트 CDN을 쓰지 않습니다. 설치형 지도의 지명 글꼴 캐시와는 별개입니다.

## 정확한 장소 온라인 확인

Nominatim 호환 역지오코딩 서버를 직접 설정한 경우에만 앱에서 이 기능을 켤 수 있습니다.

```powershell
$env:TRAVEL_PLACE_REVERSE_URL = 'https://YOUR-GEOCODER.example/reverse'
$env:TRAVEL_PLACE_PROVIDER_LABEL = '내 장소 서비스'
npm start
```

`TRAVEL_PLACE_USER_AGENT`와 `TRAVEL_PLACE_MIN_INTERVAL_MS`로 공급자의 요청 정책을 맞춥니다. 기본 OSMF 공개 서버를 자동으로 연결하지 않으며, `nominatim.openstreetmap.org`를 직접 지정해도 `TRAVEL_ALLOW_PUBLIC_NOMINATIM=1`이 추가로 필요합니다. 사용 전에 해당 공급자의 현재 개인정보·사용량 정책과 결과 캐시 허용 여부를 확인하세요.

10분·80m 안에 안정적으로 모인 사진은 중앙 좌표를 사용합니다. 단일 GPS 오차가 크거나 타임라인과 크게 어긋나면 정확한 장소를 확정하지 않습니다. 비행·기차·페리와 빠른 차량 이동 중에는 주변 장소보다 이동 상태를 우선합니다. 조회 결과는 로컬 캐시에 보관해 같은 좌표를 반복 요청하지 않습니다.

## 저장소와 공개 자료

서버는 `127.0.0.1`에만 바인딩하고 파일 API는 loopback·same-origin 제한을 사용합니다. 개인 데이터를 연결한 개발 서버의 제한을 풀어 외부에 공개하지 않습니다.

개인 원본·위치 fixture·캐시·환경 파일·설치형 지도는 Git에 넣지 않습니다. README의 화면과 데모는 소유자가 이 저장소에 공개하도록 허용한 별도 촬영 결과물입니다. 원본 기록이나 사진 묶음을 포함하지 않습니다. [촬영 자료 안내](MEDIA.md)

기존 Git 이력에는 과거 위치 fixture가 남아 있을 수 있습니다. 현재 `.gitignore`는 과거 커밋을 지우지 않으며 이번 폴더 정리는 이력 삭제 작업을 포함하지 않습니다.
