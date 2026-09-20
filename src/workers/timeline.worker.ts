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
      sendProgress(request.requestId, 0.12, '타임라인 파일을 확인하고 있습니다.');
      timelineJson = parseTimelineJson(request.text);
      if (cancelled.has(request.requestId)) return sendCancelled(request.requestId);
      sendProgress(request.requestId, 0.72, '여행 기간을 확인하고 있습니다.');
      const result = scanTimeline(timelineJson);
      availableRange = { startDate: result.startDate, endDate: result.endDate };
      send({ type: 'SCAN_RESULT', requestId: request.requestId, result });
      return;
    }

    if (!timelineJson) throw new Error('타임라인 파일을 먼저 열어 주세요.');
    sendProgress(request.requestId, 0.18, '선택한 기간의 이동 경로를 확인하고 있습니다.');
    const trip = buildParsedTrip(timelineJson, request.options, request.options.includeFlights, availableRange ?? request.options);
    if (!trip.movements.length) throw new Error('선택한 기간에 이동 기록이 없습니다. 여행 기간을 넓혀 다시 시도해 주세요.');
    if (cancelled.has(request.requestId)) return sendCancelled(request.requestId);
    sendProgress(request.requestId, 0.55, '구간별 재생 시간을 맞추고 있습니다.');
    const plan = buildPlaybackPlan(trip.movements, request.options);
    if (cancelled.has(request.requestId)) return sendCancelled(request.requestId);
    sendProgress(request.requestId, 0.92, '지도 화면을 준비하고 있습니다.');
    send({ type: 'PLAN_RESULT', requestId: request.requestId, trip, plan });
  } catch (error) {
    send({
      type: 'ERROR',
      requestId: request.requestId,
      message: error instanceof Error ? error.message : '타임라인을 처리하지 못했습니다. 파일을 다시 선택해 주세요.'
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
