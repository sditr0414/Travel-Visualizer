import type {
  AppPhase,
  MapStatus,
  PlaybackPlan,
  TimelineScanResult,
  TimelineSource
} from '../types';

export interface AppState {
  phase: AppPhase;
  source: TimelineSource | null;
  scan: TimelineScanResult | null;
  plan: PlaybackPlan | null;
  progress: number;
  statusMessage: string;
  error: string | null;
  mapStatus: MapStatus | null;
}

export type AppAction =
  | { type: 'LOAD_START'; source: TimelineSource }
  | { type: 'PROGRESS'; progress: number; message: string }
  | { type: 'SCAN_SUCCESS'; scan: TimelineScanResult }
  | { type: 'PLAN_START' }
  | { type: 'PLAN_SUCCESS'; plan: PlaybackPlan }
  | { type: 'PLAY' }
  | { type: 'PAUSE' }
  | { type: 'RESET' }
  | { type: 'COMPLETE' }
  | { type: 'FAIL'; message: string }
  | { type: 'MAP_STATUS'; status: MapStatus }
  | { type: 'NOTICE'; message: string };

export const initialAppState: AppState = {
  phase: 'idle',
  source: null,
  scan: null,
  plan: null,
  progress: 0,
  statusMessage: 'Timeline JSON을 선택해 시작하세요.',
  error: null,
  mapStatus: null
};

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'LOAD_START':
      return { ...state, phase: 'loading', source: action.source, plan: null, progress: 0, error: null, statusMessage: 'Timeline을 읽고 있어요.' };
    case 'PROGRESS':
      return { ...state, progress: action.progress, statusMessage: action.message };
    case 'SCAN_SUCCESS':
      return { ...state, phase: 'ready', scan: action.scan, progress: 1, error: null, statusMessage: '날짜 범위를 확인했어요.' };
    case 'PLAN_START':
      return { ...state, phase: 'planning', progress: 0, error: null, statusMessage: '경로와 카메라를 계산하고 있어요.' };
    case 'PLAN_SUCCESS':
      return { ...state, phase: 'ready', plan: action.plan, progress: 1, error: null, statusMessage: '준비 완료 · 재생을 눌러 시작하세요.' };
    case 'PLAY':
      return { ...state, phase: 'playing', statusMessage: '여행을 재생하고 있어요.' };
    case 'PAUSE':
      return { ...state, phase: 'paused', statusMessage: '일시정지' };
    case 'RESET':
      return { ...state, phase: 'ready', statusMessage: '처음 위치로 돌아왔어요.' };
    case 'COMPLETE':
      return { ...state, phase: 'complete', statusMessage: '여행 재생이 끝났어요.' };
    case 'FAIL':
      return { ...state, phase: 'error', progress: 0, error: action.message, statusMessage: action.message };
    case 'MAP_STATUS':
      return { ...state, mapStatus: action.status };
    case 'NOTICE':
      return { ...state, statusMessage: action.message };
  }
}
