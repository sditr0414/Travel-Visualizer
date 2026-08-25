export async function loadBundledTimeline() {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('이 브라우저는 기본 테스트 데이터의 gzip 압축 해제를 지원하지 않습니다. 최신 Chrome/Edge/Firefox를 사용하세요.');
  }

  const url = new URL('../data/trip-timeline.gz.b64', import.meta.url);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`테스트 데이터 로드 실패: ${url.pathname}`);

  const base64 = (await response.text()).trim();
  const binary = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
  const decompressed = new Blob([binary]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(decompressed).json();
}
