import { readLocalMediaMetadata } from './image-metadata.js';

const WORKER_BATCH_SIZE = 6;

self.addEventListener('message', async event => {
  const files = Array.isArray(event?.data?.files) ? event.data.files : [];
  const results = new Array(files.length).fill(null);

  try {
    for (let start = 0; start < files.length; start += WORKER_BATCH_SIZE) {
      const chunk = files.slice(start, start + WORKER_BATCH_SIZE);
      const metadata = await Promise.all(chunk.map(file => readLocalMediaMetadata(file)));
      for (let offset = 0; offset < metadata.length; offset += 1) {
        results[start + offset] = metadata[offset] || null;
      }

      self.postMessage({
        type: 'progress',
        processed: Math.min(files.length, start + chunk.length),
        total: files.length
      });
    }

    self.postMessage({ type: 'complete', results });
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: error?.message || '로컬 미디어 메타데이터 분석에 실패했습니다.'
    });
  }
});
