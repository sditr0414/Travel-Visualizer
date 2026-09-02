import { useCallback, useEffect, useRef, useState, type FocusEvent as ReactFocusEvent } from 'react';

export const PLAYBACK_CHROME_REVEAL_DELAY_MS = 220;
export const PLAYBACK_CHROME_HIDE_DELAY_MS = 650;
export const PLAYBACK_CHROME_INITIAL_VISIBLE_MS = 900;

interface PlaybackChromeOptions {
  playing: boolean;
  keepVisible?: boolean;
}

export function usePlaybackChrome({ playing, keepVisible = false }: PlaybackChromeOptions) {
  const [requestedVisible, setRequestedVisible] = useState(true);
  const pointerInsideRef = useRef(false);
  const focusInsideRef = useRef(false);
  const revealTimerRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);

  const clearRevealTimer = useCallback(() => {
    if (revealTimerRef.current === null) return;
    window.clearTimeout(revealTimerRef.current);
    revealTimerRef.current = null;
  }, []);

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current === null) return;
    window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = null;
  }, []);

  const reveal = useCallback((delayMs = PLAYBACK_CHROME_REVEAL_DELAY_MS) => {
    clearHideTimer();
    clearRevealTimer();
    if (!playing || keepVisible || delayMs <= 0) {
      setRequestedVisible(true);
      return;
    }
    revealTimerRef.current = window.setTimeout(() => {
      revealTimerRef.current = null;
      setRequestedVisible(true);
    }, delayMs);
  }, [clearHideTimer, clearRevealTimer, keepVisible, playing]);

  const scheduleHide = useCallback((delayMs = PLAYBACK_CHROME_HIDE_DELAY_MS) => {
    clearRevealTimer();
    clearHideTimer();
    if (!playing || keepVisible || pointerInsideRef.current || focusInsideRef.current) return;
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = null;
      if (!pointerInsideRef.current && !focusInsideRef.current) setRequestedVisible(false);
    }, delayMs);
  }, [clearHideTimer, clearRevealTimer, keepVisible, playing]);

  const onPointerEnter = useCallback(() => {
    pointerInsideRef.current = true;
    reveal();
  }, [reveal]);

  const onRevealPointerMove = useCallback(() => {
    if (!pointerInsideRef.current) return;
    reveal();
  }, [reveal]);

  const onPointerLeave = useCallback(() => {
    pointerInsideRef.current = false;
    scheduleHide();
  }, [scheduleHide]);

  const onFocusCapture = useCallback((event: ReactFocusEvent<HTMLElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.matches(':focus-visible')) return;
    focusInsideRef.current = true;
    reveal(0);
  }, [reveal]);

  const onBlurCapture = useCallback((event: ReactFocusEvent<HTMLElement>) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    focusInsideRef.current = false;
    scheduleHide();
  }, [scheduleHide]);

  useEffect(() => {
    clearRevealTimer();
    clearHideTimer();
    if (!playing || keepVisible || pointerInsideRef.current || focusInsideRef.current) return;
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = null;
      if (!pointerInsideRef.current && !focusInsideRef.current) setRequestedVisible(false);
    }, PLAYBACK_CHROME_INITIAL_VISIBLE_MS);
    return () => {
      clearRevealTimer();
      clearHideTimer();
    };
  }, [clearHideTimer, clearRevealTimer, keepVisible, playing]);

  return {
    visible: !playing || keepVisible || requestedVisible,
    interactionProps: { onPointerEnter, onPointerLeave, onFocusCapture, onBlurCapture },
    revealZoneProps: { onPointerEnter, onPointerMove: onRevealPointerMove, onPointerLeave },
    revealNow: () => reveal(0),
    scheduleHide
  };
}
