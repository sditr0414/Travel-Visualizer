const PART_COUNT = 9;

export async function loadBundledTimeline() {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('이 브라우저는 기본 테스트 데이터의 gzip 압축 해제를 지원하지 않습니다. 최신 Chrome/Edge/Firefox를 사용하세요.');
  }

  const urls = Array.from({ length: PART_COUNT }, (_, index) =>
    new URL(`../data/timeline-parts/part-${String(index + 1).padStart(2, '0')}.txt`, import.meta.url)
  );

  const parts = await Promise.all(urls.map(async url => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`테스트 데이터 로드 실패: ${url.pathname}`);
    return (await response.text()).trim();
  }));

  const base64 = parts.join('');
  const binary = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
  const decompressed = new Blob([binary]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(decompressed).json();
}
