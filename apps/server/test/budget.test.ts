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

/* F3.2 Presupuesto: partidas, resumen previsto/real y CSV. */

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

describe('presupuesto', () => {
  it('partidas por convocatoria con resumen y exportación', async () => {
    const p = await admin.post('/api/programs', { name: 'Gala', type: 'evento' });
    const ev = await admin.post('/api/production/events', {
      title: 'Gala fin de curso',
      startsAt: '2026-12-18T19:00:00+01:00',
      programId: p.body.program.id,
    });
    const eventId = ev.body.event.id;

    const a = await admin.post('/api/budget/lines', {
      eventId,
      category: 'catering',
      concept: 'Bocadillos',
      plannedCents: 30000,
    });
    expect(a.status).toBe(201);
    // Toma el programa y la fecha de la convocatoria.
    expect(a.body.line).toMatchObject({
      programName: 'Gala',
      eventTitle: 'Gala fin de curso',
      date: '2026-12-18',
      actualCents: null,
    });
    await admin.post('/api/budget/lines', {
      eventId,
      category: 'personal',
      concept: 'Cámaras',
      plannedCents: 100000,
      actualCents: 90000,
      paid: true,
    });
    await admin.post('/api/budget/lines', {
      category: 'otros',
      concept: 'Sin convocatoria',
      plannedCents: 5000,
      date: '2027-01-10',
    });

    const upd = await admin.patch(`/api/budget/lines/${a.body.line.id}`, { actualCents: 34000 });
    expect(upd.body.line).toMatchObject({ actualCents: 34000, date: '2026-12-18' });

    const byEvent = await admin.get(`/api/budget/lines?eventId=${eventId}`);
    expect(byEvent.body.lines).toHaveLength(2);
    expect(byEvent.body.summary.total).toMatchObject({
      plannedCents: 130000,
      actualCents: 124000,
      deviationCents: -6000,
      pendingPaymentCents: 34000,
    });
    const byDate = await admin.get('/api/budget/lines?from=2027-01-01&to=2027-01-31');
    expect(byDate.body.lines.map((l: { concept: string }) => l.concept)).toEqual([
      'Sin convocatoria',
    ]);

    const csv = await ctx.app.inject({
      method: 'GET',
      url: `/api/budget/export.csv?eventId=${eventId}`,
      headers: { cookie: admin.cookie! },
    });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body).toContain('Bocadillos');
    expect(csv.body).toContain('340,00');

    // Borrar la convocatoria no borra el gasto.
    await admin.delete(`/api/production/events/${eventId}`);
    const all = await admin.get('/api/budget/lines');
    expect(all.body.lines).toHaveLength(3);
  });

  it('permisos', async () => {
    const produccion = await userWithRole('produccion', 'prod@chaneltv.test');
    const redactor = await userWithRole('redactor', 'red@chaneltv.test');
    // Producción ve el presupuesto pero no lo cambia; el redactor no lo ve.
    expect((await produccion.get('/api/budget/lines')).status).toBe(200);
    expect(
      (await produccion.post('/api/budget/lines', { concept: 'X', plannedCents: 1 })).status,
    ).toBe(403);
    expect((await redactor.get('/api/budget/lines')).status).toBe(403);
    // Importes negativos o con decimales no.
    expect((await admin.post('/api/budget/lines', { concept: 'X', plannedCents: -1 })).status).toBe(
      400,
    );
    expect(
      (await admin.post('/api/budget/lines', { concept: 'X', plannedCents: 1.5 })).status,
    ).toBe(400);
    expect(
      (
        await admin.post('/api/budget/lines', {
          concept: 'X',
          eventId: '00000000-0000-4000-8000-000000000000',
        })
      ).status,
    ).toBe(404);
  });
});
