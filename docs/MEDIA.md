# 화면과 데모 영상

[프로그램 소개](../README.md) · [문서 목록](README.md)

## 공개 자료

| 파일 | 내용 |
| --- | --- |
| [photo-journey.png](assets/screenshots/photo-journey.png) | 지도와 오카야마 여행 사진 |
| [route-view.png](assets/screenshots/route-view.png) | 이동수단·구간 거리와 경로 보기 |
| [journey-summary.png](assets/screenshots/journey-summary.png) | 여행 전체의 기간·거리·이동수단 비중 |
| [settings.png](assets/screenshots/settings.png) | 여행 기간·카메라 설정 |
| [settings-display.png](assets/screenshots/settings-display.png) | 기본으로 꺼진 일시정지 시 전체 경로 옵션 |
| [route-view.mp4](assets/demos/route-view.mp4) | 경로 보기 약 30초 |
| [photo-journey.mp4](assets/demos/photo-journey.mp4) | 사진 여정 약 30초 |
| [route-preview.gif](assets/demos/route-preview.gif) | 경로 영상의 작은 미리보기 |
| [photos-preview.gif](assets/demos/photos-preview.gif) | 사진 영상의 작은 미리보기 |

## 촬영 조건

2026-09-20에 현재 PC에서 프로덕션 앱을 실행하고 Chromium의 실제 화면을 촬영했습니다. 화면 크기는 1440×900입니다. 여행 기록은 2026-03-17~31 일본 여행이며, 소유자가 현재 여행 기록·사진의 README 및 공개 저장소 사용을 허용했습니다.

영상을 위해 합성 UI나 사진을 만들지 않았습니다. 브라우저 화면 프레임의 시각을 유지해 약 30초씩 인코딩하며, MP4는 H.264·60fps·무음입니다. 매 화면 프레임을 수집했으며, 실제 캡처 평균은 경로 보기 56.85fps, 사진 여정 52.55fps였습니다. 원래 프레임 시각을 유지하고 필요한 구간에 마지막 화면을 유지해 60fps 파일로 저장했으며, 움직임을 합성하는 보간은 사용하지 않았습니다. GIF는 480×300·12fps로 줄인 8초 미리보기입니다. 이 측정값은 촬영 당시 PC와 장면에 한정됩니다.

촬영한 원시 프레임과 작업 로그는 `.cache/`에만 둡니다. 타임라인 JSON·사진 및 영상 원본 묶음·메타데이터 캐시는 공개 자산에 포함하지 않습니다. PNG와 MP4는 화면에 보이는 여행 장면·지역·날짜를 포함합니다.

## 자산을 갱신할 때

1. 최신 `main`에서 `npm ci`, `npm run build` 후 로컬 앱을 실행합니다.
2. 공개 가능한 데이터 범위를 먼저 확인하고 실제 UI에서 대표 장면을 선택합니다.
3. 지도와 사진 로딩을 확인한 뒤 1440×900으로 스크린샷과 약 30초 영상을 촬영합니다. 일반 장면은 **일시정지 시 전체 경로 표시**를 끄고, 여행 전체 요약에서는 전체 경로를 유지합니다.
4. 이동수단·날짜·사진 전환과 잘림·오류 화면 유무를 확인합니다. 원본 파일·개인 캐시를 자산 폴더로 복사하지 않습니다.
5. 캡처 프레임의 실제 시각과 평균 프레임률을 확인합니다. 60fps MP4와 12fps GIF, README의 링크·설명, 이 문서의 촬영 정보를 함께 갱신합니다.

`.gitignore`는 개인 영상을 기본 제외하고 `docs/assets/demos/*.mp4`만 공개 결과물로 허용합니다. 앱 배포 빌드에는 문서용 자산을 포함하지 않습니다.

화면 속 사진은 소유자의 자료입니다. 지도는 앱의 온라인 지도이며 [OpenFreeMap](https://openfreemap.org/)과 [OpenStreetMap 기여자](https://www.openstreetmap.org/copyright)의 출처 표시를 따릅니다. 사진과 지도에 별도의 오픈 라이선스를 부여하지 않습니다.
