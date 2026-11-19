import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  Client,
  createTestContext,
  PASSWORD,
  resetDb,
  roleId,
  setupFirstOrg,
  type TestContext,
} from './helpers';

let ctx: TestContext;
let admin: Client;

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await resetDb();
  ({ admin } = await setupFirstOrg(ctx.app));
});

async function addUser(email: string, role: string, name = email.split('@')[0]!) {
  const res = await admin.post('/api/users', {
    name,
    email,
    roleId: await roleId(admin, role),
    password: 'temporal-12345',
  });
  expect(res.status).toBe(201);
  return res.body.member;
}

describe('gestión de usuarios', () => {
  it('crea y lista usuarios con su rol', async () => {
    await addUser('rafa@chaneltv.test', 'redactor', 'Rafa');
    await addUser('rosa@chaneltv.test', 'realizador', 'Rosa');
    const res = await admin.get('/api/users');
    expect(res.status).toBe(200);
    const byEmail = Object.fromEntries(res.body.members.map((m: any) => [m.email, m]));
    expect(byEmail['rafa@chaneltv.test'].role.key).toBe('redactor');
    expect(byEmail['rosa@chaneltv.test'].role.key).toBe('realizador');
    expect(byEmail['ana@chaneltv.test'].role.key).toBe('admin');
    expect(res.body.members).toHaveLength(3);
  });

  it('exige contraseña para cuentas nuevas', async () => {
    const res = await admin.post('/api/users', {
      name: 'Sin clave',
      email: 'sinclave@chaneltv.test',
      roleId: await roleId(admin, 'redactor'),
    });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.password).toBeDefined();
  });

  it('no permite duplicar un miembro', async () => {
    await addUser('rafa@chaneltv.test', 'redactor');
    const res = await admin.post('/api/users', {
      name: 'Rafa',
      email: 'RAFA@chaneltv.test',
      roleId: await roleId(admin, 'redactor'),
      password: 'temporal-12345',
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('already_member');
  });

  it('cambia rol, nombre y estado', async () => {
    const rafa = await addUser('rafa@chaneltv.test', 'redactor');
    const res = await admin.patch(`/api/users/${rafa.userId}`, {
      name: 'Rafael',
      roleId: await roleId(admin, 'productor'),
      active: false,
    });
    expect(res.status).toBe(200);
    expect(res.body.member).toMatchObject({
      name: 'Rafael',
      active: false,
      role: { key: 'productor' },
    });
  });

  it('un usuario desactivado no puede trabajar en la empresa', async () => {
    const rafa = await addUser('rafa@chaneltv.test', 'redactor');
    const c = new Client(ctx.app);
    await c.login('rafa@chaneltv.test', 'temporal-12345');
    await c.post('/api/me/password', { currentPassword: 'temporal-12345', newPassword: PASSWORD });
    expect((await c.get('/api/roles')).status).toBe(200);

    await admin.patch(`/api/users/${rafa.userId}`, { active: false });
    expect((await c.get('/api/roles')).status).toBe(403);
    expect((await c.get('/api/auth/me')).body.activeOrg).toBeNull();
  });

  it('restablece la contraseña y obliga a cambiarla', async () => {
    const rafa = await addUser('rafa@chaneltv.test', 'redactor');
    const res = await admin.post(`/api/users/${rafa.userId}/password`, {
      password: 'reiniciada-12345',
    });
    expect(res.status).toBe(200);
    const me = await new Client(ctx.app).login('rafa@chaneltv.test', 'reiniciada-12345');
    expect(me.user.mustChangePassword).toBe(true);
  });

  it('elimina un usuario de la empresa y borra la cuenta si no tiene otras', async () => {
    const rafa = await addUser('rafa@chaneltv.test', 'redactor');
    expect((await admin.delete(`/api/users/${rafa.userId}`)).status).toBe(200);
    const list = await admin.get('/api/users');
    expect(list.body.members.map((m: any) => m.email)).not.toContain('rafa@chaneltv.test');
    const login = await new Client(ctx.app).post('/api/auth/login', {
      email: 'rafa@chaneltv.test',
      password: 'temporal-12345',
    });
    expect(login.status).toBe(401);
  });
});

describe('protecciones', () => {
  it('nadie puede cambiarse a sí mismo el rol ni eliminarse', async () => {
    const me = (await admin.get('/api/auth/me')).body;
    const selfRole = await admin.patch(`/api/users/${me.user.id}`, {
      roleId: await roleId(admin, 'redactor'),
    });
    expect(selfRole.status).toBe(409);
    expect((await admin.delete(`/api/users/${me.user.id}`)).status).toBe(409);
  });

  it('con dos administradores se puede degradar a uno', async () => {
    const segundo = await addUser('segundo@chaneltv.test', 'admin');
    const res = await admin.patch(`/api/users/${segundo.userId}`, {
      roleId: await roleId(admin, 'redactor'),
    });
    expect(res.status).toBe(200);
    expect(res.body.member.role.key).toBe('redactor');
  });

  it('la empresa no puede quedarse sin administrador activo', async () => {
    // Un rol personalizado con permiso de gestionar usuarios (los roles se podrán editar en M5).
    const owner = new pg.Client({ connectionString: process.env.TEST_OWNER_URL });
    await owner.connect();
    await owner.query(
      `insert into roles (org_id, key, name, permissions)
       select org_id, 'personal', 'Jefe de personal', array['rundown.view','users.manage'] from roles where key = 'admin'`,
    );
    await owner.end();
    await addUser('jefe@chaneltv.test', 'personal');
    const jefe = new Client(ctx.app);
    await jefe.login('jefe@chaneltv.test', 'temporal-12345');
    await jefe.post('/api/me/password', {
      currentPassword: 'temporal-12345',
      newPassword: PASSWORD,
    });

    const ana = (await admin.get('/api/auth/me')).body.user.id;
    for (const res of [
      await jefe.patch(`/api/users/${ana}`, { roleId: await roleId(jefe, 'redactor') }),
      await jefe.patch(`/api/users/${ana}`, { active: false }),
      await jefe.delete(`/api/users/${ana}`),
    ]) {
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('last_admin');
    }
    // Cambiar solo el nombre sí está permitido.
    expect((await jefe.patch(`/api/users/${ana}`, { name: 'Ana A.' })).status).toBe(200);
  });

  it('solo quien tiene el permiso puede gestionar usuarios', async () => {
    await addUser('rafa@chaneltv.test', 'redactor');
    const rafa = new Client(ctx.app);
    await rafa.login('rafa@chaneltv.test', 'temporal-12345');
    await rafa.post('/api/me/password', {
      currentPassword: 'temporal-12345',
      newPassword: PASSWORD,
    });
    expect((await rafa.get('/api/users')).status).toBe(403);
    expect(
      (
        await rafa.post('/api/users', {
          name: 'X',
          email: 'x@chaneltv.test',
          roleId: await roleId(rafa, 'admin'),
          password: PASSWORD,
        })
      ).status,
    ).toBe(403);
    // Pero sí puede ver los roles de su empresa.
    expect((await rafa.get('/api/roles')).status).toBe(200);
  });

  it('un rol de otra empresa no es válido', async () => {
    const res = await admin.post('/api/users', {
      name: 'X',
      email: 'x@chaneltv.test',
      roleId: '00000000-0000-4000-8000-000000000000',
      password: PASSWORD,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.roleId).toBeDefined();
  });
});
