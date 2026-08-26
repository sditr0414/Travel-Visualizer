import {
  JourneyMode,
  PhotoJourneyController as CorePhotoJourneyController,
  activePhotoBeatAtTime,
  buildPhotoJourneyBeats as buildCorePhotoJourneyBeats,
  choosePhotoPlacement,
  formatPhotoTimestamp,
  parseGooglePhotosMetadata
} from './photo-journey.js?core=1';

export { JourneyMode, activePhotoBeatAtTime, choosePhotoPlacement, formatPhotoTimestamp, parseGooglePhotosMetadata };

export const VideoPlaybackMode = Object.freeze({
  THUMBNAIL: 'THUMBNAIL',
  PLAY: 'PLAY'
});

const MEDIA_EXTENSIONS = /\.(?:jpe?g|png|webp|gif|avif|mp4|m4v|mov|webm)$/i;
const VIDEO_EXTENSIONS = /\.(?:mp4|m4v|mov|webm)$/i;
const SIDECAR_SUFFIX = /(?:\.supplemental-metadata)?\.json$/i;
const VIDEO_THUMB_PREFIX = '__tc_video_thumb__';

export async function loadGooglePhotosTakeout(fileList, { onProgress } = {}) {
  const files = Array.from(fileList || []);
  const mediaFiles = files.filter(isDisplayableMediaFile);
  const jsonFiles = files.filter(file => /\.json$/i.test(file.name));
  const mediaIndex = buildMediaIndex(mediaFiles);
  const matchedFiles = new Set();
  const media = [];

  let processed = 0;
  for (const sidecar of jsonFiles) {
    processed += 1;
    if (sidecar.size > 3_000_000) continue;
    try {
      const metadata = parseGooglePhotosMetadata(JSON.parse(await sidecar.text()), sidecar.name);
      if (!metadata?.takenMs) continue;
      const file = findMatchingMedia(sidecar, metadata, mediaIndex);
      if (!file || matchedFiles.has(file)) continue;
      matchedFiles.add(file);
      media.push({
        ...metadata,
        title: cleanMediaTitle(metadata.title || file.name),
        file,
        mediaType: mediaTypeForFile(file),
        source: 'google-photos-takeout'
      });
    } catch {}
    if (processed % 50 === 0) onProgress?.({ processed, total: jsonFiles.length, found: media.length });
  }

  for (const file of mediaFiles) {
    if (matchedFiles.has(file)) continue;
    const takenMs = Number(file.lastModified);
    if (!(takenMs > Date.UTC(2000, 0, 1))) continue;
    media.push({
      title: cleanMediaTitle(file.name),
      takenMs,
      lat: null,
      lng: null,
      hasGps: false,
      file,
      mediaType: mediaTypeForFile(file),
      source: 'file-time'
    });
  }

  media.sort((a, b) => a.takenMs - b.takenMs);
  onProgress?.({ processed: jsonFiles.length, total: jsonFiles.length, found: media.length });
  const videoCount = media.filter(item => item.mediaType === 'video').length;
  return {
    photos: media,
    stats: {
      files: files.length,
      images: media.length - videoCount,
      videos: videoCount,
      sidecars: jsonFiles.length,
      photos: media.length,
      gpsPhotos: media.filter(item => item.hasGps).length,
      inferredTimePhotos: media.filter(item => item.source === 'file-time').length
    }
  };
}

/**
 * Photo journey is a move -> stop -> show media -> move sequence.
 * The passed plan is expanded in-place because main.js constructs RoutePlayer
 * after this function returns. Photo display time is per photo, not per group.
 */
export function buildPhotoJourneyBeats(media, plan, options = {}) {
  const baseBeats = buildCorePhotoJourneyBeats(media, plan);
  if (!baseBeats.length) return [];

  const settings = resolveJourneyMediaOptions(options);
  const prepared = baseBeats.map(beat => {
    const items = normalizeRepresentativeMedia(beat.photos, settings.videoMode);
    const itemDurationsSec = items.map(item => (
      item.mediaType === 'video' && settings.videoMode === VideoPlaybackMode.PLAY
        ? settings.videoMaxPlaySec
        : settings.photoDisplaySec
    ));
    const stopDurationSec = itemDurationsSec.reduce((sum, value) => sum + value, 0);
    return {
      ...beat,
      photos: items,
      hasVideo: items.some(item => item.mediaType === 'video'),
      videoMode: settings.videoMode,
      itemDurationsSec,
      desiredDurationSec: stopDurationSec,
      displayDurationSec: stopDurationSec,
      routeVideoSec: beat.videoSec
    };
  });

  const expanded = insertPhotoJourneyStops(plan, prepared);
  if (expanded.plan && expanded.plan !== plan) Object.assign(plan, expanded.plan);
  return expanded.beats;
}

/**
 * Insert stationary frames at every media beat. Route timing is preserved and
 * media time is added, so final duration = route duration + media stop duration.
 */
export function insertPhotoJourneyStops(plan, beats) {
  if (!plan?.frames?.length || !beats?.length) return { plan, beats: beats || [] };

  const fps = Math.max(1, Math.round(Number(plan.fps) || 60));
  const firstOutroIndex = plan.frames.findIndex(frame => frame?.kind === 'OUTRO');
  const travelFrameCount = firstOutroIndex >= 0 ? firstOutroIndex : plan.frames.length;
  if (!travelFrameCount) return { plan, beats: [] };

  const scheduled = beats.map((beat, order) => {
    const routeSec = Number.isFinite(Number(beat.routeVideoSec)) ? Number(beat.routeVideoSec) : Number(beat.videoSec) || 0;
    const sourceFrameIndex = clampInteger(Math.round(routeSec * fps), 0, travelFrameCount - 1);
    const itemDurationsSec = Array.isArray(beat.itemDurationsSec) && beat.itemDurationsSec.length === beat.photos.length
      ? beat.itemDurationsSec
      : beat.photos.map(() => Math.max(0.1, Number(beat.displayDurationSec) || 3) / Math.max(1, beat.photos.length));
    const itemFrameCounts = itemDurationsSec.map(seconds => Math.max(1, Math.round(Math.max(0.1, Number(seconds) || 0.1) * fps)));
    return { beat, order, routeSec, sourceFrameIndex, itemDurationsSec, itemFrameCounts };
  }).sort((a, b) => a.sourceFrameIndex - b.sourceFrameIndex || a.order - b.order);

  const stopsByFrame = new Map();
  for (const item of scheduled) {
    if (!stopsByFrame.has(item.sourceFrameIndex)) stopsByFrame.set(item.sourceFrameIndex, []);
    stopsByFrame.get(item.sourceFrameIndex).push(item);
  }

  const frames = [];
  const expandedBeats = [];
  for (let sourceIndex = 0; sourceIndex < plan.frames.length; sourceIndex += 1) {
    const sourceFrame = plan.frames[sourceIndex];
    if (sourceIndex < travelFrameCount) {
      for (const scheduledBeat of stopsByFrame.get(sourceIndex) || []) {
        const startFrame = frames.length;
        let holdOffset = 0;
        scheduledBeat.itemFrameCounts.forEach((frameCount, mediaItemIndex) => {
          for (let localFrame = 0; localFrame < frameCount; localFrame += 1) {
            frames.push({
              ...sourceFrame,
              kind: 'TRAVEL',
              timeSec: frames.length / fps,
              speedKmh: 0,
              sceneBreak: localFrame === 0 && mediaItemIndex === 0 ? sourceFrame.sceneBreak : false,
              mediaHold: true,
              mediaBeatId: scheduledBeat.beat.id,
              mediaItemIndex,
              mediaItemProgress: frameCount > 1 ? localFrame / (frameCount - 1) : 0,
              mediaHoldOffsetSec: holdOffset + localFrame / fps,
              mediaAnchor: scheduledBeat.beat.anchor ? { ...scheduledBeat.beat.anchor } : null,
              mediaTakenMs: scheduledBeat.beat.takenMs
            });
          }
          holdOffset += frameCount / fps;
        });
        const endFrame = frames.length;
        expandedBeats.push({
          ...scheduledBeat.beat,
          routeVideoSec: scheduledBeat.routeSec,
          startSec: startFrame / fps,
          endSec: endFrame / fps,
          videoSec: (startFrame + endFrame) / (2 * fps),
          displayDurationSec: (endFrame - startFrame) / fps
        });
      }
    }

    frames.push({ ...sourceFrame, timeSec: frames.length / fps });
  }

  const expandedOutroIndex = frames.findIndex(frame => frame?.kind === 'OUTRO');
  const travelDurationSec = (expandedOutroIndex >= 0 ? expandedOutroIndex : frames.length) / fps;
  const durationSec = frames.length / fps;
  const baseDurationSec = Number(plan.durationSec) || durationSec;
  const expandedPlan = {
    ...plan,
    frames,
    travelDurationSec,
    outroStartSec: travelDurationSec,
    outroSec: Math.max(0, durationSec - travelDurationSec),
    durationSec,
    targetTotalSeconds: durationSec,
    baseRouteDurationSec: baseDurationSec,
    mediaStopDurationSec: Math.max(0, durationSec - baseDurationSec)
  };

  return { plan: expandedPlan, beats: expandedBeats };
}

export class PhotoJourneyController extends CorePhotoJourneyController {
  setJourney(plan, beats) {
    super.setJourney(plan, beats);
    this.beatsById = new Map((beats || []).map(beat => [beat.id, beat]));
    this.activeMediaKey = null;
  }

  render(frame, frameIndex) {
    if (!this.enabled || !this.plan || !frame?.mediaHold || !frame.mediaBeatId) {
      this.clearActive();
      return;
    }
    const beat = this.beatsById?.get(frame.mediaBeatId);
    if (!beat) {
      this.clearActive();
      return;
    }

    const itemIndex = clampInteger(Number(frame.mediaItemIndex) || 0, 0, Math.max(0, beat.photos.length - 1));
    const mediaKey = `${beat.id}:${itemIndex}`;
    if (this.activeMediaKey !== mediaKey) {
      this.activeBeatId = beat.id;
      this.activeMediaKey = mediaKey;
      this.renderBeat({ ...beat, photos: beat.photos[itemIndex] ? [beat.photos[itemIndex]] : [], mediaItemIndex: itemIndex });
      this.lastPlacementFrame = -Infinity;
    }
    if (frameIndex - this.lastPlacementFrame >= Math.max(1, Math.round((this.plan.fps || 60) / 5))) {
      this.placeBeat(beat);
      this.lastPlacementFrame = frameIndex;
    }
  }

  clearActive() {
    super.clearActive();
    this.activeMediaKey = null;
    this.layer?.classList?.remove('media-stop-active');
    this.card?.classList?.remove('media-stop-card');
  }

  renderBeat(beat) {
    this.revokeUrls();
    this.images.replaceChildren();
    this.images.dataset.count = '1';

    const item = beat.photos[0];
    if (item) {
      const figure = document.createElement('figure');
      figure.className = `photo-frame${item.mediaType === 'video' ? ' video-frame' : ''}`;
      const node = createMediaNode(item, beat.videoMode, this.objectUrls);
      if (node) {
        node.addEventListener('error', () => {
          figure.classList.add('photo-load-error');
          node.remove();
          const fallback = document.createElement('span');
          fallback.textContent = '미리보기 불가';
          figure.append(fallback);
        }, { once: true });
        figure.append(node);
      } else {
        figure.classList.add('photo-load-error');
        const fallback = document.createElement('span');
        fallback.textContent = '미리보기 불가';
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

  placeBeat(beat) {
    if (!beat.anchor || this.card.hidden) return;
    const stageRect = this.stage.getBoundingClientRect();
    const compact = stageRect.width < 650;
    const cardWidth = compact
      ? Math.max(280, stageRect.width - 24)
      : Math.min(980, Math.max(520, stageRect.width * 0.76));
    const cardHeight = compact
      ? Math.min(stageRect.height * 0.66, Math.max(300, stageRect.height - 150))
      : Math.min(720, Math.max(380, stageRect.height * 0.74));
    const x = Math.max(12, (stageRect.width - cardWidth) / 2);
    const y = Math.max(72, (stageRect.height - cardHeight) / 2 - 12);

    if (!beat.placeName) {
      let anchorPx = null;
      try {
        const projected = this.map.project([beat.anchor.lng, beat.anchor.lat]);
        anchorPx = { x: projected.x, y: projected.y };
      } catch {}
      const resolved = anchorPx ? this.resolvePlaceName(anchorPx) : null;
      if (resolved) beat.placeName = resolved;
      if (this.activeBeatId === beat.id) this.place.textContent = beat.placeName || fallbackPlaceName(beat);
    }

    this.card.style.width = `${Math.round(cardWidth)}px`;
    this.card.style.height = `${Math.round(cardHeight)}px`;
    this.card.style.left = `${Math.round(x)}px`;
    this.card.style.top = `${Math.round(y)}px`;
    this.card.dataset.slot = 'MEDIA_STOP';
    this.setLeader(null, null);
  }

  revokeUrls() {
    for (const video of this.images?.querySelectorAll?.('video') || []) {
      try { video.pause(); } catch {}
    }
    super.revokeUrls();
  }
}

function resolveJourneyMediaOptions(options) {
  const domPhotoSec = readNumberControl('#photoDisplaySeconds');
  const domVideoMaxSec = readNumberControl('#videoMaxPlaySeconds');
  const domVideoMode = readValueControl('#photoVideoMode');
  return {
    photoDisplaySec: clampNumber(options.photoDisplaySec ?? domPhotoSec ?? 3, 1.5, 8),
    videoMode: normalizeVideoMode(options.videoMode ?? domVideoMode),
    videoMaxPlaySec: clampNumber(options.videoMaxPlaySec ?? domVideoMaxSec ?? 5, 2, 15)
  };
}

function readNumberControl(selector) {
  const node = globalThis.document?.querySelector?.(selector);
  if (!node) return null;
  const value = Number(node.value);
  return Number.isFinite(value) ? value : null;
}

function readValueControl(selector) {
  return String(globalThis.document?.querySelector?.(selector)?.value || '').trim() || null;
}

function normalizeVideoMode(value) {
  return value === VideoPlaybackMode.PLAY ? VideoPlaybackMode.PLAY : VideoPlaybackMode.THUMBNAIL;
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || min));
}

function clampInteger(value, min, max) {
  return Math.min(max, Math.max(min, Math.round(Number(value) || 0)));
}

function normalizeRepresentativeMedia(items, videoMode) {
  const source = Array.from(items || []);
  if (videoMode !== VideoPlaybackMode.PLAY) return source.slice(0, 3);
  const videos = source.filter(item => item.mediaType === 'video');
  if (videos.length <= 1) return source.slice(0, 3);
  const selectedVideo = videos[Math.floor(videos.length / 2)];
  const photos = source.filter(item => item.mediaType !== 'video');
  return [selectedVideo, ...photos].slice(0, 3);
}

function createMediaNode(item, videoMode, objectUrls) {
  if (!item?.file) return null;
  const url = URL.createObjectURL(item.file);
  objectUrls.push(url);

  if (item.mediaType !== 'video') {
    const img = document.createElement('img');
    img.alt = item.title || '여행 사진';
    img.src = url;
    return img;
  }

  if (!String(item.file.type || '').startsWith('video/')) {
    const img = document.createElement('img');
    img.alt = `${item.title || '여행 영상'} 썸네일`;
    img.src = url;
    return img;
  }

  const video = document.createElement('video');
  video.setAttribute('aria-label', item.title || '여행 영상');
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  video.preload = 'metadata';
  video.controls = false;
  video.loop = false;

  if (videoMode === VideoPlaybackMode.THUMBNAIL) {
    video.addEventListener('loadedmetadata', () => {
      const duration = Number(video.duration);
      if (!Number.isFinite(duration) || duration <= 0) return;
      try { video.currentTime = Math.min(0.12, duration / 2); } catch {}
    }, { once: true });
  }
  return video;
}

function fallbackPlaceName(beat) {
  return beat.positionSource === 'gps' ? '사진 촬영 위치' : 'Timeline 여행 위치';
}

function isDisplayableMediaFile(file) {
  if (!file) return false;
  const type = String(file.type || '');
  if (/^(?:image\/(?:jpeg|png|webp|gif|avif)|video\/(?:mp4|quicktime|webm|x-m4v))$/i.test(type)) return true;
  return MEDIA_EXTENSIONS.test(file.name || '');
}

function mediaTypeForFile(file) {
  const name = String(file?.name || '');
  if (name.startsWith(VIDEO_THUMB_PREFIX)) return 'video';
  if (String(file?.type || '').startsWith('video/') || VIDEO_EXTENSIONS.test(name)) return 'video';
  return 'photo';
}

function cleanMediaTitle(value) {
  const text = String(value || '').replace(VIDEO_THUMB_PREFIX, '');
  return text || '여행 미디어';
}

function buildMediaIndex(files) {
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

function findMatchingMedia(sidecar, metadata, index) {
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

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
}
