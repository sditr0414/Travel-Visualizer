/// <reference lib="webworker" />

import { buildPlaybackPlan } from '../domain/planner';
import { buildParsedTrip, parseTimelineJson, scanTimeline } from '../domain/timeline';
import type { TimelineDateRange, WorkerRequest, WorkerResponse } from '../types';

let timelineJson: ReturnType<typeof parseTimelineJson> | null = null;
let availableRange: TimelineDateRange | null = null;
const cancelled = new Set<number>();

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.type === 'CANCEL') {
    cancelled.add(request.requestId);
    send({ type: 'CANCELLED', requestId: request.requestId });
    return;
  }

  try {
    if (request.type === 'SCAN_TIMELINE') {
      sendProgress(request.requestId, 0.12, 'JSON 구조를 확인하고 있어요.');
      timelineJson = parseTimelineJson(request.text);
      if (cancelled.has(request.requestId)) return sendCancelled(request.requestId);
      sendProgress(request.requestId, 0.72, '여행 날짜를 찾고 있어요.');
      const result = scanTimeline(timelineJson);
      availableRange = { startDate: result.startDate, endDate: result.endDate };
      send({ type: 'SCAN_RESULT', requestId: request.requestId, result });
      return;
    }

    if (!timelineJson) throw new Error('먼저 Timeline 파일을 불러와 주세요.');
    sendProgress(request.requestId, 0.18, '선택한 날짜의 이동 구간을 분석하고 있어요.');
    const trip = buildParsedTrip(timelineJson, request.options, request.options.includeFlights, availableRange ?? request.options);
    if (!trip.movements.length) throw new Error('선택 기간에 재생할 이동 구간이 없습니다.');
    if (cancelled.has(request.requestId)) return sendCancelled(request.requestId);
    sendProgress(request.requestId, 0.55, '이동수단별 재생 시간을 배분하고 있어요.');
    const plan = buildPlaybackPlan(trip.movements, request.options);
    if (cancelled.has(request.requestId)) return sendCancelled(request.requestId);
    sendProgress(request.requestId, 0.92, '카메라 경로를 마무리하고 있어요.');
    send({ type: 'PLAN_RESULT', requestId: request.requestId, trip, plan });
  } catch (error) {
    send({
      type: 'ERROR',
      requestId: request.requestId,
      message: error instanceof Error ? error.message : 'Timeline 처리에 실패했습니다.'
    });
  }
});

function sendProgress(requestId: number, progress: number, message: string): void {
  send({ type: 'PROGRESS', requestId, progress, message });
}

function sendCancelled(requestId: number): void {
  cancelled.delete(requestId);
  send({ type: 'CANCELLED', requestId });
}

function send(message: WorkerResponse): void {
  self.postMessage(message);
}
