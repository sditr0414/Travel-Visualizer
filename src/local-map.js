let protocolRegistered = false;

const ONLINE_FALLBACK_STYLE = 'https://tiles.openfreemap.org/styles/positron';
const GLYPHS_URL = 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf';

export async function resolveBasemap() {
  const status = await fetchMapStatus();
  const hasRuntime = !!globalThis.pmtiles?.Protocol && !!globalThis.basemaps?.layers;

  if (status.ready && hasRuntime) {
    registerPmtilesProtocol();
    return {
      local: true,
      label: '로컬 하이브리드 지도',
      detail: '세계 z0–5 · 한국/일본 z6–14',
      style: createHybridStyle()
    };
  }

  return {
    local: false,
    label: '온라인 지도 fallback',
    detail: status.ready
      ? 'PMTiles 런타임을 불러오지 못해 온라인 지도를 사용합니다.'
      : 'npm run map:setup 실행 후 로컬 지도를 사용합니다.',
    style: ONLINE_FALLBACK_STYLE
  };
}

function registerPmtilesProtocol() {
  if (protocolRegistered) return;
  const protocol = new globalThis.pmtiles.Protocol();
  globalThis.maplibregl.addProtocol('pmtiles', protocol.tile);
  protocolRegistered = true;
}

function createHybridStyle() {
  const flavor = globalThis.basemaps.namedFlavor('grayscale');
  const worldLayers = prepareLayers(
    globalThis.basemaps.layers('world', flavor, { lang: 'ko' }),
    'world',
    'world-',
    { maxzoom: 6, includeBackground: true }
  );
  const regionLayers = prepareLayers(
    globalThis.basemaps.layers('region', flavor, { lang: 'ko' }),
    'region',
    'region-',
    { minzoom: 6, includeBackground: false }
  );

  const origin = globalThis.location.origin;
  return {
    version: 8,
    glyphs: GLYPHS_URL,
    sources: {
      world: {
        type: 'vector',
        url: `pmtiles://${origin}/maps/world-z5.pmtiles`,
        attribution: '© OpenStreetMap contributors · Protomaps'
      },
      region: {
        type: 'vector',
        url: `pmtiles://${origin}/maps/korea-japan-z14.pmtiles`,
        attribution: '© OpenStreetMap contributors · Protomaps'
      }
    },
    layers: [...worldLayers, ...regionLayers]
  };
}

function prepareLayers(layers, sourceName, prefix, { minzoom = null, maxzoom = null, includeBackground }) {
  return (layers || []).flatMap(layer => {
    if (!includeBackground && layer.type === 'background') return [];
    if (layer.type === 'symbol' && layer.layout?.['icon-image']) return [];
    const id = String(layer.id || '').toLowerCase();
    if (/poi|housenumber|house_number|address|airport_gate|aeroway_gate/.test(id)) return [];

    const copy = clone(layer);
    const nextMin = minzoom === null
      ? Number(copy.minzoom ?? 0)
      : Math.max(Number(copy.minzoom ?? 0), minzoom);
    const nextMax = maxzoom === null
      ? Number(copy.maxzoom ?? 24)
      : Math.min(Number(copy.maxzoom ?? 24), maxzoom);

    if (nextMin >= nextMax) return [];

    copy.id = `${prefix}${copy.id}`;
    if (copy.source) copy.source = sourceName;
    if (nextMin > 0) copy.minzoom = nextMin;
    if (nextMax < 24) copy.maxzoom = nextMax;
    return [copy];
  });
}

async function fetchMapStatus() {
  try {
    const response = await fetch('/api/map-status', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch {
    return { ready: false, world: false, region: false };
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
