import type { FocusEvent as ReactFocusEvent } from 'react';
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

  it('waits for pointer dwell before revealing and delays hiding after leave', () => {
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

  it('does not require a perfectly still pointer after entering the reveal surface', () => {
    const view = renderHook(() => usePlaybackChrome({ playing: true }));
    act(() => vi.advanceTimersByTime(PLAYBACK_CHROME_INITIAL_VISIBLE_MS));
    expect(view.result.current.visible).toBe(false);

    act(() => view.result.current.revealZoneProps.onPointerEnter());
    act(() => vi.advanceTimersByTime(Math.floor(PLAYBACK_CHROME_REVEAL_DELAY_MS / 2)));
    expect(view.result.current.visible).toBe(false);
    act(() => vi.advanceTimersByTime(Math.ceil(PLAYBACK_CHROME_REVEAL_DELAY_MS / 2)));
    expect(view.result.current.visible).toBe(true);
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

    const keyboardTarget = document.createElement('button');
    vi.spyOn(keyboardTarget, 'matches').mockReturnValue(true);
    act(() => view.result.current.interactionProps.onFocusCapture({ target: keyboardTarget } as unknown as ReactFocusEvent<HTMLElement>));
    expect(view.result.current.visible).toBe(true);
    act(() => vi.advanceTimersByTime(PLAYBACK_CHROME_HIDE_DELAY_MS * 2));
    expect(view.result.current.visible).toBe(true);
  });

  it('does not keep chrome visible for focus created by a pointer click', () => {
    const view = renderHook(() => usePlaybackChrome({ playing: true }));
    const pointerTarget = document.createElement('button');
    vi.spyOn(pointerTarget, 'matches').mockReturnValue(false);

    act(() => view.result.current.interactionProps.onFocusCapture({ target: pointerTarget } as unknown as ReactFocusEvent<HTMLElement>));
    act(() => vi.advanceTimersByTime(PLAYBACK_CHROME_INITIAL_VISIBLE_MS));
    expect(view.result.current.visible).toBe(false);
  });
});
