import { BUNDLED_TIMELINE, BUNDLED_TIMELINE_META } from '../data/timeline-bundle.js';

export async function loadBundledTimeline() {
  const json = BUNDLED_TIMELINE;
  if (!Array.isArray(json?.semanticSegments) || json.semanticSegments.length < 100) {
    throw new Error('내장 Timeline 데이터가 불완전합니다.');
  }
  return json;
}

export function bundledTimelineMeta() {
  return BUNDLED_TIMELINE_META || {
    sourceName: '타임라인.json',
    fullTimeline: false,
    semanticSegments: BUNDLED_TIMELINE?.semanticSegments?.length || 0,
    rawSignals: 0
  };
}
