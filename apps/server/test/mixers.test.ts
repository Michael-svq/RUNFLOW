import { EventEmitter } from 'node:events';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertLine, writeScript } from '@runflow/sync';
import { CasparSimulator } from '../src/cg/simulator';
import { AtemDriver, type AtemLike } from '../src/mixers/atem';
import { ObsSimulator } from '../src/mixers/obs';
import { VmixSimulator } from '../src/mixers/vmix';
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
 * M8: mezcladores (OBS, vMix, ATEM), mapa de fuentes y mando por enlace.
 * Aceptación: GO pasa de CAM 1 a VTR (CasparCG + corte) en menos de 100 ms.
 */

let ctx: TestContext;
let admin: Client;
let orgId: string;
let rundownId: string;
const ids: Record<string, string> = {};
const cleanup: (() => Promise<unknown>)[] = [];

beforeAll(async () => {
  ctx = await createTestContext({ MIN_GO_INTERVAL_MS: '0' });
});
afterAll(async () => {
  await ctx.close();
});
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
beforeEach(async () => {
  await resetDb();
  const setup = await setupFirstOrg(ctx.app);
  admin = setup.admin;
  orgId = setup.me.activeOrg.id;
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
    ids.cam = insertLine(doc, {
      cells: { nombre: 'Presentación', tipo: 'ACTING', t_est: 30, fuente: 'CAM 1' },
    });
    ids.vtr = insertLine(doc, {
      cells: { nombre: 'Pieza', tipo: 'VTR', dur_vtr: 60, clip: 'PIEZA' },
    });
    ids.cam2 = insertLine(doc, {
      cells: { nombre: 'Entrevista', tipo: 'TEMA', t_est: 60, fuente: 'cam  2' },
    });
    writeScript(doc, ids.cam, [
      {
        kind: 'rotulo',
        id: 'g1',
        type: 'TOT',
        f0: 'Ana',
        f1: '',
        f2: '',
        f3: '',
        tcIn: '',
        tcOut: '',
      },
    ]);
  });
});

const live = () => `/api/rundowns/${rundownId}/live`;
const sources = { 'CAM 1': '1', VTR: '2', 'CAM 2': '3' };

async function addDevice(body: unknown) {
  const res = await admin.post('/api/devices', body);
  expect(res.status).toBe(201);
  await expect
    .poll(async () => {
      const list = (await admin.get('/api/devices')).body.devices as {
        id: string;
        status: { connected: boolean };
      }[];
      return list.find((d) => d.id === res.body.device.id)?.status.connected;
    })
    .toBe(true);
  return res.body.device.id as string;
}

describe('mezcladores', () => {
  it('aceptación: GO de CAM 1 a VTR mueve CasparCG y corta vMix en < 100 ms', async () => {
    const caspar = new CasparSimulator({ clips: [{ name: 'PIEZA', duration: 60 }] });
    const vmix = new VmixSimulator();
    cleanup.push(
      () => caspar.stop(),
      () => vmix.stop(),
    );
    await addDevice({
      name: 'CasparCG',
      kind: 'casparcg',
      config: { host: '127.0.0.1', port: await caspar.start(), oscPort: 0 },
    });
    await addDevice({
      name: 'vMix',
      kind: 'vmix',
      config: { host: '127.0.0.1', port: await vmix.start(), sources },
    });
    await admin.patch(live(), { mode: 'manual', armed: true });

    await admin.post(`${live()}/go`);
    await expect.poll(() => vmix.program).toBe('1');
    expect(vmix.received.at(-1)!.line).toBe('FUNCTION CutDirect Input=1');
    await expect.poll(() => caspar.sent('LOADBG 1-10').length).toBe(1);

    // GO al VTR: el clip arranca y el mezclador corta a la vez.
    const goAt = Date.now();
    await admin.post(`${live()}/go`);
    await expect.poll(() => vmix.program).toBe('2');
    await expect.poll(() => caspar.sent('PLAY 1-10').length).toBe(1);
    const cutMs = vmix.received.at(-1)!.at - goAt;
    const playMs = caspar.sent('PLAY 1-10')[0]!.at - goAt;
    expect(cutMs).toBeLessThan(100);
    expect(playMs).toBeLessThan(100);
    const state = (await admin.get(`/api/rundowns/${rundownId}/mixers`)).body.mixers;
    expect(state.program).toMatchObject({ lineId: ids.vtr, source: 'VTR' });
    expect(state.lastCutMs).toBeLessThan(100);

    // FUENTE sin distinguir mayúsculas ni espacios de más.
    await admin.post(`${live()}/go`);
    await expect.poll(() => vmix.program).toBe('3');
  });

  it('OBS: escenas en programa o, en modo estudio, previo + transición', async () => {
    const obs = new ObsSimulator({ password: 'secreta' });
    cleanup.push(() => obs.stop());
    const port = await obs.start();
    const id = await addDevice({
      name: 'OBS',
      kind: 'obs',
      config: {
        host: '127.0.0.1',
        port,
        password: 'secreta',
        sources: { 'CAM 1': 'Cámara 1', VTR: 'Vídeo' },
      },
    });
    expect((await admin.get(`/api/devices/${id}/inputs`)).body.inputs).toEqual([
      'CAM 1',
      'CAM 2',
      'VTR',
    ]);
    await admin.patch(live(), { mode: 'manual', armed: true });
    await admin.post(`${live()}/go`);
    await expect.poll(() => obs.program).toBe('Cámara 1');

    const device = (await admin.get('/api/devices')).body.devices[0];
    await admin.patch(`/api/devices/${id}`, {
      name: 'OBS',
      kind: 'obs',
      enabled: true,
      config: { ...device.config, studioMode: true },
    });
    await expect
      .poll(async () => (await admin.get('/api/devices')).body.devices[0].status.connected)
      .toBe(true);
    await admin.post(`${live()}/go`);
    await expect.poll(() => obs.program).toBe('Vídeo');
    expect(obs.requests.map((r) => r.type).slice(-2)).toEqual([
      'SetCurrentPreviewScene',
      'TriggerStudioModeTransition',
    ]);
  });

  it('OBS con contraseña equivocada: no conecta y se explica', async () => {
    const obs = new ObsSimulator({ password: 'secreta' });
    cleanup.push(() => obs.stop());
    const res = await admin.post('/api/devices/test', {
      kind: 'obs',
      config: { host: '127.0.0.1', port: await obs.start(), password: 'otra' },
    });
    expect(res.body.ok).toBe(false);
  });

  it('desarmado o en ensayo no corta; si el mezclador cae, aviso y el directo sigue', async () => {
    const vmix = new VmixSimulator();
    cleanup.push(() => vmix.stop());
    await addDevice({
      name: 'vMix',
      kind: 'vmix',
      config: { host: '127.0.0.1', port: await vmix.start(), sources },
    });
    await admin.patch(live(), { mode: 'manual', armed: false });
    await admin.post(`${live()}/go`);
    await admin.patch(live(), { armed: true, rehearsal: true });
    await admin.post(`${live()}/go`);
    await new Promise((r) => setTimeout(r, 200));
    expect(vmix.received.filter((r) => r.line.startsWith('FUNCTION'))).toHaveLength(0);

    await admin.patch(live(), { rehearsal: false });
    await vmix.stop();
    const res = await admin.post(`${live()}/go`);
    expect(res.status).toBe(200);
    expect(res.body.live.onAir.lineId).toBe(ids.cam2);
  });

  it('F2.3: emitir y grabar en vMix y OBS desde la escaleta', async () => {
    const vmix = new VmixSimulator();
    const obs = new ObsSimulator();
    cleanup.push(
      () => vmix.stop(),
      () => obs.stop(),
    );
    const vmixId = await addDevice({
      name: 'vMix',
      kind: 'vmix',
      config: { host: '127.0.0.1', port: await vmix.start(), sources },
    });
    const obsId = await addDevice({
      name: 'OBS',
      kind: 'obs',
      config: { host: '127.0.0.1', port: await obs.start(), sources: {} },
    });
    const stream = (body: unknown) => admin.post(`/api/rundowns/${rundownId}/mixers/stream`, body);
    const on = await stream({ action: 'startStream', deviceId: vmixId });
    expect(on.status).toBe(200);
    expect(vmix.streaming).toBe(true);
    expect(on.body.mixers.outputs[vmixId]).toEqual({ streaming: true, recording: false });
    await stream({ action: 'startRecord', deviceId: obsId });
    expect(obs.recording).toBe(true);
    const off = await stream({ action: 'stopStream', deviceId: vmixId });
    expect(off.body.mixers.outputs[vmixId].streaming).toBe(false);
    expect(off.body.mixers.outputs[obsId]).toEqual({ streaming: false, recording: true });

    // Solo quien da GO controla la emisión.
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
    expect(
      (await rita.post(`/api/rundowns/${rundownId}/mixers/stream`, { action: 'stopRecord' }))
        .status,
    ).toBe(403);
  });

  it('ATEM: corte directo o previo + AUTO en su M/E', async () => {
    const calls: string[] = [];
    class FakeAtem extends EventEmitter implements AtemLike {
      state = { info: { productIdentifier: 'ATEM Mini Pro' } };
      async connect() {
        setTimeout(() => this.emit('connected'), 5);
      }
      async disconnect() {}
      async changeProgramInput(input: number, me?: number) {
        calls.push(`PGM ${input} ME${me}`);
      }
      async changePreviewInput(input: number, me?: number) {
        calls.push(`PVW ${input} ME${me}`);
      }
      async autoTransition(me?: number) {
        calls.push(`AUTO ME${me}`);
      }
    }
    const cut = new AtemDriver(
      { host: 'x', me: 0, transition: 'cut', sources: {} },
      () => new FakeAtem(),
    );
    cut.connect();
    await expect.poll(() => cut.connected).toBe(true);
    expect(cut.version).toBe('ATEM Mini Pro');
    await cut.cut('3');
    const auto = new AtemDriver(
      { host: 'x', me: 1, transition: 'auto', sources: {} },
      () => new FakeAtem(),
    );
    auto.connect();
    await expect.poll(() => auto.connected).toBe(true);
    await auto.cut('2');
    await expect(auto.cut('VTR')).rejects.toThrow(/no válida/);
    expect(calls).toEqual(['PGM 3 ME0', 'PVW 2 ME1', 'AUTO ME1']);
  });
});

describe('mando por enlace (Companion, Stream Deck, tablet)', () => {
  it('GO, volver y rótulos con el token, sin sesión; revocable', async () => {
    const created = await admin.post(`/api/rundowns/${rundownId}/outputs`, {
      kind: 'control',
      name: 'Stream Deck',
    });
    expect(created.status).toBe(201);
    const token = created.body.token as string;
    const go = await ctx.app.inject({ method: 'POST', url: `/api/public/control/${token}/go` });
    expect(go.statusCode, go.body).toBe(200);
    expect(go.json().live.onAir.lineId).toBe(ids.cam);
    const graphic = await ctx.app.inject({
      method: 'POST',
      url: `/api/public/control/${token}/next-graphic`,
    });
    expect(Object.keys(graphic.json().cg.graphics)).toEqual(['g1']);
    const status = await ctx.app.inject({ method: 'GET', url: `/api/public/control/${token}` });
    expect(status.json()).toMatchObject({ onAir: { lineId: ids.cam }, graphicsOnAir: 1 });
    await ctx.app.inject({ method: 'POST', url: `/api/public/control/${token}/clear-graphics` });
    await ctx.app.inject({ method: 'POST', url: `/api/public/control/${token}/go` });
    const back = await ctx.app.inject({ method: 'POST', url: `/api/public/control/${token}/back` });
    expect(back.statusCode).toBe(200);
    expect(back.json().live.onAir.lineId).toBe(ids.cam);
    expect(
      (await ctx.app.inject({ method: 'POST', url: `/api/public/control/${token}/despegar` }))
        .statusCode,
    ).toBe(404);

    // Una salida que no es de mando no sirve como mando.
    const prompter = await admin.post(`/api/rundowns/${rundownId}/outputs`, {
      kind: 'prompter',
      name: 'Prompter',
    });
    expect(
      (
        await ctx.app.inject({
          method: 'POST',
          url: `/api/public/control/${prompter.body.token}/go`,
        })
      ).statusCode,
    ).toBe(404);

    await admin.delete(`/api/outputs/${created.body.output.id}`);
    expect(
      (await ctx.app.inject({ method: 'POST', url: `/api/public/control/${token}/go` })).statusCode,
    ).toBe(404);
  });

  it('solo quien puede dar GO crea un mando', async () => {
    await admin.post('/api/users', {
      name: 'Pepa',
      email: 'pepa@chaneltv.test',
      roleId: await roleId(admin, 'operador_cg'),
      password: 'temporal-12345',
    });
    const pepa = new Client(ctx.app);
    await pepa.login('pepa@chaneltv.test', 'temporal-12345');
    await pepa.post('/api/me/password', {
      currentPassword: 'temporal-12345',
      newPassword: PASSWORD,
    });
    const res = await pepa.post(`/api/rundowns/${rundownId}/outputs`, {
      kind: 'control',
      name: 'Mando',
    });
    expect([403]).toContain(res.status);
  });
});
