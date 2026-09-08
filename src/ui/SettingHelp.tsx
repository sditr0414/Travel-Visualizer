import { Children, cloneElement, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const CLOSE_DELAY_MS = 80;

/** Show setting help from the setting name itself; controls keep aria-description for keyboard users. */
export function SettingHelp({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLSpanElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = () => {
    if (!timer.current) return;
    clearTimeout(timer.current);
    timer.current = null;
  };
  const closeSoon = () => {
    cancelClose();
    timer.current = setTimeout(() => {
      timer.current = null;
      setOpen(false);
    }, CLOSE_DELAY_MS);
  };

  useEffect(() => () => cancelClose(), []);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node) && !bubble.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
      }
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
      const width = tip.offsetWidth;
      const height = tip.offsetHeight;
      const below = rect.bottom + 8;
      tip.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`;
      tip.style.top = `${Math.max(12, Math.min(below + height < window.innerHeight - 12 ? below : rect.top - height - 8, window.innerHeight - height - 12))}px`;
    };
    position();
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => {
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
    };
  }, [open, description]);

  const decoratedChildren = decorateSettingTitle(children, title, () => <span
    ref={anchor}
    className="setting-help-anchor"
    onMouseEnter={() => { cancelClose(); setOpen(true); }}
    onMouseLeave={closeSoon}
    onClick={event => {
      event.preventDefault();
      event.stopPropagation();
      cancelClose();
      setOpen(value => !value);
    }}
  >{title}</span>);

  return <div
    ref={root}
    className="setting-with-help"
    onFocusCapture={() => { cancelClose(); setOpen(true); }}
    onBlurCapture={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null) && !bubble.current?.contains(event.relatedTarget as Node | null)) closeSoon();
    }}
  >
    {decoratedChildren}
    {createPortal(<div
      ref={bubble}
      id={id}
      role="tooltip"
      className="setting-tooltip"
      hidden={!open}
      onMouseEnter={cancelClose}
      onMouseLeave={closeSoon}
    >
      <strong>{title}</strong><p>{description}</p>
    </div>, document.body)}
  </div>;
}

function decorateSettingTitle(children: ReactNode, title: string, renderAnchor: () => ReactNode): ReactNode {
  let decorated = false;
  const visit = (node: ReactNode): ReactNode => {
    if (decorated) return node;
    if (typeof node === 'string') {
      const index = node.indexOf(title);
      if (index < 0) return node;
      decorated = true;
      const before = node.slice(0, index);
      const after = node.slice(index + title.length);
      return <>{before}{renderAnchor()}{after}</>;
    }
    if (!isValidElement(node)) return node;
    const element = node as ReactElement<{ children?: ReactNode }>;
    if (element.props.children === undefined) return node;
    return cloneElement(element, {}, Children.map(element.props.children, visit));
  };
  return Children.map(children, visit);
}
