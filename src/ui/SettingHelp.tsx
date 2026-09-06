import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Hover/focus help also has an explicit toggle for touch screens. */
export function SettingHelp({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = () => { if (timer.current) clearTimeout(timer.current); };
  const closeLater = () => { cancelClose(); timer.current = setTimeout(() => setOpen(false), 160); };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!anchor.current?.contains(event.target as Node) && !bubble.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape, true); };
  }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    const position = () => {
      const field = anchor.current;
      const tip = bubble.current;
      if (!field || !tip) return;
      const rect = field.getBoundingClientRect();
      const width = tip.offsetWidth;
      const height = tip.offsetHeight;
      const below = rect.bottom + 8;
      tip.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`;
      tip.style.top = `${Math.max(12, Math.min(below + height < window.innerHeight - 12 ? below : rect.top - height - 8, window.innerHeight - height - 12))}px`;
    };
    position();
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => { window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true); };
  }, [open, description]);
  return <div ref={anchor} className="setting-with-help" onPointerEnter={event => { if (event.pointerType === 'mouse') { cancelClose(); setOpen(true); } }} onPointerLeave={closeLater}
    onFocus={event => { if ((event.target as HTMLElement).tagName !== 'BUTTON') { cancelClose(); setOpen(true); } }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) closeLater(); }}>
    {children}
    <button type="button" className="setting-help-button" aria-label={`${title} 설명`} aria-expanded={open} aria-describedby={id}
      onFocus={event => { if (event.currentTarget.matches(':focus-visible')) { cancelClose(); setOpen(true); } }}
      onClick={() => { cancelClose(); setOpen(value => !value); }}>?</button>
    {createPortal(<div ref={bubble} id={id} role="tooltip" className="setting-tooltip" hidden={!open} onPointerEnter={cancelClose} onPointerLeave={closeLater}>
      <strong>{title}</strong><p>{description}</p>
    </div>, document.body)}
  </div>;
}
