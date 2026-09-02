import { act, render, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { MediaJourneyPane } from './MediaJourneyPane';
import { sceneTransitionDurationMs, transitSceneTransitionDurationMs } from './scene-transition';
import type { JourneyMedia } from '../types';

const media: JourneyMedia = {
  id: 'photo-1',
  file: null,
  sourceUrl: '/api/local-media/photo-1',
  kind: 'image',
  title: 'IMG_111122',
  takenMs: Date.parse('2026-03-18T11:11:22+09:00'),
  lat: 33.883,
  lng: 130.875,
  metadataSource: 'embedded-exif',
  playbackSec: 1,
  matchedLat: 33.883,
  matchedLng: 130.875,
  positionSource: 'gps',
  groupId: 'group-1',
  groupIndex: 2,
  groupCount: 4,
  sourceCount: 4
};

const baseProps = {
  videoMode: 'PLAY' as const,
  videoMuted: true,
  photoDisplaySec: 3,
  mobilityClass: 'WALK' as const,
  movementDate: '3월 18일 (수) 11시',
  movementSpeed: '12 km/h',
  originCity: '기타큐슈',
  destinationCity: '기타큐슈',
  placeName: '기타큐슈시',
  onFiles: () => undefined
};

describe('MediaJourneyPane', () => {
  it('shows coarse place before a Korean-unit timestamp without a place icon', () => {
    const { container } = render(<MediaJourneyPane media={[media]} activeId={media.id} {...baseProps} />);

    const footer = container.querySelector('.media-caption');
    expect(footer).toHaveTextContent('기타큐슈시');
    expect(footer).toHaveTextContent('2026년 3월 18일 11시 11분');
    expect(footer?.firstElementChild).toHaveClass('media-caption-place');
    expect(footer?.lastElementChild).toHaveClass('media-caption-date');
    expect(footer?.querySelector('svg')).not.toBeInTheDocument();
    expect(footer).not.toHaveTextContent('날짜');
    expect(footer).not.toHaveTextContent('장소');
    expect(footer).not.toHaveTextContent('IMG_111122');
  });

  it('shows unknown instead of borrowing a city for an overly detailed place label', () => {
    const { container } = render(<MediaJourneyPane
      media={[media]}
      activeId={media.id}
      {...baseProps}
      originCity="인천"
      destinationCity="인천"
      placeName="북도면"
    />);

    const place = container.querySelector('.media-caption-place');
    expect(place).toHaveTextContent('알 수 없음');
    expect(place).not.toHaveTextContent('인천');
    expect(place).not.toHaveTextContent('북도면');
  });

  it('never exposes raw coordinates and shows unknown instead of a nearby city', () => {
    const { container } = render(<MediaJourneyPane
      media={[media]}
      activeId={media.id}
      {...baseProps}
      originCity="인천"
      destinationCity="인천"
      placeName="37.456, 126.440"
    />);

    const place = container.querySelector('.media-caption-place');
    expect(place).toHaveTextContent('알 수 없음');
    expect(place).not.toHaveTextContent('인천');
    expect(place).not.toHaveTextContent('37.456');
    expect(place).not.toHaveTextContent('126.440');
  });

  it('combines a district-level label with its surrounding city', () => {
    const { container } = render(<MediaJourneyPane
      media={[media]}
      activeId={media.id}
      {...baseProps}
      originCity="인천"
      destinationCity="인천"
      placeName="중구"
    />);

    expect(container.querySelector('.media-caption-place')).toHaveTextContent('인천 중구');
  });

  it('keeps an already combined coarse place label intact', () => {
    const { container } = render(<MediaJourneyPane
      media={[media]}
      activeId={media.id}
      {...baseProps}
      originCity="인천"
      destinationCity="인천"
      placeName="인천광역시 중구"
    />);

    expect(container.querySelector('.media-caption-place')).toHaveTextContent('인천광역시 중구');
    expect(container.querySelector('.media-caption-place')).not.toHaveTextContent('인천 인천광역시');
  });

  it('aligns pictogram/date and transport/route into matching rows', () => {
    const { container } = render(<MediaJourneyPane
      media={[media]}
      activeId={null}
      {...baseProps}
      mobilityClass="ROAD"
      movementSpeed="82 km/h"
      originCity="후쿠오카"
      destinationCity="기타큐슈"
      placeName={null}
    />);

    expect(container.querySelector('.movement-pictogram')).toHaveTextContent('🚗');
    expect(container.querySelector('.movement-mode')).toHaveTextContent('차량');
    expect(container.querySelector('.movement-primary')).toHaveTextContent('3월 18일 (수) 11시');
    expect(container.querySelector('.movement-primary')).toHaveTextContent('82 km/h');
    expect(container.querySelector('.movement-route')).toHaveTextContent('후쿠오카→기타큐슈');
    expect(container.querySelector('.movement-mode')).not.toHaveTextContent('도로 이동');
  });

  it('preloads upcoming photos and holds the previous scene until the active photo is decoded', async () => {
    const nativeImage = globalThis.Image;
    const preloadImages: MockPreloadImage[] = [];
    class ControlledImage {
      decoding = 'auto';
      complete = false;
      naturalWidth = 0;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      src = '';
      decode = vi.fn().mockResolvedValue(undefined);

      constructor() {
        preloadImages.push(this);
      }
    }
    vi.stubGlobal('Image', ControlledImage);
    const second: JourneyMedia = {
      ...media,
      id: 'photo-2',
      sourceUrl: '/api/local-media/photo-2',
      title: 'IMG_111223',
      takenMs: media.takenMs + 60_000,
      playbackSec: 2
    };

    try {
      const view = render(<MediaJourneyPane media={[media, second]} activeId={null} {...baseProps} />);
      expect(preloadImages.map(image => image.src)).toEqual(expect.arrayContaining([
        '/api/local-media/photo-1',
        '/api/local-media/photo-2'
      ]));

      view.rerender(<MediaJourneyPane media={[media, second]} activeId={media.id} {...baseProps} />);
      expect(view.container.querySelector('.media-scene-layer.is-current .media-transit')).toBeInTheDocument();
      expect(view.container.querySelector('.media-scene-stack')).toHaveAttribute('data-media-buffering', 'true');

      const first = preloadImages.find(image => image.src === '/api/local-media/photo-1');
      expect(first).toBeDefined();
      await act(async () => {
        first?.onload?.();
        await Promise.resolve();
        await Promise.resolve();
      });

      await waitFor(() => expect(view.container.querySelector('.media-scene-layer.is-current .media-card')).toBeInTheDocument());
      expect(view.container.querySelector('.media-scene-stack')).toHaveAttribute('data-media-buffering', 'false');
    } finally {
      vi.stubGlobal('Image', nativeImage);
    }
  });

  it('keeps the outgoing scene mounted during the photo cross-dissolve', () => {
    vi.useFakeTimers();
    const view = render(<MediaJourneyPane media={[media]} activeId={media.id} {...baseProps} photoDisplaySec={2} />);

    view.rerender(<MediaJourneyPane media={[media]} activeId={null} {...baseProps} photoDisplaySec={2} />);
    act(() => vi.advanceTimersByTime(20));
    expect(view.container.querySelector('.media-scene-layer.is-previous .media-card')).toBeInTheDocument();
    expect(view.container.querySelector('.media-scene-layer.is-current .media-transit')).toBeInTheDocument();
    expect(view.container.querySelector('.media-scene-stack')).toHaveAttribute('data-transition-ms', String(sceneTransitionDurationMs(2)));

    act(() => vi.advanceTimersByTime(sceneTransitionDurationMs(2) + 60));
    expect(view.container.querySelector('.media-scene-layer.is-previous')).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it('shortens pictogram transitions when transport modes change quickly', () => {
    vi.useFakeTimers();
    const view = render(<MediaJourneyPane media={[media]} activeId={null} {...baseProps} mobilityClass="WALK" />);
    act(() => vi.advanceTimersByTime(400));

    view.rerender(<MediaJourneyPane media={[media]} activeId={null} {...baseProps} mobilityClass="ROAD" />);
    act(() => vi.advanceTimersByTime(20));

    expect(view.container.querySelector('.media-scene-layer.is-previous .movement-pictogram')).toHaveTextContent('🚶');
    expect(view.container.querySelector('.media-scene-layer.is-current .movement-pictogram')).toHaveTextContent('🚗');
    expect(view.container.querySelector('.media-scene-stack')).toHaveAttribute('data-transition-ms', '40');
    vi.useRealTimers();
  });

  it('does not restart the pictogram cross-fade when only route text changes', () => {
    vi.useFakeTimers();
    const view = render(<MediaJourneyPane media={[media]} activeId={null} {...baseProps} mobilityClass="ROAD" originCity="서울" destinationCity="인천" />);
    act(() => vi.advanceTimersByTime(500));

    view.rerender(<MediaJourneyPane media={[media]} activeId={null} {...baseProps} mobilityClass="ROAD" originCity="인천" destinationCity="수원" />);
    act(() => vi.advanceTimersByTime(20));

    expect(view.container.querySelector('.media-scene-layer.is-previous')).not.toBeInTheDocument();
    expect(view.container.querySelector('.movement-route')).toHaveTextContent('인천→수원');
    vi.useRealTimers();
  });

  it('keeps photo dissolves stable while pictograms remain dwell-adaptive', () => {
    expect(sceneTransitionDurationMs(1.5)).toBe(420);
    expect(sceneTransitionDurationMs(3)).toBe(448);
    expect(sceneTransitionDurationMs(8)).toBe(540);
    expect(transitSceneTransitionDurationMs(0.4)).toBe(40);
    expect(transitSceneTransitionDurationMs(2)).toBe(200);
    expect(transitSceneTransitionDurationMs(8)).toBe(320);
  });
});

interface MockPreloadImage {
  src: string;
  onload: (() => void) | null;
}
