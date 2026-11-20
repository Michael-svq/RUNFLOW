import { randomUUID } from 'node:crypto';
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import {
  ADMIN_ROLE_KEY,
  type CreateUserInput,
  type MemberDto,
  type RoleDetail,
  type UpdateUserInput,
  isPermission,
} from '@runflow/core';
import { memberships, roles, users, withTenant, type Db, type Tx } from '@runflow/db';
import { badRequest, conflict, notFound } from '../errors';
import { hashPassword } from '../auth/password';
import { deleteAllSessions } from '../auth/sessions';
import type { TenantInfo } from '../auth/guards';
import { audit } from './audit';

/*
 * Gestión de miembros de una empresa. Todo se ejecuta con withTenant: la base
 * de datos garantiza que solo se ven y modifican filas de la empresa activa.
 */

const sharedAccountSql = sql<boolean>`rf_user_membership_count(${users.id}) > 1`;

function memberQuery(tx: Tx) {
  return tx
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      roleId: roles.id,
      roleKey: roles.key,
      roleName: roles.name,
      active: memberships.active,
      sharedAccount: sharedAccountSql,
      createdAt: memberships.createdAt,
      lastLoginAt: users.lastLoginAt,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .innerJoin(roles, eq(roles.id, memberships.roleId));
}

type MemberRow = Awaited<ReturnType<ReturnType<typeof memberQuery>['execute']>>[number];

function toDto(r: MemberRow): MemberDto {
  return {
    userId: r.userId,
    name: r.name,
    email: r.email,
    role: { id: r.roleId, key: r.roleKey, name: r.roleName },
    active: r.active,
    sharedAccount: r.sharedAccount,
    createdAt: r.createdAt.toISOString(),
    lastLoginAt: r.lastLoginAt?.toISOString() ?? null,
  };
}

async function getMember(tx: Tx, orgId: string, userId: string): Promise<MemberRow | undefined> {
  const [row] = await memberQuery(tx)
    .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)))
    .limit(1);
  return row;
}

async function requireMember(tx: Tx, orgId: string, userId: string): Promise<MemberRow> {
  const row = await getMember(tx, orgId, userId);
  if (!row) throw notFound('Usuario no encontrado');
  return row;
}

async function requireRole(tx: Tx, orgId: string, roleId: string) {
  const [role] = await tx
    .select({ id: roles.id, key: roles.key })
    .from(roles)
    .where(and(eq(roles.id, roleId), eq(roles.orgId, orgId)))
    .limit(1);
  if (!role)
    throw badRequest('validation', 'Revisa los datos del formulario', { roleId: 'Rol no válido' });
  return role;
}

/** Impide dejar la empresa sin ningún administrador activo. */
async function assertNotLastAdmin(tx: Tx, orgId: string, userId: string): Promise<void> {
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(memberships)
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .where(
      and(
        eq(memberships.orgId, orgId),
        eq(memberships.active, true),
        eq(roles.key, ADMIN_ROLE_KEY),
        ne(memberships.userId, userId),
      ),
    );
  if ((row?.count ?? 0) === 0) {
    throw conflict('last_admin', 'La empresa debe tener al menos un administrador activo');
  }
}

export async function listMembers(db: Db, t: TenantInfo): Promise<MemberDto[]> {
  return withTenant(db, t, async (tx) => {
    const rows = await memberQuery(tx)
      .where(eq(memberships.orgId, t.orgId))
      .orderBy(asc(users.name));
    return rows.map(toDto);
  });
}

export async function listRoles(db: Db, t: TenantInfo): Promise<RoleDetail[]> {
  return withTenant(db, t, async (tx) => {
    const rows = await tx
      .select()
      .from(roles)
      .where(eq(roles.orgId, t.orgId))
      .orderBy(asc(roles.createdAt), asc(roles.name));
    return rows.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      description: r.description,
      permissions: r.permissions.filter(isPermission),
      isSystem: r.isSystem,
    }));
  });
}

export async function createMember(
  db: Db,
  t: TenantInfo,
  input: CreateUserInput,
): Promise<{ member: MemberDto; existingAccount: boolean }> {
  // El hash es costoso: se calcula fuera de la transacción.
  const passwordHash = input.password ? await hashPassword(input.password) : undefined;
  return withTenant(db, t, async (tx) => {
    await requireRole(tx, t.orgId, input.roleId);
    const existingId = (
      await tx.execute<{ id: string | null }>(sql`select rf_user_id_by_email(${input.email}) as id`)
    ).rows[0]?.id;

    let userId: string;
    if (existingId) {
      if (await getMember(tx, t.orgId, existingId)) {
        throw conflict('already_member', 'Ese usuario ya pertenece a la empresa');
      }
      userId = existingId;
    } else {
      if (!passwordHash) {
        throw badRequest('validation', 'Revisa los datos del formulario', {
          password: 'Obligatoria para una cuenta nueva',
        });
      }
      userId = randomUUID();
      await tx.insert(users).values({
        id: userId,
        email: input.email,
        name: input.name,
        passwordHash,
        mustChangePassword: true,
        // Lo da de alta un administrador de la empresa.
        emailVerifiedAt: new Date(),
      });
    }

    await tx.insert(memberships).values({ orgId: t.orgId, userId, roleId: input.roleId });
    await audit(tx, {
      orgId: t.orgId,
      userId: t.userId,
      action: 'member.create',
      targetType: 'user',
      targetId: userId,
      data: { roleId: input.roleId, existingAccount: !!existingId },
    });
    const member = await requireMember(tx, t.orgId, userId);
    return { member: toDto(member), existingAccount: !!existingId };
  });
}

export async function updateMember(
  db: Db,
  t: TenantInfo,
  targetUserId: string,
  input: UpdateUserInput,
): Promise<MemberDto> {
  return withTenant(db, t, async (tx) => {
    const current = await requireMember(tx, t.orgId, targetUserId);
    const isSelf = targetUserId === t.userId;

    const membershipChanges: { roleId?: string; active?: boolean } = {};
    if (input.roleId !== undefined && input.roleId !== current.roleId) {
      membershipChanges.roleId = input.roleId;
    }
    if (input.active !== undefined && input.active !== current.active) {
      membershipChanges.active = input.active;
    }

    if (Object.keys(membershipChanges).length > 0) {
      if (isSelf) {
        throw conflict('self_change', 'No puedes cambiar tu propio rol ni desactivarte');
      }
      const newRole = membershipChanges.roleId
        ? await requireRole(tx, t.orgId, membershipChanges.roleId)
        : { key: current.roleKey };
      const willBeActiveAdmin =
        newRole.key === ADMIN_ROLE_KEY && (membershipChanges.active ?? current.active);
      if (current.roleKey === ADMIN_ROLE_KEY && current.active && !willBeActiveAdmin) {
        await assertNotLastAdmin(tx, t.orgId, targetUserId);
      }
      await tx
        .update(memberships)
        .set({ ...membershipChanges, updatedAt: sql`now()` })
        .where(and(eq(memberships.orgId, t.orgId), eq(memberships.userId, targetUserId)));
    }

    if (input.name !== undefined && input.name !== current.name) {
      if (current.sharedAccount && !isSelf) {
        throw conflict(
          'shared_account',
          'Esta cuenta pertenece también a otras empresas: solo su titular puede cambiar el nombre',
        );
      }
      await tx
        .update(users)
        .set({ name: input.name, updatedAt: sql`now()` })
        .where(eq(users.id, targetUserId));
    }

    await audit(tx, {
      orgId: t.orgId,
      userId: t.userId,
      action: 'member.update',
      targetType: 'user',
      targetId: targetUserId,
      data: { ...input },
    });
    return toDto(await requireMember(tx, t.orgId, targetUserId));
  });
}

export async function resetMemberPassword(
  db: Db,
  t: TenantInfo,
  targetUserId: string,
  password: string,
): Promise<void> {
  if (targetUserId === t.userId) {
    throw conflict('self_change', 'Cambia tu contraseña desde tu configuración de usuario');
  }
  const passwordHash = await hashPassword(password);
  await withTenant(db, t, async (tx) => {
    const current = await requireMember(tx, t.orgId, targetUserId);
    if (current.sharedAccount) {
      throw conflict(
        'shared_account',
        'Esta cuenta pertenece también a otras empresas: solo su titular puede cambiar la contraseña',
      );
    }
    await tx
      .update(users)
      .set({ passwordHash, mustChangePassword: true, updatedAt: sql`now()` })
      .where(eq(users.id, targetUserId));
    await audit(tx, {
      orgId: t.orgId,
      userId: t.userId,
      action: 'member.reset_password',
      targetType: 'user',
      targetId: targetUserId,
    });
  });
  await deleteAllSessions(db, targetUserId);
}

export async function removeMember(db: Db, t: TenantInfo, targetUserId: string): Promise<void> {
  if (targetUserId === t.userId) {
    throw conflict('self_change', 'No puedes eliminarte de la empresa');
  }
  await withTenant(db, t, async (tx) => {
    const current = await requireMember(tx, t.orgId, targetUserId);
    if (current.roleKey === ADMIN_ROLE_KEY && current.active) {
      await assertNotLastAdmin(tx, t.orgId, targetUserId);
    }
    await tx
      .delete(memberships)
      .where(and(eq(memberships.orgId, t.orgId), eq(memberships.userId, targetUserId)));
    // Si la cuenta ya no pertenece a ninguna empresa, se borra.
    await tx.execute(sql`select rf_delete_orphan_user(${targetUserId})`);
    await audit(tx, {
      orgId: t.orgId,
      userId: t.userId,
      action: 'member.remove',
      targetType: 'user',
      targetId: targetUserId,
      data: { email: current.email },
    });
  });
}
