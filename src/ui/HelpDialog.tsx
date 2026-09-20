import { Dialog } from './Dialog';

export function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <Dialog open={open} onClose={onClose} title="사용 안내" subtitle="타임라인으로 경로를 만들고, 사진과 영상을 함께 감상하세요.">
    <ol className="help-steps">
      <li><strong>타임라인 파일 준비하기</strong><p>스마트폰 Google 지도의 타임라인 설정에서 데이터를 내보낸 뒤 JSON 파일을 선택하세요. 내보내기 메뉴는 기기에 따라 다를 수 있습니다. 직접 선택하는 파일은 최대 250 MB까지 지원합니다.</p></li>
      <li><strong>여행 기간 확인하기</strong><p>파일을 열면 추천 여행의 경로를 준비합니다. 추천 여행이 없으면 전체 기간을 사용합니다. 다른 여행을 보고 싶다면 ‘여행 설정’에서 기간을 바꾼 뒤 ‘경로 다시 만들기’를 누르세요.</p></li>
      <li><strong>사진과 영상 더하기 <span className="optional-label">선택 사항</span></strong><p>‘사진 폴더’에서 여행 사진과 영상을 선택하세요. Google Takeout의 보조 JSON 파일도 같은 폴더에 두면 촬영 시각과 위치 정보를 보완할 수 있습니다.</p></li>
    </ol>
    <section className="help-section"><h3>감상 방식 선택하기</h3><dl className="view-mode-guide"><div><dt>경로 보기</dt><dd>지도에서 이동 경로를 따라갑니다.</dd></div><div><dt>사진 여정</dt><dd>사진과 영상을 감상하는 동안 경로 이동이 잠시 멈춥니다.</dd></div></dl><p>감상 방식을 바꿔도 각각 보던 위치를 기억합니다. 지도와 사진 사이의 분할선을 움직이면 화면 비율을 조절할 수 있습니다.</p></section>
    <section className="help-section"><h3>사진이 보이지 않을 때</h3><p>촬영 날짜가 선택한 여행 기간에 포함되는지 확인하세요. ‘사진 목록 관리’에서 감상에 포함된 사진과 촬영 시각의 출처를 확인할 수 있습니다.</p><p>HEIC/HEIF와 일부 영상은 브라우저에서 열리지 않을 수 있습니다. 이 경우 JPEG·PNG 또는 브라우저가 지원하는 영상 형식으로 변환해 주세요. 촬영 정보에 시간대가 없으면 기기의 시간대를 사용하고, 앱에는 한국 시간(UTC+9)으로 표시합니다.</p></section>
    <section className="help-section"><h3>파일과 개인정보</h3><p>타임라인과 사진·영상 원본은 외부로 업로드하지 않습니다. 온라인 지도는 인터넷을 사용합니다. 설치형 지도도 아직 저장되지 않은 지명 글꼴을 처음 표시할 때는 인터넷이 필요할 수 있습니다.</p><p>감상 설정은 이 브라우저에 저장됩니다. 직접 선택한 파일은 새로고침하면 다시 선택해야 합니다. ‘사진 목록’에서 제외한 항목도 새로고침하면 다시 포함됩니다.</p><p>‘정확한 장소 온라인 확인’은 기본으로 꺼져 있습니다. 장소 서비스를 연결하고 이 기능을 켜면, 위치 정보가 충분히 신뢰되는 사진의 GPS 좌표만 해당 서비스로 전송합니다. 원본 파일은 보내지 않으며 확인한 장소는 이 PC에 저장합니다.</p></section>
    <details className="help-details"><summary>파일 형식과 로컬 실행 안내</summary><p>스마트폰에서 내보낸 <code>semanticSegments</code> 형식의 타임라인을 지원합니다. 로컬 실행 시 앱 폴더 또는 상위 폴더의 <code>타임라인.json</code>과 <code>여행 사진</code>을 자동으로 불러옵니다.</p><p>장소 서비스와 설치형 지도는 저장소의 README에 따라 설정할 수 있습니다. PC의 로컬 주소는 휴대폰에서 열 수 없습니다. 모바일에서는 별도로 호스팅된 앱에서 해당 기기의 파일을 선택해야 합니다.</p></details>
    <section className="help-section"><h3>키보드 단축키</h3><dl className="shortcut-list"><div><dt><kbd>Space</kbd></dt><dd>재생 · 일시정지</dd></div><div><dt><kbd>←</kbd> <kbd>→</kbd></dt><dd>5초 뒤로 · 앞으로</dd></div><div><dt><kbd>Home</kbd></dt><dd>처음으로 이동</dd></div><div><dt><kbd>Esc</kbd></dt><dd>열린 창 닫기</dd></div></dl><p>날짜나 설정을 입력하는 동안에는 입력란의 키보드 동작이 우선합니다.</p></section>
  </Dialog>;
}
