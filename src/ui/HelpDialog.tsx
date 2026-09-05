import { Dialog } from './Dialog';

export function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <Dialog open={open} onClose={onClose} title="처음 사용하는 분을 위한 안내" subtitle="내 파일을 준비하면 여행을 바로 재생할 수 있어요.">
    <ol className="help-steps">
      <li><strong>Google 지도에서 Timeline을 내보내세요</strong><p>스마트폰 Google 지도의 타임라인 설정에서 데이터를 내보낸 뒤 JSON 파일을 준비하세요. 메뉴 이름은 기기에 따라 다를 수 있습니다. 이 앱은 semanticSegments 형식의 Timeline을 읽습니다.</p></li>
      <li><strong>파일을 선택하고 여행 기간을 확인하세요</strong><p>Timeline을 선택하면 전체 기록으로 경로를 준비합니다. 기록이 길다면 ‘여행 설정’에서 원하는 날짜로 좁혀 ‘경로 만들기’를 누르세요.</p></li>
      <li><strong>사진은 원하면 연결하세요</strong><p>사진 폴더 또는 개별 사진·영상을 선택하세요. Takeout의 JSON 보조 파일도 같은 폴더에 두면 촬영 시각과 위치를 더 정확하게 읽을 수 있습니다.</p></li>
    </ol>
    <section className="help-section"><h3>두 가지 감상 방식</h3><p><strong>발자취</strong>는 이동 경로를 따라갑니다. <strong>사진 여정</strong>은 사진과 영상이 나올 때 경로를 잠시 멈춥니다. 두 모드는 각각 보던 위치를 기억합니다.</p></section>
    <section className="help-section"><h3>사진이 보이지 않나요?</h3><p>촬영 시각이 여행 기간과 맞는지 먼저 확인하세요. 시각 정보가 없으면 파일명이나 수정 시각을 사용합니다. HEIC/HEIF와 일부 영상 코덱은 브라우저가 지원하지 않을 수 있으므로 JPEG·PNG 또는 브라우저에서 재생되는 영상으로 바꿔 주세요.</p><p>촬영 시각에 시간대 정보가 없으면 현재 기기의 시간대를 사용합니다. 앱의 날짜 표시는 한국 시간(UTC+9) 기준입니다.</p></section>
    <section className="help-section"><h3>개인정보와 지도</h3><p>Timeline과 사진 원본은 외부로 업로드하지 않습니다. 온라인 지도는 배경 타일을 받기 위해 인터넷에 연결합니다. 로컬 지도도 일부 지명 글꼴을 인터넷에서 받을 수 있습니다.</p><p>설정만 이 브라우저에 저장합니다. 직접 선택한 파일은 새로고침하면 다시 선택해야 합니다. PC에서 실행한 로컬 서버에 휴대폰이 자동으로 연결되지는 않습니다. 모바일 화면에서는 해당 기기의 파일을 사용하세요.</p></section>
    <section className="help-section"><h3>키보드로 조작하기</h3><dl className="shortcut-list"><div><dt><kbd>Space</kbd></dt><dd>재생 / 일시정지</dd></div><div><dt><kbd>←</kbd> <kbd>→</kbd></dt><dd>5초 이전 / 이후</dd></div><div><dt><kbd>Home</kbd></dt><dd>처음으로 이동</dd></div><div><dt><kbd>Esc</kbd></dt><dd>열린 창 닫기</dd></div></dl><p>입력란을 편집 중일 때는 입력란의 기본 키보드 동작을 유지합니다.</p></section>
  </Dialog>;
}
