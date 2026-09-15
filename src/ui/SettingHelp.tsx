import { Children, cloneElement, isValidElement, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const OPEN_DELAY_MS = 180;
const CLOSE_DELAY_MS = 180;
const HELP_OPEN_EVENT = 'travel-setting-help-open';

export function SettingHelp({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLSpanElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const pinned = useRef(false);
  const keyboardFocus = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelTimer = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const close = useCallback(() => {
    cancelTimer();
    pinned.current = false;
    setOpen(false);
  }, [cancelTimer]);
  const show = useCallback(() => {
    cancelTimer();
    document.dispatchEvent(new CustomEvent(HELP_OPEN_EVENT, { detail: id }));
    setOpen(true);
  }, [cancelTimer, id]);
  const closeSoon = () => {
    cancelTimer();
    if (pinned.current || keyboardFocus.current) return;
    timer.current = setTimeout(close, CLOSE_DELAY_MS);
  };
  const togglePinned = () => {
    if (pinned.current) close();
    else { pinned.current = true; show(); }
  };

  useEffect(() => {
    const otherHelp = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== id) close();
    };
    document.addEventListener(HELP_OPEN_EVENT, otherHelp);
    return () => { cancelTimer(); document.removeEventListener(HELP_OPEN_EVENT, otherHelp); };
  }, [cancelTimer, close, id]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      // An input is not part of the help trigger. Clicking it must not pin a
      // stale explanation above the setting the user is now editing.
      if (!anchor.current?.contains(event.target as Node) && !bubble.current?.contains(event.target as Node)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      close();
    };
    const scroll = (event: Event) => {
      if (!(event.target instanceof Node) || !bubble.current?.contains(event.target)) close();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    window.addEventListener('scroll', scroll, true);
    const details = root.current?.closest('details');
    const observer = details ? new MutationObserver(() => { if (!details.open) close(); }) : null;
    if (details) observer?.observe(details, { attributes: true, attributeFilter: ['open'] });
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape, true);
      window.removeEventListener('scroll', scroll, true);
      observer?.disconnect();
    };
  }, [close, open]);

  useLayoutEffect(() => {
    if (!open) return;
    let cancelled = false;
    let raf = 0;
    const panel = root.current?.closest<HTMLElement>('.settings-content');
    const position = () => {
      const label = anchor.current;
      const tip = bubble.current;
      if (cancelled || !label || !tip) return;
      const rect = label.getBoundingClientRect();
      const clip = panel?.getBoundingClientRect();
      if (clip && (rect.bottom <= clip.top || rect.top >= clip.bottom)) { close(); return; }
      const viewport = window.visualViewport;
      const left = viewport?.offsetLeft ?? 0;
      const top = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? window.innerWidth;
      const height = viewport?.height ?? window.innerHeight;
      tip.style.width = `${Math.min(300, Math.max(1, width - 24))}px`;
      // Use the actual rendered bubble height, never an assumed number of lines.
      tip.style.maxHeight = `${Math.max(1, height - 24)}px`;
      const box = tip.getBoundingClientRect();
      const belowSpace = top + height - 12 - rect.bottom - 8;
      const aboveSpace = rect.top - 8 - top - 12;
      const below = belowSpace >= box.height || belowSpace >= aboveSpace;
      const available = Math.max(1, below ? belowSpace : aboveSpace);
      tip.style.maxHeight = `${available}px`;
      const bubbleHeight = Math.min(box.height, available);
      const x = Math.max(left + 12, Math.min(rect.left, left + width - box.width - 12));
      const y = below ? rect.bottom + 8 : rect.top - bubbleHeight - 8;
      tip.style.left = `${x}px`;
      tip.style.top = `${Math.max(top + 12, Math.min(y, top + height - bubbleHeight - 12))}px`;
      tip.dataset.placement = below ? 'bottom' : 'top';
    };
    position();
    // The parent panel animates its transform on opening. Track that short
    // interval so a portal cannot keep coordinates from an intermediate frame.
    const until = performance.now() + 600;
    const followEntrance = () => {
      position();
      if (!cancelled && performance.now() < until) raf = requestAnimationFrame(followEntrance);
    };
    raf = requestAnimationFrame(followEntrance);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(position) : null;
    if (anchor.current) observer?.observe(anchor.current);
    if (panel) observer?.observe(panel);
    window.addEventListener('resize', position);
    window.visualViewport?.addEventListener('resize', position);
    void document.fonts?.ready.then(() => { if (!cancelled) position(); });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      observer?.disconnect();
      window.removeEventListener('resize', position);
      window.visualViewport?.removeEventListener('resize', position);
    };
  }, [close, description, open]);

  const decorated = decorateSettingTitle(children, title, id, () => <span
    ref={anchor}
    className="setting-help-anchor"
    role="button"
    tabIndex={0}
    aria-label={`${title} 설명`}
    aria-expanded={open}
    aria-describedby={id}
    onMouseEnter={() => { cancelTimer(); timer.current = setTimeout(show, OPEN_DELAY_MS); }}
    onMouseLeave={closeSoon}
    onPointerDown={() => { keyboardFocus.current = false; }}
    onFocus={() => {
      keyboardFocus.current = anchor.current?.matches(':focus-visible') ?? false;
      if (keyboardFocus.current) show();
    }}
    onBlur={() => { keyboardFocus.current = false; close(); }}
    onClick={event => { event.preventDefault(); event.stopPropagation(); togglePinned(); }}
    onKeyDown={event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.stopPropagation();
        togglePinned();
      }
    }}
  >{title}</span>);

  return <div ref={root} className="setting-with-help" onFocusCapture={event => {
    if (event.target !== anchor.current) close();
  }}>
    {decorated}
    {createPortal(<div ref={bubble} id={id} role="tooltip" className="setting-tooltip" hidden={!open}
      onMouseEnter={cancelTimer} onMouseLeave={closeSoon}
    ><strong>{title}</strong><p>{description}</p></div>, document.body)}
  </div>;
}

function decorateSettingTitle(children: ReactNode, title: string, descriptionId: string, renderAnchor: () => ReactNode): ReactNode {
  let decorated = false;
  const visit = (node: ReactNode): ReactNode => {
    if (typeof node === 'string') {
      const index = decorated ? -1 : node.indexOf(title);
      if (index < 0) return node;
      decorated = true;
      return <>{node.slice(0, index)}{renderAnchor()}{node.slice(index + title.length)}</>;
    }
    if (!isValidElement(node)) return node;
    const element = node as ReactElement<{ children?: ReactNode; 'aria-describedby'?: string }>;
    const control = typeof element.type === 'string' && ['input', 'select', 'textarea'].includes(element.type);
    const props = control ? { 'aria-describedby': [element.props['aria-describedby'], descriptionId].filter(Boolean).join(' ') } : undefined;
    return element.props.children === undefined ? cloneElement(element, props)
      : cloneElement(element, props, Children.map(element.props.children, visit));
  };
  return Children.map(children, visit);
}
