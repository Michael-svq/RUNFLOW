import dgram from 'node:dgram';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertLine, writeScript, type ScriptBlock } from '@runflow/sync';
import { CasparSimulator, tokenize } from '../src/cg/simulator';
import {
  Client,
  createTestContext,
  resetDb,
  roleId,
  setupFirstOrg,
  PASSWORD,
  type TestContext,
} from './helpers';

/*
 * M7 RunFlow CG con un CasparCG simulado (AMCP + OSC).
 * Aceptación: un VTR con 2 rótulos por TC y un rótulo manual en cámara salen
 * en su momento.
 */

let ctx: TestContext;
let sim: CasparSimulator;
let admin: Client;
let orgId: string;
let rundownId: string;
const ids: Record<string, string> = {};

async function freeUdpPort(): Promise<number> {
  const s = dgram.createSocket('udp4');
  await new Promise<void>((r) => s.bind(0, r));
  const port = (s.address() as { port: number }).port;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

const rotulo = (
  id: string,
  type: string,
  f0: string,
  f1 = '',
  tcIn = '',
  tcOut = '',
): ScriptBlock => ({
  kind: 'rotulo',
  id,
  type,
  f0,
  f1,
  f2: '',
  f3: '',
  tcIn,
  tcOut,
});

beforeAll(async () => {
  ctx = await createTestContext({
    MIN_GO_INTERVAL_MS: '0',
    PUBLIC_URL: 'http://runflow.test:8080',
  });
});
afterAll(async () => {
  await ctx.close();
});
afterEach(async () => {
  await sim.stop();
});

beforeEach(async () => {
  await resetDb();
  const oscPort = await freeUdpPort();
  sim = new CasparSimulator({ clips: [{ name: 'PIEZA_GOBIERNO', duration: 4 }], oscPort });
  const port = await sim.start();
  const setup = await setupFirstOrg(ctx.app);
  admin = setup.admin;
  orgId = setup.me.activeOrg.id;
  // Rótulos de 1 s para que la prueba sea corta; cámara con salida manual.
  expect(
    (await admin.patch('/api/org/settings', { graphicSeconds: 1, cameraAutoOut: false })).status,
  ).toBe(200);
  const device = await admin.post('/api/devices', {
    name: 'CasparCG plató',
    kind: 'casparcg',
    config: { host: '127.0.0.1', port, oscPort },
  });
  expect(device.status).toBe(201);
  const program = (await admin.post('/api/programs', { name: 'Noticias', type: 'informativo' }))
    .body.program;
  rundownId = (
    await admin.post('/api/rundowns', {
      programId: program.id,
      airDate: '2026-11-20',
      startTime: '14:00',
      endTime: '15:00',
    })
  ).body.rundown.id;
  await ctx.collab.withDoc(rundownId, orgId, (doc) => {
    ids.cam = insertLine(doc, { cells: { nombre: 'Presentación', tipo: 'ACTING', t_est: 30 } });
    ids.vtr = insertLine(doc, {
      cells: { nombre: 'Presupuestos', tipo: 'VTR', dur_vtr: 4, clip: 'PIEZA_GOBIERNO' },
    });
    ids.tema = insertLine(doc, { cells: { nombre: 'Tiempo', tipo: 'TEMA', t_est: 60 } });
    writeScript(doc, ids.cam, [
      { kind: 'paso', text: 'Buenas tardes.' },
      rotulo('g-cam', 'TOT', 'Ana Pérez', 'Presentadora'),
    ]);
    writeScript(doc, ids.vtr, [
      rotulo('g-tot', 'TOT', 'María Jesús Montero', 'Ministra de Hacienda', '00:01', '00:02'),
      rotulo('g-loc', 'LOC', 'Madrid', '', '00:02'),
    ]);
  });
  await expect
    .poll(async () => (await admin.get('/api/devices')).body.devices[0].status.connected)
    .toBe(true);
});

const live = () => `/api/rundowns/${rundownId}/live`;
const cgUrl = () => `/api/rundowns/${rundownId}/cg`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('RunFlow CG', () => {
  it('sirve las plantillas HTML de los 6 tipos y la fuente', async () => {
    for (const type of ['TOT', 'LOC', 'INF', 'DAT', 'BAN', 'HIG', 'RRS']) {
      const res = await ctx.app.inject({ method: 'GET', url: `/cg/templates/${type}.html` });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('window.update');
    }
    expect(
      (await ctx.app.inject({ method: 'GET', url: '/cg/templates/XXX.html' })).statusCode,
    ).toBe(404);
    const font = await ctx.app.inject({ method: 'GET', url: '/cg/fonts/montserrat-900.woff2' });
    expect(font.statusCode).toBe(200);
    expect(font.rawPayload.length).toBeGreaterThan(1000);
  });

  it('aceptación: el VTR con 2 rótulos por TC y el rótulo manual de cámara salen en su momento', async () => {
    await admin.patch(live(), { mode: 'manual', armed: true });
    // GO a cámara: el VTR siguiente queda precargado.
    expect((await admin.post(`${live()}/go`)).body.live.onAir.lineId).toBe(ids.cam);
    await expect.poll(() => sim.sent('LOADBG 1-10').length).toBe(1);
    expect(tokenize(sim.sent('LOADBG 1-10')[0]!.command)[2]).toBe('PIEZA_GOBIERNO');

    // ▶ manual del rótulo de cámara: entra y se queda (salida manual).
    const take = await admin.post(`${cgUrl()}/take`, { graphicId: 'g-cam' });
    expect(take.status).toBe(200);
    expect(take.body.cg.graphics['g-cam']).toMatchObject({ lineId: ids.cam, outAt: null });
    const add = tokenize(sim.sent('CG 1-20 ADD')[0]!.command);
    expect(add[4]).toBe('http://runflow.test:8080/cg/templates/TOT.html');
    expect(JSON.parse(add[6]!)).toMatchObject({
      type: 'TOT',
      fields: { f0: 'ANA PÉREZ', f1: 'PRESENTADORA' },
      design: { primary: '#FF7A1A' },
    });
    await sleep(1300);
    expect((await admin.get(cgUrl())).body.cg.graphics['g-cam']).toBeDefined();

    // GO al VTR: el clip precargado arranca y el rótulo de cámara sale.
    const goAt = Date.now();
    await admin.post(`${live()}/go`);
    await expect.poll(() => sim.sent('PLAY 1-10').length).toBe(1);
    expect(sim.sent('PLAY 1-10')[0]!.command).toBe('PLAY 1-10'); // sin nombre: el precargado
    expect(sim.sent('CG 1-20 STOP').length).toBe(1);

    // TOT en 00:01, sale en 00:02; LOC entra en 00:02 y sale a 1 s.
    await expect.poll(() => sim.sent('CG 1-20 ADD').length, { timeout: 3000 }).toBe(2);
    const totAt = sim.sent('CG 1-20 ADD')[1]!.at - goAt;
    expect(totAt).toBeGreaterThan(800);
    expect(totAt).toBeLessThan(1500);
    expect(JSON.parse(tokenize(sim.sent('CG 1-20 ADD')[1]!.command)[6]!).fields.f0).toBe(
      'MARÍA JESÚS MONTERO',
    );
    await expect.poll(() => sim.sent('CG 1-20 ADD').length, { timeout: 3000 }).toBe(3);
    const loc = sim.sent('CG 1-20 ADD')[2]!;
    expect(loc.command).toContain('/cg/templates/LOC.html');
    expect(loc.at - goAt).toBeGreaterThan(1800);
    expect(loc.at - goAt).toBeLessThan(2600);
    await expect.poll(() => sim.layer(1, 20).templateVisible, { timeout: 3000 }).toBe(false);
    const state = (await admin.get(cgUrl())).body.cg;
    expect(Object.keys(state.graphics)).toEqual([]);
    expect(Object.keys(state.done).sort()).toEqual(['g-cam', 'g-loc', 'g-tot']);
    expect(state.clip).toMatchObject({ lineId: ids.vtr, name: 'PIEZA_GOBIERNO', state: 'playing' });

    // GO a la siguiente: el VTR se para.
    await admin.post(`${live()}/go`);
    await expect.poll(() => sim.sent('STOP 1-10').length).toBe(1);
    expect((await admin.get(cgUrl())).body.cg.clip).toBeNull();
  });

  it('desarmado no mueve equipos; los rótulos manuales siguen funcionando', async () => {
    await admin.patch(live(), { mode: 'manual', armed: false });
    await admin.post(`${live()}/go`);
    await admin.post(`${live()}/go`);
    await sleep(1500);
    expect(sim.sent('LOADBG')).toHaveLength(0);
    expect(sim.sent('PLAY')).toHaveLength(0);
    expect(sim.sent('CG')).toHaveLength(0);
    await admin.post(`${cgUrl()}/take`, { graphicId: 'g-tot' });
    expect(sim.sent('CG 1-20 ADD')).toHaveLength(1);
    await admin.post(`${cgUrl()}/out`, { graphicId: 'g-tot' });
    expect(sim.sent('CG 1-20 STOP')).toHaveLength(1);
  });

  it('si CasparCG no responde, el directo sigue y se avisa', async () => {
    await admin.patch(live(), { mode: 'manual', armed: true });
    await sim.stop();
    await expect
      .poll(async () => (await admin.get('/api/devices')).body.devices[0].status.connected)
      .toBe(false);
    expect((await admin.post(`${live()}/go`)).status).toBe(200);
    const res = await admin.post(`${live()}/go`);
    expect(res.status).toBe(200);
    expect(res.body.live.onAir.lineId).toBe(ids.vtr);
    await expect.poll(async () => (await admin.get(cgUrl())).body.cg.warning).toMatch(/CasparCG/);
    sim = new CasparSimulator(); // para afterEach
    await sim.start();
  });

  it('control manual del VTR y permisos', async () => {
    await admin.patch(live(), { mode: 'manual', armed: true });
    await admin.post(`${live()}/go`);
    await admin.post(`${live()}/go`);
    await expect.poll(() => sim.sent('PLAY 1-10').length).toBe(1);
    expect((await admin.post(`${cgUrl()}/clip`, { action: 'pause' })).body.cg.clip.state).toBe(
      'paused',
    );
    expect(sim.sent('PAUSE 1-10')).toHaveLength(1);
    expect((await admin.post(`${cgUrl()}/clip`, { action: 'resume' })).body.cg.clip.state).toBe(
      'playing',
    );
    expect((await admin.post(`${cgUrl()}/clip`, { action: 'stop' })).body.cg.clip.state).toBe(
      'stopped',
    );

    // LOAD: el clip queda en el primer fotograma, sin reproducir; búsqueda y PLAY.
    const loaded = (await admin.post(`${cgUrl()}/clip`, { action: 'load', lineId: ids.vtr })).body
      .cg.clip;
    expect(loaded).toMatchObject({ lineId: ids.vtr, state: 'loaded', position: 0 });
    expect(sim.sent('LOAD 1-10')[0]!.command).toBe('LOAD 1-10 "PIEZA_GOBIERNO"');
    expect(sim.position(1, 10)).toBe(0);
    const sought = (await admin.post(`${cgUrl()}/clip`, { action: 'seek', seconds: 2 })).body.cg
      .clip;
    expect(sought).toMatchObject({ state: 'loaded', position: 2 });
    expect(sim.sent('CALL 1-10 SEEK')[0]!.command).toBe('CALL 1-10 SEEK 50');
    expect(sim.position(1, 10)).toBeCloseTo(2, 1);
    const playing = (await admin.post(`${cgUrl()}/clip`, { action: 'play' })).body.cg.clip;
    expect(playing.state).toBe('playing');
    expect(Date.now() - playing.startedAt).toBeGreaterThanOrEqual(1900);
    expect(sim.sent('RESUME 1-10').length).toBeGreaterThanOrEqual(1);
    await sleep(300);
    expect(sim.position(1, 10)!).toBeGreaterThan(2.2);
    expect((await admin.post(`${cgUrl()}/clip`, { action: 'stop' })).body.cg.clip.state).toBe(
      'stopped',
    );
    // PLAY tras parar vuelve a cargar el clip desde el principio.
    expect((await admin.post(`${cgUrl()}/clip`, { action: 'play' })).body.cg.clip.state).toBe(
      'playing',
    );
    expect(sim.sent('PLAY 1-10').at(-1)!.command).toBe('PLAY 1-10 "PIEZA_GOBIERNO"');

    // Una redactora no lanza rótulos ni configura equipos.
    await admin.post('/api/users', {
      name: 'Rita',
      email: 'rita@chaneltv.test',
      roleId: await roleId(admin, 'redactor'),
      password: 'temporal-12345',
    });
    const rita = new Client(ctx.app);
    await rita.login('rita@chaneltv.test', 'temporal-12345');
    await rita.post('/api/me/password', {
      currentPassword: 'temporal-12345',
      newPassword: PASSWORD,
    });
    expect((await rita.post(`${cgUrl()}/take`, { graphicId: 'g-tot' })).status).toBe(403);
    expect((await rita.patch('/api/org/settings', { graphicSeconds: 3 })).status).toBe(403);
    expect((await rita.get('/api/devices')).status).toBe(200);
  });

  it('lista los clips de CasparCG y prueba la conexión', async () => {
    const clips = (await admin.get('/api/cg/clips')).body;
    expect(clips).toMatchObject({ devices: 1, connected: 1 });
    expect(clips.clips[0]).toMatchObject({ name: 'PIEZA_GOBIERNO', duration: 4 });
    const ok = await admin.post('/api/devices/test', {
      config: { host: '127.0.0.1', port: sim.port },
    });
    expect(ok.body).toMatchObject({ ok: true, clips: 1 });
    const bad = await admin.post('/api/devices/test', { config: { host: '127.0.0.1', port: 1 } });
    expect(bad.body.ok).toBe(false);
  });
});
