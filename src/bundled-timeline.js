import { BUNDLED_TIMELINE } from '../data/timeline-bundle.js';

export async function loadBundledTimeline() {
  const json = BUNDLED_TIMELINE;
  if (!Array.isArray(json?.semanticSegments) || json.semanticSegments.length < 100) {
    throw new Error('내장 Timeline 데이터가 불완전합니다.');
  }
  return json;
}
