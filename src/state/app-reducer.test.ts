import { appReducer, initialAppState } from './app-reducer';
import { simplePlan } from '../test/fixtures';

describe('app state machine', () => {
  it('moves through load, ready, planning, play and completion states', () => {
    let state = appReducer(initialAppState, { type: 'LOAD_START', source: { kind: 'local-file', name: 'timeline.json' } });
    expect(state.phase).toBe('loading');
    state = appReducer(state, { type: 'SCAN_SUCCESS', scan: { startDate: '2026-04-10', endDate: '2026-04-10', semanticSegments: 1 } });
    expect(state.phase).toBe('ready');
    state = appReducer(state, { type: 'PLAN_START' });
    expect(state.phase).toBe('planning');
    state = appReducer(state, { type: 'PLAN_SUCCESS', plan: simplePlan() });
    state = appReducer(state, { type: 'PLAY' });
    expect(state.phase).toBe('playing');
    state = appReducer(state, { type: 'COMPLETE' });
    expect(state.phase).toBe('complete');
  });

  it('exposes failures as an explicit error state', () => {
    const state = appReducer(initialAppState, { type: 'FAIL', message: '잘못된 JSON' });
    expect(state.phase).toBe('error');
    expect(state.error).toBe('잘못된 JSON');
  });
});
