import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { WebsocketProvider } from 'y-websocket';
import {
  createOutputInput,
  OUTPUT_KINDS,
  type OutputDto,
  type OutputSettings,
  type StageMessage,
} from '@runflow/core';
import { Alert, Button, Dialog, SelectField, Spinner, TextField } from '@runflow/ui';
import { api, errorMessage } from '../api/client';
import { t } from '../i18n';
import { useFormState, validate } from '../lib/forms';
import { serverNow } from '../rundown/useServerClock';
import { MSG_STAGE, sendCustom } from './protocol';

const kindLabel = (k: string) => OUTPUT_KINDS.find((x) => x.value === k)?.label ?? k;

/** Salidas por enlace de una escaleta: crear, ajustar, copiar el enlace y revocar. */
export function OutputsDialog({
  rundownId,
  canManage,
  onClose,
}: {
  rundownId: string;
  canManage: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const key = ['outputs', rundownId];
  const outputs = useQuery({
    queryKey: key,
    queryFn: async () =>
      (await api.get<{ outputs: OutputDto[] }>(`/api/rundowns/${rundownId}/outputs`)).outputs,
  });
  const [values, setValues] = useState({ kind: 'prompter', name: '' });
  const [created, setCreated] = useState<{ name: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const form = useFormState();
  const action = useFormState();

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    const name = values.name || `${kindLabel(values.kind)} ${(outputs.data?.length ?? 0) + 1}`;
    const { data, errors } = validate(createOutputInput, { kind: values.kind, name });
    if (!data) return form.setFieldErrors(errors);
    const res = await form.submit(() =>
      api.post<{ output: OutputDto; token: string }>(`/api/rundowns/${rundownId}/outputs`, data),
    );
    if (res) {
      setCreated({ name: res.output.name, url: `${location.origin}/salida/${res.token}` });
      setCopied(false);
      setValues((v) => ({ ...v, name: '' }));
      void qc.invalidateQueries({ queryKey: key });
    }
  }

  async function patch(id: string, settings: Partial<OutputSettings>) {
    // Cambio inmediato en pantalla; si falla, se recarga la lista.
    qc.setQueryData<OutputDto[]>(key, (list) =>
      list?.map((o) => (o.id === id ? { ...o, settings: { ...o.settings, ...settings } } : o)),
    );
    const ok = await action.submit(() => api.patch(`/api/outputs/${id}`, { settings }));
    if (!ok) void qc.invalidateQueries({ queryKey: key });
  }

  return (
    <Dialog
      open
      title="Salidas"
      onClose={onClose}
      footer={
        <Button variant="primary" onClick={onClose}>
          {t('common.close')}
        </Button>
      }
    >
      <p className="rf-muted rf-small">
        Pantallas que se abren con un enlace, sin usuario: teleprompter, presentador, relojes,
        agenda, mensajes o multivista. Ábrelas en la TV, la tablet o el ordenador del cristal del
        prompter.
      </p>
      {created && (
        <Alert tone="success">
          <strong>{created.name}</strong>: copia el enlace ahora. Por seguridad no se vuelve a
          mostrar.
          <div className="rf-output-link">
            <input
              readOnly
              value={created.url}
              aria-label="Enlace de la salida"
              onFocus={(e) => e.target.select()}
            />
            <Button
              size="sm"
              onClick={async () => {
                await navigator.clipboard?.writeText(created.url).catch(() => undefined);
                setCopied(true);
              }}
            >
              {copied ? 'Copiado' : 'Copiar'}
            </Button>
            <a
              className="rf-btn rf-btn--sm rf-btn--secondary"
              href={created.url}
              target="_blank"
              rel="noreferrer"
            >
              Abrir
            </a>
          </div>
        </Alert>
      )}
      {action.formError && <Alert tone="error">{action.formError}</Alert>}
      {outputs.isPending ? (
        <Spinner label={t('common.loading')} />
      ) : outputs.isError ? (
        <Alert tone="error">{errorMessage(outputs.error)}</Alert>
      ) : outputs.data.length === 0 ? (
        <p className="rf-muted">Todavía no hay salidas.</p>
      ) : (
        <ul className="rf-output-list">
          {outputs.data.map((o) => (
            <li key={o.id}>
              <div className="rf-output-list__main">
                <strong>{o.name}</strong>{' '}
                <span className="rf-muted rf-small">{kindLabel(o.kind)}</span>
              </div>
              {canManage && (
                <div className="rf-output-list__settings">
                  {(o.kind === 'prompter' || o.kind === 'presenter' || o.kind === 'multiview') && (
                    <>
                      <label>
                        <input
                          type="checkbox"
                          checked={o.settings.mirror}
                          onChange={(e) => void patch(o.id, { mirror: e.target.checked })}
                        />
                        Espejo
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={o.settings.uppercase}
                          onChange={(e) => void patch(o.id, { uppercase: e.target.checked })}
                        />
                        Mayúsculas
                      </label>
                      <label>
                        Letra
                        <input
                          type="number"
                          min={16}
                          max={200}
                          defaultValue={o.settings.fontSize}
                          onBlur={(e) => {
                            const v = Number(e.target.value);
                            if (v >= 16 && v <= 200 && v !== o.settings.fontSize)
                              void patch(o.id, { fontSize: v });
                          }}
                          aria-label={`Tamaño de letra de ${o.name}`}
                        />
                      </label>
                    </>
                  )}
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={async () => {
                      const ok = await action.submit(() => api.delete(`/api/outputs/${o.id}`));
                      if (ok) void qc.invalidateQueries({ queryKey: key });
                    }}
                  >
                    Revocar
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <form className="rf-form rf-form--boxed" onSubmit={onCreate} noValidate>
          <h3 className="rf-form__title">Nueva salida</h3>
          {form.formError && <Alert tone="error">{form.formError}</Alert>}
          <div className="rf-form__row">
            <SelectField
              label="Tipo"
              value={values.kind}
              onChange={(e) => setValues((v) => ({ ...v, kind: e.target.value }))}
              options={OUTPUT_KINDS.map((k) => ({ value: k.value, label: k.label }))}
              hint={OUTPUT_KINDS.find((k) => k.value === values.kind)?.description}
            />
            <TextField
              label="Nombre"
              placeholder="Prompter cámara 1"
              value={values.name}
              onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
              error={form.fieldErrors.name}
            />
          </div>
          <div>
            <Button type="submit" variant="primary" loading={form.submitting}>
              Crear salida
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

const COLORS: { value: StageMessage['color']; label: string }[] = [
  { value: 'white', label: 'Blanco' },
  { value: 'yellow', label: 'Amarillo' },
  { value: 'green', label: 'Verde' },
  { value: 'red', label: 'Rojo' },
];

/** Mensaje del control al plató (salidas de presentador, mensajes y multivista). */
export function StageMessageDialog({
  provider,
  current,
  from,
  onSent,
  onClose,
}: {
  provider: WebsocketProvider;
  current: StageMessage | null;
  from: string;
  onSent: (m: StageMessage | null) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [color, setColor] = useState<StageMessage['color']>('yellow');
  const [flash, setFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = (message: StageMessage | null) => {
    if (!sendCustom(provider, MSG_STAGE, message)) {
      setError('Sin conexión: no se ha podido enviar.');
      return;
    }
    onSent(message);
    onClose();
  };

  return (
    <Dialog
      open
      title="Mensaje al plató"
      onClose={onClose}
      footer={
        <>
          {current?.text && (
            <Button variant="ghost" className="rf-dialog__left" onClick={() => send(null)}>
              Quitar mensaje
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={!text.trim()}
            onClick={() =>
              send({ text: text.trim().slice(0, 200), color, flash, sentAt: serverNow(), from })
            }
          >
            Enviar
          </Button>
        </>
      }
    >
      {error && <Alert tone="error">{error}</Alert>}
      {current?.text && <p className="rf-muted rf-small">En pantalla: «{current.text}»</p>}
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
              name="color"
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
