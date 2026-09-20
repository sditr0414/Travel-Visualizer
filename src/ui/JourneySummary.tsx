import type { CSSProperties } from 'react';
import type { JourneySummaryData } from '../domain/journey-summary';
import { formatMovementDistance, MOVEMENT_VISUALS } from '../domain/movement-presentation';

export function JourneySummary({ summary }: { summary: JourneySummaryData }) {
  const { period, distanceMeters, movements } = summary;
  return (
    <section className="journey-summary" aria-label="전체 여정 분석" tabIndex={0}>
      <h2>여행 전체</h2>
      {period && <p className="journey-summary-period">
        <span><time dateTime={period.startDate}>{formatDate(period.startDate)}</time>
          {period.startDate !== period.endDate && <> – <time dateTime={period.endDate}>{formatDate(period.endDate)}</time></>}</span>
        <span className="journey-summary-days">총 {period.days.toLocaleString('ko-KR')}일</span>
      </p>}
      <div className="journey-summary-total">
        <span>총 이동거리</span>
        <strong>{distanceMeters === null ? '—' : formatMovementDistance(distanceMeters)}</strong>
      </div>
      {movements.length > 0 && <>
        <h3>이동 수단별 거리 <span>비중</span></h3>
        <ul className="journey-summary-movements">
          {movements.map(movement => {
            const visual = MOVEMENT_VISUALS[movement.mobilityClass];
            const percent = movement.share * 100;
            return <li key={movement.mobilityClass}>
              <span className="journey-summary-mode"><span aria-hidden="true">{visual.icon}</span>{visual.label}</span>
              <span className="journey-summary-distance">{formatMovementDistance(movement.distanceMeters)}</span>
              <span className="journey-summary-share">{percent > 0 && percent < 0.1 ? '<0.1' : percent.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}%</span>
              <span className="journey-summary-bar" aria-hidden="true" style={{ '--movement-share': `${percent}%` } as CSSProperties} />
            </li>;
          })}
        </ul>
      </>}
    </section>
  );
}

function formatDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return `${year}.${month}.${day}`;
}
