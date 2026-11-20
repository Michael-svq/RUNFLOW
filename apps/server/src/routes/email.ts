import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { passwordSchema } from '@runflow/core';
import { emailTokens, users, withSystem } from '@runflow/db';
import { HttpError, parse } from '../errors';
import { hashPassword } from '../auth/password';
import { deleteAllSessions } from '../auth/sessions';
import { requireAuth } from '../auth/guards';
import type { AppDeps } from '../app';

/* Lanzamiento: verificación de email y recuperación de contraseña por enlace. */

const VERIFY_HOURS = 48;
const RESET_MINUTES = 60;
const tokenSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{30,80}$/) });
const hash = (t: string) => createHash('sha256').update(t).digest('hex');

/** Dirección pública para los enlaces (PUBLIC_URL o la de la petición). */
function baseUrl(deps: AppDeps, req?: FastifyRequest): string {
  if (deps.config.publicUrl) return deps.config.publicUrl.replace(/\/+$/, '');
  if (req) return `${req.protocol}://${req.headers.host}`;
  return `http://localhost:${deps.config.port}`;
}

async function newToken(
  deps: AppDeps,
  userId: string,
  purpose: 'verify' | 'reset',
  ms: number,
): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await withSystem(deps.db, async (tx) => {
    // Un enlace vivo por propósito: los anteriores dejan de valer.
    await tx
      .update(emailTokens)
      .set({ usedAt: sql`now()` })
      .where(
        and(
          eq(emailTokens.userId, userId),
          eq(emailTokens.purpose, purpose),
          isNull(emailTokens.usedAt),
        ),
      );
    await tx.insert(emailTokens).values({
      userId,
      purpose,
      tokenHash: hash(token),
      expiresAt: new Date(Date.now() + ms),
    });
  });
  return token;
}

/** Consume un enlace válido y devuelve su usuario (o error). */
async function useToken(deps: AppDeps, token: string, purpose: 'verify' | 'reset') {
  const [row] = await withSystem(deps.db, (tx) =>
    tx
      .update(emailTokens)
      .set({ usedAt: sql`now()` })
      .where(
        and(
          eq(emailTokens.tokenHash, hash(token)),
          eq(emailTokens.purpose, purpose),
          isNull(emailTokens.usedAt),
          gt(emailTokens.expiresAt, sql`now()`),
        ),
      )
      .returning({ userId: emailTokens.userId }),
  );
  if (!row)
    throw new HttpError(
      400,
      'invalid_token',
      'El enlace no es válido o ha caducado: pide uno nuevo',
    );
  return row.userId;
}

export async function sendVerification(
  deps: AppDeps,
  userId: string,
  email: string,
  req?: FastifyRequest,
): Promise<void> {
  const token = await newToken(deps, userId, 'verify', VERIFY_HOURS * 3600_000);
  const link = `${baseUrl(deps, req)}/verificar/${token}`;
  await deps.mailer!.send({
    to: email,
    subject: 'Verifica tu email en RunFlow',
    text: `Hola:\n\nPara verificar tu email en RunFlow abre este enlace (caduca en ${VERIFY_HOURS} horas):\n\n${link}\n\nSi no has creado una cuenta, ignora este mensaje.\n`,
  });
}

export async function emailRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const authed = requireAuth({ allowPasswordChange: true });
  const limit = { rateLimit: { max: deps.config.authRateLimit, timeWindow: '1 minute' } };

  /** Reenviar el enlace de verificación a la cuenta con sesión. */
  app.post('/api/auth/verify/send', { preHandler: authed, config: limit }, async (req) => {
    const auth = req.auth!;
    if (auth.emailVerified) return { ok: true, alreadyVerified: true };
    await sendVerification(deps, auth.userId, auth.email, req);
    return { ok: true };
  });

  app.post('/api/auth/verify', { config: limit }, async (req) => {
    const { token } = parse(tokenSchema, req.body);
    const userId = await useToken(deps, token, 'verify');
    await withSystem(deps.db, (tx) =>
      tx
        .update(users)
        .set({ emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, now())` })
        .where(eq(users.id, userId)),
    );
    return { ok: true };
  });

  /** «¿Has olvidado la contraseña?»: responde igual exista o no la cuenta. */
  app.post('/api/auth/password/forgot', { config: limit }, async (req) => {
    const { email } = parse(z.object({ email: z.email().max(200) }), req.body);
    const [user] = await withSystem(deps.db, (tx) =>
      tx
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(sql`lower(${users.email}) = lower(${email})`),
    );
    if (user) {
      const token = await newToken(deps, user.id, 'reset', RESET_MINUTES * 60_000);
      const link = `${baseUrl(deps, req)}/restablecer/${token}`;
      await deps
        .mailer!.send({
          to: user.email,
          subject: 'Restablecer tu contraseña de RunFlow',
          text: `Hola:\n\nPara poner una contraseña nueva en RunFlow abre este enlace (caduca en ${RESET_MINUTES} minutos):\n\n${link}\n\nSi no lo has pedido tú, ignora este mensaje: tu contraseña no cambia.\n`,
        })
        .catch((err: unknown) => app.log.warn({ err }, 'No se pudo enviar el email'));
    }
    return { ok: true };
  });

  app.post('/api/auth/password/reset', { config: limit }, async (req) => {
    const input = parse(tokenSchema.extend({ password: passwordSchema }), req.body);
    const userId = await useToken(deps, input.token, 'reset');
    const passwordHash = await hashPassword(input.password);
    await withSystem(deps.db, (tx) =>
      tx
        .update(users)
        .set({
          passwordHash,
          mustChangePassword: false,
          // Abrir el enlace demuestra que el email es suyo.
          emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, now())`,
          updatedAt: sql`now()`,
        })
        .where(eq(users.id, userId)),
    );
    // Se cierran todas las sesiones abiertas con la contraseña anterior.
    await deleteAllSessions(deps.db, userId);
    return { ok: true };
  });
}
