const PARTS = [
  'part-01.txt',
  'part-02.txt',
  'part-03.txt',
  'part-04.txt',
  'part-05.txt',
  'part-06.txt',
  'part-07.txt',
  'part-08.txt',
  'part-09.txt'
];

export async function loadBundledTimeline() {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('이 브라우저는 기본 테스트 데이터의 gzip 압축 해제를 지원하지 않습니다. 최신 Chrome/Edge/Firefox를 사용하세요.');
  }

  const chunks = await Promise.all(PARTS.map(async name => {
    const url = new URL(`../data/timeline-parts/${name}`, import.meta.url);
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`테스트 데이터 조각 로드 실패: ${name}`);
    return (await response.text()).replace(/\s+/g, '');
  }));

  const base64 = chunks.join('');
  if (!base64.startsWith('H4sI')) {
    throw new Error('내장 Timeline 압축 데이터가 올바르지 않습니다.');
  }

  const binary = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
  const decompressed = new Blob([binary]).stream().pipeThrough(new DecompressionStream('gzip'));
  const json = await new Response(decompressed).json();

  if (!Array.isArray(json?.semanticSegments) || json.semanticSegments.length < 100) {
    throw new Error('내장 Timeline 데이터가 불완전합니다.');
  }
  return json;
}
