import { and, eq } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { isPermission, type Permission } from '@runflow/core';
import { memberships, roles, withTenant, type Db } from '@runflow/db';
import { forbidden, HttpError, unauthorized } from '../errors';
import type { SessionUser } from './sessions';

export interface TenantInfo {
  orgId: string;
  userId: string;
  roleId: string;
  roleKey: string;
  permissions: Permission[];
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: SessionUser | null;
    tenant: TenantInfo | null;
  }
}

type Hook = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

/**
 * Exige sesión. Si el usuario debe cambiar la contraseña, solo puede usar
 * las rutas marcadas con `allowPasswordChange`.
 */
export function requireAuth(options: { allowPasswordChange?: boolean } = {}): Hook {
  return async (req) => {
    if (!req.auth) throw unauthorized();
    if (req.auth.mustChangePassword && !options.allowPasswordChange) {
      throw new HttpError(403, 'password_change_required', 'Debes cambiar tu contraseña');
    }
    // Nube SaaS con REQUIRE_EMAIL_VERIFICATION: primero hay que verificar el email.
    if (requireVerified && !req.auth.emailVerified && !options.allowPasswordChange) {
      throw new HttpError(403, 'email_unverified', 'Verifica tu email para continuar');
    }
  };
}

let requireVerified = false;
/** Lo activa la aplicación según la configuración. */
export function setRequireEmailVerification(on: boolean): void {
  requireVerified = on;
}

/** Exige empresa activa con membresía activa y carga los permisos del rol. */
export function requireOrg(db: Db): Hook {
  const auth = requireAuth();
  return async (req, reply) => {
    await auth(req, reply);
    const session = req.auth!;
    if (!session.activeOrgId) {
      throw new HttpError(409, 'no_active_org', 'Elige una empresa para continuar');
    }
    const orgId = session.activeOrgId;
    const [row] = await withTenant(db, { orgId, userId: session.userId }, (tx) =>
      tx
        .select({
          active: memberships.active,
          roleId: roles.id,
          roleKey: roles.key,
          permissions: roles.permissions,
        })
        .from(memberships)
        .innerJoin(roles, eq(roles.id, memberships.roleId))
        .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, session.userId)))
        .limit(1),
    );
    if (!row || !row.active) {
      throw new HttpError(403, 'not_member', 'No tienes acceso a esta empresa');
    }
    req.tenant = {
      orgId,
      userId: session.userId,
      roleId: row.roleId,
      roleKey: row.roleKey,
      permissions: row.permissions.filter(isPermission),
    };
  };
}

export function requirePermission(db: Db, permission: Permission): Hook {
  const org = requireOrg(db);
  return async (req, reply) => {
    await org(req, reply);
    if (!req.tenant!.permissions.includes(permission)) throw forbidden();
  };
}

/** Exige alguno de los permisos indicados. */
export function requireAnyPermission(db: Db, ...permissions: Permission[]): Hook {
  const org = requireOrg(db);
  return async (req, reply) => {
    await org(req, reply);
    if (!permissions.some((p) => req.tenant!.permissions.includes(p))) throw forbidden();
  };
}

export function requirePlatformAdmin(): Hook {
  const auth = requireAuth();
  return async (req, reply) => {
    await auth(req, reply);
    if (!req.auth!.isPlatformAdmin) throw forbidden();
  };
}
