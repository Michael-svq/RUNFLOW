import { and, asc, desc, eq, ilike, or } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { sourceInput, sourceItemsQuery, type SourceDto, type SourceItemDto } from '@runflow/core';
import { fridgeItems, sourceItems, sources, withTenant } from '@runflow/db';
import { forbidden, notFound, parse } from '../errors';
import { requireOrg, requirePermission } from '../auth/guards';
import { audit } from '../services/audit';
import { refreshSource } from '../sources/poller';
import type { AppDeps } from '../app';

const idParams = z.object({ id: z.uuid() });

const toDto = (r: typeof sources.$inferSelect): SourceDto => ({
  id: r.id,
  name: r.name,
  url: r.url,
  enabled: r.enabled,
  lastFetchedAt: r.lastFetchedAt?.toISOString() ?? null,
  lastError: r.lastError,
});

/** F2.2 Fuentes: RSS/Atom de agencias y medios, a la nevera o a una línea. */
export async function sourceRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const configure = requirePermission(deps.db, 'program.configure');
  const view = requirePermission(deps.db, 'rundown.view');
  const org = requireOrg(deps.db);
  const writer = async (req: FastifyRequest, reply: FastifyReply) => {
    await org(req, reply);
    const p = req.tenant!.permissions;
    if (
      !['templates.manage', 'rundown.edit_structure', 'script.edit_own', 'script.edit_any'].some(
        (x) => p.includes(x as never),
      )
    )
      throw forbidden();
  };
  // En la nube no se leen direcciones internas; en una Station sí.
  const allowPrivate = deps.config.sourcesAllowPrivate || deps.config.env === 'test';

  app.get('/api/sources', { preHandler: view }, async (req) => {
    const t = req.tenant!;
    const rows = await withTenant(deps.db, t, (tx) =>
      tx.select().from(sources).where(eq(sources.orgId, t.orgId)).orderBy(asc(sources.name)),
    );
    return { sources: rows.map(toDto) };
  });

  app.post('/api/sources', { preHandler: configure }, async (req, reply) => {
    const input = parse(sourceInput, req.body);
    const t = req.tenant!;
    const [row] = await withTenant(deps.db, t, async (tx) => {
      const created = await tx
        .insert(sources)
        .values({ orgId: t.orgId, ...input })
        .returning();
      await audit(tx, {
        orgId: t.orgId,
        userId: t.userId,
        action: 'source.create',
        targetType: 'source',
        targetId: created[0]!.id,
      });
      return created;
    });
    // Primera lectura al darla de alta (para ver si funciona).
    const result = await refreshSource(deps.db, row!, { allowPrivate });
    reply.status(201);
    const [fresh] = await withTenant(deps.db, t, (tx) =>
      tx.select().from(sources).where(eq(sources.id, row!.id)),
    );
    return { source: toDto(fresh!), added: result.added };
  });

  app.patch('/api/sources/:id', { preHandler: configure }, async (req) => {
    const { id } = parse(idParams, req.params);
    const input = parse(sourceInput, req.body);
    const t = req.tenant!;
    const rows = await withTenant(deps.db, t, (tx) =>
      tx
        .update(sources)
        .set({ ...input, updatedAt: new Date() })
        .where(and(eq(sources.id, id), eq(sources.orgId, t.orgId)))
        .returning(),
    );
    if (!rows[0]) throw notFound('Fuente no encontrada');
    return { source: toDto(rows[0]) };
  });

  app.delete('/api/sources/:id', { preHandler: configure }, async (req) => {
    const { id } = parse(idParams, req.params);
    const t = req.tenant!;
    const rows = await withTenant(deps.db, t, (tx) =>
      tx
        .delete(sources)
        .where(and(eq(sources.id, id), eq(sources.orgId, t.orgId)))
        .returning({ id: sources.id }),
    );
    if (!rows.length) throw notFound('Fuente no encontrada');
    return { ok: true };
  });

  app.post('/api/sources/:id/refresh', { preHandler: view }, async (req) => {
    const { id } = parse(idParams, req.params);
    const t = req.tenant!;
    const [row] = await withTenant(deps.db, t, (tx) =>
      tx
        .select()
        .from(sources)
        .where(and(eq(sources.id, id), eq(sources.orgId, t.orgId))),
    );
    if (!row) throw notFound('Fuente no encontrada');
    return refreshSource(deps.db, row, { allowPrivate });
  });

  app.get('/api/source-items', { preHandler: view }, async (req) => {
    const q = parse(sourceItemsQuery, req.query);
    const t = req.tenant!;
    const rows = await withTenant(deps.db, t, (tx) =>
      tx
        .select({
          id: sourceItems.id,
          sourceId: sourceItems.sourceId,
          sourceName: sources.name,
          title: sourceItems.title,
          summary: sourceItems.summary,
          link: sourceItems.link,
          publishedAt: sourceItems.publishedAt,
        })
        .from(sourceItems)
        .innerJoin(sources, eq(sources.id, sourceItems.sourceId))
        .where(
          and(
            eq(sourceItems.orgId, t.orgId),
            q.sourceId ? eq(sourceItems.sourceId, q.sourceId) : undefined,
            q.q
              ? or(
                  ilike(sourceItems.title, `%${q.q.replace(/[%_\\]/g, '\\$&')}%`),
                  ilike(sourceItems.summary, `%${q.q.replace(/[%_\\]/g, '\\$&')}%`),
                )
              : undefined,
          ),
        )
        .orderBy(desc(sourceItems.publishedAt), desc(sourceItems.createdAt))
        .limit(q.limit),
    );
    const items: SourceItemDto[] = rows.map((r) => ({
      ...r,
      publishedAt: r.publishedAt?.toISOString() ?? null,
    }));
    return { items };
  });

  /** Lleva una noticia a la nevera: una línea TEMA con la noticia en una nota del guion. */
  app.post('/api/source-items/:id/fridge', { preHandler: writer }, async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const t = req.tenant!;
    const item = await withTenant(deps.db, t, async (tx) => {
      const [it] = await tx
        .select({ title: sourceItems.title, summary: sourceItems.summary, link: sourceItems.link })
        .from(sourceItems)
        .where(and(eq(sourceItems.id, id), eq(sourceItems.orgId, t.orgId)));
      if (!it) throw notFound('Noticia no encontrada');
      const [created] = await tx
        .insert(fridgeItems)
        .values({
          orgId: t.orgId,
          name: it.title.slice(0, 120),
          cells: { tipo: 'TEMA', nombre: it.title.slice(0, 120).toUpperCase() },
          script: [{ kind: 'nota', text: [it.summary, it.link].filter(Boolean).join('\n') }],
          createdBy: t.userId,
        })
        .returning({ id: fridgeItems.id });
      return created!;
    });
    reply.status(201);
    return { fridgeItemId: item.id };
  });
}
