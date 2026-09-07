import { readFileSync, writeFileSync } from 'node:fs';

function replaceOnce(path, oldText, newText) {
  const source = readFileSync(path, 'utf8');
  const count = source.split(oldText).length - 1;
  if (count !== 1) throw new Error(`${path}: expected one match, found ${count}: ${oldText}`);
  writeFileSync(path, source.replace(oldText, newText));
}

replaceOnce(
  'src/types.ts',
  `export interface TimelineDateRange {
  startDate: string;
  endDate: string;
}

export interface TimelineScanResult extends TimelineDateRange {
  semanticSegments: number;
  recommendedRange?: TimelineDateRange;
}`,
  `export interface TimelineDateRange {
  startDate: string;
  endDate: string;
}

export interface TimelineTripCandidate extends TimelineDateRange {
  id: string;
  activeDays: number;
  distanceMeters: number;
  representativeCoordinate?: Coordinate;
  destinationHint?: string;
}

export interface TimelineScanResult extends TimelineDateRange {
  semanticSegments: number;
  recommendedRange?: TimelineDateRange;
  tripCandidates?: TimelineTripCandidate[];
}`
);

replaceOnce(
  'src/App.tsx',
  '      const preferred = preferredTripRange(scan.startDate, scan.endDate);',
  '      const preferred = preferredTripRange(scan);'
);
replaceOnce(
  'src/App.tsx',
  '<p className="setting-help">설정에 마우스를 올리거나 ? 버튼을 눌러 설명을 확인하세요.</p>',
  '<p className="setting-help">? 버튼에 마우스를 올리거나 눌러 설명을 확인하세요.</p>'
);

replaceOnce(
  'src/App.tsx',
  `          <section className="trip-range-control" aria-labelledby="trip-range-title">
            <div className="trip-range-heading">
              <div><span id="trip-range-title">여행 기간</span><strong>{formatTripRange(startDate, endDate)}</strong></div>
              <div className="trip-range-presets">
                <button type="button" onClick={() => {
                  const recommended = preferredTripRange(state.scan!.startDate, state.scan!.endDate);
                  setStartDate(recommended.startDate);
                  setEndDate(recommended.endDate);
                }}>추천 기간</button>
                <button type="button" onClick={() => {
                  setStartDate(state.scan!.startDate);
                  setEndDate(state.scan!.endDate);
                }}>전체 기간</button>
              </div>
            </div>
            <div className="trip-range-fields">
              <label><span>시작</span><input aria-label="여행 시작" type="date" value={startDate} min={state.scan.startDate} max={endDate || state.scan.endDate} onChange={event => setStartDate(event.target.value)} /></label>
              <span className="trip-range-arrow" aria-hidden="true">→</span>
              <label><span>마지막</span><input aria-label="여행 마지막 날" type="date" value={endDate} min={startDate || state.scan.startDate} max={state.scan.endDate} onChange={event => setEndDate(event.target.value)} /></label>
            </div>
          </section>`,
  `          <section className="trip-range-control" aria-labelledby="trip-range-title">
            <div className="trip-range-heading">
              <div><span id="trip-range-title">여행 기간</span><strong>{formatTripRange(startDate, endDate)}</strong></div>
              <div className="trip-range-presets">
                <button type="button" onClick={() => {
                  setStartDate(state.scan!.startDate);
                  setEndDate(state.scan!.endDate);
                }}>전체 기간</button>
              </div>
            </div>
            {!!state.scan.tripCandidates?.length && <div className="trip-candidate-list" aria-label="추천 여행 후보">
              <span className="trip-candidate-label">추천 여행</span>
              {state.scan.tripCandidates.map((candidate, index) => {
                const selected = startDate === candidate.startDate && endDate === candidate.endDate;
                return <button key={candidate.id} type="button" className={selected ? 'trip-candidate is-selected' : 'trip-candidate'} aria-pressed={selected} onClick={() => {
                  setStartDate(candidate.startDate);
                  setEndDate(candidate.endDate);
                }}>
                  <span><strong>{candidate.destinationHint ?? `추천 여행 ${index + 1}`}</strong><small>{formatTripRange(candidate.startDate, candidate.endDate)}</small></span>
                  <span className="trip-candidate-meta">{formatTripCandidateSummary(candidate)}</span>
                </button>;
              })}
            </div>}
            <div className="trip-range-fields">
              <label><span>시작</span><input aria-label="여행 시작" type="date" value={startDate} min={state.scan.startDate} max={endDate || state.scan.endDate} onChange={event => setStartDate(event.target.value)} /></label>
              <span className="trip-range-arrow" aria-hidden="true">→</span>
              <label><span>마지막</span><input aria-label="여행 마지막 날" type="date" value={endDate} min={startDate || state.scan.startDate} max={state.scan.endDate} onChange={event => setEndDate(event.target.value)} /></label>
            </div>
          </section>`
);

replaceOnce(
  'src/App.tsx',
  `function preferredTripRange(availableStart: string, availableEnd: string): { startDate: string; endDate: string } {
  return { startDate: availableStart, endDate: availableEnd };
}`,
  `function preferredTripRange(scan: import('./types').TimelineScanResult): { startDate: string; endDate: string } {
  const candidate = scan.tripCandidates?.[0] ?? scan.recommendedRange;
  if (
    candidate &&
    candidate.startDate >= scan.startDate &&
    candidate.endDate <= scan.endDate &&
    candidate.startDate <= candidate.endDate
  ) return { startDate: candidate.startDate, endDate: candidate.endDate };
  return { startDate: scan.startDate, endDate: scan.endDate };
}

function formatTripCandidateSummary(candidate: import('./types').TimelineTripCandidate): string {
  const start = Date.parse(`${candidate.startDate}T00:00:00Z`);
  const end = Date.parse(`${candidate.endDate}T00:00:00Z`);
  const days = Number.isFinite(start) && Number.isFinite(end) ? Math.max(1, Math.round((end - start) / 86_400_000) + 1) : Math.max(1, candidate.activeDays);
  const distanceKm = candidate.distanceMeters / 1_000;
  const distance = distanceKm >= 10 ? `${Math.round(distanceKm)}km` : `${distanceKm.toFixed(1)}km`;
  return `${days}일 · 이동 약 ${distance}`;
}`
);

replaceOnce(
  'src/App.test.tsx',
  `    fireEvent.click(screen.getByRole('button', { name: '추천 기간' }));
    expect(screen.getByLabelText('여행 시작')).toHaveValue('2026-03-01');
    expect(screen.getByLabelText('여행 마지막 날')).toHaveValue('2026-04-11');
    expect(rebuildButton).toBeDisabled();`,
  `    fireEvent.click(screen.getByRole('button', { name: '전체 기간' }));
    expect(screen.getByLabelText('여행 시작')).toHaveValue('2026-03-01');
    expect(screen.getByLabelText('여행 마지막 날')).toHaveValue('2026-04-11');
    expect(rebuildButton).toBeDisabled();`
);

const testPath = 'src/App.test.tsx';
const testSource = readFileSync(testPath, 'utf8');
const marker = `
  it('keeps live camera settings out of rebuild state and rebuilds only after a planned camera change', async () => {`;
if (!testSource.includes(marker)) throw new Error('App test insertion marker missing');
const addition = `

  it('offers multiple recommended trips with destination hints and lets the user select one', async () => {
    const worker: TimelineWorkerPort = {
      scan: vi.fn().mockResolvedValue({
        startDate: '2026-03-01', endDate: '2026-07-03', semanticSegments: 40,
        recommendedRange: { startDate: '2026-07-01', endDate: '2026-07-03' },
        tripCandidates: [
          { id: 'japan', startDate: '2026-07-01', endDate: '2026-07-03', activeDays: 3, distanceMeters: 2300000, destinationHint: '일본', representativeCoordinate: { lat: 35.67, lng: 139.65 } },
          { id: 'gangneung', startDate: '2026-05-02', endDate: '2026-05-04', activeDays: 3, distanceMeters: 380000, destinationHint: '강릉', representativeCoordinate: { lat: 37.75, lng: 128.88 } }
        ]
      }),
      plan: vi.fn().mockResolvedValue({ trip: {}, plan: simplePlan() }),
      cancel: vi.fn(),
      dispose: vi.fn()
    };
    render(<App workerClient={worker} />);
    fireEvent.change(screen.getByLabelText('시작할 Timeline JSON 선택'), { target: { files: [timelineFile()] } });
    await waitFor(() => expect(screen.getByRole('button', { name: '재생' })).toBeEnabled());
    expect(worker.plan).toHaveBeenCalledWith(expect.objectContaining({ startDate: '2026-07-01', endDate: '2026-07-03' }), expect.any(Function));

    fireEvent.click(screen.getByText('여행 설정'));
    expect(screen.getByRole('button', { name: /일본/ })).toHaveAttribute('aria-pressed', 'true');
    const gangneung = screen.getByRole('button', { name: /강릉/ });
    fireEvent.click(gangneung);
    expect(screen.getByLabelText('여행 시작')).toHaveValue('2026-05-02');
    expect(screen.getByLabelText('여행 마지막 날')).toHaveValue('2026-05-04');
    expect(gangneung).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '경로 다시 만들기' })).toBeEnabled();
  });
`;
writeFileSync(testPath, testSource.replace(marker, addition + marker));

replaceOnce(
  'src/settings-polish.css',
  `.trip-range-presets {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  width: 100%;
}`,
  `.trip-range-presets {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 8px;
  width: 100%;
}`
);

replaceOnce(
  'src/settings-polish.css',
  `.trip-range-presets button {
  width: 100%;
  min-height: 38px;
  padding: 0 10px;
  font-size: 12px;
}

.trip-range-fields {`,
  `.trip-range-presets button {
  width: 100%;
  min-height: 38px;
  padding: 0 10px;
  font-size: 12px;
}

.trip-candidate-list {
  display: grid;
  gap: 7px;
}

.trip-candidate-label {
  color: var(--muted);
  font-size: 12px;
  font-weight: 760;
}

.trip-candidate {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 54px;
  padding: 9px 11px;
  border: 1px solid rgba(255, 255, 255, .09);
  border-radius: 9px;
  background: rgba(255, 255, 255, .025);
  color: var(--paper);
  text-align: left;
  cursor: pointer;
}

.trip-candidate:hover,
.trip-candidate.is-selected {
  border-color: color-mix(in srgb, var(--accent) 55%, transparent);
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}

.trip-candidate > span:first-child {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.trip-candidate strong {
  font-size: 14px;
  font-weight: 820;
}

.trip-candidate small,
.trip-candidate-meta {
  color: var(--muted);
  font-size: 11px;
  font-style: normal;
}

.trip-candidate-meta {
  white-space: nowrap;
}

.trip-range-fields {`
);

console.log('Applied help tooltip and multi-trip recommendation UI patch.');
