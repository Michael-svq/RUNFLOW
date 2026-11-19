import { createHash, randomBytes } from 'node:crypto';
import { and, eq, ne, sql } from 'drizzle-orm';
import { sessions, users, withSystem, withUser, type Db } from '@runflow/db';

export const SESSION_COOKIE = 'rf_session';
/** No actualizar last_seen_at en cada petición. */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface SessionUser {
  sessionId: string;
  userId: string;
  activeOrgId: string | null;
  email: string;
  name: string;
  isPlatformAdmin: boolean;
  mustChangePassword: boolean;
}

export async function createSession(
  db: Db,
  input: {
    userId: string;
    activeOrgId: string | null;
    ttlDays: number;
    userAgent?: string;
    ip?: string;
  },
): Promise<{ token: string; sessionId: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + input.ttlDays * 24 * 60 * 60 * 1000);
  const [row] = await withUser(db, input.userId, (tx) =>
    tx
      .insert(sessions)
      .values({
        tokenHash: hashToken(token),
        userId: input.userId,
        activeOrgId: input.activeOrgId,
        userAgent: input.userAgent?.slice(0, 300),
        ip: input.ip,
        expiresAt,
      })
      .returning({ id: sessions.id }),
  );
  return { token, sessionId: row!.id, expiresAt };
}

/** Busca la sesión del token. Devuelve null si no existe o ha caducado (y la borra). */
export async function resolveSession(
  db: Db,
  token: string,
  ttlDays: number,
): Promise<SessionUser | null> {
  return withSystem(db, async (tx) => {
    const [row] = await tx
      .select({
        sessionId: sessions.id,
        userId: sessions.userId,
        activeOrgId: sessions.activeOrgId,
        expiresAt: sessions.expiresAt,
        lastSeenAt: sessions.lastSeenAt,
        email: users.email,
        name: users.name,
        isPlatformAdmin: users.isPlatformAdmin,
        mustChangePassword: users.mustChangePassword,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(eq(sessions.tokenHash, hashToken(token)))
      .limit(1);
    if (!row) return null;
    const now = Date.now();
    if (row.expiresAt.getTime() <= now) {
      await tx.delete(sessions).where(eq(sessions.id, row.sessionId));
      return null;
    }
    if (now - row.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      // Caducidad deslizante: cada uso renueva la sesión.
      await tx
        .update(sessions)
        .set({
          lastSeenAt: sql`now()`,
          expiresAt: new Date(now + ttlDays * 24 * 60 * 60 * 1000),
        })
        .where(eq(sessions.id, row.sessionId));
    }
    return {
      sessionId: row.sessionId,
      userId: row.userId,
      activeOrgId: row.activeOrgId,
      email: row.email,
      name: row.name,
      isPlatformAdmin: row.isPlatformAdmin,
      mustChangePassword: row.mustChangePassword,
    };
  });
}

export async function deleteSession(db: Db, userId: string, sessionId: string): Promise<void> {
  await withUser(db, userId, (tx) => tx.delete(sessions).where(eq(sessions.id, sessionId)));
}

export async function deleteOtherSessions(
  db: Db,
  userId: string,
  keepSessionId: string,
): Promise<void> {
  await withUser(db, userId, (tx) =>
    tx.delete(sessions).where(and(eq(sessions.userId, userId), ne(sessions.id, keepSessionId))),
  );
}

/** Cierra todas las sesiones de un usuario (p. ej. tras restablecer su contraseña). */
export async function deleteAllSessions(db: Db, userId: string): Promise<void> {
  await withSystem(db, (tx) => tx.delete(sessions).where(eq(sessions.userId, userId)));
}

export async function setSessionActiveOrg(
  db: Db,
  userId: string,
  sessionId: string,
  orgId: string | null,
): Promise<void> {
  await withUser(db, userId, (tx) =>
    tx.update(sessions).set({ activeOrgId: orgId }).where(eq(sessions.id, sessionId)),
  );
}
