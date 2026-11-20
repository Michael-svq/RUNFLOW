import { and, asc, eq, gte, lte } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  budgetCsv,
  budgetLineInput,
  budgetLinePatch,
  budgetQuery,
  summarizeBudget,
  type BudgetCategory,
  type BudgetLineDto,
  type BudgetQuery,
} from '@runflow/core';
import { budgetLines, productionEvents, programs, withTenant, type Tx } from '@runflow/db';
import { notFound, parse } from '../errors';
import { requirePermission } from '../auth/guards';
import { audit } from '../services/audit';
import type { AppDeps } from '../app';

/* F3.2 Presupuesto: partidas, previsto frente a real, resumen y exportación CSV. */

const idParams = z.object({ id: z.uuid() });

async function loadLines(
  tx: Tx,
  orgId: string,
  q: BudgetQuery,
  id?: string,
): Promise<BudgetLineDto[]> {
  const rows = await tx
    .select({ l: budgetLines, programName: programs.name, eventTitle: productionEvents.title })
    .from(budgetLines)
    .leftJoin(programs, eq(programs.id, budgetLines.programId))
    .leftJoin(productionEvents, eq(productionEvents.id, budgetLines.eventId))
    .where(
      and(
        eq(budgetLines.orgId, orgId),
        id ? eq(budgetLines.id, id) : undefined,
        q.programId ? eq(budgetLines.programId, q.programId) : undefined,
        q.eventId ? eq(budgetLines.eventId, q.eventId) : undefined,
        q.from ? gte(budgetLines.date, q.from) : undefined,
        q.to ? lte(budgetLines.date, q.to) : undefined,
      ),
    )
    .orderBy(asc(budgetLines.date), asc(budgetLines.category), asc(budgetLines.createdAt))
    .limit(5000);
  return rows.map(({ l, programName, eventTitle }) => ({
    id: l.id,
    category: l.category as BudgetCategory,
    concept: l.concept,
    provider: l.provider,
    plannedCents: l.plannedCents,
    actualCents: l.actualCents,
    date: l.date,
    invoice: l.invoice,
    paid: l.paid,
    notes: l.notes,
    programId: l.programId,
    programName: programName ?? null,
    eventId: l.eventId,
    eventTitle: eventTitle ?? null,
  }));
}

export async function budgetRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const view = requirePermission(deps.db, 'budget.view');
  const manage = requirePermission(deps.db, 'budget.manage');

  /** Programa y convocatoria de la empresa; la convocatoria aporta su programa y fecha. */
  async function links(
    tx: Tx,
    orgId: string,
    input: { programId?: string | null; eventId?: string | null; date?: string | null },
  ) {
    const out: { programId?: string | null; date?: string | null } = {};
    if (input.programId) {
      const [p] = await tx
        .select({ id: programs.id })
        .from(programs)
        .where(and(eq(programs.id, input.programId), eq(programs.orgId, orgId)));
      if (!p) throw notFound('Programa no encontrado');
    }
    if (input.eventId) {
      const [e] = await tx
        .select()
        .from(productionEvents)
        .where(and(eq(productionEvents.id, input.eventId), eq(productionEvents.orgId, orgId)));
      if (!e) throw notFound('Convocatoria no encontrada');
      if (!input.programId && e.programId) out.programId = e.programId;
      if (!input.date) out.date = e.startsAt.toISOString().slice(0, 10);
    }
    return out;
  }

  app.get('/api/budget/lines', { preHandler: view }, async (req) => {
    const q = parse(budgetQuery, req.query);
    const t = req.tenant!;
    const lines = await withTenant(deps.db, t, (tx) => loadLines(tx, t.orgId, q));
    return { lines, summary: summarizeBudget(lines) };
  });

  app.get('/api/budget/export.csv', { preHandler: view }, async (req, reply) => {
    const q = parse(budgetQuery, req.query);
    const t = req.tenant!;
    const lines = await withTenant(deps.db, t, (tx) => loadLines(tx, t.orgId, q));
    return reply
      .type('text/csv; charset=utf-8')
      .header(
        'content-disposition',
        `attachment; filename="presupuesto-${new Date().toISOString().slice(0, 10)}.csv"`,
      )
      .send(budgetCsv(lines));
  });

  app.post('/api/budget/lines', { preHandler: manage }, async (req, reply) => {
    const input = parse(budgetLineInput, req.body);
    const t = req.tenant!;
    const line = await withTenant(deps.db, t, async (tx) => {
      const extra = await links(tx, t.orgId, input);
      const [row] = await tx
        .insert(budgetLines)
        .values({ orgId: t.orgId, ...input, ...extra, createdBy: t.userId })
        .returning({ id: budgetLines.id });
      await audit(tx, {
        orgId: t.orgId,
        userId: t.userId,
        action: 'budget.line.create',
        targetType: 'budget_line',
        targetId: row!.id,
      });
      return (await loadLines(tx, t.orgId, {}, row!.id))[0]!;
    });
    reply.status(201);
    return { line };
  });

  app.patch('/api/budget/lines/:id', { preHandler: manage }, async (req) => {
    const { id } = parse(idParams, req.params);
    const input = parse(budgetLinePatch, req.body);
    const t = req.tenant!;
    const line = await withTenant(deps.db, t, async (tx) => {
      // En una edición no se cambia la fecha por la de la convocatoria.
      const extra = await links(tx, t.orgId, { ...input, date: 'keep' });
      const rows = await tx
        .update(budgetLines)
        .set({ ...input, ...extra, updatedAt: new Date() })
        .where(and(eq(budgetLines.id, id), eq(budgetLines.orgId, t.orgId)))
        .returning({ id: budgetLines.id });
      if (!rows[0]) throw notFound('Partida no encontrada');
      return (await loadLines(tx, t.orgId, {}, id))[0]!;
    });
    return { line };
  });

  app.delete('/api/budget/lines/:id', { preHandler: manage }, async (req) => {
    const { id } = parse(idParams, req.params);
    const t = req.tenant!;
    await withTenant(deps.db, t, async (tx) => {
      const rows = await tx
        .delete(budgetLines)
        .where(and(eq(budgetLines.id, id), eq(budgetLines.orgId, t.orgId)))
        .returning({ id: budgetLines.id });
      if (!rows[0]) throw notFound('Partida no encontrada');
      await audit(tx, {
        orgId: t.orgId,
        userId: t.userId,
        action: 'budget.line.delete',
        targetType: 'budget_line',
        targetId: id,
      });
    });
    return { ok: true };
  });
}
