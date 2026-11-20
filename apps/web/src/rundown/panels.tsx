import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { WebsocketProvider } from 'y-websocket';
import type * as Y from 'yjs';
import {
  formatDuration,
  lineTypeLabel,
  socialGraphicFields,
  type ChatMessageDto,
  type FridgeItemDto,
  type SocialPostDto,
  type SourceItemDto,
  type VersionDto,
} from '@runflow/core';
import {
  appendBlocks,
  getScriptFragment,
  insertLine,
  readScript,
  writeScript,
  type CellValue,
  type LineSnapshot,
  type ScriptBlock,
} from '@runflow/sync';
import { Alert, Button, Spinner } from '@runflow/ui';
import { api, errorMessage } from '../api/client';
import { locale } from '../i18n';
import { onCustom } from '../outputs/protocol';
import { LOCAL_ORIGIN } from './useRundownDoc';

const MSG_CHAT = 104;

const timeFmt = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });
const dateTimeFmt = new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' });

/* ---------- Chat ---------- */

export function useChat(
  rundownId: string,
  provider: WebsocketProvider | undefined,
  visible: boolean,
) {
  const qc = useQueryClient();
  const key = ['chat', rundownId];
  const [unread, setUnread] = useState(0);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const messages = useQuery({
    queryKey: key,
    queryFn: async () =>
      (await api.get<{ messages: ChatMessageDto[] }>(`/api/rundowns/${rundownId}/chat`)).messages,
  });
  useEffect(() => {
    if (!provider) return;
    onCustom<ChatMessageDto>(provider, MSG_CHAT, (m) => {
      qc.setQueryData<ChatMessageDto[]>(key, (list) =>
        list?.some((x) => x.id === m.id) ? list : [...(list ?? []), m],
      );
      if (!visibleRef.current) setUnread((n) => n + 1);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, rundownId]);
  useEffect(() => {
    if (visible) setUnread(0);
  }, [visible]);
  const send = async (body: string) => {
    const res = await api.post<{ message: ChatMessageDto }>(`/api/rundowns/${rundownId}/chat`, {
      body,
    });
    qc.setQueryData<ChatMessageDto[]>(key, (list) =>
      list?.some((x) => x.id === res.message.id) ? list : [...(list ?? []), res.message],
    );
  };
  return { messages, unread, send };
}

export function ChatTab({ chat, meId }: { chat: ReturnType<typeof useChat>; meId: string }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);
  const count = chat.messages.data?.length ?? 0;
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [count]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setSending(true);
    setError(null);
    try {
      await chat.send(body);
      setText('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="rf-chat">
      {chat.messages.isPending ? (
        <Spinner label="Cargando…" />
      ) : chat.messages.isError ? (
        <Alert tone="error">{errorMessage(chat.messages.error)}</Alert>
      ) : (
        <ol ref={listRef} className="rf-chat__list" aria-live="polite">
          {chat.messages.data.length === 0 && (
            <li className="rf-muted">Todavía no hay mensajes.</li>
          )}
          {chat.messages.data.map((m) => (
            <li key={m.id} className={m.userId === meId ? 'is-mine' : undefined}>
              <span className="rf-chat__meta">
                <strong>{m.userName}</strong> · {timeFmt.format(new Date(m.createdAt))}
              </span>
              <span className="rf-chat__body">{m.body}</span>
            </li>
          ))}
        </ol>
      )}
      <form className="rf-chat__form" onSubmit={onSubmit}>
        {error && <Alert tone="error">{error}</Alert>}
        <textarea
          className="rf-input rf-textarea rf-chat__input"
          rows={2}
          maxLength={2000}
          placeholder="Escribe un mensaje… (Intro para enviar)"
          value={text}
          aria-label="Mensaje del chat"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void onSubmit(e);
            }
          }}
        />
        <Button type="submit" variant="primary" size="sm" loading={sending} disabled={!text.trim()}>
          Enviar
        </Button>
      </form>
    </div>
  );
}

/* ---------- Nevera ---------- */

export const fridgeKey = ['fridge'] as const;

export function useFridge() {
  return useQuery({
    queryKey: fridgeKey,
    queryFn: async () => (await api.get<{ items: FridgeItemDto[] }>('/api/fridge')).items,
  });
}

/** Guarda una línea (celdas + guion) en la nevera. */
export async function saveLineToFridge(
  doc: Y.Doc,
  line: LineSnapshot,
  name: string,
): Promise<void> {
  const script = readScript(getScriptFragment(doc, line.id));
  await api.post('/api/fridge', { name, cells: line.cells, script });
}

export function FridgeTab({
  doc,
  insertIndex,
  canInsert,
  onInserted,
}: {
  doc: Y.Doc;
  insertIndex: number;
  canInsert: boolean;
  onInserted: (lineId: string) => void;
}) {
  const fridge = useFridge();
  const [filter, setFilter] = useState('');
  const items = (fridge.data ?? []).filter((i) =>
    i.name.toLowerCase().includes(filter.toLowerCase()),
  );

  const insert = (item: FridgeItemDto) => {
    let id = '';
    doc.transact(() => {
      id = insertLine(
        doc,
        { index: insertIndex, cells: item.cells as Record<string, CellValue> },
        LOCAL_ORIGIN,
      );
      if (item.script.length) writeScript(doc, id, item.script as ScriptBlock[], LOCAL_ORIGIN);
    }, LOCAL_ORIGIN);
    onInserted(id);
  };

  return (
    <div className="rf-sidelist">
      <input
        className="rf-input"
        placeholder="Buscar en la nevera…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        aria-label="Buscar en la nevera"
      />
      {fridge.isPending ? (
        <Spinner label="Cargando…" />
      ) : fridge.isError ? (
        <Alert tone="error">{errorMessage(fridge.error)}</Alert>
      ) : items.length === 0 ? (
        <p className="rf-muted rf-small">
          La nevera está vacía. Guarda líneas con clic derecho → «Guardar en la nevera».
        </p>
      ) : (
        <ul className="rf-sidelist__items">
          {items.map((i) => (
            <li key={i.id}>
              <div>
                <strong>{i.name}</strong>
                <span className="rf-muted rf-small">
                  {' '}
                  {lineTypeLabel(i.cells.tipo)}
                  {typeof i.cells.t_est === 'number' &&
                    ` · ${formatDuration(i.cells.t_est, { short: true })}`}
                  {i.script.length > 0 && ' · con guion'}
                </span>
              </div>
              {canInsert && (
                <Button size="sm" onClick={() => insert(i)}>
                  Insertar
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------- Versiones ---------- */

const KIND_LABEL: Record<string, string> = {
  auto: 'Automática',
  manual: 'Manual',
  restore: 'Antes de restaurar',
};

export function VersionsTab({
  rundownId,
  canSave,
  canRestore,
}: {
  rundownId: string;
  canSave: boolean;
  canRestore: boolean;
}) {
  const qc = useQueryClient();
  const key = ['versions', rundownId];
  const versions = useQuery({
    queryKey: key,
    queryFn: async () =>
      (await api.get<{ versions: VersionDto[] }>(`/api/rundowns/${rundownId}/versions`)).versions,
  });
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    setNotice(null);
    try {
      await fn();
      setNotice({ tone: 'success', text: ok });
      void qc.invalidateQueries({ queryKey: key });
    } catch (err) {
      setNotice({ tone: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  return (
    <div className="rf-sidelist">
      {canSave && (
        <form
          className="rf-sidelist__save"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await api.post(`/api/rundowns/${rundownId}/versions`, { label });
              setLabel('');
            }, 'Versión guardada.');
          }}
        >
          <input
            className="rf-input"
            placeholder="Nombre de la versión (opcional)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            aria-label="Nombre de la versión"
          />
          <Button type="submit" size="sm" loading={busy}>
            Guardar versión
          </Button>
        </form>
      )}
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      <p className="rf-muted rf-small">
        Se guarda una versión automática cada 10 minutos de actividad.
      </p>
      {versions.isPending ? (
        <Spinner label="Cargando…" />
      ) : versions.isError ? (
        <Alert tone="error">{errorMessage(versions.error)}</Alert>
      ) : versions.data.length === 0 ? (
        <p className="rf-muted rf-small">Todavía no hay versiones.</p>
      ) : (
        <ul className="rf-sidelist__items">
          {versions.data.map((v) => (
            <li key={v.id}>
              <div>
                <strong>{v.label || KIND_LABEL[v.kind]}</strong>
                <span className="rf-muted rf-small">
                  {' '}
                  {dateTimeFmt.format(new Date(v.createdAt))} · {v.lineCount} líneas
                </span>
              </div>
              {canRestore &&
                (confirm === v.id ? (
                  <span className="rf-sidelist__confirm">
                    <Button
                      size="sm"
                      variant="danger"
                      loading={busy}
                      onClick={() =>
                        void run(
                          () => api.post(`/api/rundowns/${rundownId}/versions/${v.id}/restore`),
                          'Versión restaurada. Lo anterior se ha guardado como versión.',
                        )
                      }
                    >
                      Confirmar
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
                      No
                    </Button>
                  </span>
                ) : (
                  <Button size="sm" onClick={() => setConfirm(v.id)}>
                    Restaurar
                  </Button>
                ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------- Fuentes (F2.2) ---------- */

export function SourcesTab({
  doc,
  insertIndex,
  canInsert,
  onInserted,
}: {
  doc: Y.Doc;
  insertIndex: number;
  canInsert: boolean;
  onInserted: (lineId: string) => void;
}) {
  const [q, setQ] = useState('');
  const items = useQuery({
    queryKey: ['source-items', '', q],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '50' });
      if (q.trim()) params.set('q', q.trim());
      return (await api.get<{ items: SourceItemDto[] }>(`/api/source-items?${params}`)).items;
    },
    refetchInterval: 60_000,
  });

  const insert = (item: SourceItemDto) => {
    let id = '';
    doc.transact(() => {
      id = insertLine(
        doc,
        {
          index: insertIndex,
          cells: { tipo: 'TEMA', nombre: item.title.slice(0, 120).toUpperCase() },
        },
        LOCAL_ORIGIN,
      );
      const note = [item.summary, item.link].filter(Boolean).join('\n');
      if (note) writeScript(doc, id, [{ kind: 'nota', text: note }], LOCAL_ORIGIN);
    }, LOCAL_ORIGIN);
    onInserted(id);
  };

  return (
    <div className="rf-sidelist">
      <input
        className="rf-input"
        placeholder="Buscar en las fuentes…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Buscar en las fuentes"
      />
      {items.isPending ? (
        <Spinner label="Cargando…" />
      ) : items.isError ? (
        <Alert tone="error">{errorMessage(items.error)}</Alert>
      ) : items.data.length === 0 ? (
        <p className="rf-muted rf-small">
          No hay noticias. Las fuentes (RSS de agencias y medios) se añaden en 01 Fuentes.
        </p>
      ) : (
        <ul className="rf-sidelist__items">
          {items.data.map((i) => (
            <li key={i.id}>
              <div>
                <strong>{i.title}</strong>
                <span className="rf-muted rf-small">
                  {' '}
                  {i.sourceName}
                  {i.publishedAt && ` · ${timeFmt.format(new Date(i.publishedAt))}`}
                </span>
              </div>
              {canInsert && (
                <Button size="sm" onClick={() => insert(i)}>
                  Insertar
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Pestaña «Redes»: publicaciones aprobadas como rótulo RRS (F3.4). */
export function SocialTab({
  doc,
  selectedLineId,
  insertIndex,
  canAppend,
  canInsert,
  onInserted,
}: {
  doc: Y.Doc;
  selectedLineId: string | null;
  insertIndex: number;
  canAppend: boolean;
  canInsert: boolean;
  onInserted: (lineId: string) => void;
}) {
  const [q, setQ] = useState('');
  const posts = useQuery({
    queryKey: ['social-posts', 'aprobado', q],
    queryFn: async () => {
      const params = new URLSearchParams({ status: 'aprobado', limit: '50' });
      if (q.trim()) params.set('q', q.trim());
      return (await api.get<{ posts: SocialPostDto[] }>(`/api/social/posts?${params}`)).posts;
    },
    refetchInterval: 30_000,
  });

  const rotular = (p: SocialPostDto) => {
    const block = {
      kind: 'rotulo' as const,
      id: globalThis.crypto.randomUUID(),
      type: 'RRS',
      ...socialGraphicFields(p),
      tcIn: '',
      tcOut: '',
    };
    let id = selectedLineId && canAppend ? selectedLineId : '';
    doc.transact(() => {
      if (!id)
        id = insertLine(
          doc,
          {
            index: insertIndex,
            cells: { tipo: 'GRAFISMO', nombre: `RRSS ${p.handle || p.author}`.slice(0, 80) },
          },
          LOCAL_ORIGIN,
        );
      appendBlocks(doc, id, [block], LOCAL_ORIGIN);
    }, LOCAL_ORIGIN);
    onInserted(id);
  };
  const can = (selectedLineId && canAppend) || canInsert;

  return (
    <div className="rf-sidelist">
      <input
        className="rf-input"
        placeholder="Buscar en las redes…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Buscar en las redes"
      />
      {posts.isPending ? (
        <Spinner label="Cargando…" />
      ) : posts.isError ? (
        <Alert tone="error">{errorMessage(posts.error)}</Alert>
      ) : posts.data.length === 0 ? (
        <p className="rf-muted rf-small">
          No hay publicaciones aprobadas. Se moderan en 03 Social Media.
        </p>
      ) : (
        <ul className="rf-sidelist__items">
          {posts.data.map((p) => (
            <li key={p.id}>
              <div>
                <strong>{p.author}</strong>{' '}
                <span className="rf-muted rf-small">
                  {p.handle && `@${p.handle.replace(/^@/, '')}`}
                </span>
                <div className="rf-small rf-social__snippet">{p.text}</div>
              </div>
              {can && (
                <Button size="sm" onClick={() => rotular(p)}>
                  {selectedLineId && canAppend ? 'Rotular aquí' : 'Rotular'}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
