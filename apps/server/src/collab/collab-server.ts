import { and, eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import type { WebSocket } from 'ws';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { readLines, summarize } from '@runflow/sync';
import { rundownLines, rundowns, withTenant, type Db } from '@runflow/db';

/*
 * Servidor de colaboración en tiempo real (protocolo estándar de Yjs:
 * y-protocols sync + awareness, compatible con el cliente y-websocket).
 *
 * - Un documento en memoria por escaleta abierta; se carga de Postgres al
 *   conectarse la primera persona y se descarga al irse la última.
 * - Los cambios se guardan con un pequeño retardo (agrupados) y siempre al
 *   cerrar; además se actualiza la proyección relacional de las líneas.
 * - Las conexiones de solo lectura reciben cambios pero sus cambios se ignoran.
 */

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const MESSAGE_QUERY_AWARENESS = 3;
/** Mensaje propio: estado del directo (JSON). */
export const MESSAGE_LIVE = 100;

const SAVE_DEBOUNCE_MS = 800;
const SAVE_MAX_WAIT_MS = 5_000;
const PING_INTERVAL_MS = 30_000;

/** Códigos de cierre 44xx: el cliente y-websocket no reintenta. */
export const CLOSE_UNAUTHORIZED = 4401;
export const CLOSE_FORBIDDEN = 4403;
export const CLOSE_NOT_FOUND = 4404;
export const CLOSE_DELETED = 4410;

export interface CollabConnection {
  orgId: string;
  userId: string;
  readOnly: boolean;
}

interface ConnState extends CollabConnection {
  awarenessIds: Set<number>;
  alive: boolean;
}

class SharedDoc {
  readonly doc = new Y.Doc({ gc: true });
  readonly awareness = new awarenessProtocol.Awareness(this.doc);
  readonly conns = new Map<WebSocket, ConnState>();
  private saveTimer: NodeJS.Timeout | undefined;
  private firstDirtyAt = 0;
  private saving: Promise<void> = Promise.resolve();
  private changeTimer: NodeJS.Timeout | undefined;
  dirty = false;
  /** Usos internos en curso (motor de directo) que impiden descargar el documento. */
  holds = 0;

  constructor(
    readonly rundownId: string,
    readonly orgId: string,
    private readonly server: CollabServer,
  ) {
    this.awareness.setLocalState(null);
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      this.broadcast(encoding.toUint8Array(encoder), origin);
      this.scheduleSave();
      if (origin !== 'load' && origin !== 'live') this.notifyChange();
    });
    this.awareness.on(
      'update',
      (
        { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
        origin: unknown,
      ) => {
        const changed = [...added, ...updated, ...removed];
        const conn = this.conns.get(origin as WebSocket);
        if (conn) {
          for (const id of added) conn.awarenessIds.add(id);
          for (const id of removed) conn.awarenessIds.delete(id);
        }
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(
          encoder,
          awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed),
        );
        this.broadcast(encoding.toUint8Array(encoder));
      },
    );
  }

  /** Avisa (agrupado) de que han cambiado las líneas, p. ej. para reprogramar el autonext. */
  private notifyChange(): void {
    clearTimeout(this.changeTimer);
    this.changeTimer = setTimeout(
      () => this.server.onDocChanged?.(this.rundownId, this.orgId),
      300,
    );
  }

  broadcast(message: Uint8Array, except?: unknown): void {
    for (const ws of this.conns.keys()) {
      if (ws !== except) send(ws, message);
    }
  }

  private scheduleSave(): void {
    this.dirty = true;
    const now = Date.now();
    if (!this.firstDirtyAt) this.firstDirtyAt = now;
    clearTimeout(this.saveTimer);
    const wait = Math.max(
      0,
      Math.min(SAVE_DEBOUNCE_MS, this.firstDirtyAt + SAVE_MAX_WAIT_MS - now),
    );
    this.saveTimer = setTimeout(() => void this.save(), wait);
  }

  /** Guarda el documento y la proyección de líneas (en orden, sin solaparse). */
  save(): Promise<void> {
    clearTimeout(this.saveTimer);
    this.saving = this.saving.then(async () => {
      if (!this.dirty) return;
      this.dirty = false;
      this.firstDirtyAt = 0;
      try {
        await this.server.persist(this);
      } catch (err) {
        this.dirty = true;
        this.server.log.error({ err, rundownId: this.rundownId }, 'No se pudo guardar la escaleta');
      }
    });
    return this.saving;
  }

  handleMessage(ws: WebSocket, conn: ConnState, data: Uint8Array): void {
    const decoder = decoding.createDecoder(data);
    const encoder = encoding.createEncoder();
    const type = decoding.readVarUint(decoder);
    switch (type) {
      case MESSAGE_SYNC: {
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        const syncType = decoding.readVarUint(decoder);
        if (syncType === syncProtocol.messageYjsSyncStep1) {
          syncProtocol.readSyncStep1(decoder, encoder, this.doc);
        } else if (!conn.readOnly) {
          if (syncType === syncProtocol.messageYjsSyncStep2) {
            syncProtocol.readSyncStep2(decoder, this.doc, ws);
          } else if (syncType === syncProtocol.messageYjsUpdate) {
            syncProtocol.readUpdate(decoder, this.doc, ws);
          }
        }
        if (encoding.length(encoder) > 1) send(ws, encoding.toUint8Array(encoder));
        break;
      }
      case MESSAGE_AWARENESS: {
        awarenessProtocol.applyAwarenessUpdate(
          this.awareness,
          decoding.readVarUint8Array(decoder),
          ws,
        );
        break;
      }
      case MESSAGE_QUERY_AWARENESS: {
        this.sendAwareness(ws);
        break;
      }
      default:
        break;
    }
  }

  sendInitial(ws: WebSocket): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.doc);
    send(ws, encoding.toUint8Array(encoder));
    this.sendAwareness(ws);
  }

  private sendAwareness(ws: WebSocket): void {
    const states = this.awareness.getStates();
    if (states.size === 0) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(this.awareness, [...states.keys()]),
    );
    send(ws, encoding.toUint8Array(encoder));
  }

  removeConnection(ws: WebSocket): void {
    const conn = this.conns.get(ws);
    if (!conn) return;
    this.conns.delete(ws);
    awarenessProtocol.removeAwarenessStates(this.awareness, [...conn.awarenessIds], null);
  }

  destroy(): void {
    clearTimeout(this.saveTimer);
    clearTimeout(this.changeTimer);
    this.awareness.destroy();
    this.doc.destroy();
  }
}

function liveMessage(live: unknown): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_LIVE);
  encoding.writeVarString(encoder, JSON.stringify(live));
  return encoding.toUint8Array(encoder);
}

const earlyListeners = new WeakMap<WebSocket, (data: ArrayBuffer | Buffer) => void>();

function toBytes(data: ArrayBuffer | Buffer): Uint8Array {
  return data instanceof ArrayBuffer
    ? new Uint8Array(data)
    : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function send(ws: WebSocket, message: Uint8Array): void {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(message, (err) => {
    if (err) ws.terminate();
  });
}

export class CollabServer {
  private readonly docs = new Map<string, Promise<SharedDoc>>();
  private readonly pingTimer: NodeJS.Timeout;
  /** Estado del directo que se envía a quien se conecta (lo aporta el motor de directo). */
  liveSnapshot?: (rundownId: string, orgId: string) => Promise<unknown>;
  /** Aviso de cambios en las líneas de una escaleta. */
  onDocChanged?: (rundownId: string, orgId: string) => void;

  constructor(
    private readonly db: Db,
    readonly log: FastifyBaseLogger,
  ) {
    this.pingTimer = setInterval(() => this.ping(), PING_INTERVAL_MS);
    this.pingTimer.unref();
  }

  /**
   * Empieza a guardar los mensajes de un socket recién abierto. Hay que
   * llamarlo antes de cualquier espera (comprobar permisos), porque el cliente
   * envía su primer mensaje de sincronización nada más conectar.
   */
  buffer(ws: WebSocket): Uint8Array[] {
    ws.binaryType = 'arraybuffer';
    const pending: Uint8Array[] = [];
    const onMessage = (data: ArrayBuffer | Buffer) => pending.push(toBytes(data));
    ws.on('message', onMessage);
    earlyListeners.set(ws, onMessage);
    return pending;
  }

  /** Conecta un socket ya autenticado y autorizado a la escaleta. */
  async handleConnection(
    ws: WebSocket,
    rundownId: string,
    info: CollabConnection,
    pending: Uint8Array[] = [],
  ): Promise<void> {
    ws.binaryType = 'arraybuffer';
    const conn: ConnState = { ...info, awarenessIds: new Set(), alive: true };
    // Los mensajes que llegan mientras se carga el documento se procesan después.
    let shared: SharedDoc | undefined;
    const early = earlyListeners.get(ws);
    if (early) {
      ws.off('message', early);
      earlyListeners.delete(ws);
    }
    ws.on('message', (data: ArrayBuffer | Buffer) => {
      const bytes = toBytes(data);
      if (!shared) return void pending.push(bytes);
      this.safeHandle(shared, ws, conn, bytes);
    });
    ws.on('pong', () => {
      conn.alive = true;
    });
    ws.on('close', () => void this.disconnect(rundownId, ws));

    try {
      shared = await this.getDoc(rundownId, info.orgId);
    } catch (err) {
      this.log.error({ err, rundownId }, 'No se pudo abrir la escaleta');
      ws.close(1011, 'Error al abrir la escaleta');
      return;
    }
    if (ws.readyState !== ws.OPEN) return void this.disconnect(rundownId, ws);
    shared.conns.set(ws, conn);
    shared.sendInitial(ws);
    for (const bytes of pending.splice(0)) this.safeHandle(shared, ws, conn, bytes);
    if (this.liveSnapshot) {
      try {
        const live = await this.liveSnapshot(rundownId, info.orgId);
        if (live) send(ws, liveMessage(live));
      } catch (err) {
        this.log.warn({ err, rundownId }, 'No se pudo enviar el estado del directo');
      }
    }
  }

  /** Envía el estado del directo a todas las personas conectadas a la escaleta. */
  broadcastLive(rundownId: string, live: unknown): void {
    void this.docs.get(rundownId)?.then((shared) => shared.broadcast(liveMessage(live)));
  }

  /**
   * Usa el documento de una escaleta desde el servidor (motor de directo),
   * aunque no haya nadie conectado. Se guarda y se descarga al terminar si
   * no lo usa nadie más.
   */
  async withDoc<T>(
    rundownId: string,
    orgId: string,
    fn: (doc: Y.Doc) => T | Promise<T>,
  ): Promise<T> {
    const entry = this.getDoc(rundownId, orgId);
    const shared = await entry;
    shared.holds++;
    try {
      return await fn(shared.doc);
    } finally {
      shared.holds--;
      await this.releaseIfIdle(rundownId, shared);
    }
  }

  private async releaseIfIdle(rundownId: string, shared: SharedDoc): Promise<void> {
    if (shared.conns.size > 0 || shared.holds > 0) return;
    await shared.save();
    const entry = this.docs.get(rundownId);
    if (shared.conns.size === 0 && shared.holds === 0 && entry && (await entry) === shared) {
      this.docs.delete(rundownId);
      shared.destroy();
    }
  }

  private safeHandle(shared: SharedDoc, ws: WebSocket, conn: ConnState, bytes: Uint8Array): void {
    try {
      shared.handleMessage(ws, conn, bytes);
    } catch (err) {
      this.log.warn({ err }, 'Mensaje de colaboración no válido');
      ws.close(1003, 'Mensaje no válido');
    }
  }

  private getDoc(rundownId: string, orgId: string): Promise<SharedDoc> {
    let entry = this.docs.get(rundownId);
    if (!entry) {
      entry = this.load(rundownId, orgId);
      this.docs.set(rundownId, entry);
      entry.catch(() => this.docs.delete(rundownId));
    }
    return entry.then((shared) => {
      if (shared.orgId !== orgId) throw new Error('Escaleta de otra empresa');
      return shared;
    });
  }

  private async load(rundownId: string, orgId: string): Promise<SharedDoc> {
    const shared = new SharedDoc(rundownId, orgId, this);
    const [row] = await withTenant(
      this.db,
      { orgId, userId: '00000000-0000-0000-0000-000000000000' },
      (tx) =>
        tx
          .select({ ydoc: rundowns.ydoc })
          .from(rundowns)
          .where(and(eq(rundowns.id, rundownId), eq(rundowns.orgId, orgId)))
          .limit(1),
    );
    if (row?.ydoc && row.ydoc.length > 0) {
      Y.applyUpdate(shared.doc, row.ydoc, 'load');
      shared.dirty = false;
    }
    return shared;
  }

  private async disconnect(rundownId: string, ws: WebSocket): Promise<void> {
    const entry = this.docs.get(rundownId);
    if (!entry) return;
    const shared = await entry.catch(() => undefined);
    if (!shared) return;
    shared.removeConnection(ws);
    // Puede conectarse alguien mientras se guarda: releaseIfIdle lo comprueba.
    await this.releaseIfIdle(rundownId, shared);
  }

  /** Persiste el documento y la proyección de líneas. */
  async persist(shared: SharedDoc): Promise<void> {
    const state = Y.encodeStateAsUpdate(shared.doc);
    const lines = readLines(shared.doc);
    const summary = summarize(lines);
    await withTenant(
      this.db,
      { orgId: shared.orgId, userId: '00000000-0000-0000-0000-000000000000' },
      async (tx) => {
        await tx
          .update(rundowns)
          .set({
            ydoc: state,
            lineCount: summary.lineCount,
            estimatedSeconds: summary.estimatedSeconds,
            updatedAt: new Date(),
          })
          .where(and(eq(rundowns.id, shared.rundownId), eq(rundowns.orgId, shared.orgId)));
        await tx.delete(rundownLines).where(eq(rundownLines.rundownId, shared.rundownId));
        if (lines.length > 0) {
          await tx.insert(rundownLines).values(
            lines.map((l, i) => ({
              rundownId: shared.rundownId,
              id: l.id,
              orgId: shared.orgId,
              position: i,
              num: String(l.cells.num ?? ''),
              type: String(l.cells.tipo ?? ''),
              cells: l.cells,
            })),
          );
        }
      },
    );
  }

  /** Cierra las conexiones de una escaleta (p. ej. al borrarla). */
  closeDocument(rundownId: string): void {
    void this.docs.get(rundownId)?.then((shared) => {
      for (const ws of shared.conns.keys()) ws.close(CLOSE_DELETED, 'Escaleta borrada');
    });
  }

  private ping(): void {
    for (const entry of this.docs.values()) {
      void entry.then((shared) => {
        for (const [ws, conn] of shared.conns) {
          if (!conn.alive) {
            ws.terminate();
            continue;
          }
          conn.alive = false;
          ws.ping();
        }
      });
    }
  }

  /** Guarda todo y cierra (al apagar el servidor). */
  async close(): Promise<void> {
    clearInterval(this.pingTimer);
    const all = await Promise.allSettled([...this.docs.values()]);
    for (const r of all) {
      if (r.status !== 'fulfilled') continue;
      for (const ws of r.value.conns.keys()) ws.close(1001, 'Servidor apagándose');
      await r.value.save();
      r.value.destroy();
    }
    this.docs.clear();
  }

  /** Número de documentos abiertos (pruebas y diagnóstico). */
  get openDocuments(): number {
    return this.docs.size;
  }
}
