import { MOVEMENT_VISUALS } from '../domain/movement-presentation';
import type { MobilityClass } from '../types';

const dateFormat = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short', timeZone: 'Asia/Seoul' });
const timeFormat = new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Seoul' });
const rangeFormat = new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Seoul' });

export function RouteSceneDetails({ mobilityClass, mobility, speed, distance, originCity, destinationCity, sourceMs, segmentStartMs, segmentEndMs }: {
  mobilityClass: MobilityClass; mobility: string; speed: string; distance: string | null;
  originCity: string | null; destinationCity: string | null;
  sourceMs: number | null; segmentStartMs: number | null; segmentEndMs: number | null;
}) {
  const places = originCity && destinationCity
    ? originCity === destinationCity ? originCity : `${originCity} → ${destinationCity}`
    : originCity ? `${originCity} → 지역명 없음` : destinationCity ? `지역명 없음 → ${destinationCity}` : '지역명 없음';
  return <section className="route-bottom-scene" aria-label="하단 현재 장면 정보">
    <div className="bottom-scene-movement">
      <span className="bottom-scene-label">현재 장면</span>
      <strong className="bottom-scene-mobility"><span aria-hidden="true">{MOVEMENT_VISUALS[mobilityClass].icon}</span> {mobility}</strong>
      <span className="bottom-scene-metrics">{[speed, distance].filter(Boolean).join(' · ')}</span>
    </div>
    <div className="bottom-scene-route">
      <span className="bottom-scene-label">이동 지역</span>
      <strong title="지도에서 확인한 주변 도시">{places}</strong>
      {segmentStartMs !== null && segmentEndMs !== null && <span className="bottom-scene-range">구간 {rangeFormat.format(segmentStartMs)} → {rangeFormat.format(segmentEndMs)}</span>}
    </div>
    <div className="bottom-scene-time">
      <span className="bottom-scene-label">여행 시각 · 한국 시간</span>
      {sourceMs !== null && <time dateTime={new Date(sourceMs).toISOString()}><strong>{timeFormat.format(sourceMs)}</strong><span>{dateFormat.format(sourceMs)}</span></time>}
    </div>
  </section>;
}
