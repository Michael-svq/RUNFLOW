import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readLines } from '@runflow/sync';
import { DEMO_ACCOUNT, DEMO_USERS, ensureDemoUsers, seedDemo } from '../src/demo/seed';
import { Client, createTestContext, resetDb, type TestContext } from './helpers';

/* Estudio virtual: datos de ejemplo la primera vez (DEMO_SEED). */

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await resetDb();
});

describe('estudio virtual', () => {
  it('crea empresa, equipos y una escaleta lista para dar GO; solo una vez', async () => {
    const opts = { studioHost: 'estudio', runflowUrl: 'http://localhost:3000' };
    expect(await seedDemo(ctx.app, ctx.deps, opts)).toBe(true);
    expect(await seedDemo(ctx.app, ctx.deps, opts)).toBe(false);

    const demo = new Client(ctx.app);
    const me = await demo.login(DEMO_ACCOUNT.email, DEMO_ACCOUNT.password);
    expect(me.activeOrg.name).toBe('Estudio de pruebas');

    const devices = (await demo.get('/api/devices')).body.devices;
    expect(devices.map((d: { kind: string }) => d.kind).sort()).toEqual(['casparcg', 'obs']);
    expect(devices.find((d: { kind: string }) => d.kind === 'casparcg').config).toMatchObject({
      host: 'estudio',
      port: 5250,
      templateBaseUrl: 'http://localhost:3000',
    });

    const rundowns = (await demo.get('/api/rundowns?from=2000-01-01&to=2100-01-01')).body.rundowns;
    expect(rundowns).toHaveLength(1);
    const id = rundowns[0].id;
    const live = (await demo.get(`/api/rundowns/${id}/live`)).body.live;
    expect(live).toMatchObject({ mode: 'manual', armed: true });
    const lines = await ctx.collab.withDoc(id, me.activeOrg.id, (doc) => readLines(doc));
    expect(lines.map((l) => l.cells.nombre)).toEqual([
      'CABECERA',
      'PRESENTACIÓN',
      'PRESUPUESTOS',
      'ENTREVISTA',
      'DEPORTES',
      'DESPEDIDA',
    ]);
    const outputs = (await demo.get(`/api/rundowns/${id}/outputs`)).body.outputs;
    expect(outputs[0]).toMatchObject({ kind: 'prompter' });

    // Una cuenta por área, lista para entrar (y solo se crean una vez).
    expect(await ensureDemoUsers(ctx.deps)).toBe(3);
    expect(await ensureDemoUsers(ctx.deps)).toBe(0);
    for (const u of DEMO_USERS) {
      const c = new Client(ctx.app);
      const m = await c.login(u.email, DEMO_ACCOUNT.password);
      expect(m.user.mustChangePassword).toBe(false);
      expect(m.activeOrg.role.key).toBe(u.role);
    }
    const dir = new Client(ctx.app);
    const m = await dir.login('dirtv@runflow.test', DEMO_ACCOUNT.password);
    expect(m.activeOrg.permissions).toEqual(
      expect.arrayContaining(['live.go', 'cg.fire', 'devices.configure', 'station.admin']),
    );
    expect((await dir.get('/api/devices')).status).toBe(200);
  });
});
