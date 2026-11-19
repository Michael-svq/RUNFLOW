import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { memberships, roles, users, withTenant, withUser } from '@runflow/db';
import {
  Client,
  createTestContext,
  PASSWORD,
  resetDb,
  roleId,
  setupFirstOrg,
  type TestContext,
} from './helpers';

/*
 * Criterio de aceptación de M0: dos empresas no ven datos entre sí.
 * Se comprueba por la API y directamente en la base de datos (RLS).
 */

let ctx: TestContext;
let platformAdmin: Client; // Ana, administradora de Chanel TV y de la plataforma
let adminB: Client; // Bea, administradora de Escuela Audiovisual
let orgA: string;
let orgB: string;
let anaId: string;
let beaId: string;

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.close();
});

beforeEach(async () => {
  await resetDb();
  const first = await setupFirstOrg(ctx.app);
  platformAdmin = first.admin;
  orgA = first.me.activeOrg.id;
  anaId = first.me.user.id;

  const created = await platformAdmin.post('/api/platform/orgs', {
    orgName: 'Escuela Audiovisual',
    adminName: 'Bea Profe',
    adminEmail: 'bea@escuela.test',
    adminPassword: 'temporal-12345',
  });
  expect(created.status).toBe(201);
  orgB = created.body.orgId;
  beaId = created.body.adminUserId;

  adminB = new Client(ctx.app);
  await adminB.login('bea@escuela.test', 'temporal-12345');
  await adminB.post('/api/me/password', {
    currentPassword: 'temporal-12345',
    newPassword: PASSWORD,
  });

  for (const [client, email] of [
    [platformAdmin, 'rafa@chaneltv.test'],
    [adminB, 'alumno@escuela.test'],
  ] as const) {
    const res = await client.post('/api/users', {
      name: email,
      email,
      roleId: await roleId(client, client === adminB ? 'alumno' : 'redactor'),
      password: 'temporal-12345',
    });
    expect(res.status).toBe(201);
  }
});

describe('aislamiento entre empresas (API)', () => {
  it('cada empresa solo lista sus usuarios', async () => {
    const a = (await platformAdmin.get('/api/users')).body.members.map((m: any) => m.email).sort();
    const b = (await adminB.get('/api/users')).body.members.map((m: any) => m.email).sort();
    expect(a).toEqual(['ana@chaneltv.test', 'rafa@chaneltv.test']);
    expect(b).toEqual(['alumno@escuela.test', 'bea@escuela.test']);
  });

  it('cada empresa solo ve sus roles', async () => {
    const a = (await platformAdmin.get('/api/roles')).body.roles.map((r: any) => r.id);
    const b = (await adminB.get('/api/roles')).body.roles.map((r: any) => r.id);
    expect(a.filter((id: string) => b.includes(id))).toEqual([]);
  });

  it('no se puede modificar, restablecer ni eliminar un usuario de otra empresa', async () => {
    expect((await adminB.patch(`/api/users/${anaId}`, { name: 'Hackeada' })).status).toBe(404);
    expect(
      (await adminB.post(`/api/users/${anaId}/password`, { password: 'robada-123456' })).status,
    ).toBe(404);
    expect((await adminB.delete(`/api/users/${anaId}`)).status).toBe(404);
    // Ana sigue intacta.
    const me = (await platformAdmin.get('/api/auth/me')).body;
    expect(me.user.name).toBe('Ana Admin');
  });

  it('no se puede activar una empresa a la que no se pertenece', async () => {
    const res = await adminB.post('/api/auth/active-org', { orgId: orgA });
    expect(res.status).toBe(403);
  });

  it('no se puede asignar un rol de otra empresa', async () => {
    const roleOfA = await roleId(platformAdmin, 'admin');
    const res = await adminB.post('/api/users', {
      name: 'X',
      email: 'x@escuela.test',
      roleId: roleOfA,
      password: PASSWORD,
    });
    expect(res.status).toBe(400);
  });

  it('solo la administración de plataforma puede crear empresas', async () => {
    const res = await adminB.post('/api/platform/orgs', {
      orgName: 'Pirata',
      adminName: 'X',
      adminEmail: 'x@pirata.test',
      adminPassword: PASSWORD,
    });
    expect(res.status).toBe(403);
    expect((await adminB.get('/api/platform/orgs')).status).toBe(403);
    const list = await platformAdmin.get('/api/platform/orgs');
    expect(list.body.organizations.map((o: any) => o.name)).toEqual([
      'Chanel TV',
      'Escuela Audiovisual',
    ]);
  });
});

describe('cuentas en varias empresas', () => {
  it('añadir un email existente lo une a la empresa sin cambiar su contraseña', async () => {
    const res = await adminB.post('/api/users', {
      name: 'Ignorado',
      email: 'rafa@chaneltv.test',
      roleId: await roleId(adminB, 'profesor'),
      password: 'intento-de-cambio',
    });
    expect(res.status).toBe(201);
    expect(res.body.existingAccount).toBe(true);
    expect(res.body.member.sharedAccount).toBe(true);

    const rafa = new Client(ctx.app);
    const me = await rafa.login('rafa@chaneltv.test', 'temporal-12345');
    expect(me.organizations.map((o: any) => o.name).sort()).toEqual([
      'Chanel TV',
      'Escuela Audiovisual',
    ]);
    expect(me.activeOrg).toBeNull(); // con varias empresas, debe elegir

    // Una empresa no puede cambiar la contraseña ni el nombre de una cuenta compartida.
    const rafaId = res.body.member.userId;
    const reset = await adminB.post(`/api/users/${rafaId}/password`, { password: 'robada-123456' });
    expect(reset.status).toBe(409);
    expect(reset.body.error.code).toBe('shared_account');
    expect((await adminB.patch(`/api/users/${rafaId}`, { name: 'Otro' })).status).toBe(409);
  });

  it('elige empresa y cambia de una a otra', async () => {
    await adminB.post('/api/users', {
      name: 'Rafa',
      email: 'rafa@chaneltv.test',
      roleId: await roleId(adminB, 'profesor'),
    });
    const rafa = new Client(ctx.app);
    await rafa.login('rafa@chaneltv.test', 'temporal-12345');
    await rafa.post('/api/me/password', {
      currentPassword: 'temporal-12345',
      newPassword: PASSWORD,
    });
    expect((await rafa.get('/api/roles')).body.error.code).toBe('no_active_org');

    const inB = await rafa.post('/api/auth/active-org', { orgId: orgB });
    expect(inB.body.activeOrg).toMatchObject({
      name: 'Escuela Audiovisual',
      role: { key: 'profesor' },
    });
    const inA = await rafa.post('/api/auth/active-org', { orgId: orgA });
    expect(inA.body.activeOrg).toMatchObject({
      name: 'Chanel TV',
      role: { key: 'redactor' },
    });
  });

  it('eliminar de una empresa no borra la cuenta si pertenece a otra', async () => {
    const added = await adminB.post('/api/users', {
      name: 'Rafa',
      email: 'rafa@chaneltv.test',
      roleId: await roleId(adminB, 'profesor'),
    });
    expect((await adminB.delete(`/api/users/${added.body.member.userId}`)).status).toBe(200);
    const me = await new Client(ctx.app).login('rafa@chaneltv.test', 'temporal-12345');
    expect(me.organizations.map((o: any) => o.name)).toEqual(['Chanel TV']);
  });
});

describe('aislamiento en la base de datos (RLS)', () => {
  const db = () => ctx.handle.db;

  it('una consulta SIN filtro de empresa solo devuelve filas de la empresa activa', async () => {
    const seen = await withTenant(db(), { orgId: orgB, userId: beaId }, async (tx) => ({
      memberships: await tx.select().from(memberships),
      roles: await tx.select().from(roles),
      users: await tx.select().from(users),
    }));
    expect(new Set(seen.memberships.map((m) => m.orgId))).toEqual(new Set([orgB]));
    expect(new Set(seen.roles.map((r) => r.orgId))).toEqual(new Set([orgB]));
    expect(seen.users.map((u) => u.email).sort()).toEqual([
      'alumno@escuela.test',
      'bea@escuela.test',
    ]);
  });

  it('no se pueden modificar filas de otra empresa aunque se apunte a ellas directamente', async () => {
    const updated = await withTenant(db(), { orgId: orgB, userId: beaId }, (tx) =>
      tx
        .update(users)
        .set({ name: 'Hackeada' })
        .where(sql`${users.id} = ${anaId}`)
        .returning(),
    );
    expect(updated).toEqual([]);
    const deleted = await withTenant(db(), { orgId: orgB, userId: beaId }, (tx) =>
      tx
        .delete(memberships)
        .where(sql`${memberships.orgId} = ${orgA}`)
        .returning(),
    );
    expect(deleted).toEqual([]);
  });

  it('no se puede insertar en otra empresa', async () => {
    await expect(
      withTenant(db(), { orgId: orgB, userId: beaId }, (tx) =>
        tx.insert(roles).values({ orgId: orgA, key: 'pirata', name: 'Pirata' }),
      ),
    ).rejects.toThrow();
  });

  it('sin contexto no se ve nada', async () => {
    const rows = await db().select().from(users);
    expect(rows).toEqual([]);
    const own = await withUser(db(), beaId, (tx) => tx.select().from(users));
    expect(own.map((u) => u.email)).toEqual(['bea@escuela.test']);
  });
});
