import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  API_SCOPES,
  WEBHOOK_EVENTS,
  type ApiScope,
  type ApiTokenDto,
  type WebhookDto,
  type WebhookEvent,
} from '@runflow/core';
import { Alert, Badge, Button, Spinner, TextField } from '@runflow/ui';
import { api, errorMessage } from '../api/client';
import { locale } from '../i18n';

/* Configuración → API y webhooks (F2.4). Ver docs/API.md. */

const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' });

export function ApiConfig() {
  const qc = useQueryClient();
  const tokens = useQuery({
    queryKey: ['api-tokens'],
    queryFn: async () => (await api.get<{ tokens: ApiTokenDto[] }>('/api/api-tokens')).tokens,
  });
  const hooks = useQuery({
    queryKey: ['webhooks'],
    queryFn: async () => (await api.get<{ webhooks: WebhookDto[] }>('/api/webhooks')).webhooks,
  });
  const [tokenForm, setTokenForm] = useState<{ name: string; scopes: ApiScope[] }>({
    name: '',
    scopes: ['read'],
  });
  const [hookForm, setHookForm] = useState<{ url: string; events: WebhookEvent[] }>({
    url: '',
    events: ['live.go'],
  });
  const [secret, setSecret] = useState<{ label: string; value: string } | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const toggle = <T,>(list: T[], v: T) =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

  async function createToken(e: FormEvent) {
    e.preventDefault();
    setNotice(null);
    try {
      const res = await api.post<{ token: string }>('/api/api-tokens', tokenForm);
      setSecret({ label: `Token «${tokenForm.name}»`, value: res.token });
      setTokenForm({ name: '', scopes: ['read'] });
      void qc.invalidateQueries({ queryKey: ['api-tokens'] });
    } catch (err) {
      setNotice({ tone: 'error', text: errorMessage(err) });
    }
  }

  async function createHook(e: FormEvent) {
    e.preventDefault();
    setNotice(null);
    try {
      const res = await api.post<{ secret: string }>('/api/webhooks', hookForm);
      setSecret({ label: 'Secreto de firma del webhook', value: res.secret });
      setHookForm({ url: '', events: ['live.go'] });
      void qc.invalidateQueries({ queryKey: ['webhooks'] });
    } catch (err) {
      setNotice({ tone: 'error', text: errorMessage(err) });
    }
  }

  return (
    <section className="rf-card rf-config" aria-labelledby="api-title">
      <h2 id="api-title" className="rf-form__title">
        API y webhooks
      </h2>
      <p className="rf-muted rf-small">
        Para conectar RunFlow con otros sistemas (web, grafismo, redes, automatismos): la API REST{' '}
        <code>/api/v1</code> con un token y avisos firmados (webhooks) cuando cambia el directo.
      </p>
      {secret && (
        <Alert tone="success">
          {secret.label}: cópialo ahora, no se volverá a mostrar.
          <code className="rf-code">{secret.value}</code>
          <Button size="sm" variant="ghost" onClick={() => setSecret(null)}>
            Hecho
          </Button>
        </Alert>
      )}
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}

      <h3 className="rf-small">Tokens de la API</h3>
      {tokens.isPending ? (
        <Spinner label="Cargando…" />
      ) : (
        <ul className="rf-sidelist__items">
          {(tokens.data ?? []).map((t) => (
            <li key={t.id}>
              <div>
                <strong>{t.name}</strong>{' '}
                {t.scopes.map((s) => (
                  <Badge key={s}>{s}</Badge>
                ))}
                <span className="rf-muted rf-small">
                  {' '}
                  {t.lastUsedAt ? `usado ${dateTime.format(new Date(t.lastUsedAt))}` : 'sin usar'}
                </span>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  await api.delete(`/api/api-tokens/${t.id}`).catch(() => undefined);
                  void qc.invalidateQueries({ queryKey: ['api-tokens'] });
                }}
              >
                Revocar
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form className="rf-config__inline" onSubmit={createToken} aria-label="Nuevo token">
        <TextField
          label="Nombre del token"
          value={tokenForm.name}
          maxLength={60}
          onChange={(e) => setTokenForm({ ...tokenForm, name: e.target.value })}
          required
        />
        <fieldset className="rf-config__checks">
          <legend className="rf-field__label">Permisos</legend>
          {API_SCOPES.map((s) => (
            <label key={s.value} className="rf-check">
              <input
                type="checkbox"
                checked={tokenForm.scopes.includes(s.value)}
                onChange={() =>
                  setTokenForm({ ...tokenForm, scopes: toggle(tokenForm.scopes, s.value) })
                }
              />
              <span>{s.label}</span>
            </label>
          ))}
        </fieldset>
        <Button
          type="submit"
          size="sm"
          disabled={!tokenForm.name.trim() || !tokenForm.scopes.length}
        >
          Crear token
        </Button>
      </form>

      <h3 className="rf-small">Webhooks</h3>
      {hooks.isPending ? (
        <Spinner label="Cargando…" />
      ) : (
        <ul className="rf-sidelist__items">
          {(hooks.data ?? []).map((h) => (
            <li key={h.id}>
              <div>
                <strong className="rf-config__url">{h.url}</strong>{' '}
                {h.lastDeliveryAt &&
                  (h.lastError ? (
                    <Badge tone="danger">{h.lastError}</Badge>
                  ) : (
                    <Badge tone="success">{h.lastStatus}</Badge>
                  ))}
                <span className="rf-muted rf-small"> {h.events.join(', ')}</span>
              </div>
              <span className="rf-sidelist__confirm">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    const r = await api
                      .post<{
                        status: number | null;
                        error: string | null;
                      }>(`/api/webhooks/${h.id}/test`)
                      .catch((e: unknown) => ({ status: null, error: errorMessage(e) }));
                    setNotice(
                      r.error
                        ? { tone: 'error', text: `Prueba: ${r.error}` }
                        : { tone: 'success', text: `Prueba entregada (${r.status}).` },
                    );
                    void qc.invalidateQueries({ queryKey: ['webhooks'] });
                  }}
                >
                  Probar
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    await api.delete(`/api/webhooks/${h.id}`).catch(() => undefined);
                    void qc.invalidateQueries({ queryKey: ['webhooks'] });
                  }}
                >
                  Quitar
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <form className="rf-config__inline" onSubmit={createHook} aria-label="Nuevo webhook">
        <TextField
          label="Dirección que recibe los avisos"
          type="url"
          value={hookForm.url}
          placeholder="https://…"
          onChange={(e) => setHookForm({ ...hookForm, url: e.target.value })}
          required
        />
        <fieldset className="rf-config__checks">
          <legend className="rf-field__label">Eventos</legend>
          {WEBHOOK_EVENTS.map((ev) => (
            <label key={ev.value} className="rf-check">
              <input
                type="checkbox"
                checked={hookForm.events.includes(ev.value)}
                onChange={() =>
                  setHookForm({ ...hookForm, events: toggle(hookForm.events, ev.value) })
                }
              />
              <span>{ev.label}</span>
            </label>
          ))}
        </fieldset>
        <Button type="submit" size="sm" disabled={!hookForm.url.trim() || !hookForm.events.length}>
          Añadir webhook
        </Button>
      </form>
    </section>
  );
}
