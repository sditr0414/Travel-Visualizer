import type {
  AnalysisOptions,
  ParsedTrip,
  PlaybackPlan,
  TimelineScanResult,
  TimelineSource,
  WorkerRequest,
  WorkerResponse
} from '../types';

type ProgressHandler = (progress: number, message: string) => void;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  onProgress?: ProgressHandler;
}

export interface TimelineWorkerPort {
  scan(source: TimelineSource, text: string, onProgress?: ProgressHandler): Promise<TimelineScanResult>;
  plan(options: AnalysisOptions, onProgress?: ProgressHandler): Promise<{ trip: ParsedTrip; plan: PlaybackPlan }>;
  cancel(): void;
  dispose(): void;
}

export class TimelineWorkerClient implements TimelineWorkerPort {
  private worker: Worker;
  private nextRequestId = 1;
  private currentRequestId: number | null = null;
  private pending = new Map<number, PendingRequest>();

  constructor() {
    this.worker = this.createWorker();
  }

  scan(source: TimelineSource, text: string, onProgress?: ProgressHandler): Promise<TimelineScanResult> {
    return this.send<TimelineScanResult>({ type: 'SCAN_TIMELINE', source, text }, onProgress);
  }

  plan(options: AnalysisOptions, onProgress?: ProgressHandler): Promise<{ trip: ParsedTrip; plan: PlaybackPlan }> {
    return this.send<{ trip: ParsedTrip; plan: PlaybackPlan }>({ type: 'PLAN_TRIP', options }, onProgress);
  }

  cancel(): void {
    if (this.currentRequestId === null) return;
    const requestId = this.currentRequestId;
    this.worker.postMessage({ type: 'CANCEL', requestId } satisfies WorkerRequest);
    this.pending.get(requestId)?.reject(new Error('작업을 취소했습니다.'));
    this.pending.delete(requestId);
    this.currentRequestId = null;
    this.worker.terminate();
    this.worker = this.createWorker();
  }

  dispose(): void {
    for (const request of this.pending.values()) request.reject(new Error('타임라인 분석이 종료되었습니다.'));
    this.pending.clear();
    this.worker.terminate();
  }

  private send<T>(
    request: Omit<Extract<WorkerRequest, { type: 'SCAN_TIMELINE' }>, 'requestId'>
      | Omit<Extract<WorkerRequest, { type: 'PLAN_TRIP' }>, 'requestId'>,
    onProgress?: ProgressHandler
  ): Promise<T> {
    const requestId = this.nextRequestId++;
    this.currentRequestId = requestId;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(requestId, { resolve: value => resolve(value as T), reject, onProgress });
      this.worker.postMessage({ ...request, requestId } as WorkerRequest);
    });
  }

  private createWorker(): Worker {
    const worker = new Worker(new URL('../workers/timeline.worker.ts', import.meta.url), { type: 'module' });
    worker.addEventListener('message', event => this.handleMessage(event.data as WorkerResponse));
    worker.addEventListener('error', () => {
      if (this.currentRequestId === null) return;
      this.pending.get(this.currentRequestId)?.reject(new Error('타임라인 분석을 시작하지 못했습니다. 새로고침한 뒤 다시 시도해 주세요.'));
      this.pending.delete(this.currentRequestId);
      this.currentRequestId = null;
    });
    return worker;
  }

  private handleMessage(message: WorkerResponse): void {
    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    if (message.type === 'PROGRESS') {
      pending.onProgress?.(message.progress, message.message);
      return;
    }
    this.pending.delete(message.requestId);
    if (this.currentRequestId === message.requestId) this.currentRequestId = null;
    if (message.type === 'ERROR') return pending.reject(new Error(message.message));
    if (message.type === 'CANCELLED') return pending.reject(new Error('작업을 취소했습니다.'));
    if (message.type === 'SCAN_RESULT') return pending.resolve(message.result);
    pending.resolve({ trip: message.trip, plan: message.plan });
  }
}
