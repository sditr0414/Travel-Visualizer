import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { Map } from 'maplibre-gl';
import mapWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

// MapLibre 6 resolves its default worker next to the original module. Vite moves
// that module into a chunk, so bundle the worker explicitly for production too.
maplibregl.setWorkerUrl(mapWorkerUrl);
import type { MapSourceConfig } from '../types';
import { disposeMapTileWarmup } from './tile-warmup';
import { mapStyleFor } from './map-style';

interface MapStageProps {
  source: MapSourceConfig;
  onReady: (map: Map) => void;
  onError: (message: string | null) => void;
}

export function MapStage({ source, onReady, onError }: MapStageProps) {
  const [loading, setLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    let map: Map | null = null;
    let cancelled = false;
    let observer: ResizeObserver | null = null;
    let ready = false;
    let reportedError = false;
    let fallbackTimeout = 0;
    const initTimeout = window.setTimeout(async () => {
      if (cancelled || !containerRef.current) return;
      let style;
      try {
        style = await mapStyleFor(source);
      } catch {
        onError('지도 구성을 준비하지 못해 기본 배경으로 전환했습니다.');
        style = fallbackStyle();
      }
      if (cancelled || !containerRef.current) return;
      try {
        map = new maplibregl.Map({
          container: containerRef.current,
          style,
          center: [127.6, 36.2],
          zoom: 5.4,
          locale: {
            'Map.Title': '여행 지도',
            'NavigationControl.ZoomIn': '지도 확대',
            'NavigationControl.ZoomOut': '지도 축소',
            'AttributionControl.ToggleAttribution': '지도 출처 보기'
          },
          attributionControl: false,
          cooperativeGestures: false,
          cancelPendingTileRequestsWhileZooming: false,
          maxTileCacheZoomLevels: 8
        });

      } catch {
        setLoading(false);
        onError('이 브라우저에서 지도를 시작하지 못했습니다. 최신 브라우저와 하드웨어 가속 설정을 확인해 주세요.');
        return;
      }
      observer = new ResizeObserver(() => map?.resize());
      observer.observe(containerRef.current);
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
      map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
      collapseAttribution(map);
      map.once('idle', () => map && collapseAttribution(map));
      const markReady = () => {
        if (ready || !map) return;
        ready = true;
        ensureRouteLayers(map);
        collapseAttribution(map);
        onReady(map);
      };
      map.once('load', () => { window.clearTimeout(fallbackTimeout); setLoading(false); if (!reportedError) onError(null); });
      map.once('style.load', markReady);
      map.on('error', event => {
        const message = event.error?.message;
        if (message && !reportedError) {
          reportedError = true;
          console.warn('[Travel Camera 지도]', message);
          onError('배경 지도 요청에 실패했습니다. 인터넷 연결을 확인한 뒤 지도 다시 연결을 눌러 주세요.');
        }
      });
      fallbackTimeout = window.setTimeout(() => {
        if (!map || map.loaded()) return;
        onError('지도 로딩이 지연되고 있습니다. 계속 불러오는 중이며, 연결 상태를 확인하거나 다시 연결할 수 있습니다.');
      }, 12_000);
    }, 0);

    return () => {
      cancelled = true;
      observer?.disconnect();
      window.clearTimeout(initTimeout);
      window.clearTimeout(fallbackTimeout);
      if (map) { disposeMapTileWarmup(map); map.remove(); }
    };
  }, [source, onError, onReady]);

  return <><div ref={containerRef} className="map-canvas" aria-label="여행 경로 지도" data-testid="map-stage" />{loading && <div className="map-loading" role="status">지도를 불러오는 중…</div>}</>;
}

function collapseAttribution(map: Map): void {
  const attribution = map.getContainer().querySelector<HTMLDetailsElement>('.maplibregl-ctrl-attrib');
  if (!attribution) return;
  if (!attribution.dataset.collapseReady) {
    attribution.dataset.collapseReady = 'true';
    attribution.querySelector('.maplibregl-ctrl-attrib-button')?.addEventListener('click', () => {
      attribution.dataset.userOpened = 'true';
    }, { once: true });
  }
  if (attribution.dataset.userOpened) return;
  attribution.open = false;
  attribution.classList.remove('maplibregl-compact-show');
}

function fallbackStyle(): maplibregl.StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [{ id: 'fallback-background', type: 'background', paint: { 'background-color': '#d8d9d4' } }]
  };
}

function ensureRouteLayers(map: Map): void {
  const empty = { type: 'FeatureCollection', features: [] } as const;
  if (!map.getSource('route-all')) map.addSource('route-all', { type: 'geojson', data: empty });
  if (!map.getSource('route-progress')) map.addSource('route-progress', { type: 'geojson', data: empty });

  map.addLayer({
    id: 'route-all',
    type: 'line',
    source: 'route-all',
    paint: {
      'line-color': ['coalesce', ['get', 'color'], '#77818a'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 3, 1.2, 12, 3.6],
      'line-opacity': 0.28
    }
  });
  map.addLayer({
    id: 'route-progress',
    type: 'line',
    source: 'route-progress',
    filter: ['==', ['geometry-type'], 'LineString'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['coalesce', ['get', 'color'], '#ff6b55'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 3, 2.4, 12, 6],
      'line-opacity': ['case', ['==', ['get', 'trail'], true], 0.6, 0.94]
    }
  });
  map.addLayer({
    id: 'route-head',
    type: 'circle',
    source: 'route-progress',
    filter: ['==', ['geometry-type'], 'Point'],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 4.5, 12, 7],
      'circle-color': '#fff7ee',
      'circle-stroke-color': ['coalesce', ['get', 'color'], '#ff6b55'],
      'circle-stroke-width': 3
    }
  });
}
