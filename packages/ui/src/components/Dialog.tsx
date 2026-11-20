import { useEffect, useRef, type ReactNode } from 'react';

export interface DialogProps {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

/** Diálogo modal accesible basado en <dialog> (gestiona foco y tecla Escape). */
export function Dialog({ open, title, onClose, children, footer }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="rf-dialog"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      aria-labelledby="rf-dialog-title"
    >
      {open && (
        <>
          <div className="rf-dialog__header">
            <h2 className="rf-dialog__title" id="rf-dialog-title">
              {title}
            </h2>
            <button
              type="button"
              className="rf-btn rf-btn--ghost rf-btn--sm"
              onClick={onClose}
              aria-label="Cerrar ventana"
            >
              ✕
            </button>
          </div>
          <div className="rf-dialog__body">{children}</div>
          {footer && <div className="rf-dialog__footer">{footer}</div>}
        </>
      )}
    </dialog>
  );
}
