import { randomBytes } from 'node:crypto';
import { and, asc, eq, gte, inArray, lt } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  callInput,
  callPatch,
  callReply,
  crewInput,
  crewPatch,
  guestInput,
  guestPatch,
  logisticsInput,
  logisticsPatch,
  productionEventInput,
  productionEventPatch,
  productionEventsQuery,
  type CallDto,
  type CallStatus,
  type CrewDto,
  type GuestDto,
  type GuestStatus,
  type LogisticsCategory,
  type LogisticsDto,
  type ProductionEventDetail,
  type ProductionEventDto,
  type PublicCallDto,
  type EventKind,
  type EventStatus,
} from '@runflow/core';
import {
  crewMembers,
  eventCalls,
  guests,
  logisticsItems,
  organizations,
  productionEvents,
  programs,
  rundowns,
  withSystem,
  withTenant,
  type Tx,
} from '@runflow/db';
import { HttpError, notFound, parse } from '../errors';
import { requirePermission } from '../auth/guards';
import { audit } from '../services/audit';
import type { AppDeps } from '../app';

/* F3.1 Producción: calendario, personal, hojas de llamada, invitados y logística. */

const idParams = z.object({ id: z.uuid() });
const tokenParams = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{20,64}$/) });

const iso = (d: Date | null) => d?.toISOString() ?? null;
const toDate = (s: string | null | undefined) =>
  s === undefined ? undefined : s === null ? null : new Date(s);

type EventRow = typeof productionEvents.$inferSelect;
type Tally = Pick<
  ProductionEventDto,
  'crewTotal' | 'crewConfirmed' | 'crewDeclined' | 'guestTotal' | 'logisticsPending'
>;
const EMPTY: Tally = {
  crewTotal: 0,
  crewConfirmed: 0,
  crewDeclined: 0,
  guestTotal: 0,
  logisticsPending: 0,
};

const eventDto = (
  r: EventRow,
  names: { programName: string | null; rundownTitle: string | null },
  tally: Tally,
): ProductionEventDto => ({
  id: r.id,
  title: r.title,
  kind: r.kind as EventKind,
  status: r.status as EventStatus,
  startsAt: r.startsAt.toISOString(),
  endsAt: iso(r.endsAt),
  location: r.location,
  notes: r.notes,
  programId: r.programId,
  programName: names.programName,
  rundownId: r.rundownId,
  rundownTitle: names.rundownTitle,
  ...tally,
});

const crewDto = (r: typeof crewMembers.$inferSelect): CrewDto => ({
  id: r.id,
  name: r.name,
  role: r.role,
  phone: r.phone,
  email: r.email,
  notes: r.notes,
  active: r.active,
});

const guestDto = (r: typeof guests.$inferSelect): GuestDto => ({
  id: r.id,
  name: r.name,
  description: r.description,
  phone: r.phone,
  email: r.email,
  arrivalAt: iso(r.arrivalAt),
  makeupAt: iso(r.makeupAt),
  setAt: iso(r.setAt),
  status: r.status as GuestStatus,
  notes: r.notes,
});

const logisticsDto = (r: typeof logisticsItems.$inferSelect): LogisticsDto => ({
  id: r.id,
  category: r.category as LogisticsCategory,
  description: r.description,
  provider: r.provider,
  at: iso(r.at),
  assignee: r.assignee,
  done: r.done,
  notes: r.notes,
});

/** Recuento por convocatoria para el calendario. */
async function tallies(tx: Tx, ids: string[]): Promise<Map<string, Tally>> {
  const out = new Map<string, Tally>();
  if (!ids.length) return out;
  const get = (id: string) => {
    let t = out.get(id);
    if (!t) out.set(id, (t = { ...EMPTY }));
    return t;
  };
  const calls = await tx
    .select({ eventId: eventCalls.eventId, status: eventCalls.status })
    .from(eventCalls)
    .where(inArray(eventCalls.eventId, ids));
  for (const c of calls) {
    const t = get(c.eventId);
    t.crewTotal++;
    if (c.status === 'confirmado') t.crewConfirmed++;
    if (c.status === 'rechazado') t.crewDeclined++;
  }
  const gs = await tx
    .select({ eventId: guests.eventId })
    .from(guests)
    .where(inArray(guests.eventId, ids));
  for (const g of gs) get(g.eventId).guestTotal++;
  const ls = await tx
    .select({ eventId: logisticsItems.eventId, done: logisticsItems.done })
    .from(logisticsItems)
    .where(inArray(logisticsItems.eventId, ids));
  for (const l of ls) if (!l.done) get(l.eventId).logisticsPending++;
  return out;
}

async function loadEvents(tx: Tx, where: ReturnType<typeof and>): Promise<ProductionEventDto[]> {
  const rows = await tx
    .select({ e: productionEvents, programName: programs.name, rundownTitle: rundowns.title })
    .from(productionEvents)
    .leftJoin(programs, eq(programs.id, productionEvents.programId))
    .leftJoin(rundowns, eq(rundowns.id, productionEvents.rundownId))
    .where(where)
    .orderBy(asc(productionEvents.startsAt))
    .limit(1000);
  const t = await tallies(
    tx,
    rows.map((r) => r.e.id),
  );
  return rows.map((r) =>
    eventDto(
      r.e,
      { programName: r.programName ?? null, rundownTitle: r.rundownTitle ?? null },
      t.get(r.e.id) ?? EMPTY,
    ),
  );
}

const newToken = () => randomBytes(24).toString('base64url');

export async function productionRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const view = requirePermission(deps.db, 'production.view');
  const manage = requirePermission(deps.db, 'production.manage');

  /** El programa y la escaleta tienen que ser de la empresa (las FK no miran RLS). */
  async function checkLinks(
    tx: Tx,
    orgId: string,
    input: { programId?: string | null; rundownId?: string | null },
  ): Promise<{ programId?: string | null }> {
    let programId = input.programId;
    if (input.programId) {
      const [p] = await tx
        .select({ id: programs.id })
        .from(programs)
        .where(and(eq(programs.id, input.programId), eq(programs.orgId, orgId)));
      if (!p) throw notFound('Programa no encontrado');
    }
    if (input.rundownId) {
      const [r] = await tx
        .select({ id: rundowns.id, programId: rundowns.programId })
        .from(rundowns)
        .where(and(eq(rundowns.id, input.rundownId), eq(rundowns.orgId, orgId)));
      if (!r) throw notFound('Escaleta no encontrada');
      if (!programId) programId = r.programId;
    }
    return programId === undefined ? {} : { programId };
  }

  async function eventDetail(tx: Tx, orgId: string, id: string): Promise<ProductionEventDetail> {
    const [event] = await loadEvents(
      tx,
      and(eq(productionEvents.id, id), eq(productionEvents.orgId, orgId)),
    );
    if (!event) throw notFound('Convocatoria no encontrada');
    const calls = await tx
      .select({ c: eventCalls, crew: crewMembers })
      .from(eventCalls)
      .innerJoin(crewMembers, eq(crewMembers.id, eventCalls.crewId))
      .where(eq(eventCalls.eventId, id))
      .orderBy(asc(eventCalls.callAt), asc(crewMembers.name));
    const gs = await tx
      .select()
      .from(guests)
      .where(eq(guests.eventId, id))
      .orderBy(asc(guests.arrivalAt), asc(guests.name));
    const ls = await tx
      .select()
      .from(logisticsItems)
      .where(eq(logisticsItems.eventId, id))
      .orderBy(asc(logisticsItems.at), asc(logisticsItems.createdAt));
    return {
      event,
      calls: calls.map(
        ({ c, crew }): CallDto => ({
          id: c.id,
          crewId: c.crewId,
          name: crew.name,
          phone: crew.phone,
          email: crew.email,
          role: c.role,
          callAt: iso(c.callAt),
          status: c.status as CallStatus,
          reply: c.reply,
          respondedAt: iso(c.respondedAt),
          token: c.token,
        }),
      ),
      guests: gs.map(guestDto),
      logistics: ls.map(logisticsDto),
    };
  }

  /* ---------- Convocatorias (calendario) ---------- */

  app.get('/api/production/events', { preHandler: view }, async (req) => {
    const q = parse(productionEventsQuery, req.query);
    const t = req.tenant!;
    const events = await withTenant(deps.db, t, (tx) =>
      loadEvents(
        tx,
        and(
          eq(productionEvents.orgId, t.orgId),
          q.from ? gte(productionEvents.startsAt, new Date(q.from)) : undefined,
          q.to ? lt(productionEvents.startsAt, new Date(q.to)) : undefined,
        ),
      ),
    );
    return { events };
  });

  app.get('/api/production/events/:id', { preHandler: view }, async (req) => {
    const { id } = parse(idParams, req.params);
    const t = req.tenant!;
    return withTenant(deps.db, t, (tx) => eventDetail(tx, t.orgId, id));
  });

  app.post('/api/production/events', { preHandler: manage }, async (req, reply) => {
    const input = parse(productionEventInput, req.body);
    const t = req.tenant!;
    const detail = await withTenant(deps.db, t, async (tx) => {
      const links = await checkLinks(tx, t.orgId, input);
      const [row] = await tx
        .insert(productionEvents)
        .values({
          orgId: t.orgId,
          ...input,
          ...links,
          startsAt: new Date(input.startsAt),
          endsAt: toDate(input.endsAt),
          createdBy: t.userId,
        })
        .returning();
      await audit(tx, {
        orgId: t.orgId,
        userId: t.userId,
        action: 'production.event.create',
        targetType: 'production_event',
        targetId: row!.id,
      });
      return eventDetail(tx, t.orgId, row!.id);
    });
    reply.status(201);
    return detail;
  });

  app.patch('/api/production/events/:id', { preHandler: manage }, async (req) => {
    const { id } = parse(idParams, req.params);
    const input = parse(productionEventPatch, req.body);
    const t = req.tenant!;
    return withTenant(deps.db, t, async (tx) => {
      const links = await checkLinks(tx, t.orgId, input);
      const [current] = await tx
        .select()
        .from(productionEvents)
        .where(and(eq(productionEvents.id, id), eq(productionEvents.orgId, t.orgId)));
      if (!current) throw notFound('Convocatoria no encontrada');
      const startsAt = input.startsAt ? new Date(input.startsAt) : current.startsAt;
      const endsAt = input.endsAt === undefined ? current.endsAt : toDate(input.endsAt);
      if (endsAt && endsAt < startsAt)
        throw new HttpError(400, 'bad_range', 'El fin no puede ser anterior al inicio');
      await tx
        .update(productionEvents)
        .set({ ...input, ...links, startsAt, endsAt, updatedAt: new Date() })
        .where(eq(productionEvents.id, id));
      return eventDetail(tx, t.orgId, id);
    });
  });

  app.delete('/api/production/events/:id', { preHandler: manage }, async (req) => {
    const { id } = parse(idParams, req.params);
    const t = req.tenant!;
    await withTenant(deps.db, t, async (tx) => {
      const rows = await tx
        .delete(productionEvents)
        .where(and(eq(productionEvents.id, id), eq(productionEvents.orgId, t.orgId)))
        .returning({ id: productionEvents.id });
      if (!rows[0]) throw notFound('Convocatoria no encontrada');
      await audit(tx, {
        orgId: t.orgId,
        userId: t.userId,
        action: 'production.event.delete',
        targetType: 'production_event',
        targetId: id,
      });
    });
    return { ok: true };
  });

  /** Duplicar (p. ej. el mismo directo la semana siguiente) con equipo y logística. */
  app.post('/api/production/events/:id/duplicate', { preHandler: manage }, async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const { startsAt } = parse(z.object({ startsAt: z.iso.datetime({ offset: true }) }), req.body);
    const t = req.tenant!;
    const detail = await withTenant(deps.db, t, async (tx) => {
      const [src] = await tx
        .select()
        .from(productionEvents)
        .where(and(eq(productionEvents.id, id), eq(productionEvents.orgId, t.orgId)));
      if (!src) throw notFound('Convocatoria no encontrada');
      const shift = new Date(startsAt).getTime() - src.startsAt.getTime();
      const move = (d: Date | null) => (d ? new Date(d.getTime() + shift) : null);
      const [copy] = await tx
        .insert(productionEvents)
        .values({
          orgId: t.orgId,
          programId: src.programId,
          title: src.title,
          kind: src.kind,
          status: 'previsto',
          startsAt: new Date(startsAt),
          endsAt: move(src.endsAt),
          location: src.location,
          notes: src.notes,
          createdBy: t.userId,
        })
        .returning();
      const calls = await tx.select().from(eventCalls).where(eq(eventCalls.eventId, id));
      if (calls.length)
        await tx.insert(eventCalls).values(
          calls.map((c) => ({
            orgId: t.orgId,
            eventId: copy!.id,
            crewId: c.crewId,
            role: c.role,
            callAt: move(c.callAt),
            token: newToken(),
          })),
        );
      const ls = await tx.select().from(logisticsItems).where(eq(logisticsItems.eventId, id));
      if (ls.length)
        await tx.insert(logisticsItems).values(
          ls.map((l) => ({
            orgId: t.orgId,
            eventId: copy!.id,
            category: l.category,
            description: l.description,
            provider: l.provider,
            at: move(l.at),
            assignee: l.assignee,
            notes: l.notes,
          })),
        );
      return eventDetail(tx, t.orgId, copy!.id);
    });
    reply.status(201);
    return detail;
  });

  /* ---------- Personal ---------- */

  app.get('/api/production/crew', { preHandler: view }, async (req) => {
    const t = req.tenant!;
    const rows = await withTenant(deps.db, t, (tx) =>
      tx
        .select()
        .from(crewMembers)
        .where(eq(crewMembers.orgId, t.orgId))
        .orderBy(asc(crewMembers.name)),
    );
    return { crew: rows.map(crewDto) };
  });

  app.post('/api/production/crew', { preHandler: manage }, async (req, reply) => {
    const input = parse(crewInput, req.body);
    const t = req.tenant!;
    const [row] = await withTenant(deps.db, t, (tx) =>
      tx
        .insert(crewMembers)
        .values({ orgId: t.orgId, ...input })
        .returning(),
    );
    reply.status(201);
    return { crew: crewDto(row!) };
  });

  app.patch('/api/production/crew/:id', { preHandler: manage }, async (req) => {
    const { id } = parse(idParams, req.params);
    const input = parse(crewPatch, req.body);
    const t = req.tenant!;
    const [row] = await withTenant(deps.db, t, (tx) =>
      tx
        .update(crewMembers)
        .set(input)
        .where(and(eq(crewMembers.id, id), eq(crewMembers.orgId, t.orgId)))
        .returning(),
    );
    if (!row) throw notFound('Persona no encontrada');
    return { crew: crewDto(row) };
  });

  app.delete('/api/production/crew/:id', { preHandler: manage }, async (req) => {
    const { id } = parse(idParams, req.params);
    const t = req.tenant!;
    const rows = await withTenant(deps.db, t, (tx) =>
      tx
        .delete(crewMembers)
        .where(and(eq(crewMembers.id, id), eq(crewMembers.orgId, t.orgId)))
        .returning({ id: crewMembers.id }),
    );
    if (!rows[0]) throw notFound('Persona no encontrada');
    return { ok: true };
  });

  /* ---------- Hoja de llamada ---------- */

  app.post('/api/production/events/:id/calls', { preHandler: manage }, async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const input = parse(callInput, req.body);
    const t = req.tenant!;
    const detail = await withTenant(deps.db, t, async (tx) => {
      const [event] = await tx
        .select({ id: productionEvents.id })
        .from(productionEvents)
        .where(and(eq(productionEvents.id, id), eq(productionEvents.orgId, t.orgId)));
      if (!event) throw notFound('Convocatoria no encontrada');
      const [crew] = await tx
        .select()
        .from(crewMembers)
        .where(and(eq(crewMembers.id, input.crewId), eq(crewMembers.orgId, t.orgId)));
      if (!crew) throw notFound('Persona no encontrada');
      const inserted = await tx
        .insert(eventCalls)
        .values({
          orgId: t.orgId,
          eventId: id,
          crewId: crew.id,
          role: input.role ?? crew.role,
          callAt: toDate(input.callAt),
          token: newToken(),
        })
        .onConflictDoNothing()
        .returning({ id: eventCalls.id });
      if (!inserted[0])
        throw new HttpError(409, 'already_called', `${crew.name} ya está en esta convocatoria`);
      return eventDetail(tx, t.orgId, id);
    });
    reply.status(201);
    return detail;
  });

  app.patch('/api/production/calls/:id', { preHandler: manage }, async (req) => {
    const { id } = parse(idParams, req.params);
    const input = parse(callPatch, req.body);
    const t = req.tenant!;
    return withTenant(deps.db, t, async (tx) => {
      const [row] = await tx
        .update(eventCalls)
        .set({
          ...input,
          callAt: toDate(input.callAt),
          ...(input.status
            ? { respondedAt: input.status === 'pendiente' ? null : new Date() }
            : {}),
        })
        .where(and(eq(eventCalls.id, id), eq(eventCalls.orgId, t.orgId)))
        .returning({ eventId: eventCalls.eventId });
      if (!row) throw notFound('Convocado no encontrado');
      return eventDetail(tx, t.orgId, row.eventId);
    });
  });

  /** Nuevo enlace de confirmación (el anterior deja de valer). */
  app.post('/api/production/calls/:id/token', { preHandler: manage }, async (req) => {
    const { id } = parse(idParams, req.params);
    const t = req.tenant!;
    return withTenant(deps.db, t, async (tx) => {
      const [row] = await tx
        .update(eventCalls)
        .set({ token: newToken() })
        .where(and(eq(eventCalls.id, id), eq(eventCalls.orgId, t.orgId)))
        .returning({ eventId: eventCalls.eventId });
      if (!row) throw notFound('Convocado no encontrado');
      return eventDetail(tx, t.orgId, row.eventId);
    });
  });

  app.delete('/api/production/calls/:id', { preHandler: manage }, async (req) => {
    const { id } = parse(idParams, req.params);
    const t = req.tenant!;
    return withTenant(deps.db, t, async (tx) => {
      const [row] = await tx
        .delete(eventCalls)
        .where(and(eq(eventCalls.id, id), eq(eventCalls.orgId, t.orgId)))
        .returning({ eventId: eventCalls.eventId });
      if (!row) throw notFound('Convocado no encontrado');
      return eventDetail(tx, t.orgId, row.eventId);
    });
  });

  /* ---------- Invitados y logística ---------- */

  const children = [
    {
      path: 'guests',
      table: guests,
      input: guestInput,
      patch: guestPatch,
      dates: ['arrivalAt', 'makeupAt', 'setAt'] as const,
      missing: 'Invitado no encontrado',
    },
    {
      path: 'logistics',
      table: logisticsItems,
      input: logisticsInput,
      patch: logisticsPatch,
      dates: ['at'] as const,
      missing: 'Elemento no encontrado',
    },
  ] as const;

  for (const c of children) {
    const withDates = (v: Record<string, unknown>) => {
      const out = { ...v };
      for (const k of c.dates) if (k in out) out[k] = toDate(out[k] as string | null);
      return out;
    };

    app.post(`/api/production/events/:id/${c.path}`, { preHandler: manage }, async (req, reply) => {
      const { id } = parse(idParams, req.params);
      const input = parse(c.input as z.ZodType<Record<string, unknown>>, req.body);
      const t = req.tenant!;
      const detail = await withTenant(deps.db, t, async (tx) => {
        const [event] = await tx
          .select({ id: productionEvents.id })
          .from(productionEvents)
          .where(and(eq(productionEvents.id, id), eq(productionEvents.orgId, t.orgId)));
        if (!event) throw notFound('Convocatoria no encontrada');
        await tx
          .insert(c.table)
          .values({ orgId: t.orgId, eventId: id, ...withDates(input) } as never);
        return eventDetail(tx, t.orgId, id);
      });
      reply.status(201);
      return detail;
    });

    app.patch(`/api/production/${c.path}/:id`, { preHandler: manage }, async (req) => {
      const { id } = parse(idParams, req.params);
      const input = parse(c.patch as z.ZodType<Record<string, unknown>>, req.body);
      const t = req.tenant!;
      return withTenant(deps.db, t, async (tx) => {
        const [row] = await tx
          .update(c.table)
          .set(withDates(input) as never)
          .where(and(eq(c.table.id, id), eq(c.table.orgId, t.orgId)))
          .returning({ eventId: c.table.eventId });
        if (!row) throw notFound(c.missing);
        return eventDetail(tx, t.orgId, row.eventId);
      });
    });

    app.delete(`/api/production/${c.path}/:id`, { preHandler: manage }, async (req) => {
      const { id } = parse(idParams, req.params);
      const t = req.tenant!;
      return withTenant(deps.db, t, async (tx) => {
        const [row] = await tx
          .delete(c.table)
          .where(and(eq(c.table.id, id), eq(c.table.orgId, t.orgId)))
          .returning({ eventId: c.table.eventId });
        if (!row) throw notFound(c.missing);
        return eventDetail(tx, t.orgId, row.eventId);
      });
    });
  }

  /* ---------- Enlace de confirmación (sin cuenta) ---------- */

  async function findCall(token: string) {
    const [row] = await withSystem(deps.db, (tx) =>
      tx
        .select({
          call: eventCalls,
          crew: crewMembers,
          event: productionEvents,
          orgName: organizations.name,
          timezone: organizations.timezone,
        })
        .from(eventCalls)
        .innerJoin(crewMembers, eq(crewMembers.id, eventCalls.crewId))
        .innerJoin(productionEvents, eq(productionEvents.id, eventCalls.eventId))
        .innerJoin(organizations, eq(organizations.id, eventCalls.orgId))
        .where(eq(eventCalls.token, token))
        .limit(1),
    );
    if (!row) throw notFound('Este enlace ya no es válido');
    return row;
  }

  const publicDto = (row: Awaited<ReturnType<typeof findCall>>): PublicCallDto => ({
    orgName: row.orgName,
    timezone: row.timezone,
    event: {
      title: row.event.title,
      kind: row.event.kind as EventKind,
      startsAt: row.event.startsAt.toISOString(),
      endsAt: iso(row.event.endsAt),
      location: row.event.location,
      notes: row.event.notes,
    },
    name: row.crew.name,
    role: row.call.role,
    callAt: iso(row.call.callAt),
    status: row.call.status as CallStatus,
    reply: row.call.reply,
  });

  app.get('/api/public/call/:token', async (req) => {
    const { token } = parse(tokenParams, req.params);
    return { call: publicDto(await findCall(token)) };
  });

  app.post('/api/public/call/:token', async (req) => {
    const { token } = parse(tokenParams, req.params);
    const input = parse(callReply, req.body);
    const row = await findCall(token);
    if (row.event.status === 'cancelado')
      throw new HttpError(409, 'cancelled', 'Esta convocatoria se ha cancelado');
    await withSystem(deps.db, async (tx) => {
      await tx
        .update(eventCalls)
        .set({ status: input.status, reply: input.reply, respondedAt: new Date() })
        .where(eq(eventCalls.id, row.call.id));
      await audit(tx, {
        orgId: row.call.orgId,
        userId: null,
        action: `production.call.${input.status}`,
        targetType: 'event_call',
        targetId: row.call.id,
      });
    });
    return { call: publicDto(await findCall(token)) };
  });
}
