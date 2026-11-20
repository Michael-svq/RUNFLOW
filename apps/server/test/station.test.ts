import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertLine, readLines } from '@runflow/sync';
import {
  Client,
  createTestContext,
  PASSWORD,
  resetDb,
  setupFirstOrg,
  type TestContext,
} from './helpers';

/*
 * RunFlow Station en modo híbrido (M6): una segunda instalación, con su propia
 * base de datos, enlazada con la nube por su token.
 */

let cloud: TestContext;
let cloudUrl: string;
let admin: Client;
let orgId: string;
let rundownId: string;
let station: TestContext | undefined;

const today = new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  cloud = await createTestContext();
  await cloud.app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = cloud.app.server.address() as AddressInfo;
  cloudUrl = `http://127.0.0.1:${port}`;
});
afterAll(async () => {
  await cloud.close();
});
afterEach(async () => {
  await station?.close();
  station = undefined;
  // La nube guarda y cierra los documentos que tenía abiertos la Station.
  await waitFor(() => cloud.collab.openDocuments === 0);
});
beforeEach(async () => {
  await resetDb();
  await resetDb(process.env.TEST_STATION_OWNER_URL);
  const setup = await setupFirstOrg(cloud.app);
  admin = setup.admin;
  orgId = setup.me.activeOrg.id;
  const program = (await admin.post('/api/programs', { name: 'Noticias', type: 'informativo' }))
    .body.program;
  rundownId = (
    await admin.post('/api/rundowns', {
      programId: program.id,
      airDate: today,
      startTime: '14:00',
      endTime: '15:00',
    })
  ).body.rundown.id;
});

async function waitFor(check: () => boolean | Promise<boolean>, timeout = 8000): Promise<void> {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeout) throw new Error('Tiempo de espera agotado');
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** Da de alta una Station en la nube y arranca otra instalación enlazada con ella. */
async function startStation() {
  const created = await admin.post('/api/stations', { name: 'Plató 1' });
  expect(created.status).toBe(201);
  station = await createTestContext({
    DATABASE_URL: process.env.TEST_STATION_APP_URL!,
    RUNFLOW_MODE: 'station',
    CLOUD_URL: cloudUrl,
    STATION_TOKEN: created.body.token,
    STATION_SYNC_INTERVAL_MS: '150',
    MIN_GO_INTERVAL_MS: '0',
  });
  const sync = station.deps.stationSync!;
  sync.start();
  await waitFor(() => sync.status.lastSyncAt !== null && sync.status.syncedRundowns > 0);
  return { stationId: created.body.station.id as string, sync, ctx: station };
}

const linesAt = (ctx: TestContext) =>
  ctx.collab.withDoc(rundownId, orgId, (doc) => readLines(doc).map((l) => l.cells.nombre));

describe('RunFlow Station enlazada con la nube', () => {
  it('se entra en la Station con la cuenta de la nube y se ven sus escaletas', async () => {
    const { ctx } = await startStation();
    const status = await new Client(ctx.app).get('/api/setup/status');
    expect(status.body.needsSetup).toBe(false);
    const setup = await new Client(ctx.app).post('/api/setup', {
      orgName: 'Otra',
      name: 'X',
      email: 'x@x.test',
      password: PASSWORD,
    });
    expect(setup.status).toBe(409);

    const ana = new Client(ctx.app);
    await ana.login('ana@chaneltv.test', PASSWORD);
    const list = await ana.get(`/api/rundowns?from=${today}&to=${today}`);
    expect(list.status).toBe(200);
    expect(list.body.rundowns.map((r: { id: string }) => r.id)).toEqual([rundownId]);

    const st = await ana.get('/api/station/status');
    expect(st.body).toMatchObject({ mode: 'station', linked: true, sync: { online: true } });
  });

  it('los cambios de la escaleta van y vienen entre la nube y la Station', async () => {
    const { ctx } = await startStation();
    await ctx.collab.withDoc(rundownId, orgId, (doc) =>
      insertLine(doc, { cells: { nombre: 'Desde la Station', t_est: 30 } }),
    );
    await waitFor(async () => (await linesAt(cloud)).includes('Desde la Station'));
    await cloud.collab.withDoc(rundownId, orgId, (doc) =>
      insertLine(doc, { index: 1, cells: { nombre: 'Desde la nube', t_est: 20 } }),
    );
    await waitFor(async () => (await linesAt(ctx)).includes('Desde la nube'));
    expect(await linesAt(ctx)).toEqual(await linesAt(cloud));
  });

  it('sin internet se sigue trabajando y al volver se fusiona todo', async () => {
    const { ctx, sync } = await startStation();
    await sync.pause();
    await ctx.collab.withDoc(rundownId, orgId, (doc) =>
      insertLine(doc, { cells: { nombre: 'Offline Station', t_est: 30 } }),
    );
    await cloud.collab.withDoc(rundownId, orgId, (doc) =>
      insertLine(doc, { cells: { nombre: 'Mientras, en la nube', t_est: 30 } }),
    );
    expect(await linesAt(cloud)).not.toContain('Offline Station');
    expect(sync.status.online).toBe(false);

    sync.resume();
    await waitFor(async () => {
      const [a, b] = [await linesAt(ctx), await linesAt(cloud)];
      return a.length === 2 && JSON.stringify(a) === JSON.stringify(b);
    });
    await waitFor(() => sync.status.online);
  });

  it('aceptación: se corta internet en pleno directo, el estudio sigue y al volver todo se fusiona', async () => {
    const { ctx, sync } = await startStation();
    const ids = await ctx.collab.withDoc(rundownId, orgId, (doc) => [
      insertLine(doc, { cells: { nombre: 'Uno', tipo: 'ACTING', t_est: 30 } }),
      insertLine(doc, { cells: { nombre: 'Dos', tipo: 'TEMA', t_est: 30 } }),
      insertLine(doc, { cells: { nombre: 'Tres', tipo: 'TEMA', t_est: 30 } }),
    ]);
    await waitFor(async () => (await linesAt(cloud)).length === 3);
    const ana = new Client(ctx.app);
    await ana.login('ana@chaneltv.test', PASSWORD);
    const live = `/api/rundowns/${rundownId}/live`;
    expect((await ana.patch(live, { mode: 'manual' })).status).toBe(200);
    expect((await ana.post(`${live}/go`)).body.live.onAir.lineId).toBe(ids[0]);
    // Quien sigue el directo desde la nube lo ve…
    await waitFor(async () => (await admin.get(live)).body.live.onAir?.lineId === ids[0]);
    // …pero el directo lo controla la Station.
    expect((await admin.post(`${live}/go`)).status).toBe(409);

    await sync.pause(); // se cae internet
    expect((await ana.post(`${live}/go`)).body.live.onAir.lineId).toBe(ids[1]);
    await cloud.collab.withDoc(rundownId, orgId, (doc) =>
      insertLine(doc, { cells: { nombre: 'Última hora', tipo: 'TEMA', t_est: 20 } }),
    );
    expect((await admin.get(live)).body.live.onAir.lineId).toBe(ids[0]);

    sync.resume(); // vuelve internet
    await waitFor(async () => (await admin.get(live)).body.live.onAir?.lineId === ids[1]);
    const estado = (c: TestContext) =>
      c.collab.withDoc(
        rundownId,
        orgId,
        (doc) => readLines(doc).find((l) => l.id === ids[0])?.cells.estado,
      );
    await waitFor(async () => (await estado(cloud)) === 'E');
    await waitFor(async () => (await linesAt(ctx)).includes('Última hora'));
    expect(await linesAt(ctx)).toEqual(await linesAt(cloud));
  });

  it('lo creado en la Station sube a la nube', async () => {
    const { ctx } = await startStation();
    const ana = new Client(ctx.app);
    await ana.login('ana@chaneltv.test', PASSWORD);
    const program = (await ana.post('/api/programs', { name: 'Deportes', type: 'deportes' })).body
      .program;
    const created = await ana.post('/api/rundowns', {
      programId: program.id,
      airDate: today,
      startTime: '20:00',
      endTime: '20:30',
    });
    expect(created.status).toBe(201);
    const newId = created.body.rundown.id;
    await waitFor(async () => {
      const list = await admin.get(`/api/rundowns?from=${today}&to=${today}`);
      return list.body.rundowns.some((r: { id: string }) => r.id === newId);
    });
    // Y su documento también se sincroniza.
    await ctx.collab.withDoc(newId, orgId, (doc) =>
      insertLine(doc, { cells: { nombre: 'Portada deportes' } }),
    );
    await waitFor(async () =>
      cloud.collab.withDoc(newId, orgId, (doc) => readLines(doc).length === 1),
    );
  });

  it('quien sale de la empresa en la nube tampoco entra en la Station', async () => {
    const roles = (await admin.get('/api/roles')).body.roles as { id: string; key: string }[];
    const created = await admin.post('/api/users', {
      name: 'Rodrigo',
      email: 'rodrigo@chaneltv.test',
      roleId: roles.find((r) => r.key === 'redactor')!.id,
      password: 'temporal-12345',
    });
    expect(created.status).toBe(201);
    const { ctx, sync } = await startStation();
    const rodrigo = new Client(ctx.app);
    expect(
      (
        await rodrigo.post('/api/auth/login', {
          email: 'rodrigo@chaneltv.test',
          password: 'temporal-12345',
        })
      ).status,
    ).toBe(200);

    const members = (await admin.get('/api/users')).body.members as {
      userId: string;
      email: string;
    }[];
    const m = members.find((x) => x.email === 'rodrigo@chaneltv.test')!;
    expect((await admin.delete(`/api/users/${m.userId}`)).status).toBe(200);
    // En la siguiente sincronización deja de poder entrar en la Station.
    await waitFor(
      async () =>
        (
          await new Client(ctx.app).post('/api/auth/login', {
            email: 'rodrigo@chaneltv.test',
            password: 'temporal-12345',
          })
        ).status !== 200,
    );
    expect(sync.status.online).toBe(true);
  });

  it('una Station revocada deja de sincronizar', async () => {
    const { stationId, sync } = await startStation();
    expect((await admin.get('/api/stations')).body.stations).toHaveLength(1);
    expect((await admin.delete(`/api/stations/${stationId}`)).status).toBe(200);
    await waitFor(() => sync.status.online === false);
    expect(sync.status.lastError).toMatch(/401/);
    const direct = await cloud.app.inject({
      method: 'GET',
      url: '/api/station-sync/snapshot',
      headers: { authorization: 'Bearer token-que-no-existe-0000000000' },
    });
    expect(direct.statusCode).toBe(401);
  });
});
