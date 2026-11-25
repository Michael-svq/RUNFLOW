import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router';
import type { RundownDto, StageMessage } from '@runflow/core';
import { Alert, Button, Dialog, SelectField } from '@runflow/ui';
import { api, errorMessage } from '../api/client';

/* Menús desplegables de la cabecera y «Mensaje al plató». */

export const todayIso = (): string => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** Desplegable sencillo: se cierra al elegir, al pulsar fuera, con Esc o al cambiar de página. */
export function Dropdown({
  label,
  button,
  className,
  children,
}: {
  label: string;
  button: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className={`rf-dropdown ${className ?? ''}`} ref={ref}>
      <button
        type="button"
        className="rf-dropdown__button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {button}
      </button>
      {open && (
        <div className="rf-dropdown__menu" role="menu" onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}

export function MenuLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} role="menuitem" className="rf-dropdown__item">
      {children}
    </Link>
  );
}

const COLORS: { value: StageMessage['color']; label: string }[] = [
  { value: 'yellow', label: 'Amarillo' },
  { value: 'white', label: 'Blanco' },
  { value: 'green', label: 'Verde' },
  { value: 'red', label: 'Rojo' },
];

/** Botón de la cabecera de Dirección TV: mensaje al presentador de una escaleta de hoy. */
export function StageMessageButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="ghost" className="rf-header__stage" onClick={() => setOpen(true)}>
        💬 Mensaje al plató
      </Button>
      {open && <StageMessageGlobalDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function StageMessageGlobalDialog({ onClose }: { onClose: () => void }) {
  const day = todayIso();
  const rundowns = useQuery({
    queryKey: ['rundowns', day, day, 'stage'],
    queryFn: async () =>
      (
        await api.get<{ rundowns: RundownDto[] }>(
          `/api/rundowns?${new URLSearchParams({ from: day, to: day })}`,
        )
      ).rundowns,
  });
  const list = rundowns.data ?? [];
  const [chosen, setChosen] = useState('');
  const [text, setText] = useState('');
  const [color, setColor] = useState<StageMessage['color']>('yellow');
  const [flash, setFlash] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const rundownId = chosen || list.find((r) => r.status === 'en_aire')?.id || list[0]?.id || '';

  const send = async (message: string) => {
    setNotice(null);
    try {
      await api.post(`/api/rundowns/${rundownId}/stage`, { text: message, color, flash });
      if (message) onClose();
      else setNotice({ tone: 'success', text: 'Mensaje quitado.' });
    } catch (err) {
      setNotice({ tone: 'error', text: errorMessage(err) });
    }
  };

  return (
    <Dialog
      open
      title="Mensaje al plató"
      onClose={onClose}
      footer={
        <>
          <Button
            variant="ghost"
            className="rf-dialog__left"
            disabled={!rundownId}
            onClick={() => void send('')}
          >
            Quitar mensaje
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            disabled={!rundownId || !text.trim()}
            onClick={() => void send(text.trim())}
          >
            Enviar
          </Button>
        </>
      }
    >
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      {list.length === 0 && !rundowns.isPending ? (
        <p className="rf-muted rf-small">No hay escaletas hoy.</p>
      ) : (
        <SelectField
          label="Escaleta"
          value={rundownId}
          onChange={(e) => setChosen(e.target.value)}
          options={list.map((r) => ({
            value: r.id,
            label: `${r.startTime.slice(0, 5)} · ${r.title}${r.status === 'en_aire' ? ' (en el aire)' : ''}`,
          }))}
        />
      )}
      <label className="rf-field">
        <span className="rf-field__label">Mensaje</span>
        <textarea
          className="rf-input rf-textarea"
          rows={3}
          maxLength={200}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ej.: 1 minuto · Estira · Pasa a la conexión"
          autoFocus
        />
      </label>
      <div className="rf-choice-row" role="radiogroup" aria-label="Color">
        {COLORS.map((c) => (
          <label
            key={c.value}
            className={`rf-color-choice is-${c.value}${color === c.value ? ' is-active' : ''}`}
          >
            <input
              type="radio"
              name="stage-color"
              value={c.value}
              checked={color === c.value}
              onChange={() => setColor(c.value)}
            />
            {c.label}
          </label>
        ))}
        <label className="rf-checkbox">
          <input type="checkbox" checked={flash} onChange={(e) => setFlash(e.target.checked)} />
          Parpadeo
        </label>
      </div>
    </Dialog>
  );
}
