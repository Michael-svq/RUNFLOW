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

/* F3.1 Producción: convocatorias, personal, hoja de llamada, invitados y logística. */

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

const EVENT = {
  title: 'Gala fin de curso',
  kind: 'directo',
  startsAt: '2026-12-18T19:00:00+01:00',
  endsAt: '2026-12-18T22:00:00+01:00',
  location: 'Plató 1',
};

describe('producción', () => {
  it('convocatoria con equipo, invitados y logística; resumen en el calendario', async () => {
    const created = await admin.post('/api/production/events', EVENT);
    expect(created.status).toBe(201);
    const id = created.body.event.id;
    expect(created.body.event).toMatchObject({ title: 'Gala fin de curso', status: 'previsto' });

    const cam = await admin.post('/api/production/crew', {
      name: 'Luis Cámara',
      role: 'Cámara 1',
      phone: '+34 600 000 001',
    });
    expect(cam.status).toBe(201);
    const real = await admin.post('/api/production/crew', { name: 'Eva', role: 'Realización' });

    let d = await admin.post(`/api/production/events/${id}/calls`, {
      crewId: cam.body.crew.id,
      callAt: '2026-12-18T16:30:00+01:00',
    });
    expect(d.status).toBe(201);
    expect(d.body.calls[0]).toMatchObject({ name: 'Luis Cámara', role: 'Cámara 1' });
    d = await admin.post(`/api/production/events/${id}/calls`, {
      crewId: real.body.crew.id,
      role: 'Realizadora',
    });
    expect(d.body.calls).toHaveLength(2);
    // Dos veces la misma persona: no.
    const dup = await admin.post(`/api/production/events/${id}/calls`, {
      crewId: cam.body.crew.id,
    });
    expect(dup.status).toBe(409);

    d = await admin.post(`/api/production/events/${id}/guests`, {
      name: 'Marta Ruiz',
      description: 'Directora del centro',
      arrivalAt: '2026-12-18T18:00:00+01:00',
    });
    expect(d.status).toBe(201);
    expect(d.body.guests[0]).toMatchObject({ name: 'Marta Ruiz', status: 'pendiente' });
    d = await admin.post(`/api/production/events/${id}/logistics`, {
      category: 'catering',
      description: 'Bocadillos para 20',
    });
    expect(d.body.logistics[0]).toMatchObject({ category: 'catering', done: false });

    const list = await admin.get(
      '/api/production/events?from=2026-12-01T00:00:00Z&to=2027-01-01T00:00:00Z',
    );
    expect(list.body.events).toHaveLength(1);
    expect(list.body.events[0]).toMatchObject({
      crewTotal: 2,
      crewConfirmed: 0,
      guestTotal: 1,
      logisticsPending: 1,
    });
    const empty = await admin.get(
      '/api/production/events?from=2027-01-01T00:00:00Z&to=2027-02-01T00:00:00Z',
    );
    expect(empty.body.events).toHaveLength(0);

    // Marcar la logística como hecha y el invitado como llegado.
    await admin.patch(`/api/production/logistics/${d.body.logistics[0].id}`, { done: true });
    d = await admin.patch(`/api/production/guests/${d.body.guests[0].id}`, { status: 'llegado' });
    expect(d.body.guests[0].status).toBe('llegado');
    expect(d.body.event.logisticsPending).toBe(0);

    // Duplicar a la semana siguiente: horas de citación desplazadas.
    const copy = await admin.post(`/api/production/events/${id}/duplicate`, {
      startsAt: '2026-12-25T19:00:00+01:00',
    });
    expect(copy.status).toBe(201);
    expect(copy.body.calls).toHaveLength(2);
    expect(copy.body.guests).toHaveLength(0);
    const luis = copy.body.calls.find((c: { name: string }) => c.name === 'Luis Cámara');
    expect(luis.callAt).toBe('2026-12-25T15:30:00.000Z');
    expect(luis.status).toBe('pendiente');
  });

  it('confirmación por enlace sin cuenta', async () => {
    const { body } = await admin.post('/api/production/events', EVENT);
    const crew = await admin.post('/api/production/crew', { name: 'Luis', role: 'Cámara' });
    const d = await admin.post(`/api/production/events/${body.event.id}/calls`, {
      crewId: crew.body.crew.id,
    });
    const token = d.body.calls[0].token;

    const anon = new Client(ctx.app);
    const view = await anon.get(`/api/public/call/${token}`);
    expect(view.status).toBe(200);
    expect(view.body.call).toMatchObject({
      orgName: 'Chanel TV',
      name: 'Luis',
      role: 'Cámara',
      status: 'pendiente',
      event: { title: 'Gala fin de curso', location: 'Plató 1' },
    });
    const ok = await anon.post(`/api/public/call/${token}`, {
      status: 'confirmado',
      reply: 'Llego a las 16:00',
    });
    expect(ok.status).toBe(200);
    expect(ok.body.call.status).toBe('confirmado');

    const detail = await admin.get(`/api/production/events/${body.event.id}`);
    expect(detail.body.calls[0]).toMatchObject({
      status: 'confirmado',
      reply: 'Llego a las 16:00',
    });
    expect(detail.body.event.crewConfirmed).toBe(1);

    // Nuevo enlace: el anterior deja de valer.
    await admin.post(`/api/production/calls/${d.body.calls[0].id}/token`);
    expect((await anon.get(`/api/public/call/${token}`)).status).toBe(404);
    expect((await anon.get('/api/public/call/no-existe-este-token-xx')).status).toBe(404);
  });

  it('permisos y aislamiento', async () => {
    const realizador = await userWithRole('realizador', 'real@chaneltv.test');
    const redactor = await userWithRole('redactor', 'red@chaneltv.test');
    const { body } = await admin.post('/api/production/events', EVENT);
    // El realizador ve la producción pero no la cambia; el redactor ni la ve.
    expect((await realizador.get(`/api/production/events/${body.event.id}`)).status).toBe(200);
    expect((await realizador.post('/api/production/events', EVENT)).status).toBe(403);
    expect((await redactor.get('/api/production/events')).status).toBe(403);

    // Un programa de otra empresa no se puede enlazar.
    const res = await admin.post('/api/production/events', {
      ...EVENT,
      programId: '00000000-0000-4000-8000-000000000000',
    });
    expect(res.status).toBe(404);
    // Fin antes del inicio.
    const bad = await admin.patch(`/api/production/events/${body.event.id}`, {
      endsAt: '2026-12-18T10:00:00+01:00',
    });
    expect(bad.status).toBe(400);
  });

  it('enlazada a una escaleta toma su programa', async () => {
    const p = await admin.post('/api/programs', { name: 'Gala', type: 'evento' });
    const r = await admin.post('/api/rundowns', {
      programId: p.body.program.id,
      title: 'Gala 2026',
      airDate: '2026-12-18',
      startTime: '20:00',
      endTime: '22:00',
    });
    expect(r.status).toBe(201);
    const res = await admin.post('/api/production/events', {
      ...EVENT,
      rundownId: r.body.rundown.id,
    });
    expect(res.body.event).toMatchObject({
      programName: 'Gala',
      rundownTitle: 'Gala 2026',
    });
  });
});
