import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { setupInput, signupInput, type SetupStatusResponse } from '@runflow/core';
import { users, withSystem } from '@runflow/db';
import { conflict, HttpError, parse } from '../errors';
import { createOrganizationWithAdmin } from '../services/orgs';
import type { AppDeps } from '../app';
import { sendVerification } from './email';
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
    return {
      needsSetup: await needsSetup(deps),
      signupEnabled: deps.config.signupEnabled && deps.config.mode === 'cloud',
      legal: deps.config.legal,
    };
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

  /**
   * Registro autoservicio (nube SaaS, SIGNUP_ENABLED): una empresa nueva en el
   * plan Gratis y su administración. No da acceso a cuentas que ya existen.
   */
  app.post(
    '/api/signup',
    { config: { rateLimit: { max: deps.config.authRateLimit, timeWindow: '1 minute' } } },
    async (req, reply) => {
      if (!deps.config.signupEnabled || deps.config.mode !== 'cloud') {
        throw new HttpError(404, 'not_found', 'El registro no está disponible');
      }
      const input = parse(signupInput, req.body);
      const result = await withSystem(deps.db, async (tx) => {
        const existing = (
          await tx.execute<{ id: string | null }>(
            sql`select rf_user_id_by_email(${input.email}) as id`,
          )
        ).rows[0]?.id;
        if (existing) {
          throw new HttpError(
            409,
            'email_taken',
            'Ya hay una cuenta con ese email: entra con ella',
            {
              email: 'Ya hay una cuenta con ese email',
            },
          );
        }
        return createOrganizationWithAdmin(tx, {
          orgName: input.orgName,
          adminName: input.name,
          adminEmail: input.email,
          adminPassword: input.password,
          mustChangePassword: false,
          isPlatformAdmin: false,
          actorUserId: null,
          emailUnverified: true,
        });
      });
      // Enlace de verificación al email del registro.
      await sendVerification(deps, result.adminUserId, input.email).catch((err: unknown) =>
        app.log.warn({ err }, 'No se pudo enviar el email de verificación'),
      );
      reply.status(201);
      return startSession(app, deps, req, reply, result.adminUserId, result.orgId);
    },
  );
}
