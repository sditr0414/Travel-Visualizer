import { BUNDLED_TIMELINE_GZIP_BASE64 } from '../data/timeline-bundle.js';

export async function loadBundledTimeline() {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('이 브라우저는 기본 테스트 데이터의 gzip 압축 해제를 지원하지 않습니다. 최신 Chrome/Edge/Firefox를 사용하세요.');
  }

  const base64 = String(BUNDLED_TIMELINE_GZIP_BASE64 || '').replace(/\s+/g, '');
  if (!base64.startsWith('H4sI')) {
    throw new Error('내장 Timeline 압축 데이터가 올바르지 않습니다.');
  }

  let binary;
  try {
    binary = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
  } catch {
    throw new Error('내장 Timeline base64 데이터가 손상되었습니다.');
  }

  try {
    const decompressed = new Blob([binary]).stream().pipeThrough(new DecompressionStream('gzip'));
    const json = await new Response(decompressed).json();
    if (!Array.isArray(json?.semanticSegments) || json.semanticSegments.length < 100) {
      throw new Error('내장 Timeline 데이터가 불완전합니다.');
    }
    return json;
  } catch (error) {
    throw new Error(`내장 Timeline 압축 해제 실패: ${error.message}`);
  }
}
