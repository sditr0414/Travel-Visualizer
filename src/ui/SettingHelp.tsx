import { Children, cloneElement, isValidElement, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const CLOSE_DELAY_MS = 160;
const OPEN_EVENT = 'travel-setting-help-open';

export function SettingHelp({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLSpanElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const pinned = useRef(false);
  const pointerFocus = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const close = useCallback(() => {
    cancelClose();
    pinned.current = false;
    setOpen(false);
  }, [cancelClose]);
  const show = useCallback(() => {
    cancelClose();
    // Moving to another setting must not leave an older pinned bubble behind.
    document.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id }));
    setOpen(true);
  }, [cancelClose, id]);
  const closeSoon = () => {
    cancelClose();
    if (pinned.current) return;
    timer.current = setTimeout(close, CLOSE_DELAY_MS);
  };
  const togglePinned = () => {
    if (pinned.current) close();
    else { pinned.current = true; show(); }
  };

  useEffect(() => {
    const otherHelp = (event: Event) => { if ((event as CustomEvent<string>).detail !== id) close(); };
    document.addEventListener(OPEN_EVENT, otherHelp);
    return () => { cancelClose(); document.removeEventListener(OPEN_EVENT, otherHelp); };
  }, [cancelClose, close, id]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!anchor.current?.contains(event.target as Node) && !bubble.current?.contains(event.target as Node)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      close();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape, true);
    };
  }, [close, open]);

  useLayoutEffect(() => {
    if (!open) return;
    let raf = 0;
    const position = () => {
      const label = anchor.current;
      const tip = bubble.current;
      if (!label || !tip) return;
      const panel = label.closest('details');
      const clip = label.closest('.settings-content')?.getBoundingClientRect();
      const rect = label.getBoundingClientRect();
      const viewport = window.visualViewport;
      const left = (viewport?.offsetLeft ?? 0) + 12;
      const top = (viewport?.offsetTop ?? 0) + 12;
      const right = left + (viewport?.width ?? window.innerWidth) - 24;
      const bottom = top + (viewport?.height ?? window.innerHeight) - 24;
      // A portalled tooltip must not outlive its closed/scrolled-away setting.
      if ((panel && !panel.open) || (rect.width > 0 && (
        rect.bottom <= Math.max(top, clip?.top ?? top) || rect.top >= Math.min(bottom, clip?.bottom ?? bottom)
        || rect.right <= left || rect.left >= right
      ))) { close(); return; }
      tip.style.maxWidth = `${right - left}px`;
      tip.style.maxHeight = `${bottom - top}px`;
      const width = tip.offsetWidth;
      const height = tip.offsetHeight;
      const x = Math.max(left, Math.min(rect.left, right - width));
      const below = rect.bottom + 8;
      const y = Math.max(top, Math.min(below + height <= bottom ? below : rect.top - height - 8, bottom - height));
      // Follow the actual label rect, including the settings entrance transform,
      // scrolling, zoom and late font/layout changes. No positional CSS transition.
      const nextLeft = `${x}px`;
      const nextTop = `${y}px`;
      if (tip.style.left !== nextLeft) tip.style.left = nextLeft;
      if (tip.style.top !== nextTop) tip.style.top = nextTop;
      raf = requestAnimationFrame(position);
    };
    position();
    return () => cancelAnimationFrame(raf);
  }, [close, open, description]);

  const decorated = decorateSettingTitle(children, title, id, () => <span
    ref={anchor}
    className="setting-help-anchor"
    role="button"
    tabIndex={0}
    aria-label={`${title} 설명`}
    aria-expanded={open}
    aria-describedby={id}
    onMouseEnter={show}
    onMouseLeave={closeSoon}
    onClick={event => { event.preventDefault(); event.stopPropagation(); togglePinned(); }}
    onKeyDown={event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.stopPropagation();
        togglePinned();
      }
    }}
  >{title}</span>);

  return <div ref={root} className="setting-with-help"
    onPointerDownCapture={() => { pointerFocus.current = true; }}
    onKeyDownCapture={() => { pointerFocus.current = false; }}
    onFocusCapture={() => { if (!pointerFocus.current) show(); }}
    onBlurCapture={event => {
      pointerFocus.current = false;
      if (!event.currentTarget.contains(event.relatedTarget as Node | null) && !bubble.current?.contains(event.relatedTarget as Node | null)) close();
    }}
  >
    {decorated}
    {createPortal(<div ref={bubble} id={id} role="tooltip" className="setting-tooltip" hidden={!open}
      onMouseEnter={cancelClose} onMouseLeave={closeSoon}
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
