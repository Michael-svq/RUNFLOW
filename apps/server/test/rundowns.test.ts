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

async function createProgram(client: Client, name = 'Informativos Mediodía') {
  const res = await client.post('/api/programs', {
    name,
    type: 'informativo',
    defaultStartTime: '14:00',
    defaultDurationMin: 60,
  });
  expect(res.status).toBe(201);
  return res.body.program;
}

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

describe('programas', () => {
  it('se crean, se listan y se archivan', async () => {
    const p = await createProgram(admin);
    expect(p).toMatchObject({
      name: 'Informativos Mediodía',
      defaultStartTime: '14:00:00',
      archived: false,
    });
    const updated = await admin.patch(`/api/programs/${p.id}`, { archived: true });
    expect(updated.body.program.archived).toBe(true);
    const list = await admin.get('/api/programs');
    expect(list.body.programs).toHaveLength(1);
  });

  it('no admite nombres repetidos', async () => {
    await createProgram(admin, 'Deportes');
    const res = await admin.post('/api/programs', { name: 'deportes', type: 'deportes' });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.name).toMatch(/Ya existe/);
  });

  it('solo quien configura programas puede crearlos', async () => {
    const redactor = await userWithRole('redactor', 'r@chaneltv.test');
    expect((await redactor.post('/api/programs', { name: 'X', type: 'otro' })).status).toBe(403);
    expect((await redactor.get('/api/programs')).status).toBe(200);
  });
});

describe('escaletas', () => {
  it('se crean con el nombre del programa y se filtran por fecha', async () => {
    const p = await createProgram(admin);
    const r1 = await admin.post('/api/rundowns', {
      programId: p.id,
      airDate: '2026-11-20',
      startTime: '14:00',
      endTime: '15:00',
    });
    expect(r1.status).toBe(201);
    expect(r1.body.rundown).toMatchObject({
      title: 'Informativos Mediodía',
      programName: 'Informativos Mediodía',
      airDate: '2026-11-20',
      startTime: '14:00:00',
      status: 'borrador',
      lineCount: 0,
    });
    await admin.post('/api/rundowns', {
      programId: p.id,
      title: 'Especial elecciones',
      airDate: '2026-12-01',
      startTime: '21:00',
      endTime: '23:30',
    });
    const nov = await admin.get('/api/rundowns?from=2026-11-01&to=2026-11-30');
    expect(nov.body.rundowns.map((r: any) => r.title)).toEqual(['Informativos Mediodía']);
    const all = await admin.get('/api/rundowns');
    expect(all.body.rundowns.map((r: any) => r.title)).toEqual([
      'Especial elecciones',
      'Informativos Mediodía',
    ]);
  });

  it('se modifican y se borran (desaparecen del listado)', async () => {
    const p = await createProgram(admin);
    const { rundown } = (
      await admin.post('/api/rundowns', {
        programId: p.id,
        airDate: '2026-11-20',
        startTime: '14:00',
        endTime: '15:00',
      })
    ).body;
    const upd = await admin.patch(`/api/rundowns/${rundown.id}`, {
      title: 'Avance',
      status: 'lista',
    });
    expect(upd.body.rundown).toMatchObject({ title: 'Avance', status: 'lista' });
    expect((await admin.delete(`/api/rundowns/${rundown.id}`)).status).toBe(200);
    expect((await admin.get(`/api/rundowns/${rundown.id}`)).status).toBe(404);
    expect((await admin.get('/api/rundowns')).body.rundowns).toEqual([]);
  });

  it('valida programa, fecha y horas', async () => {
    const res = await admin.post('/api/rundowns', {
      programId: '00000000-0000-4000-8000-000000000000',
      airDate: '20-11-2026',
      startTime: '25:00',
      endTime: '15:00',
    });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.fields)).toEqual(
      expect.arrayContaining(['airDate', 'startTime']),
    );
    const bad = await admin.post('/api/rundowns', {
      programId: '00000000-0000-4000-8000-000000000000',
      airDate: '2026-11-20',
      startTime: '14:00',
      endTime: '15:00',
    });
    expect(bad.body.error.fields.programId).toBeDefined();
  });

  it('un redactor ve escaletas pero no puede crearlas', async () => {
    const p = await createProgram(admin);
    const redactor = await userWithRole('redactor', 'r@chaneltv.test');
    const res = await redactor.post('/api/rundowns', {
      programId: p.id,
      airDate: '2026-11-20',
      startTime: '14:00',
      endTime: '15:00',
    });
    expect(res.status).toBe(403);
    expect((await redactor.get('/api/rundowns')).status).toBe(200);
  });
});

describe('vistas guardadas', () => {
  const columns = [
    { key: 'estado', width: 64 },
    { key: 'num', width: 56 },
    { key: 'nombre', width: 300 },
  ];

  it('personales: solo las ve su dueño', async () => {
    const realizador = await userWithRole('realizador', 'real@chaneltv.test');
    const created = await realizador.post('/api/views', { name: 'Mi vista', columns });
    expect(created.status).toBe(201);
    expect(created.body.view).toMatchObject({ shared: false, canEdit: true });
    expect((await realizador.get('/api/views')).body.views).toHaveLength(1);
    expect((await admin.get('/api/views')).body.views).toHaveLength(0);
    // Tampoco puede borrarla otro (no la ve).
    expect((await admin.delete(`/api/views/${created.body.view.id}`)).status).toBe(404);
  });

  it('compartidas: solo quien configura programas las crea; todos las ven', async () => {
    const realizador = await userWithRole('realizador', 'real@chaneltv.test');
    expect((await realizador.post('/api/views', { name: 'X', shared: true, columns })).status).toBe(
      403,
    );
    const shared = await admin.post('/api/views', {
      name: 'Realización plató',
      shared: true,
      columns,
    });
    expect(shared.status).toBe(201);
    const seen = (await realizador.get('/api/views')).body.views;
    expect(seen).toEqual([
      expect.objectContaining({ name: 'Realización plató', shared: true, canEdit: false }),
    ]);
    expect(
      (
        await realizador.patch(`/api/views/${shared.body.view.id}`, {
          name: 'Y',
          shared: true,
          columns,
        })
      ).status,
    ).toBe(403);
    const renamed = await admin.patch(`/api/views/${shared.body.view.id}`, {
      name: 'Plató',
      shared: true,
      columns,
    });
    expect(renamed.body.view.name).toBe('Plató');
  });

  it('rechaza columnas desconocidas', async () => {
    const res = await admin.post('/api/views', {
      name: 'X',
      columns: [{ key: 'inventada', width: 100 }],
    });
    expect(res.status).toBe(400);
  });
});
