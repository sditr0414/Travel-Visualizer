import { videoTargetTime } from './video-sync';

describe('video elapsed-time synchronization', () => {
  it('seeks backward accurately instead of keeping the later frame', () => {
    expect(videoTargetTime(0.2, 8, 'PLAY', 5)).toBe(0.2);
    expect(videoTargetTime(0, 8, 'PLAY', 5)).toBe(0);
  });
  it('holds a short video at its final frame for the rest of a longer stop', () => {
    expect(videoTargetTime(9, 1.2, 'PLAY', 1.2)).toBeCloseTo(1.19);
    expect(videoTargetTime(10, 0, 'PLAY', 0)).toBe(0);
  });
  it('freezes outgoing scenes and shows the first frame in thumbnail mode', () => {
    expect(videoTargetTime(Number.NaN, 8, 'PLAY', 2)).toBe(2);
    expect(videoTargetTime(4, 8, 'THUMBNAIL', 3)).toBe(0);
    expect(videoTargetTime(4, Infinity, 'PLAY', 0)).toBe(4);
  });
});
