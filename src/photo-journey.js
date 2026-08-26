import { clamp, haversineMeters } from './geo.js';

export const JourneyMode = Object.freeze({
  ROUTE: 'ROUTE',
  PHOTOS: 'PHOTOS'
});

const IMAGE_EXTENSIONS = /\.(?:jpe?g|png|webp|gif|avif)$/i;
const SIDECAR_SUFFIX = /(?:\.supplemental-metadata)?\.json$/i;
const JST_FORMATTER = new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
  timeZone: 'Asia/Tokyo'
});

export async function loadGooglePhotosTakeout(fileList, { onProgress } = {}) {
  const files = Array.from(fileList || []);
  const imageFiles = files.filter(isDisplayableImageFile);
  const jsonFiles = files.filter(file => /\.json$/i.test(file.name));
  const imageIndex = buildImageIndex(imageFiles);
  const matchedImages = new Set();
  const photos = [];

  let processed = 0;
  for (const sidecar of jsonFiles) {
    processed += 1;
    if (sidecar.size > 3_000_000) continue;
    try {
      const metadata = parseGooglePhotosMetadata(JSON.parse(await sidecar.text()), sidecar.name);
      if (!metadata?.takenMs) continue;
      const image = findMatchingImage(sidecar, metadata, imageIndex);
      if (!image || matchedImages.has(image)) continue;
      matchedImages.add(image);
      photos.push({ ...metadata, file: image, source: 'google-photos-takeout' });
    } catch {}
    if (processed % 50 === 0) onProgress?.({ processed, total: jsonFiles.length, found: photos.length });
  }

  // A folder without Takeout sidecars is still usable. File timestamps are less
  // reliable, so these photos are explicitly marked and their position is inferred
  // from the Timeline during journey construction.
  for (const image of imageFiles) {
    if (matchedImages.has(image)) continue;
    const takenMs = Number(image.lastModified);
    if (!(takenMs > Date.UTC(2000, 0, 1))) continue;
    photos.push({
      title: image.name,
      takenMs,
      lat: null,
      lng: null,
      hasGps: false,
      file: image,
      source: 'file-time'
    });
  }

  photos.sort((a, b) => a.takenMs - b.takenMs);
  onProgress?.({ processed: jsonFiles.length, total: jsonFiles.length, found: photos.length });
  return {
    photos,
    stats: {
      files: files.length,
      images: imageFiles.length,
      sidecars: jsonFiles.length,
      photos: photos.length,
      gpsPhotos: photos.filter(photo => photo.hasGps).length,
      inferredTimePhotos: photos.filter(photo => photo.source === 'file-time').length
    }
  };
}

export function parseGooglePhotosMetadata(data, sidecarName = '') {
  if (!data || typeof data !== 'object') return null;
  const timestamp = data.photoTakenTime?.timestamp ?? data.creationTime?.timestamp ?? data.creationTime;
  const takenMs = parseTimestamp(timestamp);
  if (!Number.isFinite(takenMs)) return null;

  const gps = validGps(data.geoDataExif) || validGps(data.geoData);
  return {
    title: String(data.title || stripSidecarName(sidecarName) || '사진'),
    takenMs,
    lat: gps?.lat ?? null,
    lng: gps?.lng ?? null,
    hasGps: !!gps
  };
}

export function buildPhotoJourneyBeats(photos, plan) {
  if (!photos?.length || !plan?.segments?.length || !plan?.frames?.length) return [];
  const mapped = photos
    .map(photo => mapPhotoToJourney(photo, plan))
    .filter(Boolean)
    .sort((a, b) => a.takenMs - b.takenMs);
  if (!mapped.length) return [];

  const groups = groupMappedPhotos(mapped);
  const travelDuration = Math.max(1, Number(plan.travelDurationSec) || Number(plan.outroStartSec) || Number(plan.durationSec) || 1);
  const maxBeats = clamp(Math.floor(travelDuration / 2.25), 6, 48);
  const selected = selectGroupsAcrossVideo(groups, maxBeats, travelDuration);

  return selected.map((group, index) => {
    const previous = selected[index - 1];
    const next = selected[index + 1];
    const centerSec = median(group.items.map(item => item.videoSec));
    const previousMid = previous ? (centerSec + median(previous.items.map(item => item.videoSec))) / 2 : 0;
    const nextCenter = next ? median(next.items.map(item => item.videoSec)) : travelDuration;
    const nextMid = next ? (centerSec + nextCenter) / 2 : travelDuration;
    const natural = clamp(travelDuration / Math.max(1, selected.length) * 0.72, 2.0, 4.8);
    const startSec = Math.max(previousMid, centerSec - natural / 2, 0);
    const endSec = Math.min(nextMid, centerSec + natural / 2, travelDuration);
    const photosForBeat = pickRepresentativePhotos(group.items, 3);
    const anchor = representativeAnchor(group.items);

    return {
      id: `photo-beat-${index}`,
      videoSec: centerSec,
      startSec,
      endSec: Math.max(startSec + 0.55, endSec),
      takenMs: median(group.items.map(item => item.takenMs)),
      photos: photosForBeat,
      anchor,
      positionSource: anchor?.positionSource || 'timeline',
      sourceCount: group.items.length
    };
  });
}

export function activePhotoBeatAtTime(beats, timeSec) {
  if (!beats?.length || !Number.isFinite(timeSec)) return null;
  let low = 0;
  let high = beats.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const beat = beats[mid];
    if (timeSec < beat.startSec) high = mid - 1;
    else if (timeSec > beat.endSec) low = mid + 1;
    else return beat;
  }
  return null;
}

export function choosePhotoPlacement({
  viewportWidth,
  viewportHeight,
  cardWidth,
  cardHeight,
  anchorPx,
  routePoints = [],
  forbiddenRects = [],
  previousSlot = null
}) {
  const width = Math.max(240, Number(viewportWidth) || 1100);
  const height = Math.max(240, Number(viewportHeight) || 700);
  const cw = clamp(Number(cardWidth) || 320, 180, Math.max(180, width - 24));
  const ch = clamp(Number(cardHeight) || 230, 130, Math.max(130, height - 24));
  const margin = width < 650 ? 12 : 18;
  const top = width < 650 ? 82 : 72;
  const midY = clamp((height - ch) / 2, top, Math.max(top, height - ch - margin));
  const bottom = Math.max(top, height - ch - margin);
  const right = Math.max(margin, width - cw - margin);

  const candidates = [
    { slot: 'TOP_LEFT', x: margin, y: top },
    { slot: 'TOP_RIGHT', x: right, y: top },
    { slot: 'MID_LEFT', x: margin, y: midY },
    { slot: 'MID_RIGHT', x: right, y: midY },
    { slot: 'BOTTOM_LEFT', x: margin, y: bottom },
    { slot: 'BOTTOM_RIGHT', x: right, y: bottom }
  ];

  let best = null;
  for (const candidate of candidates) {
    const rect = { x: candidate.x, y: candidate.y, width: cw, height: ch };
    let score = 0;

    for (const forbidden of forbiddenRects) {
      const overlap = overlapArea(rect, forbidden);
      if (overlap > 0) score += 25_000 + overlap * 2.5;
    }

    for (const point of routePoints) {
      const distance = pointToRectDistance(point, rect);
      if (distance === 0) score += 2_200;
      else if (distance < 54) score += (54 - distance) * 18;
    }
    for (let i = 1; i < routePoints.length; i += 1) {
      if (segmentIntersectsRect(routePoints[i - 1], routePoints[i], rect)) score += 3_600;
    }

    if (anchorPx && Number.isFinite(anchorPx.x) && Number.isFinite(anchorPx.y)) {
      const anchorDistance = pointToRectDistance(anchorPx, rect);
      if (anchorDistance === 0) score += 9_000;
      const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      score += Math.hypot(center.x - anchorPx.x, center.y - anchorPx.y) * 0.06;
    }

    if (candidate.slot === previousSlot) score -= 420;
    if (!best || score < best.score) best = { ...candidate, rect, score };
  }
  return best;
}

export class PhotoJourneyController {
  constructor({ map, stage, layer, card, images, time, meta, leader, leaderDot }) {
    this.map = map;
    this.stage = stage;
    this.layer = layer;
    this.card = card;
    this.images = images;
    this.time = time;
    this.meta = meta;
    this.leader = leader;
    this.leaderDot = leaderDot;
    this.enabled = false;
    this.plan = null;
    this.beats = [];
    this.activeBeatId = null;
    this.previousSlot = null;
    this.objectUrls = [];
    this.lastPlacementFrame = -Infinity;
  }

  setEnabled(enabled) {
    this.enabled = !!enabled;
    this.layer.hidden = !this.enabled;
    if (!this.enabled) this.clearActive();
  }

  setJourney(plan, beats) {
    this.plan = plan;
    this.beats = beats || [];
    this.activeBeatId = null;
    this.previousSlot = null;
    this.lastPlacementFrame = -Infinity;
    this.clearActive();
  }

  render(frame, frameIndex) {
    if (!this.enabled || !this.plan || frame?.kind !== 'TRAVEL') {
      this.clearActive();
      return;
    }
    const beat = activePhotoBeatAtTime(this.beats, frame.timeSec);
    if (!beat) {
      this.clearActive();
      return;
    }

    if (this.activeBeatId !== beat.id) {
      this.activeBeatId = beat.id;
      this.renderBeat(beat);
      this.lastPlacementFrame = -Infinity;
    }
    if (frameIndex - this.lastPlacementFrame >= Math.max(1, Math.round((this.plan.fps || 60) / 5))) {
      this.placeBeat(beat, frameIndex);
      this.lastPlacementFrame = frameIndex;
    }
  }

  clear() {
    this.setJourney(null, []);
  }

  clearActive() {
    if (this.card) this.card.hidden = true;
    this.activeBeatId = null;
    this.setPhotoAnchor(null);
    this.setLeader(null, null);
    this.revokeUrls();
  }

  renderBeat(beat) {
    this.revokeUrls();
    this.images.replaceChildren();
    this.images.dataset.count = String(beat.photos.length);

    for (const item of beat.photos) {
      const figure = document.createElement('figure');
      figure.className = 'photo-frame';
      const img = document.createElement('img');
      img.alt = item.title || '여행 사진';
      if (item.file) {
        const url = URL.createObjectURL(item.file);
        this.objectUrls.push(url);
        img.src = url;
      }
      img.addEventListener('error', () => {
        figure.classList.add('photo-load-error');
        img.remove();
        const fallback = document.createElement('span');
        fallback.textContent = '미리보기 불가';
        figure.append(fallback);
      }, { once: true });
      figure.append(img);
      this.images.append(figure);
    }

    this.time.textContent = formatPhotoTime(beat.takenMs);
    const sourceLabel = beat.positionSource === 'gps' ? '사진 GPS' : 'Timeline 위치 추정';
    const extra = beat.sourceCount > beat.photos.length ? ` · +${beat.sourceCount - beat.photos.length}장` : '';
    this.meta.textContent = `${sourceLabel}${extra}`;
    this.card.hidden = false;
    this.setPhotoAnchor(beat.anchor);
  }

  placeBeat(beat, frameIndex) {
    if (!beat.anchor || this.card.hidden) return;
    const stageRect = this.stage.getBoundingClientRect();
    const projected = this.map.project([beat.anchor.lng, beat.anchor.lat]);
    const anchorPx = { x: projected.x, y: projected.y };
    const cardWidth = clamp(stageRect.width * 0.30, 220, 360);
    const cardHeight = clamp(stageRect.height * 0.35, 180, 270);
    const routePoints = routePointsAroundFrame(this.plan, frameIndex)
      .map(point => this.map.project([point.lng, point.lat]))
      .map(point => ({ x: point.x, y: point.y }));
    const forbiddenRects = forbiddenRectsWithinStage(this.stage, stageRect);
    const placement = choosePhotoPlacement({
      viewportWidth: stageRect.width,
      viewportHeight: stageRect.height,
      cardWidth,
      cardHeight,
      anchorPx,
      routePoints,
      forbiddenRects,
      previousSlot: this.previousSlot
    });
    if (!placement) return;

    this.previousSlot = placement.slot;
    this.card.style.width = `${Math.round(cardWidth)}px`;
    this.card.style.height = `${Math.round(cardHeight)}px`;
    this.card.style.left = `${Math.round(placement.x)}px`;
    this.card.style.top = `${Math.round(placement.y)}px`;
    this.card.dataset.slot = placement.slot;

    const anchorVisible = anchorPx.x >= 0 && anchorPx.y >= 0 && anchorPx.x <= stageRect.width && anchorPx.y <= stageRect.height;
    this.setLeader(anchorVisible ? anchorPx : null, placement.rect);
  }

  setPhotoAnchor(anchor) {
    const source = this.map.getSource('photo-anchor');
    if (!source) return;
    if (!anchor) {
      source.setData(emptyFeatureCollection());
      return;
    }
    source.setData({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: { source: anchor.positionSource || 'timeline' },
        geometry: { type: 'Point', coordinates: [anchor.lng, anchor.lat] }
      }]
    });
  }

  setLeader(anchor, rect) {
    if (!anchor || !rect) {
      this.leader.setAttribute('x1', '0');
      this.leader.setAttribute('y1', '0');
      this.leader.setAttribute('x2', '0');
      this.leader.setAttribute('y2', '0');
      this.leaderDot.setAttribute('cx', '-20');
      this.leaderDot.setAttribute('cy', '-20');
      return;
    }
    const edge = closestPointOnRect(anchor, rect);
    this.leader.setAttribute('x1', String(edge.x));
    this.leader.setAttribute('y1', String(edge.y));
    this.leader.setAttribute('x2', String(anchor.x));
    this.leader.setAttribute('y2', String(anchor.y));
    this.leaderDot.setAttribute('cx', String(anchor.x));
    this.leaderDot.setAttribute('cy', String(anchor.y));
  }

  revokeUrls() {
    for (const url of this.objectUrls) URL.revokeObjectURL(url);
    this.objectUrls = [];
  }
}

function mapPhotoToJourney(photo, plan) {
  const takenMs = Number(photo?.takenMs);
  if (!Number.isFinite(takenMs)) return null;
  const segments = plan.segments;
  const tripStart = segments[0]?.startMs;
  const tripEnd = segments.at(-1)?.endMs;
  if (!Number.isFinite(tripStart) || !Number.isFinite(tripEnd)) return null;
  if (takenMs < tripStart - 6 * 3600_000 || takenMs > tripEnd + 6 * 3600_000) return null;

  let low = 0;
  let high = segments.length - 1;
  let containing = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const segment = segments[mid];
    if (takenMs < segment.startMs) high = mid - 1;
    else if (takenMs > segment.endMs) low = mid + 1;
    else { containing = mid; break; }
  }

  let videoSec;
  let segmentIndex;
  if (containing >= 0) {
    const segment = segments[containing];
    const progress = clamp((takenMs - segment.startMs) / Math.max(1, segment.endMs - segment.startMs), 0, 1);
    videoSec = segment.videoStartSec + segment.videoSec * progress;
    segmentIndex = containing;
  } else {
    const nextIndex = clamp(low, 0, segments.length - 1);
    const previousIndex = clamp(low - 1, 0, segments.length - 1);
    const previous = segments[previousIndex];
    const next = segments[nextIndex];
    const previousGap = Math.abs(takenMs - previous.endMs);
    const nextGap = Math.abs(next.startMs - takenMs);
    if (previousGap <= nextGap) {
      videoSec = previous.videoEndSec;
      segmentIndex = previousIndex;
    } else {
      videoSec = next.videoStartSec;
      segmentIndex = nextIndex;
    }
  }

  const travelFrameMax = Math.max(0, Math.round((plan.travelDurationSec || plan.outroStartSec || videoSec) * (plan.fps || 60)) - 1);
  const frameIndex = clamp(Math.round(videoSec * (plan.fps || 60)), 0, travelFrameMax);
  const timelinePosition = plan.frames[frameIndex]?.position || segments[segmentIndex]?.end;
  if (!timelinePosition) return null;

  const gps = photo.hasGps && Number.isFinite(photo.lat) && Number.isFinite(photo.lng)
    ? { lat: photo.lat, lng: photo.lng }
    : null;
  const gpsDistanceKm = gps ? haversineMeters(gps, timelinePosition) / 1000 : Infinity;
  const useGps = !!gps && gpsDistanceKm <= 80;
  const anchor = useGps ? gps : timelinePosition;

  return {
    ...photo,
    videoSec,
    segmentIndex,
    timelinePosition,
    anchor: {
      lat: anchor.lat,
      lng: anchor.lng,
      positionSource: useGps ? 'gps' : 'timeline'
    },
    positionSource: useGps ? 'gps' : 'timeline'
  };
}

function groupMappedPhotos(items) {
  const groups = [];
  let current = null;
  for (const item of items) {
    const previous = current?.items.at(-1);
    const sourceGap = previous ? item.takenMs - previous.takenMs : Infinity;
    const videoGap = previous ? Math.abs(item.videoSec - previous.videoSec) : Infinity;
    const geoGap = previous ? haversineMeters(previous.anchor, item.anchor) : Infinity;
    const sameMoment = sourceGap <= 30 * 60_000 && geoGap <= 2_500;
    const sameCompressedStop = videoGap <= 0.65 && geoGap <= 4_000;
    if (!current || (!sameMoment && !sameCompressedStop)) {
      current = { items: [] };
      groups.push(current);
    }
    current.items.push(item);
  }
  return groups;
}

function selectGroupsAcrossVideo(groups, maxBeats, travelDuration) {
  if (groups.length <= maxBeats) return groups;
  const bucketWidth = travelDuration / maxBeats;
  const buckets = Array.from({ length: maxBeats }, () => []);
  for (const group of groups) {
    const sec = median(group.items.map(item => item.videoSec));
    const index = clamp(Math.floor(sec / Math.max(0.001, bucketWidth)), 0, maxBeats - 1);
    buckets[index].push(group);
  }
  return buckets
    .map(bucket => bucket.sort((a, b) => groupScore(b) - groupScore(a))[0])
    .filter(Boolean)
    .sort((a, b) => median(a.items.map(item => item.videoSec)) - median(b.items.map(item => item.videoSec)));
}

function groupScore(group) {
  const gps = group.items.filter(item => item.positionSource === 'gps').length;
  return group.items.length * 1.5 + gps * 0.75;
}

function pickRepresentativePhotos(items, count) {
  if (items.length <= count) return [...items];
  if (count === 1) return [items[Math.floor(items.length / 2)]];
  const result = [];
  for (let i = 0; i < count; i += 1) {
    result.push(items[Math.round(i * (items.length - 1) / (count - 1))]);
  }
  return result;
}

function representativeAnchor(items) {
  const gpsItems = items.filter(item => item.positionSource === 'gps');
  const candidates = gpsItems.length ? gpsItems : items;
  if (!candidates.length) return null;
  const item = candidates[Math.floor(candidates.length / 2)];
  return { ...item.anchor, positionSource: gpsItems.length ? 'gps' : 'timeline' };
}

function routePointsAroundFrame(plan, frameIndex) {
  const fps = Math.max(1, plan?.fps || 60);
  const frames = plan?.frames || [];
  const start = Math.max(0, frameIndex - Math.round(fps * 3.8));
  const end = Math.min(frames.length - 1, frameIndex + Math.round(fps * 1.4));
  const step = Math.max(1, Math.round(fps / 10));
  const points = [];
  for (let i = start; i <= end; i += step) {
    const frame = frames[i];
    if (frame?.kind === 'TRAVEL' && frame.position) points.push(frame.position);
  }
  const current = frames[frameIndex];
  if (current?.kind === 'TRAVEL' && current.position) points.push(current.position);
  return points;
}

function forbiddenRectsWithinStage(stage, stageRect) {
  const selectors = ['.video-hud', '.settings-shell[open]', '.player-dock'];
  return selectors.flatMap(selector => [...stage.querySelectorAll(selector)]).map(node => {
    const rect = node.getBoundingClientRect();
    return {
      x: rect.left - stageRect.left,
      y: rect.top - stageRect.top,
      width: rect.width,
      height: rect.height
    };
  }).filter(rect => rect.width > 0 && rect.height > 0);
}

function buildImageIndex(files) {
  const byPath = new Map();
  const byName = new Map();
  for (const file of files) {
    const path = normalizePath(file.webkitRelativePath || file.name);
    byPath.set(path.toLowerCase(), file);
    const name = file.name.toLowerCase();
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(file);
  }
  return { byPath, byName };
}

function findMatchingImage(sidecar, metadata, index) {
  const relative = normalizePath(sidecar.webkitRelativePath || sidecar.name);
  const slash = relative.lastIndexOf('/');
  const directory = slash >= 0 ? relative.slice(0, slash + 1) : '';
  const sidecarBase = stripSidecarName(sidecar.name);
  const candidates = [metadata.title, sidecarBase].filter(Boolean);

  for (const name of candidates) {
    const exact = index.byPath.get(`${directory}${name}`.toLowerCase());
    if (exact) return exact;
  }
  for (const name of candidates) {
    const matches = index.byName.get(String(name).toLowerCase());
    if (matches?.length === 1) return matches[0];
    if (matches?.length > 1) {
      const sameDirectory = matches.find(file => normalizePath(file.webkitRelativePath || file.name).startsWith(directory));
      if (sameDirectory) return sameDirectory;
    }
  }
  return null;
}

function stripSidecarName(name) {
  return String(name || '').replace(SIDECAR_SUFFIX, '');
}

function parseTimestamp(value) {
  if (value === null || value === undefined || value === '') return NaN;
  if (/^\d+(?:\.\d+)?$/.test(String(value))) {
    const numeric = Number(value);
    return numeric > 10_000_000_000 ? numeric : numeric * 1000;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function validGps(value) {
  const lat = Number(value?.latitude);
  const lng = Number(value?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (Math.abs(lat) < 1e-7 && Math.abs(lng) < 1e-7) return null;
  return { lat, lng };
}

function isDisplayableImageFile(file) {
  if (!file) return false;
  return /^image\/(?:jpeg|png|webp|gif|avif)$/i.test(file.type || '') || IMAGE_EXTENSIONS.test(file.name || '');
}

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function formatPhotoTime(ms) {
  return JST_FORMATTER.format(new Date(ms)).replace(/\.\s?/g, '.').replace(/\.$/, '');
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function overlapArea(a, b) {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

function pointToRectDistance(point, rect) {
  const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.width));
  const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.height));
  return Math.hypot(dx, dy);
}

function segmentIntersectsRect(a, b, rect) {
  if (pointToRectDistance(a, rect) === 0 || pointToRectDistance(b, rect) === 0) return true;
  const edges = [
    [{ x: rect.x, y: rect.y }, { x: rect.x + rect.width, y: rect.y }],
    [{ x: rect.x + rect.width, y: rect.y }, { x: rect.x + rect.width, y: rect.y + rect.height }],
    [{ x: rect.x + rect.width, y: rect.y + rect.height }, { x: rect.x, y: rect.y + rect.height }],
    [{ x: rect.x, y: rect.y + rect.height }, { x: rect.x, y: rect.y }]
  ];
  return edges.some(([c, d]) => segmentsIntersect(a, b, c, d));
}

function segmentsIntersect(a, b, c, d) {
  const cross = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  return ((abC <= 0 && abD >= 0) || (abC >= 0 && abD <= 0)) &&
    ((cdA <= 0 && cdB >= 0) || (cdA >= 0 && cdB <= 0));
}

function closestPointOnRect(point, rect) {
  const x = clamp(point.x, rect.x, rect.x + rect.width);
  const y = clamp(point.y, rect.y, rect.y + rect.height);
  if (x !== point.x || y !== point.y) return { x, y };
  const distances = [
    { d: point.x - rect.x, x: rect.x, y: point.y },
    { d: rect.x + rect.width - point.x, x: rect.x + rect.width, y: point.y },
    { d: point.y - rect.y, x: point.x, y: rect.y },
    { d: rect.y + rect.height - point.y, x: point.x, y: rect.y + rect.height }
  ];
  return distances.sort((a, b) => a.d - b.d)[0];
}

function emptyFeatureCollection() {
  return { type: 'FeatureCollection', features: [] };
}
