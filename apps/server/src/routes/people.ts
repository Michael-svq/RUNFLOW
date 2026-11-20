import { and, asc, eq, ilike, or } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { listPeopleQuery, personInput, type PersonDto } from '@runflow/core';
import { people, withTenant } from '@runflow/db';
import { badRequest, forbidden, notFound, parse, pgErrorCode } from '../errors';
import { requireOrg, requirePermission } from '../auth/guards';
import type { AppDeps } from '../app';

const idParams = z.object({ id: z.uuid() });

function toDto(p: typeof people.$inferSelect): PersonDto {
  return { id: p.id, name: p.name, title: p.title, notes: p.notes };
}

async function duplicate<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (pgErrorCode(err) === '23505') {
      throw badRequest('validation', 'Revisa los datos del formulario', {
        name: 'Esa persona con ese cargo ya existe',
      });
    }
    throw err;
  }
}

/** Base de datos de personas y cargos (para rótulos TOT e INF). */
export async function peopleRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const view = requirePermission(deps.db, 'rundown.view');
  const org = requireOrg(deps.db);
  // Pueden mantenerla quienes escriben guiones.
  const edit = async (req: FastifyRequest, reply: FastifyReply) => {
    await org(req, reply);
    const p = req.tenant!.permissions;
    if (!p.includes('script.edit_own') && !p.includes('script.edit_any')) throw forbidden();
  };

  app.get('/api/people', { preHandler: view }, async (req) => {
    const { q } = parse(listPeopleQuery, req.query);
    const t = req.tenant!;
    const rows = await withTenant(deps.db, t, (tx) => {
      const like = q ? `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
      return tx
        .select()
        .from(people)
        .where(
          and(
            eq(people.orgId, t.orgId),
            like ? or(ilike(people.name, like), ilike(people.title, like)) : undefined,
          ),
        )
        .orderBy(asc(people.name))
        .limit(q ? 20 : 500);
    });
    return { people: rows.map(toDto) };
  });

  app.post('/api/people', { preHandler: edit }, async (req, reply) => {
    const input = parse(personInput, req.body);
    const t = req.tenant!;
    const [row] = await duplicate(() =>
      withTenant(deps.db, t, (tx) =>
        tx
          .insert(people)
          .values({ orgId: t.orgId, ...input })
          .returning(),
      ),
    );
    reply.status(201);
    return { person: toDto(row!) };
  });

  app.patch('/api/people/:id', { preHandler: edit }, async (req) => {
    const { id } = parse(idParams, req.params);
    const input = parse(personInput, req.body);
    const t = req.tenant!;
    const [row] = await duplicate(() =>
      withTenant(deps.db, t, (tx) =>
        tx
          .update(people)
          .set({ ...input, updatedAt: new Date() })
          .where(and(eq(people.id, id), eq(people.orgId, t.orgId)))
          .returning(),
      ),
    );
    if (!row) throw notFound('Persona no encontrada');
    return { person: toDto(row) };
  });

  app.delete('/api/people/:id', { preHandler: edit }, async (req) => {
    const { id } = parse(idParams, req.params);
    const t = req.tenant!;
    const rows = await withTenant(deps.db, t, (tx) =>
      tx
        .delete(people)
        .where(and(eq(people.id, id), eq(people.orgId, t.orgId)))
        .returning({ id: people.id }),
    );
    if (!rows.length) throw notFound('Persona no encontrada');
    return { ok: true };
  });
}
