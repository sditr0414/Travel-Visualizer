/// <reference lib="webworker" />

import { analyzeMediaFilesInline } from './media-analysis';

self.addEventListener('message', (event: MessageEvent<{ files: File[] }>) => {
  void analyzeMediaFilesInline(event.data.files, progress => self.postMessage({ type: 'PROGRESS', progress }))
    .then(records => self.postMessage({ type: 'RESULT', records }))
    .catch(error => self.postMessage({ type: 'ERROR', message: error instanceof Error ? error.message : '미디어 분석에 실패했습니다.' }));
});
