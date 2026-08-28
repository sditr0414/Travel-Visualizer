export * from './photo-journey-v3.js';

import {
  JourneyMode,
  PhotoJourneyController as PhotoJourneyControllerV3,
  VideoPlaybackMode,
  activePhotoBeatAtTime,
  buildPhotoJourneyBeats as buildPhotoJourneyBeatsV3,
  formatPhotoTimestamp
} from './photo-journey-v3.js';
import { getActiveMediaLibrary, MediaLibrarySource } from './media-library-state.js';
import { PHOTO_SPLIT_BREAKPOINT } from './photo-split-layout.js';
import { koreanJapanesePlaceName } from './japanese-place-ko.js';

const VIDEO_THUMB_PREFIX = '__tc_video_thumb__';
const ADMIN_LAYER_HINT = /place|city|town|village|locality|municip|district|ward|borough|neigh|suburb|quarter|hamlet|prefecture|region|province|state|county/i;

const MOVEMENT_VISUALS = Object.freeze({
  WALK: { icon: '🚶', label: '도보 이동' },
  BIKE: { icon: '🚲', label: '자전거 이동' },
  URBAN_TRANSIT: { icon: '🚇', label: '도시교통 이동' },
  ROAD: { icon: '🚗', label: '도로 이동' },
  FAST_GROUND: { icon: '🚆', label: '철도 이동' },
  FERRY: { icon: '⛴', label: '페리 이동' },
  FLIGHT: { icon: '✈', label: '항공 이동' },
  UNKNOWN: { icon: '●', label: '이동 중' }
});

export class PhotoJourneyController extends PhotoJourneyControllerV3 {
  constructor(options) {
    super(options);
    this.movementIndicator = ensureMovementIndicator(this.layer);
  }

  render(frame, frameIndex) {
    if (!this.enabled || !this.plan || frame?.kind !== 'TRAVEL') {
      this.hideMovementIndicator();
      super.render(frame, frameIndex);
      return;
    }

    const beat = activePhotoBeatAtTime(this.beats, frame.timeSec);
    if (beat) {
      this.hideMovementIndicator();
      super.render(frame, frameIndex);
      return;
    }

    super.clearActive();
    this.showMovementIndicator(frame);
  }

  showMovementIndicator(frame) {
    if (!this.movementIndicator || frame?.mediaHold) {
      this.hideMovementIndicator();
      return;
    }
    const visual = movementVisualForMobility(frame?.mobilityClass);
    const icon = this.movementIndicator.querySelector('.journey-movement-icon');
    const label = this.movementIndicator.querySelector('.journey-movement-label');
    if (icon) icon.textContent = visual.icon;
    if (label) label.textContent = visual.label;
    positionMovementIndicator(this.movementIndicator);
    this.movementIndicator.hidden = false;
  }

  hideMovementIndicator() {
    if (this.movementIndicator) this.movementIndicator.hidden = true;
  }

  renderBeat(beat) {
    this.revokeUrls();
    this.images.replaceChildren();
    this.images.dataset.count = '1';

    const item = beat.photos[0];
    if (item) {
      const figure = document.createElement('figure');
      figure.className = `photo-frame${item.mediaType === 'video' ? ' video-frame' : ''}`;
      const node = createJourneyMediaNode(item, beat.videoMode, this.objectUrls);
      if (node) {
        node.addEventListener('error', () => {
          figure.classList.add('photo-load-error');
          node.remove();
          const fallback = document.createElement('span');
          fallback.textContent = item.mediaType === 'video' ? '영상 재생 불가' : '미리보기 불가';
          figure.append(fallback);
        }, { once: true });
        figure.append(node);
      } else {
        figure.classList.add('photo-load-error');
        const fallback = document.createElement('span');
        fallback.textContent = item.mediaType === 'video' ? '영상 재생 불가' : '미리보기 불가';
        figure.append(fallback);
      }

      if (item.mediaType === 'video') {
        const badge = document.createElement('span');
        badge.className = 'video-media-badge';
        badge.textContent = beat.videoMode === VideoPlaybackMode.PLAY ? '▶ 영상 재생' : '▶ 영상 썸네일';
        figure.append(badge);
      }
      this.images.append(figure);
    }

    this.place.textContent = beat.placeName || '장소 확인 중…';
    this.time.textContent = formatPhotoTimestamp(beat.takenMs);
    const sourceLabel = beat.positionSource === 'gps' ? '사진 GPS' : 'Timeline 위치 추정';
    const ordinal = beat.sourceCount > 1 ? ` · ${Number(beat.mediaItemIndex || 0) + 1}/${Math.min(beat.sourceCount, 3)}` : '';
    const mediaLabel = item?.mediaType === 'video' ? ' · 영상' : ' · 사진';
    this.meta.textContent = `${sourceLabel}${mediaLabel}${ordinal}`;
    this.card.hidden = false;
    this.card.classList.add('media-stop-card');
    this.layer.classList.add('media-stop-active');
    this.setPhotoAnchor(beat.anchor);
  }

  resolvePlaceName(anchorPx) {
    const features = collectAdministrativeFeatures(this.map, anchorPx);
    const administrative = administrativePlaceLabel(features, anchorPx, coordinate => this.map.project(coordinate));
    return administrative || super.resolvePlaceName(anchorPx);
  }
}

export function movementVisualForMobility(mobilityClass) {
  return MOVEMENT_VISUALS[String(mobilityClass || '').toUpperCase()] || MOVEMENT_VISUALS.UNKNOWN;
}

export function buildPhotoJourneyBeats(media, plan, options = {}) {
  const beats = buildPhotoJourneyBeatsV3(media, plan, options);
  const activeLibrary = getActiveMediaLibrary();

  if (activeLibrary.source === MediaLibrarySource.LOCAL_GALLERY && activeLibrary.media === media) {
    const photos = media.filter(item => item?.mediaType !== 'video').length;
    const videos = media.length - photos;
    scheduleLocalReadyStatus(photos, videos, beats.length);
  }
  return beats;
}

/**
 * Resolve a photo GPS point to administrative labels rather than a nearby POI.
 * When city-level data is available, all usable lower administrative levels are
 * appended in hierarchy order (city -> district/ward -> neighborhood/locality).
 * Region/prefecture is only used as a fallback when city-level data is absent.
 */
export function administrativePlaceLabel(features, anchorPx, projectCoordinate = null) {
  const candidates = [];
  for (const feature of features || []) {
    const name = administrativeFeatureName(feature?.properties);
    if (!name) continue;
    const level = administrativeFeatureLevel(feature);
    if (!level) continue;

    let distance = 9999;
    const coordinate = representativeFeatureCoordinate(feature?.geometry);
    if (coordinate && typeof projectCoordinate === 'function') {
      try {
        const point = projectCoordinate(coordinate);
        if (Number.isFinite(point?.x) && Number.isFinite(point?.y)) {
          distance = Math.hypot(point.x - Number(anchorPx?.x || 0), point.y - Number(anchorPx?.y || 0));
        }
      } catch {}
    }

    const maxDistance = level === 'locality' ? 220 : level === 'district' ? 320 : level === 'city' ? 560 : 760;
    if (distance !== 9999 && distance > maxDistance) continue;
    candidates.push({ name, level, distance });
  }

  const nearest = level => candidates
    .filter(item => item.level === level)
    .sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name))[0] || null;

  const city = nearest('city');
  const district = nearest('district');
  const locality = nearest('locality');
  const region = nearest('region');
  const parts = [];

  if (city?.name) {
    parts.push(city.name);
    appendAdministrativePart(parts, district?.name);
    appendAdministrativePart(parts, locality?.name);
  } else {
    appendAdministrativePart(parts, region?.name);
    appendAdministrativePart(parts, district?.name);
    appendAdministrativePart(parts, locality?.name);
  }
  return parts.join(' · ') || null;
}

function collectAdministrativeFeatures(map, anchorPx) {
  const collected = [];
  try {
    const radius = 220;
    collected.push(...(map.queryRenderedFeatures([
      [anchorPx.x - radius, anchorPx.y - radius],
      [anchorPx.x + radius, anchorPx.y + radius]
    ]) || []));
  } catch {}

  let layers = [];
  try { layers = map.getStyle?.()?.layers || []; } catch {}
  const queried = new Set();
  for (const layer of layers) {
    const source = layer?.source;
    const sourceLayer = layer?.['source-layer'];
    const hint = `${layer?.id || ''} ${sourceLayer || ''}`;
    if (!source || !sourceLayer || !ADMIN_LAYER_HINT.test(hint)) continue;
    const key = `${source}:${sourceLayer}`;
    if (queried.has(key)) continue;
    queried.add(key);
    try {
      const features = map.querySourceFeatures(source, { sourceLayer }) || [];
      for (const feature of features.slice(0, 4000)) {
        collected.push({ ...feature, layer: feature.layer || { id: layer.id, 'source-layer': sourceLayer } });
      }
    } catch {}
  }
  return collected;
}

function administrativeFeatureLevel(feature) {
  const properties = feature?.properties || {};
  const hint = [
    feature?.layer?.id,
    feature?.layer?.['source-layer'],
    properties.place,
    properties.class,
    properties.kind,
    properties['pmap:kind'],
    properties.type,
    properties.featurecla
  ].map(value => String(value || '').toLowerCase()).join(' ');
  const admin = Number(properties.admin_level ?? properties.adminLevel);

  if (/neigh|neighbour|suburb|quarter|hamlet|block|chome|aza|locality/.test(hint) || (Number.isFinite(admin) && admin >= 9)) return 'locality';
  if (/ward|district|borough/.test(hint) || (Number.isFinite(admin) && admin >= 8 && admin < 9)) return 'district';
  if (/city|town|municip|village/.test(hint) || (Number.isFinite(admin) && admin >= 6 && admin < 8)) return 'city';
  if (/prefecture|region|province|state|county/.test(hint) || (Number.isFinite(admin) && admin >= 3 && admin < 6)) return 'region';
  return null;
}

function administrativeFeatureName(properties) {
  if (!properties) return null;
  const korean = [properties['name:ko'], properties.name_ko];
  for (const value of korean) {
    const text = String(value || '').trim();
    if (text && text.length <= 80) return text;
  }

  const localizedJapanese = koreanJapanesePlaceName(properties);
  if (localizedJapanese) return localizedJapanese;

  const candidates = [
    properties.name,
    properties['name:ja'], properties.name_ja,
    properties['name:en'], properties.name_en
  ];
  for (const value of candidates) {
    const text = String(value || '').trim();
    if (text && text.length <= 80) return text;
  }
  return null;
}

function appendAdministrativePart(parts, name) {
  if (!name || parts.some(value => sameAdministrativeName(value, name))) return;
  parts.push(name);
}

function representativeFeatureCoordinate(geometry) {
  if (!geometry) return null;
  if (isCoordinatePair(geometry.coordinates)) return geometry.coordinates;

  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, count: 0 };
  collectCoordinateBounds(geometry.coordinates, bounds, 1024);
  if (!bounds.count) return null;
  return [
    (bounds.minX + bounds.maxX) / 2,
    (bounds.minY + bounds.maxY) / 2
  ];
}

function collectCoordinateBounds(value, bounds, limit) {
  if (!Array.isArray(value) || bounds.count >= limit) return;
  if (isCoordinatePair(value)) {
    const x = Number(value[0]);
    const y = Number(value[1]);
    bounds.minX = Math.min(bounds.minX, x);
    bounds.minY = Math.min(bounds.minY, y);
    bounds.maxX = Math.max(bounds.maxX, x);
    bounds.maxY = Math.max(bounds.maxY, y);
    bounds.count += 1;
    return;
  }
  for (const child of value) {
    collectCoordinateBounds(child, bounds, limit);
    if (bounds.count >= limit) break;
  }
}

function isCoordinatePair(value) {
  return Array.isArray(value) && value.length >= 2 &&
    Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]));
}

function sameAdministrativeName(a, b) {
  const normalize = value => String(value || '')
    .toLowerCase()
    .replace(/[\s·・,._-]+/g, '')
    .replace(/(?:시|구|군|동|읍|면|리|도|부|현|市|区|郡|町|村|丁目|都|府|県)$/u, '');
  return normalize(a) === normalize(b);
}

function ensureMovementIndicator(layer) {
  if (!layer || !globalThis.document?.createElement) return null;
  const existing = layer.querySelector?.('.journey-movement-indicator');
  if (existing) return existing;
  const indicator = document.createElement('div');
  indicator.className = 'journey-movement-indicator';
  indicator.hidden = true;
  indicator.setAttribute('aria-live', 'polite');
  indicator.innerHTML = '<span class="journey-movement-icon" aria-hidden="true"></span><strong class="journey-movement-label"></strong>';
  Object.assign(indicator.style, {
    position: 'absolute',
    zIndex: '4',
    placeItems: 'center',
    alignContent: 'center',
    gap: '10px',
    pointerEvents: 'none',
    color: '#cbd5e1',
    textAlign: 'center'
  });
  const icon = indicator.querySelector('.journey-movement-icon');
  const label = indicator.querySelector('.journey-movement-label');
  if (icon) Object.assign(icon.style, {
    display: 'block',
    fontSize: 'clamp(44px, 6vw, 78px)',
    lineHeight: '1',
    filter: 'grayscale(.15)',
    opacity: '.92'
  });
  if (label) Object.assign(label.style, {
    display: 'block',
    fontSize: '12px',
    fontWeight: '800',
    letterSpacing: '.04em',
    color: '#94a3b8'
  });
  layer.append(indicator);
  return indicator;
}

function positionMovementIndicator(indicator) {
  if (!indicator) return;
  const narrow = Number(globalThis.window?.innerWidth) <= PHOTO_SPLIT_BREAKPOINT;
  indicator.style.display = 'grid';
  if (narrow) {
    indicator.style.left = '0';
    indicator.style.right = '0';
    indicator.style.top = 'var(--photo-map-share)';
    indicator.style.bottom = '0';
  } else {
    indicator.style.left = 'var(--photo-map-share)';
    indicator.style.right = '0';
    indicator.style.top = '0';
    indicator.style.bottom = '0';
  }
}

function createJourneyMediaNode(item, videoMode, objectUrls) {
  if (!item?.file) return null;

  let url = '';
  try {
    url = URL.createObjectURL(item.file);
    objectUrls.push(url);
  } catch {
    return null;
  }

  if (item.mediaType !== 'video') return createImage(url, item.title || '여행 사진');

  // Google Photos thumbnail mode stores a still image while keeping mediaType
  // as video. Local MP4/MOV files, including files with an empty MIME type,
  // must still become a real <video> element.
  if (String(item.file?.name || '').startsWith(VIDEO_THUMB_PREFIX)) {
    return createImage(url, `${item.title || '여행 영상'} 썸네일`);
  }

  const video = document.createElement('video');
  video.setAttribute('aria-label', item.title || '여행 영상');
  video.src = url;
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.controls = false;
  video.loop = false;
  video.preload = videoMode === VideoPlaybackMode.PLAY ? 'auto' : 'metadata';

  if (videoMode === VideoPlaybackMode.PLAY) {
    const syncPlayback = () => {
      if (!shouldPlayJourneyVideo()) {
        try { video.pause(); } catch {}
        return;
      }
      video.play().then(() => {
        delete video.dataset.playbackBlocked;
      }).catch(() => {
        video.dataset.playbackBlocked = 'true';
      });
    };

    video.autoplay = shouldPlayJourneyVideo();
    video.addEventListener('loadeddata', syncPlayback, { once: true });
    video.addEventListener('canplay', syncPlayback, { once: true });
    queueMicrotask(syncPlayback);
  } else {
    video.addEventListener('loadedmetadata', () => {
      const duration = Number(video.duration);
      if (Number.isFinite(duration) && duration > 0) {
        try { video.currentTime = Math.min(0.12, duration / 2); } catch {}
      }
      try { video.pause(); } catch {}
    }, { once: true });
  }

  return video;
}

function createImage(url, alt) {
  const img = document.createElement('img');
  img.alt = alt;
  img.decoding = 'async';
  img.loading = 'eager';
  img.src = url;
  return img;
}

function shouldPlayJourneyVideo() {
  const journeyMode = String(globalThis.document?.querySelector?.('#journeyMode')?.value || '');
  const videoMode = String(globalThis.document?.querySelector?.('#photoVideoMode')?.value || '');
  const playText = String(globalThis.document?.querySelector?.('#playButton')?.textContent || '').trim();
  return journeyMode === JourneyMode.PHOTOS && videoMode === VideoPlaybackMode.PLAY && playText === '일시정지';
}

function scheduleLocalReadyStatus(photos, videos, scenes) {
  if (typeof setTimeout !== 'function') return;
  setTimeout(() => {
    const status = globalThis.document?.querySelector?.('#status');
    const activeLibrary = getActiveMediaLibrary();
    if (status && activeLibrary.source === MediaLibrarySource.LOCAL_GALLERY) {
      status.textContent = `기기 갤러리 · 준비 완료 · 사진 ${photos.toLocaleString()}장 · 영상 ${videos.toLocaleString()}개 · 장면 ${scenes.toLocaleString()}개`;
    }
  }, 0);
}
