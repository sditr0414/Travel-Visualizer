export type AppPhase =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'planning'
  | 'playing'
  | 'paused'
  | 'complete'
  | 'error';

export type MobilityClass =
  | 'WALK'
  | 'BIKE'
  | 'URBAN_TRANSIT'
  | 'FAST_GROUND'
  | 'FERRY'
  | 'FLIGHT'
  | 'ROAD'
  | 'UNKNOWN';

export interface Coordinate {
  lat: number;
  lng: number;
}

export interface TimedCoordinate extends Coordinate {
  timeMs?: number;
  inferred?: boolean;
}

export interface TimelineSource {
  kind: 'local-file';
  name: string;
}

export interface TimelineDateRange {
  startDate: string;
  endDate: string;
}

export interface TimelineScanResult extends TimelineDateRange {
  semanticSegments: number;
}

export interface Movement {
  startMs: number;
  endMs: number;
  start: Coordinate;
  end: Coordinate;
  points: TimedCoordinate[];
  distanceMeters: number;
  pathDistanceMeters?: number;
  durationSec: number;
  avgSpeedKmh: number;
  googleType: string;
  googleProbability: number;
  activityProbability: number;
  inferred: boolean;
  inferenceSource?: string;
}

export interface Visit {
  startMs: number;
  endMs: number;
  point: Coordinate;
  placeId: string | null;
  probability: number;
}

export interface ParsedTrip {
  movements: Movement[];
  routePoints: TimedCoordinate[];
  visits: Visit[];
  timelinePaths: Array<{ startMs: number; endMs: number; points: TimedCoordinate[] }>;
  availableRange: TimelineDateRange;
}

export interface DurationLimits {
  minSeconds: number;
  recommendedSeconds: number;
  maxSeconds: number;
  days: number;
  distanceKm: number;
}

export interface PlaybackSegment extends Movement {
  index: number;
  videoSec: number;
  startVideoSec: number;
  endVideoSec: number;
  sceneId: number;
  inference: {
    mobilityClass: MobilityClass;
    confidence: number;
    speedKmh: number;
    distanceKm: number;
  };
}

export interface TravelFrame {
  kind: 'TRAVEL';
  timeSec: number;
  segmentIndex: number;
  sceneId: number;
  sceneBreak?: boolean;
  progress: number;
  position: Coordinate;
  center: Coordinate;
  lockedCenter?: Coordinate;
  zoom: number;
  lockedZoom?: number;
  speedKmh: number;
  mobilityClass: MobilityClass;
  targetZoom?: number;
  targetCenterX?: number;
  targetCenterY?: number;
  maxPanPxPerSec?: number;
  cameraMode?: CameraMode;
  dayKey?: string;
  dayZoom?: number;
  segmentZoom?: number;
  longDistanceException?: boolean;
  modeBaseTargetZoom?: number;
  modeTargetZoom?: number;
}

export interface OutroFrame {
  kind: 'OUTRO';
  timeSec: number;
  center: Coordinate;
  position: Coordinate;
  zoom: number;
  targetZoom?: number;
}

export type PlaybackFrame = TravelFrame | OutroFrame;

export interface PlaybackPlan {
  frames: PlaybackFrame[];
  segments: PlaybackSegment[];
  fps: number;
  durationSec: number;
  travelDurationSec: number;
  outroStartSec: number;
  outroSec: number;
  durationLimits: DurationLimits;
  routeRenderPoints: TimedCoordinate[];
  pacingMode: 'LOCAL_DAYS' | 'GLOBAL';
  cameraMode: CameraMode;
  zoomOffset?: number;
  autoCloserBias?: number;
  autoLockedCloserBias?: number;
}

export type CameraMode = 'AUTO' | 'DAY' | 'SEGMENT';
export type PacingMode = 'LOCAL_DAYS' | 'GLOBAL';

export interface AnalysisOptions extends TimelineDateRange {
  includeFlights: boolean;
  targetDurationSec: number;
  viewportWidth: number;
  viewportHeight: number;
  cameraMode: CameraMode;
  zoomOffset: number;
  pacingMode: PacingMode;
}

export interface JourneyMedia {
  id: string;
  file: File | null;
  sourceUrl?: string;
  kind: 'image' | 'video';
  title: string;
  takenMs: number;
  lat: number | null;
  lng: number | null;
  metadataSource: MediaMetadataSource;
  playbackSec: number;
  matchedLat: number;
  matchedLng: number;
  positionSource: 'gps' | 'timeline';
  groupId: string;
  groupIndex: number;
  groupCount: number;
  sourceCount: number;
}

export interface LocalMediaManifestItem {
  id: string;
  name: string;
  size: number;
  lastModified: number;
  kind: 'image' | 'video';
  metadata?: {
    takenMs: number;
    lat: number | null;
    lng: number | null;
    source: MediaMetadataSource;
  } | null;
}

export interface LocalMediaManifest {
  available: boolean;
  rootName: string;
  count: number;
  totalBytes: number;
  items: LocalMediaManifestItem[];
}

export type MediaMetadataSource = 'takeout-sidecar' | 'embedded-exif' | 'filename-time' | 'file-time';
export type PhotoViewMode = 'PREVIEW' | 'ALL';

export interface MediaMetadataRecord {
  fileIndex: number;
  title: string;
  takenMs: number;
  lat: number | null;
  lng: number | null;
  source: MediaMetadataSource;
}

export interface MediaImportProgress {
  phase: 'PREPARE' | 'METADATA' | 'SIDECAR' | 'MATCH' | 'BUILD' | 'COMPLETE';
  processed: number;
  total: number;
  message: string;
}

export interface PlaybackStop {
  id: string;
  atSec: number;
  durationSec: number;
}

export type MapSourceConfig =
  | { kind: 'online'; styleUrl: string }
  | { kind: 'local-pmtiles'; worldUrl: string; regionUrl: string };

export interface MapStatus {
  ready: boolean;
  world: boolean;
  region: boolean;
  worldBytes: number;
  regionBytes: number;
}

export type WorkerRequest =
  | { type: 'SCAN_TIMELINE'; requestId: number; source: TimelineSource; text: string }
  | { type: 'PLAN_TRIP'; requestId: number; options: AnalysisOptions }
  | { type: 'CANCEL'; requestId: number };

export type WorkerResponse =
  | { type: 'PROGRESS'; requestId: number; progress: number; message: string }
  | { type: 'SCAN_RESULT'; requestId: number; result: TimelineScanResult }
  | { type: 'PLAN_RESULT'; requestId: number; trip: ParsedTrip; plan: PlaybackPlan }
  | { type: 'CANCELLED'; requestId: number }
  | { type: 'ERROR'; requestId: number; message: string };
