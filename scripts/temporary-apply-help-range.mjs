import { readFileSync, writeFileSync } from 'node:fs';

function replaceOnce(path, oldText, newText) {
  const source = readFileSync(path, 'utf8');
  const count = source.split(oldText).length - 1;
  if (count !== 1) throw new Error(`${path}: expected one match, found ${count}: ${oldText}`);
  writeFileSync(path, source.replace(oldText, newText));
}

replaceOnce(
  'src/App.tsx',
  '      const preferred = preferredTripRange(scan.startDate, scan.endDate);',
  '      const preferred = preferredTripRange(scan);'
);
replaceOnce(
  'src/App.tsx',
  '                  const recommended = preferredTripRange(state.scan!.startDate, state.scan!.endDate);',
  '                  const recommended = preferredTripRange(state.scan!);'
);
replaceOnce(
  'src/App.tsx',
  `function preferredTripRange(availableStart: string, availableEnd: string): { startDate: string; endDate: string } {
  return { startDate: availableStart, endDate: availableEnd };
}`,
  `function preferredTripRange(scan: import('./types').TimelineScanResult): { startDate: string; endDate: string } {
  const recommended = scan.recommendedRange;
  if (
    recommended &&
    recommended.startDate >= scan.startDate &&
    recommended.endDate <= scan.endDate &&
    recommended.startDate <= recommended.endDate
  ) return recommended;
  return { startDate: scan.startDate, endDate: scan.endDate };
}`
);

const testPath = 'src/App.test.tsx';
const testSource = readFileSync(testPath, 'utf8');
const marker = `
  it('keeps live camera settings out of rebuild state and rebuilds only after a planned camera change', async () => {`;
if (!testSource.includes(marker)) throw new Error('App test insertion marker missing');
const addition = `

  it('uses the scanned recommendation and restores it after selecting the full range', async () => {
    const worker: TimelineWorkerPort = {
      scan: vi.fn().mockResolvedValue({
        startDate: '2026-03-01', endDate: '2026-04-11', semanticSegments: 20,
        recommendedRange: { startDate: '2026-04-04', endDate: '2026-04-11' }
      }),
      plan: vi.fn().mockResolvedValue({ trip: {}, plan: simplePlan() }),
      cancel: vi.fn(),
      dispose: vi.fn()
    };
    render(<App workerClient={worker} />);
    fireEvent.change(screen.getByLabelText('시작할 Timeline JSON 선택'), {
      target: { files: [timelineFile()] }
    });
    await waitFor(() => expect(screen.getByRole('button', { name: '재생' })).toBeEnabled());
    expect(worker.plan).toHaveBeenCalledWith(
      expect.objectContaining({ startDate: '2026-04-04', endDate: '2026-04-11' }),
      expect.any(Function)
    );
    fireEvent.click(screen.getByText('여행 설정'));
    expect(screen.getByLabelText('여행 시작')).toHaveValue('2026-04-04');
    expect(screen.getByLabelText('여행 마지막 날')).toHaveValue('2026-04-11');
    fireEvent.click(screen.getByRole('button', { name: '전체 기간' }));
    expect(screen.getByLabelText('여행 시작')).toHaveValue('2026-03-01');
    fireEvent.click(screen.getByRole('button', { name: '추천 기간' }));
    expect(screen.getByLabelText('여행 시작')).toHaveValue('2026-04-04');
    expect(screen.getByLabelText('여행 마지막 날')).toHaveValue('2026-04-11');
  });
`;
writeFileSync(testPath, testSource.replace(marker, addition + marker));
