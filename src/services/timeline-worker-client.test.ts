import { TimelineWorkerClient } from './timeline-worker-client';

class FakeWorker extends EventTarget {
  static instances: FakeWorker[] = [];
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() { super(); FakeWorker.instances.push(this); }
}
const source = { kind: 'local-file' as const, name: 'private.json' };
beforeEach(() => { FakeWorker.instances = []; vi.stubGlobal('Worker', FakeWorker); });
afterEach(() => vi.unstubAllGlobals());

it('starts no analysis worker until a file is submitted, and releases it on dispose', async () => {
  const client = new TimelineWorkerClient();
  expect(FakeWorker.instances).toHaveLength(0);
  const scanning = client.scan(source, '{}');
  const worker = FakeWorker.instances[0];
  const result = { startDate: '2026-04-10', endDate: '2026-04-10', semanticSegments: 1 };
  worker.dispatchEvent(new MessageEvent('message', { data: { type: 'SCAN_RESULT', requestId: 1, result } }));
  await expect(scanning).resolves.toEqual(result);
  client.dispose();
  expect(worker.terminate).toHaveBeenCalledOnce();
  await expect(client.scan(source, '{}')).rejects.toThrow('종료');
  expect(FakeWorker.instances).toHaveLength(1);
});

it('rejects every waiting request on worker failure and starts a fresh worker on retry', async () => {
  const client = new TimelineWorkerClient();
  const results = Promise.allSettled([client.scan(source, '{}'), client.scan(source, '{}')]);
  const failed = FakeWorker.instances[0];
  failed.dispatchEvent(new Event('error'));
  expect((await results).every(result => result.status === 'rejected')).toBe(true);
  expect(failed.terminate).toHaveBeenCalledOnce();
  const retried = client.scan(source, '{}').catch(error => error);
  expect(FakeWorker.instances).toHaveLength(2);
  client.dispose();
  expect(await retried).toBeInstanceOf(Error);
});

it('cancels pending work without eagerly downloading another worker', async () => {
  const client = new TimelineWorkerClient();
  const cancelled = client.scan(source, '{}').catch(error => error);
  client.cancel();
  expect(await cancelled).toMatchObject({ message: '작업을 취소했습니다.' });
  expect(FakeWorker.instances).toHaveLength(1);
  expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
  client.dispose();
});
