import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import {
  autoAdvanceAt,
  initialLiveState,
  isFloating,
  resolveNext,
  rundownWindow,
  scheduledEvent,
  type LiveMode,
  type LiveState,
  type RundownWindow,
  type TimingLine,
} from '@runflow/core';
import { readLines, setCells } from '@runflow/sync';
import {
  asrunLog,
  organizations,
  rundowns,
  withSystem,
  withTenant,
  type Db,
  type Tx,
} from '@runflow/db';
import { conflict, notFound } from '../errors';
import type { CollabServer } from '../collab/collab-server';

/*
 * Motor de directo (PLAN §11). Autoridad única del estado del directo de
 * cada escaleta: EN AIRE, SIGUIENTE, emitidas, modo y avance automático.
 * Las órdenes se procesan de una en una por escaleta y el resultado se
 * guarda, se registra en el as-run y se envía a todas las personas conectadas.
 */

const SYSTEM_USER = '00000000-0000-0000-0000-000000000000';
/** Reprogramación máxima de temporizadores (los muy lejanos se recalculan). */
const MAX_TIMER_MS = 60 * 60 * 1000;

export type GoTrigger = 'go' | 'auto' | 'event' | 'back';

export interface LiveSettings {
  mode?: LiveMode;
  armed?: boolean;
  rehearsal?: boolean;
  autonextAt?: 'duration' | 'coleo';
}

interface LiveRundown {
  rundownId: string;
  orgId: string;
  /** El directo lo lleva una RunFlow Station: la nube solo lo refleja. */
  external: boolean;
  window: RundownWindow;
  state: LiveState;
  timer: NodeJS.Timeout | undefined;
  queue: Promise<unknown>;
}

interface Actor {
  orgId: string;
  userId: string;
}

export class LiveManager {
  private readonly items = new Map<string, Promise<LiveRundown>>();

  constructor(
    private readonly db: Db,
    private readonly collab: CollabServer,
    private readonly log: FastifyBaseLogger,
    private readonly options: { minGoIntervalMs: number },
  ) {
    collab.liveSnapshot = async (rundownId, orgId) => (await this.load(rundownId, orgId)).state;
    collab.onDocChanged = (rundownId) => {
      void this.items.get(rundownId)?.then((item) => this.enqueue(item, () => this.schedule(item)));
    };
  }

  /** Estado actual del directo (cargándolo si hace falta). */
  async get(actor: Actor, rundownId: string): Promise<LiveState> {
    return (await this.load(rundownId, actor.orgId)).state;
  }

  private load(rundownId: string, orgId: string): Promise<LiveRundown> {
    let entry = this.items.get(rundownId);
    if (!entry) {
      entry = this.fetch(rundownId, orgId);
      this.items.set(rundownId, entry);
      entry.catch(() => this.items.delete(rundownId));
    }
    return entry.then((item) => {
      if (item.orgId !== orgId) throw notFound('Escaleta no encontrada');
      return item;
    });
  }

  private async fetch(rundownId: string, orgId: string): Promise<LiveRundown> {
    const [row] = await withTenant(this.db, { orgId, userId: SYSTEM_USER }, (tx) =>
      tx
        .select({
          live: rundowns.live,
          airDate: rundowns.airDate,
          startTime: rundowns.startTime,
          endTime: rundowns.endTime,
          timezone: organizations.timezone,
        })
        .from(rundowns)
        .innerJoin(organizations, eq(organizations.id, rundowns.orgId))
        .where(
          and(eq(rundowns.id, rundownId), eq(rundowns.orgId, orgId), isNull(rundowns.deletedAt)),
        )
        .limit(1),
    );
    if (!row) throw notFound('Escaleta no encontrada');
    const item: LiveRundown = {
      rundownId,
      orgId,
      window: rundownWindow(row.airDate, row.startTime, row.endTime, row.timezone),
      state: { ...initialLiveState(), ...((row.live as Partial<LiveState> | null) ?? {}) },
      external: !!(row.live as { station?: boolean } | null)?.station,
      timer: undefined,
      queue: Promise.resolve(),
    };
    await this.enqueue(item, () => this.schedule(item));
    return item;
  }

  /** Las órdenes de una escaleta se ejecutan en orden, nunca a la vez. */
  private enqueue<T>(item: LiveRundown, fn: () => Promise<T>): Promise<T> {
    const run = item.queue.then(fn, fn);
    item.queue = run.catch(() => undefined);
    return run;
  }

  /** Cambio de fecha u horario de la escaleta: recalcula la ventana. */
  async refreshWindow(rundownId: string): Promise<void> {
    const entry = this.items.get(rundownId);
    if (!entry) return;
    const item = await entry.catch(() => undefined);
    if (!item) return;
    this.items.delete(rundownId);
    clearTimeout(item.timer);
    await this.load(rundownId, item.orgId);
  }

  forget(rundownId: string): void {
    void this.items.get(rundownId)?.then((item) => clearTimeout(item.timer));
    this.items.delete(rundownId);
  }

  private async lines(item: LiveRundown): Promise<TimingLine[]> {
    return this.collab.withDoc(item.rundownId, item.orgId, (doc) => readLines(doc));
  }

  /** Escaleta cuyo directo se controla desde aquí (no desde una Station). */
  private async local(rundownId: string, orgId: string): Promise<LiveRundown> {
    const item = await this.load(rundownId, orgId);
    if (item.external)
      throw conflict(
        'station_live',
        'Este directo se controla desde la RunFlow Station del estudio',
      );
    return item;
  }

  /**
   * Nube: refleja el estado del directo que lleva una Station (para quien lo
   * sigue desde fuera del estudio). No programa avances: manda la Station.
   */
  async mirror(orgId: string, rundownId: string, state: LiveState): Promise<void> {
    const item = await this.load(rundownId, orgId);
    await this.enqueue(item, async () => {
      clearTimeout(item.timer);
      item.timer = undefined;
      item.external = !!state.onAir || (!!state.showStartedAt && !state.showEndedAt);
      item.state = state;
      await withTenant(this.db, { orgId, userId: SYSTEM_USER }, (tx) =>
        tx
          .update(rundowns)
          .set({
            live: item.external ? { ...state, station: true } : state,
            updatedAt: sql`now()`,
          })
          .where(and(eq(rundowns.id, rundownId), eq(rundowns.orgId, orgId))),
      );
      this.collab.broadcastLive(rundownId, state);
    });
  }

  /* ---------- Órdenes ---------- */

  async go(
    actor: Actor,
    rundownId: string,
    opts: { expectedOnAir?: string | null; trigger?: GoTrigger; lineId?: string },
  ): Promise<LiveState> {
    const item = await this.local(rundownId, actor.orgId);
    return this.enqueue(item, () => this.doGo(item, actor.userId, opts));
  }

  private async doGo(
    item: LiveRundown,
    userId: string | null,
    opts: { expectedOnAir?: string | null; trigger?: GoTrigger; lineId?: string; end?: boolean },
  ): Promise<LiveState> {
    const trigger = opts.trigger ?? 'go';
    const now = Date.now();
    const state = item.state;
    // Otra persona (o el automático) ya ha avanzado: esta orden llega tarde.
    if (opts.expectedOnAir !== undefined && opts.expectedOnAir !== (state.onAir?.lineId ?? null)) {
      throw conflict('stale', 'La escaleta ya ha avanzado');
    }
    if (trigger === 'go' && now - state.lastGoAt < this.options.minGoIntervalMs) {
      throw conflict('too_fast', 'GO demasiado seguido: espera un momento');
    }
    const lines = await this.lines(item);
    const nextId = opts.end ? null : (opts.lineId ?? resolveNext(lines, state));
    const updated: LiveState = {
      ...state,
      played: { ...state.played },
      seq: state.seq + 1,
      lastGoAt: trigger === 'go' ? now : state.lastGoAt,
      next: null,
    };
    const closed = state.onAir;
    if (closed) {
      updated.played[closed.lineId] = {
        startedAt: closed.startedAt,
        duration: Math.round((now - closed.startedAt) / 100) / 10,
      };
    }
    if (nextId) {
      updated.onAir = { lineId: nextId, startedAt: now };
      delete updated.played[nextId];
      updated.showStartedAt ??= now;
      updated.showEndedAt = null;
    } else {
      updated.onAir = null;
      updated.showEndedAt = now;
    }

    // La línea que sale pasa a EMITIDO (salvo en ensayo).
    if (closed && !state.rehearsal) {
      await this.collab.withDoc(item.rundownId, item.orgId, (doc) =>
        setCells(doc, [{ id: closed.lineId, key: 'estado', value: 'E' }], 'live'),
      );
    }

    await withTenant(this.db, { orgId: item.orgId, userId: userId ?? SYSTEM_USER }, async (tx) => {
      if (closed) await this.closeAsrun(tx, item, closed.lineId, now);
      if (nextId) {
        const line = lines.find((l) => l.id === nextId);
        await tx.insert(asrunLog).values({
          orgId: item.orgId,
          rundownId: item.rundownId,
          lineId: nextId,
          num: String(line?.cells.num ?? ''),
          name: String(line?.cells.nombre ?? ''),
          type: String(line?.cells.tipo ?? ''),
          startedAt: new Date(now),
          rehearsal: state.rehearsal,
          trigger,
          userId,
        });
      }
      await this.persist(tx, item, updated, {
        status: state.rehearsal ? undefined : nextId ? 'en_aire' : 'cerrada',
      });
    });
    return this.commit(item, updated);
  }

  /** Vuelve a poner en aire la línea anterior. */
  async back(actor: Actor, rundownId: string): Promise<LiveState> {
    const item = await this.local(rundownId, actor.orgId);
    return this.enqueue(item, async () => {
      const state = item.state;
      const lines = (await this.lines(item)).filter((l) => !isFloating(l));
      const currentIdx = state.onAir
        ? lines.findIndex((l) => l.id === state.onAir!.lineId)
        : lines.length;
      const prev = [...lines.slice(0, Math.max(0, currentIdx))]
        .reverse()
        .find((l) => state.played[l.id]);
      if (!prev) throw conflict('no_previous', 'No hay línea anterior');
      const now = Date.now();
      const updated: LiveState = {
        ...state,
        played: { ...state.played },
        onAir: { lineId: prev.id, startedAt: now },
        next: null,
        showEndedAt: null,
        seq: state.seq + 1,
      };
      delete updated.played[prev.id];
      await withTenant(this.db, { orgId: item.orgId, userId: actor.userId }, async (tx) => {
        if (state.onAir) await this.closeAsrun(tx, item, state.onAir.lineId, now);
        await tx.insert(asrunLog).values({
          orgId: item.orgId,
          rundownId: item.rundownId,
          lineId: prev.id,
          num: String(prev.cells.num ?? ''),
          name: String(prev.cells.nombre ?? ''),
          type: String(prev.cells.tipo ?? ''),
          startedAt: new Date(now),
          rehearsal: state.rehearsal,
          trigger: 'back',
          userId: actor.userId,
        });
        await this.persist(tx, item, updated, { status: state.rehearsal ? undefined : 'en_aire' });
      });
      return this.commit(item, updated);
    });
  }

  /** Elige a mano la siguiente línea (null = la siguiente en orden). */
  async setNext(actor: Actor, rundownId: string, lineId: string | null): Promise<LiveState> {
    const item = await this.local(rundownId, actor.orgId);
    return this.enqueue(item, async () => {
      if (lineId) {
        const line = (await this.lines(item)).find((l) => l.id === lineId);
        if (!line) throw notFound('Línea no encontrada');
        if (isFloating(line))
          throw conflict('floating', 'Una línea flotante no puede ser la siguiente');
        if (lineId === item.state.onAir?.lineId)
          throw conflict('on_air', 'Esa línea ya está en aire');
      }
      const updated = { ...item.state, next: lineId, seq: item.state.seq + 1 };
      await withTenant(this.db, { orgId: item.orgId, userId: actor.userId }, (tx) =>
        this.persist(tx, item, updated, {}),
      );
      return this.commit(item, updated);
    });
  }

  /** Termina el directo: la línea en aire pasa a emitida. */
  async stop(actor: Actor, rundownId: string): Promise<LiveState> {
    const item = await this.local(rundownId, actor.orgId);
    return this.enqueue(item, async () => {
      if (!item.state.onAir) throw conflict('not_live', 'No hay nada en aire');
      return this.doGo(item, actor.userId, { trigger: 'auto', end: true });
    });
  }

  /** Vuelve a preparación (no borra el as-run ni los estados de las líneas). */
  async reset(actor: Actor, rundownId: string): Promise<LiveState> {
    const item = await this.local(rundownId, actor.orgId);
    return this.enqueue(item, async () => {
      const s = item.state;
      const updated: LiveState = {
        ...initialLiveState(),
        mode: s.mode,
        armed: s.armed,
        rehearsal: s.rehearsal,
        autonextAt: s.autonextAt,
        seq: s.seq + 1,
      };
      await withTenant(this.db, { orgId: item.orgId, userId: actor.userId }, async (tx) => {
        if (s.onAir) await this.closeAsrun(tx, item, s.onAir.lineId, Date.now());
        await this.persist(tx, item, updated, {
          status: s.showStartedAt && !s.rehearsal ? 'lista' : undefined,
        });
      });
      return this.commit(item, updated);
    });
  }

  async settings(actor: Actor, rundownId: string, input: LiveSettings): Promise<LiveState> {
    const item = await this.local(rundownId, actor.orgId);
    return this.enqueue(item, async () => {
      const updated: LiveState = { ...item.state, ...input, seq: item.state.seq + 1 };
      await withTenant(this.db, { orgId: item.orgId, userId: actor.userId }, (tx) =>
        this.persist(tx, item, updated, {}),
      );
      return this.commit(item, updated);
    });
  }

  /* ---------- Internos ---------- */

  private async closeAsrun(tx: Tx, item: LiveRundown, lineId: string, now: number): Promise<void> {
    const [open] = await tx
      .select({ id: asrunLog.id, startedAt: asrunLog.startedAt })
      .from(asrunLog)
      .where(
        and(
          eq(asrunLog.rundownId, item.rundownId),
          eq(asrunLog.lineId, lineId),
          isNull(asrunLog.endedAt),
        ),
      )
      .orderBy(desc(asrunLog.startedAt))
      .limit(1);
    if (!open) return;
    await tx
      .update(asrunLog)
      .set({
        endedAt: new Date(now),
        durationS: Math.round((now - open.startedAt.getTime()) / 1000),
      })
      .where(eq(asrunLog.id, open.id));
  }

  private async persist(
    tx: Tx,
    item: LiveRundown,
    state: LiveState,
    extra: { status?: 'en_aire' | 'cerrada' | 'lista' },
  ): Promise<void> {
    await tx
      .update(rundowns)
      .set({
        live: state,
        ...(extra.status ? { status: extra.status } : {}),
        updatedAt: sql`now()`,
      })
      .where(and(eq(rundowns.id, item.rundownId), eq(rundowns.orgId, item.orgId)));
  }

  /** RunFlow CG (y mezcladores en M8): reaccionan a cada cambio del directo. */
  onChange:
    | ((rundownId: string, orgId: string, prev: LiveState, next: LiveState) => void)
    | undefined;

  private async commit(item: LiveRundown, state: LiveState): Promise<LiveState> {
    const prev = item.state;
    item.state = state;
    this.collab.broadcastLive(item.rundownId, state);
    try {
      this.onChange?.(item.rundownId, item.orgId, prev, state);
    } catch (err) {
      this.log.error({ err, rundownId: item.rundownId }, 'Error al avisar del cambio de directo');
    }
    await this.schedule(item);
    return state;
  }

  /** Programa el siguiente avance automático (autonext, arranque o hora fija). */
  private async schedule(item: LiveRundown): Promise<void> {
    clearTimeout(item.timer);
    item.timer = undefined;
    if (item.external) return;
    const state = item.state;
    if (state.mode === 'manual' && !state.onAir) return;
    let lines: TimingLine[];
    try {
      lines = await this.lines(item);
    } catch (err) {
      this.log.warn({ err, rundownId: item.rundownId }, 'No se pudo programar el directo');
      return;
    }
    const auto = autoAdvanceAt(lines, state);
    const event = scheduledEvent(lines, state, item.window);
    const candidates: { at: number; run: () => Promise<unknown> }[] = [];
    const expected = state.onAir?.lineId ?? null;
    if (auto !== null) {
      candidates.push({
        at: auto,
        run: () => this.doGo(item, null, { trigger: 'auto', expectedOnAir: expected }),
      });
    }
    if (event) {
      candidates.push({
        at: event.at,
        run: () =>
          this.doGo(item, null, {
            trigger: 'event',
            expectedOnAir: expected,
            ...(event.lineId ? { lineId: event.lineId } : {}),
          }),
      });
    }
    if (!candidates.length) return;
    const first = candidates.sort((a, b) => a.at - b.at)[0]!;
    const delay = first.at - Date.now();
    // Un arranque a la hora que ya pasó hace mucho no se dispara (p. ej. al reiniciar el servidor).
    if (event && first.at === event.at && !state.showStartedAt && delay < -5 * 60_000) return;
    item.timer = setTimeout(
      () => {
        item.timer = undefined;
        if (delay > MAX_TIMER_MS) {
          void this.enqueue(item, () => this.schedule(item));
          return;
        }
        void this.enqueue(item, first.run).catch((err: unknown) => {
          if ((err as { code?: string }).code !== 'stale') {
            this.log.error({ err, rundownId: item.rundownId }, 'Fallo en el avance automático');
          }
        });
      },
      Math.max(0, Math.min(delay, MAX_TIMER_MS)),
    );
    item.timer.unref?.();
  }

  /** Al arrancar el servidor: retoma los directos en curso y los eventos programados. */
  async resume(): Promise<void> {
    const rows = await withSystem(this.db, (tx) =>
      tx
        .select({ id: rundowns.id, orgId: rundowns.orgId })
        .from(rundowns)
        .where(
          and(
            isNull(rundowns.deletedAt),
            sql`${rundowns.live} is not null and ${rundowns.live}->>'showEndedAt' is null
                and (${rundowns.live}->'onAir' <> 'null'::jsonb or ${rundowns.live}->>'mode' = 'evento')`,
          ),
        ),
    );
    for (const r of rows) {
      await this.load(r.id, r.orgId).catch((err: unknown) =>
        this.log.warn({ err, rundownId: r.id }, 'No se pudo retomar el directo'),
      );
    }
  }

  close(): void {
    for (const entry of this.items.values()) void entry.then((item) => clearTimeout(item.timer));
    this.items.clear();
  }
}
