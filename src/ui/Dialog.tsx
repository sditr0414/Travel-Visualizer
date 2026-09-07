import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function Dialog({ open, onClose, title, subtitle, children, footer, sheet = false }: {
  open: boolean; onClose: () => void; title: string; subtitle?: string;
  children: ReactNode; footer?: ReactNode; sheet?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return <dialog ref={ref} className={`app-dialog ${sheet ? 'settings-sheet' : ''}`} aria-labelledby={titleId}
    aria-describedby={subtitle ? descriptionId : undefined} onCancel={onClose} onClose={onClose}
    onClick={event => { if (event.target === event.currentTarget) {
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
    } }}>
    <header className="dialog-header"><div><h2 id={titleId}>{title}</h2>{subtitle && <p id={descriptionId}>{subtitle}</p>}</div>
      <button type="button" className="icon-button" onClick={onClose} aria-label={`${title} 닫기`}><X size={20} /></button>
    </header>
    <div className="dialog-body">{children}</div>
    {footer && <footer className="dialog-footer">{footer}</footer>}
  </dialog>;
}
