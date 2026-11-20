import { and, eq, gte, isNull, lte, notInArray, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import WebSocket from 'ws';
import { Awareness } from 'y-protocols/awareness';
import { WebsocketProvider } from 'y-websocket';
import {
  fridgeItems,
  memberships,
  organizations,
  outputs,
  people,
  programs,
  roles,
  rundowns,
  rundownTemplates,
  users,
  views,
  withSystem,
  type Db,
} from '@runflow/db';
import type { CollabServer } from '../collab/collab-server';

/*
 * Sincronización Station ↔ nube (modo híbrido, PLAN §4 y §9).
 *
 * - Cada pocos segundos trae la instantánea de la empresa (usuarios, roles,
 *   programas, escaletas…) y la aplica en la base de datos local: así se
 *   puede entrar y trabajar en la Station aunque se caiga internet.
 * - Sube lo creado en la Station sin conexión (programas y escaletas).
 * - Mantiene sincronizados con la nube, en ambos sentidos, los documentos de
 *   las escaletas cercanas (CRDT: al volver la red, todo se fusiona).
 */

const WINDOW_PAST_DAYS = 2;
const WINDOW_FUTURE_DAYS = 14;

export interface SyncStatus {
  enabled: boolean;
  online: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  syncedRundowns: number;
  orgId: string | null;
}

interface Link {
  provider: WebsocketProvider;
  release: () => Promise<void>;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const fromB64 = (v: string | null) => (v ? new Uint8Array(Buffer.from(v, 'base64')) : null);
/** Usuarios conocidos en la Station (las referencias a otros se quedan en blanco). */
let knownUsers = new Set<string>();

/**
 * Prepara una fila de la instantánea para insertarla: las fechas llegan como
 * texto ISO (las columnas «…At» vuelven a ser Date) y `createdBy` solo se
 * conserva si esa persona existe en la Station.
 */
const dates = <T extends Record<string, unknown>>(row: T, _keys?: string[]): T => {
  const out: Record<string, unknown> = { ...row };
  for (const k of Object.keys(out)) {
    if (k.endsWith('At') && typeof out[k] === 'string') out[k] = new Date(out[k] as string);
  }
  if (typeof out.createdBy === 'string' && !knownUsers.has(out.createdBy)) out.createdBy = null;
  return out as T;
};

export class StationSync {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private paused = false;
  private links = new Map<string, Link>();
  private orgId: string | null = null;
  private pendingLive = new Map<string, unknown>();
  private flushing = false;
  readonly status: SyncStatus = {
    enabled: true,
    online: false,
    lastSyncAt: null,
    lastError: null,
    syncedRundowns: 0,
    orgId: null,
  };

  constructor(
    private readonly db: Db,
    private readonly collab: CollabServer,
    private readonly log: FastifyBaseLogger,
    private readonly options: {
      cloudUrl: string;
      token: string;
      intervalMs: number;
      version: string;
    },
  ) {}

  start(): void {
    this.collab.onLive = (rundownId, live) => {
      this.pendingLive.set(rundownId, live);
      void this.flushLive();
    };
    void this.tick();
  }

  /** Envía a la nube el último estado del directo de cada escaleta (si hay red). */
  private async flushLive(): Promise<void> {
    if (this.paused || this.flushing) return;
    this.flushing = true;
    let failed = false;
    try {
      for (const [rundownId, live] of [...this.pendingLive]) {
        const res = await fetch(`${this.options.cloudUrl}/api/station-sync/live/${rundownId}`, {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify({ live }),
        });
        if (!res.ok && res.status !== 404) throw new Error(`Directo a la nube: ${res.status}`);
        if (this.pendingLive.get(rundownId) === live) this.pendingLive.delete(rundownId);
      }
    } catch (err) {
      failed = true;
      this.log.warn({ err }, 'No se pudo enviar el directo a la nube (se reintentará)');
    } finally {
      this.flushing = false;
    }
    // Llegó otro cambio mientras se enviaba (si falló, se reintenta en la próxima sincronización).
    if (!failed && !this.paused && this.pendingLive.size) void this.flushLive();
  }

  /** Simula la pérdida de red (pruebas) o detiene la sincronización. */
  async pause(): Promise<void> {
    this.paused = true;
    clearTimeout(this.timer);
    for (const link of this.links.values()) link.provider.disconnect();
    this.status.online = false;
  }

  resume(): void {
    this.paused = false;
    for (const link of this.links.values()) link.provider.connect();
    void this.tick();
  }

  async close(): Promise<void> {
    this.paused = true;
    this.collab.onLive = undefined;
    clearTimeout(this.timer);
    for (const [id, link] of this.links) {
      link.provider.destroy();
      await link.release();
      this.links.delete(id);
    }
  }

  private schedule(): void {
    clearTimeout(this.timer);
    if (this.paused) return;
    this.timer = setTimeout(() => void this.tick(), this.options.intervalMs);
    this.timer.unref?.();
  }

  private headers(): Record<string, string> {
    return {
      authorization: `Bearer ${this.options.token}`,
      'x-runflow-version': this.options.version,
      'x-runflow-request': '1',
      'content-type': 'application/json',
    };
  }

  private async tick(): Promise<void> {
    if (this.running || this.paused) return;
    this.running = true;
    try {
      const res = await fetch(`${this.options.cloudUrl}/api/station-sync/snapshot`, {
        headers: this.headers(),
      });
      if (!res.ok) throw new Error(`La nube respondió ${res.status}`);
      const snapshot = (await res.json()) as Snapshot;
      this.orgId = snapshot.organization.id;
      this.status.orgId = this.orgId;
      await this.apply(snapshot);
      await this.push(snapshot);
      await this.linkDocs();
      await this.flushLive();
      // Si se pausó mientras tanto, no se da por conectada.
      if (this.paused) return;
      this.status.online = true;
      this.status.lastError = null;
      this.status.lastSyncAt = new Date().toISOString();
    } catch (err) {
      this.status.online = false;
      this.status.lastError = err instanceof Error ? err.message : String(err);
      this.log.warn({ err }, 'Sincronización con la nube fallida (se reintentará)');
    } finally {
      this.running = false;
      this.schedule();
    }
  }

  /** Aplica la instantánea de la nube en la base de datos local. */
  private async apply(s: Snapshot): Promise<void> {
    knownUsers = new Set(s.users.map((u) => u.id));
    await withSystem(this.db, async (tx) => {
      const org = dates(s.organization, ['createdAt', 'updatedAt']);
      await tx
        .insert(organizations)
        .values(org)
        .onConflictDoUpdate({
          target: organizations.id,
          set: {
            name: org.name,
            plan: org.plan,
            timezone: org.timezone,
            mode: 'hybrid',
            updatedAt: new Date(),
          },
        });
      for (const u of s.users) {
        const row = dates(u, ['createdAt', 'updatedAt', 'lastLoginAt']);
        await tx
          .insert(users)
          .values(row)
          .onConflictDoUpdate({
            target: users.id,
            set: {
              email: row.email,
              name: row.name,
              passwordHash: row.passwordHash,
              mustChangePassword: row.mustChangePassword,
            },
          });
      }
      for (const r of s.roles) {
        const row = dates(r, ['createdAt', 'updatedAt']);
        await tx
          .insert(roles)
          .values(row)
          .onConflictDoUpdate({
            target: roles.id,
            set: { name: row.name, description: row.description, permissions: row.permissions },
          });
      }
      for (const m of s.memberships) {
        const row = dates(m, ['createdAt', 'updatedAt']);
        await tx
          .insert(memberships)
          .values(row)
          .onConflictDoUpdate({
            target: memberships.id,
            set: { roleId: row.roleId, active: row.active },
          });
      }
      // Quien ya no pertenece a la empresa en la nube, tampoco entra en la Station.
      const keep = s.memberships.map((m) => m.id);
      await tx
        .delete(memberships)
        .where(
          and(
            eq(memberships.orgId, s.organization.id),
            keep.length ? notInArray(memberships.id, keep) : undefined,
          ),
        );
      // …y su cuenta desaparece de la Station si no le queda ninguna empresa.
      await tx.execute(
        sql`delete from users u where not exists (select 1 from memberships m where m.user_id = u.id)`,
      );
      for (const p of s.programs) {
        const row = dates(p, ['createdAt', 'updatedAt']);
        await tx
          .insert(programs)
          .values(row)
          .onConflictDoUpdate({
            target: programs.id,
            set: {
              name: row.name,
              type: row.type,
              defaultStartTime: row.defaultStartTime,
              defaultDurationMin: row.defaultDurationMin,
              archived: row.archived,
            },
          });
      }
      for (const r of s.rundowns) {
        const row = dates(r, ['createdAt', 'deletedAt']);
        await tx
          .insert(rundowns)
          .values({ ...row, orgId: s.organization.id } as never)
          .onConflictDoUpdate({
            target: rundowns.id,
            set: {
              title: row.title,
              airDate: row.airDate,
              startTime: row.startTime,
              endTime: row.endTime,
              deletedAt: row.deletedAt as unknown as Date | null,
            },
          });
      }
      for (const v of s.views) {
        const row = dates(v, ['createdAt', 'updatedAt']);
        await tx
          .insert(views)
          .values(row)
          .onConflictDoUpdate({ target: views.id, set: { name: row.name, columns: row.columns } });
      }
      for (const p of s.people) {
        const row = dates(p, ['createdAt', 'updatedAt']);
        await tx.insert(people).values(row).onConflictDoNothing();
      }
      for (const t of s.templates) {
        const row = dates({ ...t, ydoc: fromB64(t.ydoc)! }, ['createdAt']);
        await tx.insert(rundownTemplates).values(row).onConflictDoNothing();
      }
      for (const f of s.fridge) {
        await tx
          .insert(fridgeItems)
          .values(dates(f, ['createdAt']))
          .onConflictDoNothing();
      }
      for (const o of s.outputs) {
        const row = dates(o, ['createdAt', 'updatedAt', 'revokedAt']);
        await tx
          .insert(outputs)
          .values(row)
          .onConflictDoUpdate({
            target: outputs.id,
            set: {
              settings: row.settings as never,
              revokedAt: row.revokedAt as Date | null,
              name: row.name,
            },
          });
      }
    });
  }

  /** Sube a la nube los programas y escaletas creados en la Station. */
  private async push(s: Snapshot): Promise<void> {
    const known = new Set(s.rundowns.map((r) => r.id));
    const knownPrograms = new Set(s.programs.map((p) => p.id));
    const local = await withSystem(this.db, (tx) =>
      Promise.all([
        tx.select().from(programs).where(eq(programs.orgId, s.organization.id)),
        tx
          .select()
          .from(rundowns)
          .where(and(eq(rundowns.orgId, s.organization.id), isNull(rundowns.deletedAt))),
      ]),
    );
    const newPrograms = local[0].filter((p) => !knownPrograms.has(p.id));
    const newRundowns = local[1].filter((r) => !known.has(r.id));
    if (!newPrograms.length && !newRundowns.length) return;
    const res = await fetch(`${this.options.cloudUrl}/api/station-sync/push`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        programs: newPrograms.map((p) => ({
          id: p.id,
          name: p.name,
          type: p.type,
          defaultStartTime: p.defaultStartTime,
          defaultDurationMin: p.defaultDurationMin,
        })),
        rundowns: newRundowns.map((r) => ({
          id: r.id,
          programId: r.programId,
          title: r.title,
          airDate: r.airDate,
          startTime: r.startTime,
          endTime: r.endTime,
          status: r.status,
        })),
      }),
    });
    if (!res.ok) throw new Error(`Subida a la nube: ${res.status}`);
  }

  /** Abre (o cierra) la sincronización de documentos de las escaletas cercanas. */
  private async linkDocs(): Promise<void> {
    if (!this.orgId) return;
    const now = new Date();
    const from = isoDate(new Date(now.getTime() - WINDOW_PAST_DAYS * 86_400_000));
    const to = isoDate(new Date(now.getTime() + WINDOW_FUTURE_DAYS * 86_400_000));
    const wanted = await withSystem(this.db, (tx) =>
      tx
        .select({ id: rundowns.id })
        .from(rundowns)
        .where(
          and(
            eq(rundowns.orgId, this.orgId!),
            isNull(rundowns.deletedAt),
            gte(rundowns.airDate, from),
            lte(rundowns.airDate, to),
          ),
        ),
    );
    const wantedIds = new Set(wanted.map((r) => r.id));
    for (const [id, link] of this.links) {
      if (!wantedIds.has(id)) {
        link.provider.destroy();
        await link.release();
        this.links.delete(id);
      }
    }
    const wsBase = this.options.cloudUrl.replace(/^http/, 'ws') + '/api/station-sync/collab';
    const headers = {
      authorization: `Bearer ${this.options.token}`,
      'x-runflow-version': this.options.version,
    };
    class StationWebSocket extends WebSocket {
      constructor(url: string, protocols?: string | string[]) {
        super(url, protocols, { headers });
      }
    }
    for (const id of wantedIds) {
      if (this.links.has(id)) continue;
      const { doc, release } = await this.collab.acquire(id, this.orgId);
      const provider = new WebsocketProvider(wsBase, id, doc, {
        WebSocketPolyfill: StationWebSocket as unknown as typeof globalThis.WebSocket,
        awareness: new Awareness(doc),
        disableBc: true,
        maxBackoffTime: 5000,
      });
      // Mensajes propios de la nube (directo, prompter…): la Station tiene los suyos.
      for (const type of [100, 101, 102, 103, 104])
        provider.messageHandlers[type] = () => undefined;
      this.links.set(id, { provider, release });
    }
    this.status.syncedRundowns = this.links.size;
  }
}

/* Forma de la instantánea (ver routes/stations.ts). */
type Row = Record<string, unknown> & { id: string };
interface Snapshot {
  organization: {
    id: string;
    name: string;
    plan: string;
    mode: string;
    timezone: string;
    slug: string;
  } & Row;
  roles: (Row & {
    orgId: string;
    key: string;
    name: string;
    description: string;
    permissions: string[];
  })[];
  users: (Row & {
    email: string;
    name: string;
    passwordHash: string;
    mustChangePassword: boolean;
    isPlatformAdmin: boolean;
  })[];
  memberships: (Row & { orgId: string; userId: string; roleId: string; active: boolean })[];
  programs: (Row & {
    orgId: string;
    name: string;
    type: string;
    defaultStartTime: string | null;
    defaultDurationMin: number | null;
    archived: boolean;
  })[];
  rundowns: (Row & {
    programId: string;
    title: string;
    airDate: string;
    startTime: string;
    endTime: string;
    status: string;
    deletedAt: string | null;
  })[];
  views: (Row & { orgId: string; name: string; columns: { key: string; width: number }[] })[];
  people: (Row & { orgId: string; name: string })[];
  templates: (Row & { orgId: string; name: string; ydoc: string | null })[];
  fridge: (Row & { orgId: string; name: string })[];
  outputs: (Row & {
    orgId: string;
    rundownId: string;
    kind: string;
    name: string;
    tokenHash: string;
    settings: unknown;
  })[];
}
