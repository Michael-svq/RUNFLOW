import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { setupInput, type SetupStatusResponse } from '@runflow/core';
import { users, withSystem } from '@runflow/db';
import { conflict, parse } from '../errors';
import { createOrganizationWithAdmin } from '../services/orgs';
import type { AppDeps } from '../app';
import { startSession } from './auth';

async function needsSetup(deps: AppDeps): Promise<boolean> {
  // Una Station enlazada con la nube recibe empresa y usuarios de la nube.
  if (deps.stationSync) return false;
  const [row] = await withSystem(deps.db, (tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(users),
  );
  return (row?.count ?? 0) === 0;
}

export async function systemRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  app.get('/api/health', async () => {
    await deps.db.execute(sql`select 1`);
    return { ok: true, mode: deps.config.mode, version: deps.version };
  });

  app.get('/api/setup/status', async (): Promise<SetupStatusResponse> => {
    return { needsSetup: await needsSetup(deps) };
  });

  /**
   * Primera configuración (instalación nueva o Station): crea la primera
   * empresa y su administrador, que también administra la plataforma.
   */
  app.post(
    '/api/setup',
    { config: { rateLimit: { max: deps.config.authRateLimit, timeWindow: '1 minute' } } },
    async (req, reply) => {
      if (deps.stationSync)
        throw conflict('station_linked', 'Esta Station está enlazada con la nube');
      const input = parse(setupInput, req.body);
      const result = await withSystem(deps.db, async (tx) => {
        // Evita que dos peticiones simultáneas creen dos administradores.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('runflow_setup'))`);
        const [row] = await tx.select({ count: sql<number>`count(*)::int` }).from(users);
        if ((row?.count ?? 0) > 0) {
          throw conflict('setup_done', 'RunFlow ya está configurado');
        }
        return createOrganizationWithAdmin(tx, {
          orgName: input.orgName,
          adminName: input.name,
          adminEmail: input.email,
          adminPassword: input.password,
          mustChangePassword: false,
          isPlatformAdmin: true,
          actorUserId: null,
        });
      });
      return startSession(app, deps, req, reply, result.adminUserId, result.orgId);
    },
  );
}
