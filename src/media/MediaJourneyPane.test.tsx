import { render } from '@testing-library/react';
import { MediaJourneyPane } from './MediaJourneyPane';
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

describe('MediaJourneyPane', () => {
  it('shows coarse place before timestamp without a place icon', () => {
    const { container } = render(<MediaJourneyPane
      media={[media]}
      activeId={media.id}
      videoMode="THUMBNAIL"
      mobilityClass="WALK"
      movementDate="3월 18일 (수) 11시"
      movementSpeed="12 km/h"
      originCity="기타큐슈"
      destinationCity="기타큐슈"
      placeName="기타큐슈시"
      onFiles={() => undefined}
    />);

    const footer = container.querySelector('.media-caption');
    expect(footer).toHaveTextContent('기타큐슈시');
    expect(footer).toHaveTextContent('2026년 3월 18일 11:11');
    expect(footer?.firstElementChild).toHaveClass('media-caption-place');
    expect(footer?.lastElementChild).toHaveClass('media-caption-date');
    expect(footer?.querySelector('svg')).not.toBeInTheDocument();
    expect(footer).not.toHaveTextContent('날짜');
    expect(footer).not.toHaveTextContent('장소');
    expect(footer).not.toHaveTextContent('IMG_111122');
    expect(footer).not.toHaveTextContent('사진 EXIF');
    expect(footer).not.toHaveTextContent('장면 3 / 4');
  });

  it('replaces overly detailed Korean place labels with the surrounding city', () => {
    const { container } = render(<MediaJourneyPane
      media={[media]}
      activeId={media.id}
      videoMode="THUMBNAIL"
      mobilityClass="WALK"
      movementDate="3월 18일 (수) 11시"
      movementSpeed="12 km/h"
      originCity="인천"
      destinationCity="인천"
      placeName="북도면"
      onFiles={() => undefined}
    />);

    const place = container.querySelector('.media-caption-place');
    expect(place).toHaveTextContent('인천');
    expect(place).not.toHaveTextContent('북도면');
  });

  it('combines a district-level label with its surrounding city', () => {
    const { container } = render(<MediaJourneyPane
      media={[media]}
      activeId={media.id}
      videoMode="THUMBNAIL"
      mobilityClass="WALK"
      movementDate="3월 18일 (수) 11시"
      movementSpeed="12 km/h"
      originCity="인천"
      destinationCity="인천"
      placeName="중구"
      onFiles={() => undefined}
    />);

    expect(container.querySelector('.media-caption-place')).toHaveTextContent('인천 중구');
  });

  it('uses everyday transport labels and places them with the pictogram', () => {
    const { container } = render(<MediaJourneyPane
      media={[media]}
      activeId={null}
      videoMode="THUMBNAIL"
      mobilityClass="ROAD"
      movementDate="3월 18일 (수) 11시"
      movementSpeed="82 km/h"
      originCity="후쿠오카"
      destinationCity="기타큐슈"
      placeName={null}
      onFiles={() => undefined}
    />);

    const identity = container.querySelector('.movement-identity');
    expect(identity).toHaveTextContent('🚗');
    expect(identity).toHaveTextContent('차량');
    expect(identity).not.toHaveTextContent('도로 이동');
    const details = container.querySelector('.movement-details');
    expect(details?.firstElementChild).toHaveClass('movement-date');
    expect(details?.children[1]).toHaveClass('movement-speed');
    expect(details).toHaveTextContent('3월 18일 (수) 11시');
    expect(details).toHaveTextContent('82 km/h');
    expect(details).toHaveTextContent('후쿠오카→기타큐슈');
  });
});
