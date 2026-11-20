import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import * as decoding from 'lib0/decoding';
import type { LiveState, PrompterState, StageMessage } from '@runflow/core';
import { MSG_PROMPTER, MSG_STAGE, onCustom } from '../outputs/protocol';
import { api } from '../api/client';
import { IndexeddbPersistence } from 'y-indexeddb';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import { getLinesMap, readLines, type LineSnapshot } from '@runflow/sync';

/** Origen de las transacciones locales (lo que se puede deshacer). */
export const LOCAL_ORIGIN = { local: true } as const;

export type ConnectionStatus = 'connecting' | 'online' | 'offline' | 'denied' | 'deleted';

export interface PresenceUser {
  clientId: number;
  userId: string;
  name: string;
  color: string;
  cell: { lineId: string; col: string } | null;
}

export interface RundownSession {
  doc: Y.Doc;
  provider: WebsocketProvider;
  undo: Y.UndoManager;
  /** Aplica un estado del directo recibido por REST (respuesta a una orden). */
  applyLive: (live: LiveState) => void;
}

const PRESENCE_COLORS = [
  '#4FC3F7',
  '#A3C94A',
  '#F06292',
  '#FFD24A',
  '#9575CD',
  '#4DB6AC',
  '#FF8A65',
  '#E57373',
];

export function colorFor(userId: string): string {
  let h = 0;
  for (const ch of userId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PRESENCE_COLORS[h % PRESENCE_COLORS.length]!;
}

function wsBase(): string {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/collab`;
}

/** Nombre de la copia local (IndexedDB) de una escaleta. */
export function localDbName(orgId: string, rundownId: string): string {
  return `rf-${orgId}-${rundownId}`;
}

/** Borra las copias locales de escaletas (al cerrar sesión en un equipo compartido). */
export async function clearLocalRundowns(): Promise<void> {
  if (!('indexedDB' in window) || !indexedDB.databases) return;
  const dbs = await indexedDB.databases();
  await Promise.all(
    dbs
      .filter((d) => d.name?.startsWith('rf-'))
      .map(
        (d) =>
          new Promise<void>((resolve) => {
            const req = indexedDB.deleteDatabase(d.name!);
            req.onsuccess = req.onerror = req.onblocked = () => resolve();
          }),
      ),
  );
}

/**
 * Abre el documento colaborativo de una escaleta: copia local (sin conexión)
 * + sincronización en tiempo real con el servidor.
 */
export function useRundownSession(
  orgId: string,
  rundownId: string,
  user: { id: string; name: string },
) {
  const [session, setSession] = useState<RundownSession | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [loaded, setLoaded] = useState(false);
  const [live, setLive] = useState<LiveState | null>(null);
  const [prompter, setPrompter] = useState<PrompterState | null>(null);
  const [stage, setStage] = useState<StageMessage | null>(null);

  useEffect(() => {
    const doc = new Y.Doc();
    const local = new IndexeddbPersistence(localDbName(orgId, rundownId), doc);
    const provider = new WebsocketProvider(wsBase(), rundownId, doc, { maxBackoffTime: 5000 });
    const undo = new Y.UndoManager(getLinesMap(doc), {
      trackedOrigins: new Set([LOCAL_ORIGIN]),
      captureTimeout: 500,
    });
    let alive = true;
    let lastSeq = -1;
    const applyLive = (next: LiveState) => {
      if (!alive || next.seq < lastSeq) return;
      lastSeq = next.seq;
      setLive(next);
    };
    // Estado del directo: llega por el WebSocket (mensaje 100) y al abrir por REST.
    provider.messageHandlers[100] = (_encoder: unknown, decoder: decoding.Decoder) => {
      applyLive(JSON.parse(decoding.readVarString(decoder)) as LiveState);
    };
    onCustom<PrompterState | null>(provider, MSG_PROMPTER, (p) => alive && setPrompter(p));
    onCustom<StageMessage | null>(provider, MSG_STAGE, (m) => alive && setStage(m));
    void api
      .get<{ live: LiveState }>(`/api/rundowns/${rundownId}/live`)
      .then((r) => applyLive(r.live))
      .catch(() => undefined);
    void local.whenSynced.then(() => alive && setLoaded(true));
    provider.on('sync', (synced: boolean) => {
      if (synced && alive) setLoaded(true);
    });
    provider.on('status', ({ status: s }: { status: string }) => {
      if (!alive) return;
      setStatus((prev) =>
        prev === 'denied' || prev === 'deleted'
          ? prev
          : s === 'connected'
            ? 'online'
            : s === 'connecting' && prev === 'connecting'
              ? 'connecting'
              : 'offline',
      );
    });
    provider.on('connection-close', (event: CloseEvent | null) => {
      if (!alive || !event) return;
      if (event.code === 4410) setStatus('deleted');
      else if (event.code >= 4400 && event.code < 4500) setStatus('denied');
    });
    provider.awareness.setLocalStateField('user', {
      id: user.id,
      name: user.name,
      color: colorFor(user.id),
    });
    // El navegador avisa al perder la red: se pasa a modo sin conexión al
    // instante (sin esperar a que caduque el WebSocket) y se reconecta al volver.
    const goOffline = () => {
      provider.disconnect();
      setStatus((prev) => (prev === 'denied' || prev === 'deleted' ? prev : 'offline'));
    };
    const goOnline = () => provider.connect();
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    if (!navigator.onLine) goOffline();
    setSession({ doc, provider, undo, applyLive });
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
      alive = false;
      undo.destroy();
      provider.destroy();
      void local.destroy();
      doc.destroy();
      setSession(null);
      setLoaded(false);
      setLive(null);
      setStatus('connecting');
    };
  }, [orgId, rundownId, user.id, user.name]);

  return { session, status, loaded, live, prompter, stage, setStage };
}

/* ---------- Líneas (instantánea reactiva) ---------- */

function sameCells(a: LineSnapshot['cells'], b: LineSnapshot['cells']): boolean {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => a[k] === b[k]);
}

/** Lista ordenada de líneas; reutiliza los objetos que no cambian (filas memorizadas). */
export function useLines(doc: Y.Doc | undefined): LineSnapshot[] {
  const store = useMemo(() => {
    let snapshot: LineSnapshot[] = [];
    let byId = new Map<string, LineSnapshot>();
    const compute = () => {
      if (!doc) return;
      const next = readLines(doc).map((l) => {
        const prev = byId.get(l.id);
        return prev && prev.pos === l.pos && sameCells(prev.cells, l.cells) ? prev : l;
      });
      byId = new Map(next.map((l) => [l.id, l]));
      snapshot = next;
    };
    compute();
    return {
      subscribe(cb: () => void) {
        if (!doc) return () => {};
        const lines = getLinesMap(doc);
        let frame = 0;
        // Cambios propios: al instante (la siguiente tecla ya ve la línea nueva).
        // Cambios remotos: agrupados por fotograma.
        const handler = (_events: unknown, transaction: Y.Transaction) => {
          if (transaction.local) {
            cancelAnimationFrame(frame);
            frame = 0;
            compute();
            cb();
            return;
          }
          if (frame) return;
          frame = requestAnimationFrame(() => {
            frame = 0;
            compute();
            cb();
          });
        };
        lines.observeDeep(handler);
        return () => {
          cancelAnimationFrame(frame);
          lines.unobserveDeep(handler);
        };
      },
      get: () => snapshot,
    };
  }, [doc]);
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

/* ---------- Presencia ---------- */

export function usePresence(provider: WebsocketProvider | undefined): PresenceUser[] {
  const store = useMemo(() => {
    let snapshot: PresenceUser[] = [];
    const compute = () => {
      if (!provider) return;
      const out: PresenceUser[] = [];
      provider.awareness.getStates().forEach((state, clientId) => {
        if (clientId === provider.awareness.clientID) return;
        const u = state.user as { id: string; name: string; color: string } | undefined;
        if (!u) return;
        out.push({
          clientId,
          userId: u.id,
          name: u.name,
          color: u.color,
          cell: (state.cell as PresenceUser['cell']) ?? null,
        });
      });
      snapshot = out;
    };
    compute();
    return {
      subscribe(cb: () => void) {
        if (!provider) return () => {};
        const handler = () => {
          compute();
          cb();
        };
        provider.awareness.on('change', handler);
        return () => provider.awareness.off('change', handler);
      },
      get: () => snapshot,
    };
  }, [provider]);
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

/** Estado de deshacer/rehacer. */
export function useUndoState(undo: Y.UndoManager | undefined) {
  const store = useMemo(() => {
    let snapshot = { canUndo: false, canRedo: false };
    const compute = () => {
      snapshot = { canUndo: !!undo?.canUndo(), canRedo: !!undo?.canRedo() };
    };
    return {
      subscribe(cb: () => void) {
        if (!undo) return () => {};
        const handler = () => {
          const prev = snapshot;
          compute();
          if (prev.canUndo !== snapshot.canUndo || prev.canRedo !== snapshot.canRedo) cb();
        };
        undo.on('stack-item-added', handler);
        undo.on('stack-item-popped', handler);
        undo.on('stack-cleared', handler);
        return () => {
          undo.off('stack-item-added', handler);
          undo.off('stack-item-popped', handler);
          undo.off('stack-cleared', handler);
        };
      },
      get: () => snapshot,
    };
  }, [undo]);
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
