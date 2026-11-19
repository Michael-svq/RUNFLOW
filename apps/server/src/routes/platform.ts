import { asc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { createOrgInput, type PlatformOrgDto } from '@runflow/core';
import { memberships, organizations, withSystem } from '@runflow/db';
import { parse } from '../errors';
import { requirePlatformAdmin } from '../auth/guards';
import { createOrganizationWithAdmin } from '../services/orgs';
import type { AppDeps } from '../app';

/** Administración de la plataforma (operador del SaaS): alta de empresas. */
export async function platformRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const guard = requirePlatformAdmin();

  app.get('/api/platform/orgs', { preHandler: guard }, async () => {
    const rows = await withSystem(deps.db, (tx) =>
      tx
        .select({
          id: organizations.id,
          name: organizations.name,
          slug: organizations.slug,
          plan: organizations.plan,
          mode: organizations.mode,
          createdAt: organizations.createdAt,
          members: sql<number>`count(${memberships.id})::int`,
        })
        .from(organizations)
        .leftJoin(memberships, eq(memberships.orgId, organizations.id))
        .groupBy(organizations.id)
        .orderBy(asc(organizations.name)),
    );
    const orgs: PlatformOrgDto[] = rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
    }));
    return { organizations: orgs };
  });

  app.post('/api/platform/orgs', { preHandler: guard }, async (req, reply) => {
    const input = parse(createOrgInput, req.body);
    const result = await withSystem(deps.db, (tx) =>
      createOrganizationWithAdmin(tx, {
        orgName: input.orgName,
        adminName: input.adminName,
        adminEmail: input.adminEmail,
        adminPassword: input.adminPassword,
        mustChangePassword: true,
        actorUserId: req.auth!.userId,
      }),
    );
    reply.status(201);
    return result;
  });
}
