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
  statusMessage: '타임라인 파일을 열어 여행을 시작하세요.',
  error: null,
  mapStatus: null
};

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'LOAD_START':
      return { ...state, phase: 'loading', source: action.source, scan: null, plan: null, progress: 0, error: null, statusMessage: '타임라인을 읽고 있습니다.' };
    case 'PROGRESS':
      return { ...state, progress: action.progress, statusMessage: action.message };
    case 'SCAN_SUCCESS':
      return { ...state, phase: 'ready', scan: action.scan, progress: 1, error: null, statusMessage: '여행 기간을 확인했습니다.' };
    case 'PLAN_START':
      return { ...state, phase: 'planning', progress: 0, error: null, statusMessage: '여행 경로를 준비하고 있습니다.' };
    case 'PLAN_SUCCESS':
      return { ...state, phase: 'ready', plan: action.plan, progress: 1, error: null, statusMessage: '재생을 눌러 여행을 시작하세요.' };
    case 'PLAY':
      return { ...state, phase: 'playing', statusMessage: '여행 재생 중' };
    case 'PAUSE':
      return { ...state, phase: 'paused', statusMessage: '일시정지' };
    case 'RESET':
      return { ...state, phase: 'ready', statusMessage: '처음부터 재생할 수 있습니다.' };
    case 'COMPLETE':
      return { ...state, phase: 'complete', statusMessage: '여행을 모두 감상했습니다.' };
    case 'FAIL':
      return { ...state, phase: 'error', progress: 0, error: action.message, statusMessage: action.message };
    case 'MAP_STATUS':
      return { ...state, mapStatus: action.status };
    case 'NOTICE':
      return { ...state, statusMessage: action.message };
  }
}
