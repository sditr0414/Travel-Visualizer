import { Children, cloneElement, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const CLOSE_DELAY_MS = 100;

export function SettingHelp({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLSpanElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const pinned = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  const close = () => {
    cancelClose();
    pinned.current = false;
    setOpen(false);
  };
  const closeSoon = () => {
    cancelClose();
    if (pinned.current) return;
    timer.current = setTimeout(() => { timer.current = null; setOpen(false); }, CLOSE_DELAY_MS);
  };
  // Touch browsers can dispatch hover and focus before click. Toggle the explicit
  // pinned state, not the incidental hover state, so the first tap stays open.
  const togglePinned = () => {
    cancelClose();
    pinned.current = !pinned.current;
    setOpen(pinned.current);
  };

  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current); }, []);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node) && !bubble.current?.contains(event.target as Node)) {
        pinned.current = false;
        setOpen(false);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      pinned.current = false;
      setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape, true);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const position = () => {
      const label = anchor.current;
      const tip = bubble.current;
      if (!label || !tip) return;
      const rect = label.getBoundingClientRect();
      const below = rect.bottom + 8;
      tip.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - tip.offsetWidth - 12))}px`;
      tip.style.top = `${Math.max(12, Math.min(below + tip.offsetHeight < window.innerHeight - 12 ? below : rect.top - tip.offsetHeight - 8, window.innerHeight - tip.offsetHeight - 12))}px`;
    };
    position();
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => {
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
    };
  }, [open, description]);

  const decorated = decorateSettingTitle(children, title, id, () => <span
    ref={anchor}
    className="setting-help-anchor"
    role="button"
    tabIndex={0}
    aria-label={`${title} 설명`}
    aria-expanded={open}
    aria-describedby={id}
    onMouseEnter={() => { cancelClose(); setOpen(true); }}
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
    onFocusCapture={() => { cancelClose(); setOpen(true); }}
    onBlurCapture={event => {
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
