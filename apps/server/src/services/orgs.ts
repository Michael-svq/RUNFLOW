import { randomUUID } from 'node:crypto';
import { eq, like, or, sql } from 'drizzle-orm';
import { ADMIN_ROLE_KEY, DEFAULT_ROLES } from '@runflow/core';
import { memberships, organizations, roles, users, type Tx } from '@runflow/db';
import { badRequest } from '../errors';
import { hashPassword } from '../auth/password';
import { audit } from './audit';

export function slugify(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base || 'empresa';
}

async function uniqueSlug(tx: Tx, name: string): Promise<string> {
  const base = slugify(name);
  const taken = await tx
    .select({ slug: organizations.slug })
    .from(organizations)
    .where(or(eq(organizations.slug, base), like(organizations.slug, `${base}-%`)));
  const set = new Set(taken.map((t) => t.slug));
  if (!set.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!set.has(candidate)) return candidate;
  }
}

/**
 * Crea una empresa con sus roles por defecto y su administrador.
 * Si el email ya existe, añade esa cuenta como administradora (su contraseña no cambia).
 * Debe ejecutarse en una transacción de sistema (withSystem).
 */
export async function createOrganizationWithAdmin(
  tx: Tx,
  input: {
    orgName: string;
    adminName: string;
    adminEmail: string;
    adminPassword?: string;
    /** El administrador debe cambiar la contraseña al entrar (cuando la pone otra persona). */
    mustChangePassword: boolean;
    isPlatformAdmin?: boolean;
    actorUserId: string | null;
    /** Registro autoservicio: el email queda sin verificar hasta abrir el enlace. */
    emailUnverified?: boolean;
  },
): Promise<{ orgId: string; adminUserId: string; existingAccount: boolean }> {
  const [org] = await tx
    .insert(organizations)
    .values({ name: input.orgName, slug: await uniqueSlug(tx, input.orgName) })
    .returning({ id: organizations.id });
  const orgId = org!.id;

  const insertedRoles = await tx
    .insert(roles)
    .values(
      DEFAULT_ROLES.map((r) => ({
        orgId,
        key: r.key,
        name: r.name,
        description: r.description,
        permissions: r.permissions,
        isSystem: true,
      })),
    )
    .returning({ id: roles.id, key: roles.key });
  const adminRoleId = insertedRoles.find((r) => r.key === ADMIN_ROLE_KEY)!.id;

  const [existing] = await tx
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${input.adminEmail.toLowerCase()}`)
    .limit(1);

  let adminUserId: string;
  if (existing) {
    adminUserId = existing.id;
  } else {
    if (!input.adminPassword) {
      throw badRequest('validation', 'Revisa los datos del formulario', {
        adminPassword: 'Obligatoria para una cuenta nueva',
      });
    }
    adminUserId = randomUUID();
    await tx.insert(users).values({
      id: adminUserId,
      email: input.adminEmail,
      name: input.adminName,
      passwordHash: await hashPassword(input.adminPassword),
      mustChangePassword: input.mustChangePassword,
      isPlatformAdmin: input.isPlatformAdmin ?? false,
      emailVerifiedAt: input.emailUnverified ? null : new Date(),
    });
  }

  await tx.insert(memberships).values({ orgId, userId: adminUserId, roleId: adminRoleId });
  await audit(tx, {
    orgId,
    userId: input.actorUserId ?? adminUserId,
    action: 'org.create',
    targetType: 'organization',
    targetId: orgId,
    data: { name: input.orgName, adminUserId, existingAccount: !!existing },
  });
  return { orgId, adminUserId, existingAccount: !!existing };
}
