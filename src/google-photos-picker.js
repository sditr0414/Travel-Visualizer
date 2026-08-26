const PICKER_API = 'https://photospicker.googleapis.com/v1';
const PICKER_SCOPE = 'https://www.googleapis.com/auth/photospicker.mediaitems.readonly';
const GIS_SCRIPT = 'https://accounts.google.com/gsi/client';
const TRAVEL_TIME_ZONE_OFFSET = '+09:00';

let googleIdentityPromise = null;

export async function pickGooglePhotos({ clientId, dateRange, onStatus } = {}) {
  const resolvedClientId = String(clientId || '').trim();
  if (!resolvedClientId) throw new Error('Google Photos 로그인을 위한 앱 설정이 없습니다.');

  onStatus?.('Google 계정 연결 중…');
  const google = await loadGoogleIdentityServices();
  const accessToken = await requestAccessToken(google, resolvedClientId);

  onStatus?.('Google Photos 선택 세션 만드는 중…');
  const session = await pickerRequest('/sessions', accessToken, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}'
  });
  if (!session?.id || !session?.pickerUri) throw new Error('Google Photos 선택 세션을 만들지 못했습니다.');

  const pickerUrl = appendAutoClose(session.pickerUri);
  const popup = globalThis.open?.(pickerUrl, 'google-photos-picker', 'popup=yes,width=1100,height=760,resizable=yes,scrollbars=yes');
  if (!popup) {
    await deleteSessionQuietly(session.id, accessToken);
    throw new Error('Google Photos 선택창이 차단됐습니다. 브라우저 팝업을 허용한 뒤 다시 시도하세요.');
  }

  try {
    const rangeLabel = formatDateRangeLabel(dateRange);
    onStatus?.(rangeLabel
      ? `Google Photos에서 ${rangeLabel} 여행 사진·동영상을 선택하고 완료를 누르세요.`
      : 'Google Photos에서 여행 사진·동영상을 선택하고 완료를 누르세요.');
    await waitForSelection(session, accessToken, onStatus);
    onStatus?.('선택한 미디어 목록 가져오는 중…');
    const mediaItems = await listSelectedMedia(session.id, accessToken);
    const normalized = normalizePickedMediaItems(mediaItems);
    const filtered = filterPhotosToTravelDates(normalized, dateRange);
    if (!filtered.photos.length) {
      if (normalized.length && filtered.excludedOutsideRange) {
        throw new Error(`${rangeLabel || '현재 여행 기간'}에 해당하는 사진·동영상이 없습니다.`);
      }
      throw new Error('선택한 항목에서 표시 가능한 사진·동영상을 찾지 못했습니다.');
    }
    const selectedVideos = filtered.photos.filter(item => item.mediaType === 'video').length;
    const selectedPhotos = filtered.photos.length - selectedVideos;
    onStatus?.(`${rangeLabel ? `${rangeLabel} · ` : ''}사진 ${selectedPhotos.toLocaleString()} · 영상 ${selectedVideos.toLocaleString()} 준비 완료`);
    return {
      photos: filtered.photos,
      accessToken,
      sessionId: session.id,
      stats: {
        picked: mediaItems.length,
        normalizedPhotos: normalized.filter(item => item.mediaType === 'photo').length,
        photos: selectedPhotos,
        videos: selectedVideos,
        media: filtered.photos.length,
        excludedOutsideRange: filtered.excludedOutsideRange,
        gpsPhotos: 0
      }
    };
  } catch (error) {
    await deleteSessionQuietly(session.id, accessToken);
    throw error;
  } finally {
    try { popup.close(); } catch {}
  }
}

export async function releaseGooglePhotosSelection(sessionId, accessToken) {
  if (!sessionId || !accessToken) return;
  await deleteSessionQuietly(sessionId, accessToken);
}

export function normalizePickedMediaItems(items) {
  return (items || []).flatMap(item => {
    const mediaFile = item?.mediaFile || {};
    const mimeType = String(mediaFile.mimeType || item?.mimeType || '');
    const type = String(item?.type || '').toUpperCase();
    const mediaType = type === 'VIDEO' || mimeType.startsWith('video/') ? 'video'
      : type === 'PHOTO' || mimeType.startsWith('image/') ? 'photo'
        : null;
    if (!mediaType) return [];

    const takenMs = Date.parse(item?.createTime || '');
    const baseUrl = String(mediaFile.baseUrl || item?.baseUrl || '').trim();
    if (!Number.isFinite(takenMs) || !baseUrl) return [];

    const common = {
      id: item.id || null,
      title: String(mediaFile.filename || item.filename || (mediaType === 'video' ? 'Google Photos 영상' : 'Google Photos 사진')),
      takenMs,
      lat: null,
      lng: null,
      hasGps: false,
      mimeType,
      mediaType,
      source: 'google-photos-picker'
    };

    if (mediaType === 'video') {
      return [{
        ...common,
        remoteThumbnailUrl: `${baseUrl}=w1600-h1600-no`,
        remoteVideoUrl: `${baseUrl}=dv`,
        videoStatus: String(mediaFile?.mediaFileMetadata?.videoMetadata?.status || '')
      }];
    }

    return [{ ...common, remoteUrl: `${baseUrl}=w1600-h1600` }];
  }).sort((a, b) => a.takenMs - b.takenMs);
}

export function filterPhotosToTravelDates(photos, dateRange) {
  const startDate = normalizeDateOnly(dateRange?.startDate);
  const endDate = normalizeDateOnly(dateRange?.endDate);
  if (!startDate || !endDate || endDate < startDate) {
    return { photos: [...(photos || [])], excludedOutsideRange: 0 };
  }

  const startMs = Date.parse(`${startDate}T00:00:00${TRAVEL_TIME_ZONE_OFFSET}`);
  const endMs = Date.parse(`${endDate}T23:59:59.999${TRAVEL_TIME_ZONE_OFFSET}`);
  const filtered = (photos || []).filter(photo => Number(photo?.takenMs) >= startMs && Number(photo?.takenMs) <= endMs);
  return {
    photos: filtered,
    excludedOutsideRange: Math.max(0, (photos?.length || 0) - filtered.length)
  };
}

async function loadGoogleIdentityServices() {
  if (globalThis.google?.accounts?.oauth2) return globalThis.google;
  if (googleIdentityPromise) return googleIdentityPromise;

  googleIdentityPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${GIS_SCRIPT}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(globalThis.google), { once: true });
      existing.addEventListener('error', () => reject(new Error('Google 로그인 라이브러리를 불러오지 못했습니다.')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = GIS_SCRIPT;
    script.async = true;
    script.defer = true;
    script.onload = () => globalThis.google?.accounts?.oauth2
      ? resolve(globalThis.google)
      : reject(new Error('Google 로그인 라이브러리가 초기화되지 않았습니다.'));
    script.onerror = () => reject(new Error('Google 로그인 라이브러리를 불러오지 못했습니다.'));
    document.head.append(script);
  });
  return googleIdentityPromise;
}

function requestAccessToken(google, clientId) {
  return new Promise((resolve, reject) => {
    const tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: PICKER_SCOPE,
      callback: response => {
        if (response?.error) {
          reject(new Error(response.error_description || response.error));
          return;
        }
        if (!response?.access_token) {
          reject(new Error('Google OAuth access token을 받지 못했습니다.'));
          return;
        }
        resolve(response.access_token);
      },
      error_callback: error => reject(new Error(error?.message || 'Google 로그인 창을 완료하지 못했습니다.'))
    });
    tokenClient.requestAccessToken();
  });
}

async function waitForSelection(initialSession, accessToken, onStatus) {
  const started = Date.now();
  let session = initialSession;
  const timeoutMs = Math.max(30_000, parseGoogleDurationMs(session?.pollingConfig?.timeoutIn, 10 * 60_000));

  while (Date.now() - started < timeoutMs) {
    if (session?.mediaItemsSet) return session;
    const pollMs = Math.max(1_000, parseGoogleDurationMs(session?.pollingConfig?.pollInterval, 2_000));
    await delay(pollMs);
    session = await pickerRequest(`/sessions/${encodeURIComponent(initialSession.id)}`, accessToken);
    if (session?.mediaItemsSet) return session;
    onStatus?.('Google Photos 선택 완료를 기다리는 중…');
  }
  throw new Error('Google Photos 사진·동영상 선택 시간이 만료됐습니다. 다시 연결해 주세요.');
}

async function listSelectedMedia(sessionId, accessToken) {
  const items = [];
  let pageToken = '';
  do {
    const params = new URLSearchParams({ sessionId, pageSize: '100' });
    if (pageToken) params.set('pageToken', pageToken);
    const response = await pickerRequest(`/mediaItems?${params}`, accessToken);
    items.push(...(response?.mediaItems || []));
    pageToken = response?.nextPageToken || '';
  } while (pageToken);
  return items;
}

async function pickerRequest(path, accessToken, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('authorization', `Bearer ${accessToken}`);
  const response = await fetch(`${PICKER_API}${path}`, { ...options, headers });
  const text = await response.text();
  let data = {};
  if (text) {
    try { data = JSON.parse(text); } catch { data = {}; }
  }
  if (!response.ok) {
    const message = data?.error?.message || `Google Photos API 오류 (HTTP ${response.status})`;
    throw new Error(message);
  }
  return data;
}

async function deleteSessionQuietly(sessionId, accessToken) {
  try {
    await pickerRequest(`/sessions/${encodeURIComponent(sessionId)}`, accessToken, { method: 'DELETE' });
  } catch {}
}

function appendAutoClose(uri) {
  const clean = String(uri || '').replace(/\/+$/, '');
  return clean.endsWith('/autoclose') ? clean : `${clean}/autoclose`;
}

function parseGoogleDurationMs(value, fallback) {
  const match = /^([0-9]+(?:\.[0-9]+)?)s$/.exec(String(value || '').trim());
  return match ? Number(match[1]) * 1000 : fallback;
}

function normalizeDateOnly(value) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function formatDateRangeLabel(dateRange) {
  const start = normalizeDateOnly(dateRange?.startDate);
  const end = normalizeDateOnly(dateRange?.endDate);
  if (!start || !end) return '';
  return start === end ? start : `${start} ~ ${end}`;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
