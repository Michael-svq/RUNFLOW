import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { asrunLog, withTenant } from '@runflow/db';
import { parse } from '../errors';
import { requirePermission } from '../auth/guards';
import { requireRundown } from '../services/rundowns';
import type { AppDeps } from '../app';

const idParams = z.object({ id: z.uuid() });
const goInput = z.object({ expectedOnAir: z.string().max(64).nullable().optional() });
const nextInput = z.object({ lineId: z.string().max(64).nullable() });
const settingsInput = z
  .object({
    mode: z.enum(['manual', 'automatico', 'hibrido', 'evento']),
    armed: z.boolean(),
    rehearsal: z.boolean(),
    autonextAt: z.enum(['duration', 'coleo']),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nada que actualizar');

/** Directo: GO, siguiente, volver, terminar, modo… y registro de emisión. */
export async function liveRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const view = requirePermission(deps.db, 'rundown.view');
  const go = requirePermission(deps.db, 'live.go');
  const live = () => deps.live!;
  const actor = (req: { tenant: { orgId: string; userId: string } | null }) => ({
    orgId: req.tenant!.orgId,
    userId: req.tenant!.userId,
  });

  // Hora del servidor, para que todos los relojes marquen lo mismo.
  app.get('/api/time', async () => ({ now: Date.now() }));

  app.get('/api/rundowns/:id/live', { preHandler: view }, async (req) => {
    const { id } = parse(idParams, req.params);
    return { live: await live().get(actor(req), id) };
  });

  app.post('/api/rundowns/:id/live/go', { preHandler: go }, async (req) => {
    const { id } = parse(idParams, req.params);
    const { expectedOnAir } = parse(goInput, req.body);
    return { live: await live().go(actor(req), id, { expectedOnAir, trigger: 'go' }) };
  });

  app.post('/api/rundowns/:id/live/back', { preHandler: go }, async (req) => {
    const { id } = parse(idParams, req.params);
    return { live: await live().back(actor(req), id) };
  });

  app.post('/api/rundowns/:id/live/next', { preHandler: go }, async (req) => {
    const { id } = parse(idParams, req.params);
    const { lineId } = parse(nextInput, req.body);
    return { live: await live().setNext(actor(req), id, lineId) };
  });

  app.post('/api/rundowns/:id/live/stop', { preHandler: go }, async (req) => {
    const { id } = parse(idParams, req.params);
    return { live: await live().stop(actor(req), id) };
  });

  app.post('/api/rundowns/:id/live/reset', { preHandler: go }, async (req) => {
    const { id } = parse(idParams, req.params);
    return { live: await live().reset(actor(req), id) };
  });

  app.patch('/api/rundowns/:id/live', { preHandler: go }, async (req) => {
    const { id } = parse(idParams, req.params);
    const input = parse(settingsInput, req.body);
    return { live: await live().settings(actor(req), id, input) };
  });

  app.get('/api/rundowns/:id/asrun', { preHandler: view }, async (req) => {
    const { id } = parse(idParams, req.params);
    const t = req.tenant!;
    const entries = await withTenant(deps.db, t, async (tx) => {
      await requireRundown(tx, t.orgId, id);
      return tx
        .select()
        .from(asrunLog)
        .where(eq(asrunLog.rundownId, id))
        .orderBy(asc(asrunLog.startedAt));
    });
    return {
      entries: entries.map((e) => ({
        id: e.id,
        lineId: e.lineId,
        num: e.num,
        name: e.name,
        type: e.type,
        startedAt: e.startedAt.toISOString(),
        endedAt: e.endedAt?.toISOString() ?? null,
        durationS: e.durationS,
        rehearsal: e.rehearsal,
        trigger: e.trigger,
      })),
    };
  });
}
