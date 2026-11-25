import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SourceDto, SourceItemDto } from '@runflow/core';
import { Alert, Badge, Button, Spinner, TextField } from '@runflow/ui';
import { api, errorMessage } from '../api/client';
import { useCan } from '../auth/session';
import { PageHeader } from '../components/PageHeader';
import { locale } from '../i18n';
import { fridgeKey } from '../rundown/panels';

/* 01 Fuentes (F2.2): noticias de agencias y medios por RSS/Atom. */

const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' });
export const sourcesKey = ['sources'];

export function useSourceItems(sourceId: string, q: string) {
  return useQuery({
    queryKey: ['source-items', sourceId, q],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '100' });
      if (sourceId) params.set('sourceId', sourceId);
      if (q.trim()) params.set('q', q.trim());
      return (await api.get<{ items: SourceItemDto[] }>(`/api/source-items?${params}`)).items;
    },
    refetchInterval: 60_000,
  });
}

export function useSources() {
  return useQuery({
    queryKey: sourcesKey,
    queryFn: async () => (await api.get<{ sources: SourceDto[] }>('/api/sources')).sources,
  });
}

export function SourcesPage() {
  const qc = useQueryClient();
  const canManage = useCan('program.configure');
  const sources = useSources();
  const [sourceId, setSourceId] = useState('');
  const [q, setQ] = useState('');
  const items = useSourceItems(sourceId, q);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [form, setForm] = useState({ name: '', url: '' });
  const [busy, setBusy] = useState(false);

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const res = await api.post<{ source: SourceDto; added: number }>('/api/sources', form);
      setForm({ name: '', url: '' });
      setNotice(
        res.source.lastError
          ? { tone: 'error', text: `«${res.source.name}»: ${res.source.lastError}` }
          : { tone: 'success', text: `«${res.source.name}»: ${res.added} noticias.` },
      );
      void qc.invalidateQueries({ queryKey: sourcesKey });
      void qc.invalidateQueries({ queryKey: ['source-items'] });
    } catch (err) {
      setNotice({ tone: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function toFridge(item: SourceItemDto) {
    try {
      await api.post(`/api/source-items/${item.id}/fridge`);
      void qc.invalidateQueries({ queryKey: fridgeKey });
      setNotice({ tone: 'success', text: `«${item.title}» está en la nevera.` });
    } catch (err) {
      setNotice({ tone: 'error', text: errorMessage(err) });
    }
  }

  return (
    <>
      <PageHeader
        title="Fuentes"
        intro="Noticias de agencias y medios (RSS o Atom). Llévalas a la nevera o insértalas en una escaleta desde su panel."
      />
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      <div className="rf-sources">
        <aside className="rf-card rf-sources__list" aria-label="Fuentes">
          <h2 className="rf-form__title">Fuentes</h2>
          {sources.isPending ? (
            <Spinner label="Cargando…" />
          ) : (
            <ul className="rf-sidelist__items">
              <li>
                <button
                  type="button"
                  className={`rf-sources__pick${sourceId === '' ? ' is-active' : ''}`}
                  onClick={() => setSourceId('')}
                >
                  Todas
                </button>
              </li>
              {(sources.data ?? []).map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className={`rf-sources__pick${sourceId === s.id ? ' is-active' : ''}`}
                    onClick={() => setSourceId(s.id)}
                    title={s.url}
                  >
                    {s.name}{' '}
                    {s.lastError ? (
                      <Badge tone="danger">Error</Badge>
                    ) : !s.enabled ? (
                      <Badge tone="muted">Pausada</Badge>
                    ) : null}
                  </button>
                  {canManage && (
                    <span className="rf-sidelist__confirm">
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Actualizar ${s.name}`}
                        onClick={async () => {
                          const r = await api
                            .post<{
                              added: number;
                              error: string | null;
                            }>(`/api/sources/${s.id}/refresh`)
                            .catch((e: unknown) => ({ added: 0, error: errorMessage(e) }));
                          setNotice(
                            r.error
                              ? { tone: 'error', text: `«${s.name}»: ${r.error}` }
                              : { tone: 'success', text: `«${s.name}»: ${r.added} nuevas.` },
                          );
                          void qc.invalidateQueries({ queryKey: sourcesKey });
                          void qc.invalidateQueries({ queryKey: ['source-items'] });
                        }}
                      >
                        ↻
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Quitar ${s.name}`}
                        onClick={async () => {
                          await api.delete(`/api/sources/${s.id}`).catch(() => undefined);
                          if (sourceId === s.id) setSourceId('');
                          void qc.invalidateQueries({ queryKey: sourcesKey });
                          void qc.invalidateQueries({ queryKey: ['source-items'] });
                        }}
                      >
                        ✕
                      </Button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canManage && (
            <form className="rf-sources__add" onSubmit={add} aria-label="Nueva fuente">
              <TextField
                label="Nombre"
                value={form.name}
                maxLength={80}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
              <TextField
                label="Dirección del RSS o Atom"
                type="url"
                value={form.url}
                placeholder="https://…/rss"
                onChange={(e) => setForm({ ...form, url: e.target.value })}
                required
              />
              <Button type="submit" variant="primary" size="sm" loading={busy}>
                Añadir fuente
              </Button>
            </form>
          )}
        </aside>
        <section className="rf-sources__items" aria-label="Noticias">
          <input
            className="rf-input"
            placeholder="Buscar en las noticias…"
            aria-label="Buscar en las noticias"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {items.isPending ? (
            <Spinner label="Cargando…" />
          ) : items.isError ? (
            <Alert tone="error">{errorMessage(items.error)}</Alert>
          ) : items.data.length === 0 ? (
            <div className="rf-card rf-empty">No hay noticias.</div>
          ) : (
            <ul className="rf-sources__feed">
              {items.data.map((i) => (
                <li key={i.id} className="rf-card rf-sources__item">
                  <div className="rf-sources__meta rf-small rf-muted">
                    {i.sourceName}
                    {i.publishedAt && ` · ${dateTime.format(new Date(i.publishedAt))}`}
                  </div>
                  <h3>{i.title}</h3>
                  {i.summary && <p>{i.summary}</p>}
                  <div className="rf-form__actions">
                    <Button size="sm" onClick={() => void toFridge(i)}>
                      A la nevera
                    </Button>
                    {i.link && (
                      <a
                        className="rf-btn rf-btn--ghost rf-btn--sm"
                        href={i.link}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Abrir original
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
