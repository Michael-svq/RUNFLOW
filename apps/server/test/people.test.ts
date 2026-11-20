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

async function userWithRole(role: string, email: string) {
  await admin.post('/api/users', {
    name: role,
    email,
    roleId: await roleId(admin, role),
    password: 'temporal-12345',
  });
  const c = new Client(ctx.app);
  await c.login(email, 'temporal-12345');
  await c.post('/api/me/password', { currentPassword: 'temporal-12345', newPassword: PASSWORD });
  return c;
}

describe('personas y cargos', () => {
  it('se crean, se buscan por nombre o cargo, se editan y se borran', async () => {
    const a = await admin.post('/api/people', { name: 'Ana Pérez', title: 'Ministra de Hacienda' });
    expect(a.status).toBe(201);
    await admin.post('/api/people', { name: 'Andrés López', title: 'Ciclista BMX' });
    await admin.post('/api/people', { name: 'Pablo Ruiz', title: 'Jugador de petanca' });
    expect((await admin.get('/api/people?q=an')).body.people.map((p: any) => p.name)).toEqual([
      'Ana Pérez',
      'Andrés López',
      'Pablo Ruiz', // "petanca"
    ]);
    expect((await admin.get('/api/people?q=hacienda')).body.people).toHaveLength(1);
    expect((await admin.get('/api/people?q=100%')).body.people).toHaveLength(0);
    const upd = await admin.patch(`/api/people/${a.body.person.id}`, {
      name: 'Ana Pérez',
      title: 'Ministra',
    });
    expect(upd.body.person.title).toBe('Ministra');
    expect((await admin.delete(`/api/people/${a.body.person.id}`)).status).toBe(200);
    expect((await admin.get('/api/people')).body.people).toHaveLength(2);
  });

  it('no admite la misma persona con el mismo cargo', async () => {
    await admin.post('/api/people', { name: 'Ana', title: 'Ministra' });
    const dup = await admin.post('/api/people', { name: 'ANA', title: 'ministra' });
    expect(dup.status).toBe(400);
    expect((await admin.post('/api/people', { name: 'Ana', title: 'Portavoz' })).status).toBe(201);
  });

  it('solo lectura puede consultar pero no modificar', async () => {
    const lector = await userWithRole('lectura', 'l@chaneltv.test');
    expect((await lector.get('/api/people')).status).toBe(200);
    expect((await lector.post('/api/people', { name: 'X' })).status).toBe(403);
    const redactor = await userWithRole('redactor', 'r@chaneltv.test');
    expect((await redactor.post('/api/people', { name: 'X' })).status).toBe(201);
  });
});
