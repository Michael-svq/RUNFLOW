import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { changePasswordInput, loginInput, setActiveOrgInput, updateMeInput } from '@runflow/core';
import { users, withSystem, withUser } from '@runflow/db';
import { badRequest, HttpError, parse } from '../errors';
import { getDummyHash, hashPassword, verifyPassword } from '../auth/password';
import {
  createSession,
  deleteOtherSessions,
  deleteSession,
  SESSION_COOKIE,
  setSessionActiveOrg,
} from '../auth/sessions';
import { requireAuth } from '../auth/guards';
import { buildMe, listUserOrgs } from '../services/me';
import type { AppDeps } from '../app';

export function setSessionCookie(
  reply: FastifyReply,
  deps: AppDeps,
  token: string,
  expiresAt: Date,
) {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: deps.config.cookieSecure,
    path: '/',
    expires: expiresAt,
  });
}

/** Crea la sesión, pone la cookie y devuelve /me. */
export async function startSession(
  _app: FastifyInstance,
  deps: AppDeps,
  req: FastifyRequest,
  reply: FastifyReply,
  userId: string,
  preferredOrgId: string | null,
) {
  const orgs = await listUserOrgs(deps.db, userId);
  const activeOrgId =
    orgs.find((o) => o.id === preferredOrgId)?.id ?? (orgs.length === 1 ? orgs[0]!.id : null);
  const session = await createSession(deps.db, {
    userId,
    activeOrgId,
    ttlDays: deps.config.sessionTtlDays,
    userAgent: req.headers['user-agent'],
    ip: req.ip,
  });
  setSessionCookie(reply, deps, session.token, session.expiresAt);
  await withUser(deps.db, userId, (tx) =>
    tx
      .update(users)
      .set({ lastLoginAt: sql`now()` })
      .where(eq(users.id, userId)),
  );
  const [user] = await withUser(deps.db, userId, (tx) =>
    tx
      .select({
        email: users.email,
        name: users.name,
        isPlatformAdmin: users.isPlatformAdmin,
        mustChangePassword: users.mustChangePassword,
      })
      .from(users)
      .where(eq(users.id, userId)),
  );
  return buildMe(
    deps.db,
    { sessionId: session.sessionId, userId, activeOrgId, ...user! },
    deps.config.mode,
  );
}

export async function authRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const authed = requireAuth({ allowPasswordChange: true });

  app.post(
    '/api/auth/login',
    { config: { rateLimit: { max: deps.config.authRateLimit, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const input = parse(loginInput, req.body);
      const [user] = await withSystem(deps.db, (tx) =>
        tx
          .select({ id: users.id, passwordHash: users.passwordHash })
          .from(users)
          .where(sql`lower(${users.email}) = ${input.email}`)
          .limit(1),
      );
      const ok = await verifyPassword(input.password, user?.passwordHash ?? (await getDummyHash()));
      if (!user || !ok) {
        throw new HttpError(401, 'invalid_credentials', 'Email o contraseña incorrectos');
      }
      return startSession(app, deps, req, reply, user.id, null);
    },
  );

  app.post('/api/auth/logout', async (req, reply) => {
    if (req.auth) await deleteSession(deps.db, req.auth.userId, req.auth.sessionId);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', { preHandler: authed }, async (req) => {
    return buildMe(deps.db, req.auth!, deps.config.mode);
  });

  app.post('/api/auth/active-org', { preHandler: authed }, async (req) => {
    const { orgId } = parse(setActiveOrgInput, req.body);
    const orgs = await listUserOrgs(deps.db, req.auth!.userId);
    if (!orgs.some((o) => o.id === orgId)) {
      throw new HttpError(403, 'not_member', 'No tienes acceso a esta empresa');
    }
    await setSessionActiveOrg(deps.db, req.auth!.userId, req.auth!.sessionId, orgId);
    req.auth!.activeOrgId = orgId;
    return buildMe(deps.db, req.auth!, deps.config.mode);
  });

  app.patch('/api/me', { preHandler: requireAuth() }, async (req) => {
    const input = parse(updateMeInput, req.body);
    await withUser(deps.db, req.auth!.userId, (tx) =>
      tx
        .update(users)
        .set({ name: input.name, updatedAt: sql`now()` })
        .where(eq(users.id, req.auth!.userId)),
    );
    req.auth!.name = input.name;
    return buildMe(deps.db, req.auth!, deps.config.mode);
  });

  app.post(
    '/api/me/password',
    {
      preHandler: authed,
      config: { rateLimit: { max: deps.config.authRateLimit, timeWindow: '1 minute' } },
    },
    async (req) => {
      const input = parse(changePasswordInput, req.body);
      const userId = req.auth!.userId;
      const [user] = await withUser(deps.db, userId, (tx) =>
        tx.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, userId)),
      );
      if (!user || !(await verifyPassword(input.currentPassword, user.passwordHash))) {
        throw badRequest('validation', 'Revisa los datos del formulario', {
          currentPassword: 'Contraseña actual incorrecta',
        });
      }
      const passwordHash = await hashPassword(input.newPassword);
      await withUser(deps.db, userId, (tx) =>
        tx
          .update(users)
          .set({ passwordHash, mustChangePassword: false, updatedAt: sql`now()` })
          .where(eq(users.id, userId)),
      );
      // Cierra el resto de sesiones abiertas con la contraseña anterior.
      await deleteOtherSessions(deps.db, userId, req.auth!.sessionId);
      req.auth!.mustChangePassword = false;
      return buildMe(deps.db, req.auth!, deps.config.mode);
    },
  );
}
