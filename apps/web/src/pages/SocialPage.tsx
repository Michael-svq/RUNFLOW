import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MAX_SOCIAL_FEEDS,
  SOCIAL_NETWORKS,
  SOCIAL_STATUSES,
  networkLabel,
  type RundownDto,
  type SocialFeedDto,
  type SocialPostDto,
  type SocialStatus,
} from '@runflow/core';
import { Alert, Badge, Button, Dialog, SelectField, Spinner, TextField } from '@runflow/ui';
import { api, errorMessage } from '../api/client';
import { useCan } from '../auth/session';
import { PageHeader } from '../components/PageHeader';
import { locale } from '../i18n';

/* 03 Social Media (F3.4): búsquedas en redes, moderación y rótulos RRS. */

const feedsKey = ['social-feeds'];
const postsKey = ['social-posts'];
const timeFmt = new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' });
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export function useSocialPosts(status: SocialStatus | '', q = '') {
  return useQuery({
    queryKey: [...postsKey, status, q],
    queryFn: () => {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (q.trim()) params.set('q', q.trim());
      return api.get<{ posts: SocialPostDto[]; counts: Partial<Record<SocialStatus, number>> }>(
        `/api/social/posts?${params}`,
      );
    },
    refetchInterval: 30_000,
  });
}

export function SocialPage() {
  const qc = useQueryClient();
  const canConfigure = useCan('program.configure');
  const canTemplates = useCan('templates.manage');
  const canStructure = useCan('rundown.edit_structure');
  const canOwn = useCan('script.edit_own');
  const canAny = useCan('script.edit_any');
  const canWrite = canTemplates || canStructure || canOwn || canAny;
  const [status, setStatus] = useState<SocialStatus>('nuevo');
  const [q, setQ] = useState('');
  const posts = useSocialPosts(status, q);
  const feeds = useQuery({
    queryKey: feedsKey,
    queryFn: () => api.get<{ feeds: SocialFeedDto[]; max: number }>('/api/social/feeds'),
  });
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [toRundown, setToRundown] = useState<SocialPostDto | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: postsKey });
    void qc.invalidateQueries({ queryKey: feedsKey });
  };
  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    setNotice(null);
    try {
      await fn();
      if (ok) setNotice({ tone: 'success', text: ok });
    } catch (err) {
      setNotice({ tone: 'error', text: errorMessage(err) });
    }
    refresh();
  };

  return (
    <>
      <PageHeader
        title="Redes sociales"
        intro="Publicaciones de redes por hashtag o cuenta, y mensajes de la audiencia. Modéralas y rotúlalas en directo con el rótulo de redes (RRS)."
      />
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      <div className="rf-sources">
        <aside className="rf-card rf-sources__list" aria-label="Búsquedas">
          <h2 className="rf-form__title">Búsquedas</h2>
          {feeds.isPending ? (
            <Spinner label="Cargando…" />
          ) : (
            <ul className="rf-sidelist__items">
              {(feeds.data?.feeds ?? []).map((f) => (
                <li key={f.id}>
                  <div>
                    <Badge tone="accent">{networkLabel(f.network)}</Badge>{' '}
                    <strong>{f.query}</strong>
                    <div className="rf-muted rf-small">
                      {f.lastError ? (
                        <span className="rf-error-text">⚠ {f.lastError}</span>
                      ) : f.lastFetchedAt ? (
                        `Leída ${timeFmt.format(new Date(f.lastFetchedAt))}`
                      ) : (
                        'Sin leer'
                      )}
                      {!f.enabled && ' · en pausa'}
                    </div>
                  </div>
                  <span className="rf-sidelist__confirm">
                    {canWrite && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          void act(async () => {
                            const r = await api.post<{ added: number; error: string | null }>(
                              `/api/social/feeds/${f.id}/refresh`,
                            );
                            if (r.error) throw new Error(r.error);
                            setNotice({ tone: 'success', text: `${r.added} nuevas.` });
                          })
                        }
                      >
                        Leer
                      </Button>
                    )}
                    {canConfigure && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          window.confirm(`¿Quitar la búsqueda «${f.query}»?`) &&
                          void act(() => api.delete(`/api/social/feeds/${f.id}`))
                        }
                      >
                        Quitar
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {canConfigure && (feeds.data?.feeds.length ?? 0) < MAX_SOCIAL_FEEDS && (
            <NewFeed onDone={(text) => act(async () => undefined, text)} onError={setNotice} />
          )}
          {canWrite && (
            <ManualPost onDone={() => act(async () => undefined, 'Publicación añadida.')} />
          )}
        </aside>

        <section className="rf-sources__items" aria-label="Publicaciones">
          <div className="rf-tabs" role="tablist" aria-label="Moderación">
            {SOCIAL_STATUSES.map((s) => (
              <button
                key={s.value}
                type="button"
                role="tab"
                aria-selected={status === s.value}
                className={`rf-tabs__tab${status === s.value ? ' is-active' : ''}`}
                onClick={() => setStatus(s.value)}
              >
                {s.label} ({posts.data?.counts[s.value] ?? 0})
              </button>
            ))}
          </div>
          <input
            className="rf-input"
            placeholder="Buscar en las publicaciones…"
            aria-label="Buscar publicaciones"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {posts.isPending ? (
            <Spinner label="Cargando…" />
          ) : posts.isError ? (
            <Alert tone="error">{errorMessage(posts.error)}</Alert>
          ) : posts.data.posts.length === 0 ? (
            <div className="rf-card rf-empty">No hay publicaciones aquí.</div>
          ) : (
            <ul className="rf-social__list">
              {posts.data.posts.map((p) => (
                <li key={p.id} className="rf-card rf-social__post">
                  <PostBody post={p} />
                  {canWrite && (
                    <div className="rf-form__actions">
                      {p.status !== 'aprobado' && (
                        <Button
                          size="sm"
                          onClick={() =>
                            void act(() =>
                              api.patch(`/api/social/posts/${p.id}`, { status: 'aprobado' }),
                            )
                          }
                        >
                          Aprobar
                        </Button>
                      )}
                      {p.status !== 'descartado' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            void act(() =>
                              api.patch(`/api/social/posts/${p.id}`, { status: 'descartado' }),
                            )
                          }
                        >
                          Descartar
                        </Button>
                      )}
                      {p.status !== 'descartado' && (
                        <Button size="sm" variant="primary" onClick={() => setToRundown(p)}>
                          Rotular…
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      {toRundown && (
        <ToRundownDialog
          post={toRundown}
          onClose={() => setToRundown(null)}
          onDone={(title) => {
            setToRundown(null);
            void act(async () => undefined, `Rótulo de redes añadido a «${title}».`);
          }}
        />
      )}
    </>
  );
}

export function PostBody({ post }: { post: SocialPostDto }) {
  return (
    <div className="rf-social__body">
      <div className="rf-social__meta">
        <Badge tone="accent">{networkLabel(post.network)}</Badge>
        <strong>{post.author}</strong>
        {post.handle && (
          <span className="rf-muted">
            {post.handle.startsWith('@') ? post.handle : `@${post.handle}`}
          </span>
        )}
        <span className="rf-muted rf-small">
          {post.postedAt && timeFmt.format(new Date(post.postedAt))}
        </span>
        {post.url && (
          <a className="rf-link rf-small" href={post.url} target="_blank" rel="noreferrer noopener">
            Ver
          </a>
        )}
      </div>
      <p className="rf-social__text">{post.text}</p>
      {post.mediaUrl && (
        <img
          className="rf-social__media"
          src={post.mediaUrl}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      )}
    </div>
  );
}

function NewFeed({
  onDone,
  onError,
}: {
  onDone: (text: string) => void;
  onError: (n: { tone: 'error'; text: string }) => void;
}) {
  const empty = { network: 'bluesky', query: '', instance: 'https://mastodon.social', apiKey: '' };
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const needsKey = form.network === 'x' || form.network === 'youtube';
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.post<{ feed: SocialFeedDto; added: number }>('/api/social/feeds', {
        network: form.network,
        query: form.query,
        instance: form.network === 'mastodon' ? form.instance : '',
        ...(needsKey ? { apiKey: form.apiKey } : {}),
      });
      setForm({ ...empty, network: form.network });
      onDone(
        r.feed.lastError
          ? `Búsqueda añadida, pero no se pudo leer: ${r.feed.lastError}`
          : `Búsqueda añadida: ${r.added} publicaciones.`,
      );
    } catch (err) {
      onError({ tone: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="rf-form" aria-label="Nueva búsqueda" onSubmit={submit}>
      <h3 className="rf-small">Nueva búsqueda (máx. {MAX_SOCIAL_FEEDS})</h3>
      <SelectField
        label="Red"
        value={form.network}
        onChange={(e) => setForm({ ...form, network: e.target.value })}
        options={SOCIAL_NETWORKS.filter((n) => n.auto).map((n) => ({
          value: n.value,
          label: n.needsKey ? `${n.label} (con clave)` : n.label,
        }))}
      />
      <TextField
        label={
          form.network === 'youtube'
            ? 'Vídeo o directo (dirección o id)'
            : 'Hashtag, @cuenta o palabras'
        }
        value={form.query}
        placeholder={form.network === 'youtube' ? 'https://www.youtube.com/watch?v=…' : '#Gala2026'}
        onChange={(e) => setForm({ ...form, query: e.target.value })}
        required
      />
      {form.network === 'mastodon' && (
        <TextField
          label="Servidor de Mastodon"
          type="url"
          value={form.instance}
          onChange={(e) => setForm({ ...form, instance: e.target.value })}
          required
        />
      )}
      {needsKey && (
        <TextField
          label={
            form.network === 'x' ? 'Bearer token de la API de X' : 'Clave de la API de YouTube'
          }
          type="password"
          autoComplete="off"
          value={form.apiKey}
          onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
          hint="Se guarda cifrada. La API de X es de pago."
          required
        />
      )}
      <Button type="submit" size="sm" disabled={busy || !form.query.trim()}>
        Añadir búsqueda
      </Button>
    </form>
  );
}

function ManualPost({ onDone }: { onDone: () => void }) {
  const empty = { network: 'whatsapp', author: '', handle: '', text: '' };
  const [form, setForm] = useState(empty);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="rf-form"
      aria-label="Publicación manual"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        try {
          await api.post('/api/social/posts', form);
          setForm({ ...empty, network: form.network });
          onDone();
        } catch (err) {
          setError(errorMessage(err));
        }
      }}
    >
      <h3 className="rf-small">Mensaje de la audiencia</h3>
      {error && <Alert tone="error">{error}</Alert>}
      <SelectField
        label="Llega por"
        value={form.network}
        onChange={(e) => setForm({ ...form, network: e.target.value })}
        options={SOCIAL_NETWORKS.map((n) => ({ value: n.value, label: n.label }))}
      />
      <TextField
        label="Nombre"
        value={form.author}
        maxLength={80}
        onChange={(e) => setForm({ ...form, author: e.target.value })}
        required
      />
      <TextField
        label="Usuario (opcional)"
        value={form.handle}
        maxLength={80}
        onChange={(e) => setForm({ ...form, handle: e.target.value })}
      />
      <label className="rf-field">
        <span className="rf-field__label">Mensaje</span>
        <textarea
          className="rf-input rf-textarea"
          rows={3}
          maxLength={2000}
          value={form.text}
          onChange={(e) => setForm({ ...form, text: e.target.value })}
          required
        />
      </label>
      <Button type="submit" size="sm" disabled={!form.author.trim() || !form.text.trim()}>
        Añadir
      </Button>
    </form>
  );
}

function ToRundownDialog({
  post,
  onClose,
  onDone,
}: {
  post: SocialPostDto;
  onClose: () => void;
  onDone: (title: string) => void;
}) {
  const today = new Date();
  const rundowns = useQuery({
    queryKey: ['rundowns', 'social', isoDay(today)],
    queryFn: async () =>
      (
        await api.get<{ rundowns: RundownDto[] }>(
          `/api/rundowns?${new URLSearchParams({
            from: isoDay(new Date(today.getTime() - 86_400_000)),
            to: isoDay(new Date(today.getTime() + 14 * 86_400_000)),
          })}`,
        )
      ).rundowns,
  });
  const [rundownId, setRundownId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const chosen = rundownId || rundowns.data?.[0]?.id || '';
  return (
    <Dialog
      open
      title="Rotular en una escaleta"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            disabled={!chosen}
            onClick={async () => {
              try {
                await api.post(`/api/social/posts/${post.id}/rundown`, { rundownId: chosen });
                onDone(rundowns.data?.find((r) => r.id === chosen)?.title ?? '');
              } catch (err) {
                setError(errorMessage(err));
              }
            }}
          >
            Añadir rótulo
          </Button>
        </>
      }
    >
      {error && <Alert tone="error">{error}</Alert>}
      <PostBody post={post} />
      {rundowns.isPending ? (
        <Spinner label="Cargando…" />
      ) : (rundowns.data ?? []).length === 0 ? (
        <p className="rf-muted rf-small">No hay escaletas entre ayer y las próximas dos semanas.</p>
      ) : (
        <SelectField
          label="Escaleta"
          value={chosen}
          onChange={(e) => setRundownId(e.target.value)}
          options={(rundowns.data ?? []).map((r) => ({
            value: r.id,
            label: `${r.airDate} · ${r.title}`,
          }))}
        />
      )}
      <p className="rf-muted rf-small">
        Se añade una línea de GRAFISMO al final con el rótulo RRS. Para ponerlo en una línea
        concreta, usa la pestaña «Redes» del panel de la escaleta.
      </p>
    </Dialog>
  );
}
