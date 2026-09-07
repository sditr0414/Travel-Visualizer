import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const CLOSE_DELAY_MS = 80;

/** Desktop hover belongs only to the explicit ? button; click/focus keep touch and keyboard access. */
export function SettingHelp({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
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
      if (!button.current?.contains(event.target as Node) && !bubble.current?.contains(event.target as Node)) setOpen(false);
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
      const anchor = button.current;
      const tip = bubble.current;
      if (!anchor || !tip) return;
      const rect = anchor.getBoundingClientRect();
      const width = tip.offsetWidth;
      const height = tip.offsetHeight;
      const below = rect.bottom + 8;
      tip.style.left = `${Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12))}px`;
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

  return <div className="setting-with-help">
    {children}
    <button
      ref={button}
      type="button"
      className="setting-help-button"
      aria-label={`${title} 설명`}
      aria-expanded={open}
      aria-describedby={id}
      onMouseEnter={() => { cancelClose(); setOpen(true); }}
      onMouseLeave={closeSoon}
      onFocus={event => {
        if (event.currentTarget.matches(':focus-visible')) {
          cancelClose();
          setOpen(true);
        }
      }}
      onBlur={event => {
        if (!bubble.current?.contains(event.relatedTarget as Node | null)) closeSoon();
      }}
      onClick={() => { cancelClose(); setOpen(value => !value); }}
    >?</button>
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
