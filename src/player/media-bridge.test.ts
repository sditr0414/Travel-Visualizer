import { heldMediaStopId, mediaBridgeThresholdSec } from './media-bridge';

const stops = [
  { id: 'photo-a', atSec: 10, durationSec: 3 },
  { id: 'photo-b', atSec: 15, durationSec: 3 },
  { id: 'photo-c', atSec: 30, durationSec: 3 }
];

describe('media gap bridging', () => {
  it('keeps the previous photo visible across a short route gap', () => {
    expect(heldMediaStopId(10.1, stops)).toBe('photo-a');
    expect(heldMediaStopId(14.9, stops)).toBe('photo-a');
  });

  it('shows transit again when the next photo is far enough away', () => {
    expect(heldMediaStopId(15.1, stops)).toBeNull();
    expect(heldMediaStopId(24, stops)).toBeNull();
  });

  it('does not bridge a photo across a day marker', () => {
    const withDayMarker = [
      { id: 'photo-a', atSec: 10, durationSec: 3 },
      { id: '__day__:2:2026-04-11', atSec: 12, durationSec: 1.8 },
      { id: 'photo-b', atSec: 14, durationSec: 3 }
    ];
    expect(heldMediaStopId(11, withDayMarker)).toBeNull();
    expect(heldMediaStopId(12.5, withDayMarker)).toBeNull();
  });

  it('derives a bounded threshold from the neighboring media display times', () => {
    expect(mediaBridgeThresholdSec(stops[0], stops[1])).toBe(6);
    expect(mediaBridgeThresholdSec(
      { id: 'short', atSec: 0, durationSec: 0.5 },
      { id: 'short-2', atSec: 1, durationSec: 0.5 }
    )).toBe(2.5);
    expect(mediaBridgeThresholdSec(
      { id: 'video', atSec: 0, durationSec: 12 },
      { id: 'photo', atSec: 1, durationSec: 3 }
    )).toBe(8);
  });
});