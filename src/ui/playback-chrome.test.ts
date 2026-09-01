import { act, renderHook } from '@testing-library/react';
import {
  PLAYBACK_CHROME_HIDE_DELAY_MS,
  PLAYBACK_CHROME_INITIAL_VISIBLE_MS,
  PLAYBACK_CHROME_REVEAL_DELAY_MS,
  usePlaybackChrome
} from './playback-chrome';

describe('playback chrome visibility', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('waits before hiding and before revealing from a pointer zone', () => {
    const view = renderHook(() => usePlaybackChrome({ playing: true }));
    expect(view.result.current.visible).toBe(true);

    act(() => vi.advanceTimersByTime(PLAYBACK_CHROME_INITIAL_VISIBLE_MS));
    expect(view.result.current.visible).toBe(false);

    act(() => view.result.current.revealZoneProps.onPointerEnter());
    act(() => vi.advanceTimersByTime(PLAYBACK_CHROME_REVEAL_DELAY_MS - 1));
    expect(view.result.current.visible).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(view.result.current.visible).toBe(true);

    act(() => view.result.current.revealZoneProps.onPointerLeave());
    act(() => vi.advanceTimersByTime(PLAYBACK_CHROME_HIDE_DELAY_MS - 1));
    expect(view.result.current.visible).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(view.result.current.visible).toBe(false);
  });

  it('keeps chrome visible while a panel requests it or keyboard focus is inside', () => {
    const view = renderHook(({ keepVisible }) => usePlaybackChrome({ playing: true, keepVisible }), {
      initialProps: { keepVisible: false }
    });
    act(() => vi.advanceTimersByTime(PLAYBACK_CHROME_INITIAL_VISIBLE_MS));
    expect(view.result.current.visible).toBe(false);

    view.rerender({ keepVisible: true });
    expect(view.result.current.visible).toBe(true);
    view.rerender({ keepVisible: false });

    act(() => view.result.current.interactionProps.onFocusCapture());
    expect(view.result.current.visible).toBe(true);
    act(() => vi.advanceTimersByTime(PLAYBACK_CHROME_HIDE_DELAY_MS * 2));
    expect(view.result.current.visible).toBe(true);
  });
});
