import { Dialog } from './Dialog';
import { canUseLocalApi } from '../services/local-api';

export function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const local = canUseLocalApi();
  return <Dialog open={open} onClose={onClose} title="사용 안내">
    <ol className="help-steps">
      <li>
        <strong>타임라인 파일 열기</strong>
        <p>스마트폰 Google 지도의 타임라인 설정에서 데이터를 내보낸 뒤 JSON 파일을 선택하세요. 최대 250 MB까지 지원합니다.</p>
      </li>
      <li>
        <strong>여행 기간 확인하기</strong>
        <p>추천 여행으로 경로가 준비됩니다. 다른 기간은 ‘여행 설정’에서 선택한 뒤 ‘경로 다시 만들기’를 누르세요.</p>
      </li>
      <li>
        <strong>사진과 영상 더하기 <span className="optional-label">선택</span></strong>
        <p>여행 사진이 담긴 폴더나 개별 파일을 선택하세요. ‘경로 보기’와 ‘사진 여정’을 오가며 재생할 수 있습니다.</p>
      </li>
    </ol>
    <details className="help-details">
      <summary>사진이 보이지 않을 때</summary>
      <p>촬영 날짜가 여행 기간 안에 있는지 확인하세요. ‘사진 목록 관리’에서 제외한 사진, 촬영 시각과 시간대를 확인할 수 있습니다.</p>
      <p>Google Takeout의 보조 JSON 파일을 함께 선택하면 촬영 정보가 보완됩니다. HEIC/HEIF와 일부 영상은 JPEG·PNG 또는 브라우저가 지원하는 영상 형식으로 변환해야 합니다.</p>
      <p>시간대가 없는 촬영 정보는 사진 목록의 ‘촬영 시간대’ 설정을 따르며, 기본값은 기기 시간대입니다. 여행 화면에는 한국 시간(UTC+9)으로 표시합니다.</p>
    </details>
    <details className="help-details">
      <summary>여행 저장과 개인정보</summary>
      <p>타임라인과 사진·영상 원본은 외부로 업로드하지 않습니다. 지도는 인터넷으로 불러오며, 보거나 미리 불러오는 영역이 지도 서버 요청에 반영됩니다.</p>
      <p>설정은 이 브라우저에 남습니다. 여행 기간, 제외한 사진과 재생 위치는 ‘여행 저장·열기’로 저장하세요. 새로고침하거나 다른 기기에서 열면 원본 파일을 다시 선택해야 합니다.</p>
      {local && <p>‘정확한 장소 온라인 확인’을 켜면 신뢰 가능한 사진 GPS 좌표를 연결한 장소 서비스로 전송합니다. 원본은 보내지 않으며 확인한 장소는 이 PC에 저장합니다.</p>}
    </details>
    <details className="help-details">
      <summary>{local ? '지원 파일과 로컬 실행' : '지원 파일과 브라우저'}</summary>
      <p>스마트폰에서 내보낸 <code>semanticSegments</code> 형식의 타임라인을 지원합니다. 내보내기 메뉴는 기기마다 다를 수 있습니다.</p>
      {local ? <>
        <p>로컬 실행 시 앱 폴더 또는 상위 폴더의 <code>타임라인.json</code>과 <code>여행 사진</code>을 자동으로 불러옵니다. 장소 서비스 연결 방법은 저장소의 ‘파일과 개인정보’ 문서에서 확인하세요.</p>
        <p>PC의 로컬 주소는 휴대폰에서 열 수 없습니다. 모바일에서는 웹앱을 열어 해당 기기의 파일을 선택하세요.</p>
      </> : <p>최신 브라우저에서 이용해 주세요. 사진과 영상의 지원 형식은 브라우저마다 다릅니다.</p>}
    </details>
    <details className="help-details">
      <summary>감상 조작과 단축키</summary>
      <p>사진 여정은 사진과 영상을 감상하는 동안 이동을 잠시 멈춥니다. 감상 모드를 바꿔도 각각 보던 위치를 기억하며, 지도와 사진 사이의 분할선으로 화면 비율을 조절할 수 있습니다.</p>
      <dl className="shortcut-list"><div><dt><kbd>Space</kbd></dt><dd>재생 · 일시정지</dd></div><div><dt><kbd>←</kbd> <kbd>→</kbd></dt><dd>5초 뒤로 · 앞으로</dd></div><div><dt><kbd>Home</kbd></dt><dd>처음으로</dd></div><div><dt><kbd>Esc</kbd></dt><dd>열린 창 닫기</dd></div></dl>
      <p>입력란에서는 해당 입력란의 키보드 동작이 우선합니다.</p>
    </details>
  </Dialog>;
}
