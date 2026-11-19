import { and, asc, eq } from 'drizzle-orm';
import { isPermission, type MeResponse } from '@runflow/core';
import { memberships, organizations, roles, users, withUser, type Db } from '@runflow/db';
import { setSessionActiveOrg, type SessionUser } from '../auth/sessions';

/** Empresas a las que el usuario tiene acceso (membresías activas). */
export async function listUserOrgs(db: Db, userId: string) {
  return withUser(db, userId, (tx) =>
    tx
      .select({
        id: organizations.id,
        name: organizations.name,
        roleId: roles.id,
        roleKey: roles.key,
        roleName: roles.name,
        permissions: roles.permissions,
      })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.orgId))
      .innerJoin(roles, eq(roles.id, memberships.roleId))
      .where(and(eq(memberships.userId, userId), eq(memberships.active, true)))
      .orderBy(asc(organizations.name)),
  );
}

/**
 * Construye la respuesta de /api/auth/me. Si la empresa activa de la sesión ya no
 * es válida, la corrige (y elige automáticamente si solo hay una).
 */
export async function buildMe(
  db: Db,
  session: SessionUser,
  mode: 'cloud' | 'station',
): Promise<MeResponse> {
  const [user] = await withUser(db, session.userId, (tx) =>
    tx
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        isPlatformAdmin: users.isPlatformAdmin,
        mustChangePassword: users.mustChangePassword,
      })
      .from(users)
      .where(eq(users.id, session.userId)),
  );
  const orgs = await listUserOrgs(db, session.userId);

  let active = orgs.find((o) => o.id === session.activeOrgId) ?? null;
  if (!active && orgs.length === 1) active = orgs[0]!;
  const activeId = active?.id ?? null;
  if (activeId !== session.activeOrgId) {
    await setSessionActiveOrg(db, session.userId, session.sessionId, activeId);
    session.activeOrgId = activeId;
  }

  const toOrg = (o: (typeof orgs)[number]) => ({
    id: o.id,
    name: o.name,
    role: { id: o.roleId, key: o.roleKey, name: o.roleName },
  });

  return {
    user: user!,
    organizations: orgs.map(toOrg),
    activeOrg: active
      ? { ...toOrg(active), permissions: active.permissions.filter(isPermission) }
      : null,
    mode,
  };
}
