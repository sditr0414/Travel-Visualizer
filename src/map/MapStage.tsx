import { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { Map } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { MapSourceConfig } from '../types';
import { mapStyleFor } from './map-style';

interface MapStageProps {
  source: MapSourceConfig;
  onReady: (map: Map) => void;
  onError: (message: string) => void;
}

export function MapStage({ source, onReady, onError }: MapStageProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    let map: Map | null = null;
    let ready = false;
    let fallbackTimeout = 0;
    const initTimeout = window.setTimeout(() => {
      if (!containerRef.current) return;
      map = new maplibregl.Map({
        container: containerRef.current,
        style: mapStyleFor(source),
        center: [127.6, 36.2],
        zoom: 5.4,
        attributionControl: false,
        cooperativeGestures: false
      });

      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
      map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
      const markReady = () => {
        if (ready || !map) return;
        ready = true;
        window.clearTimeout(fallbackTimeout);
        ensureRouteLayers(map);
        onReady(map);
      };
      map.once('style.load', markReady);
      map.on('error', event => {
        const message = event.error?.message;
        if (message && /style|source|pmtiles|tile/i.test(message)) onError(message);
      });
      fallbackTimeout = window.setTimeout(() => {
        if (ready || !map) return;
        onError('온라인 지도를 불러오지 못해 기본 배경으로 전환했습니다.');
        map.setStyle(fallbackStyle());
        map.once('style.load', markReady);
      }, 5_000);
    }, 0);

    return () => {
      window.clearTimeout(initTimeout);
      window.clearTimeout(fallbackTimeout);
      map?.remove();
    };
  }, [source, onError, onReady]);

  return <div ref={containerRef} className="map-canvas" aria-label="여행 경로 지도" data-testid="map-stage" />;
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
  if (!map.getSource('route-head')) map.addSource('route-head', { type: 'geojson', data: empty });

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
    paint: {
      'line-color': ['coalesce', ['get', 'color'], '#ff6b55'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 3, 2.4, 12, 6],
      'line-opacity': 0.94
    }
  });
  map.addLayer({
    id: 'route-head',
    type: 'circle',
    source: 'route-head',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 4.5, 12, 7],
      'circle-color': '#fff7ee',
      'circle-stroke-color': ['coalesce', ['get', 'color'], '#ff6b55'],
      'circle-stroke-width': 3
    }
  });
}
