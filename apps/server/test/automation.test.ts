import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addCue, insertLine, readCues, updateCue, writeScript } from '@runflow/sync';
import { CasparSimulator } from '../src/cg/simulator';
import { VmixSimulator } from '../src/mixers/vmix';
import {
  createTestContext,
  resetDb,
  setupFirstOrg,
  type Client,
  type TestContext,
} from './helpers';

/* F4.2 Automatización: los cues del timeline se ejecutan a su tiempo en directo. */

let ctx: TestContext;
let admin: Client;
let orgId: string;
let rundownId: string;
let vmix: VmixSimulator;
const ids: Record<string, string> = {};
const sources = { 'CAM 1': '1', 'CAM 2': '2', 'CAM 3': '3' };

beforeAll(async () => {
  ctx = await createTestContext({ MIN_GO_INTERVAL_MS: '0' });
});
afterAll(async () => {
  await ctx.close();
});
afterEach(async () => {
  await vmix.stop();
});
beforeEach(async () => {
  await resetDb();
  const setup = await setupFirstOrg(ctx.app);
  admin = setup.admin;
  orgId = setup.me.activeOrg.id;
  vmix = new VmixSimulator();
  const res = await admin.post('/api/devices', {
    name: 'vMix',
    kind: 'vmix',
    config: { host: '127.0.0.1', port: await vmix.start(), sources },
  });
  expect(res.status).toBe(201);
  await expect
    .poll(async () => (await admin.get('/api/devices')).body.devices[0].status.connected)
    .toBe(true);
  const program = (await admin.post('/api/programs', { name: 'Gala', type: 'evento' })).body
    .program;
  rundownId = (
    await admin.post('/api/rundowns', {
      programId: program.id,
      airDate: '2026-12-18',
      startTime: '20:00',
      endTime: '22:00',
    })
  ).body.rundown.id;
  await ctx.collab.withDoc(rundownId, orgId, (doc) => {
    ids.song = insertLine(doc, {
      cells: { nombre: 'Canción', tipo: 'VARIOS', t_est: 180, fuente: 'CAM 1' },
    });
    ids.next = insertLine(doc, { cells: { nombre: 'Despedida', tipo: 'ACTING', t_est: 30 } });
    ids.c2 = addCue(doc, ids.song, {
      track: 'camara',
      at: 0.4,
      duration: 0,
      label: 'Plano general',
      target: 'CAM 2',
    });
    ids.c3 = addCue(doc, ids.song, {
      track: 'camara',
      at: 0.8,
      duration: 0,
      label: 'CAM 3',
      target: '',
    });
    ids.lyric = addCue(doc, ids.song, {
      track: 'letras',
      at: 0.2,
      duration: 2,
      label: 'Primer verso',
      target: '',
    });
  });
});

const live = () => `/api/rundowns/${rundownId}/live`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('automatización', () => {
  it('los cues de cámara cortan el mezclador a su tiempo y se registran', async () => {
    await admin.patch(live(), { mode: 'manual', armed: true });
    const goAt = Date.now();
    await admin.post(`${live()}/go`);
    // GO: FUENTE de la línea; luego los cues.
    await expect.poll(() => vmix.program).toBe('1');
    await expect.poll(() => vmix.program, { timeout: 3000 }).toBe('2');
    const cut2 = vmix.received.find((r) => r.line === 'FUNCTION CutDirect Input=2')!;
    expect(cut2.at - goAt).toBeGreaterThanOrEqual(350);
    expect(cut2.at - goAt).toBeLessThan(900);
    await expect.poll(() => vmix.program, { timeout: 3000 }).toBe('3');

    const state = ctx.deps.cues!.state(rundownId);
    expect(state.fired.map((f) => f.label)).toEqual(['CAM 3', 'Plano general', 'Primer verso']);
    expect(state.fired[0]).toMatchObject({ executed: true, error: null });
    // Las letras no mandan nada a ningún equipo.
    expect(state.fired[2]).toMatchObject({ track: 'letras', executed: false });
  });

  it('editar un cue en pleno directo lo reprograma; en ensayo no se cortan equipos', async () => {
    await admin.patch(live(), { mode: 'manual', armed: true });
    await ctx.collab.withDoc(rundownId, orgId, (doc) => {
      updateCue(doc, ids.song!, ids.c2!, { at: 30 });
      updateCue(doc, ids.song!, ids.c3!, { at: 30 });
    });
    await admin.post(`${live()}/go`);
    await expect.poll(() => vmix.program).toBe('1');
    // En directo, el cue de CAM 2 se adelanta a ya mismo.
    await ctx.collab.withDoc(rundownId, orgId, (doc) => {
      expect(readCues(doc, ids.song!).find((c) => c.id === ids.c2)!.at).toBe(30);
      updateCue(doc, ids.song!, ids.c2!, { at: 0.6 });
    });
    await expect.poll(() => vmix.program, { timeout: 3000 }).toBe('2');

    // Ensayo: se avisa pero no se corta.
    await admin.post(`${live()}/reset`);
    await admin.patch(live(), { rehearsal: true });
    const before = vmix.received.length;
    await ctx.collab.withDoc(rundownId, orgId, (doc) => {
      updateCue(doc, ids.song!, ids.c3!, { at: 0.3 });
    });
    await admin.post(`${live()}/go`);
    await sleep(900);
    expect(
      vmix.received.slice(before).filter((r) => r.line === 'FUNCTION CutDirect Input=3'),
    ).toHaveLength(0);
    const fired = ctx.deps.cues!.state(rundownId).fired;
    expect(fired.find((f) => f.label === 'CAM 3')).toMatchObject({ executed: false });
  });

  it('cue de rótulos: lanza el rótulo del guion en CasparCG', async () => {
    const caspar = new CasparSimulator({ clips: [] });
    try {
      await admin.post('/api/devices', {
        name: 'CasparCG',
        kind: 'casparcg',
        config: { host: '127.0.0.1', port: await caspar.start(), oscPort: 0 },
      });
      await ctx.collab.withDoc(rundownId, orgId, (doc) => {
        writeScript(doc, ids.song!, [
          {
            kind: 'rotulo',
            id: 'g-art',
            type: 'TOT',
            f0: 'Lucía Romero',
            f1: 'Cantante',
            f2: '',
            f3: '',
            tcIn: '',
            tcOut: '',
          },
        ]);
        addCue(doc, ids.song!, {
          track: 'rotulos',
          at: 0.3,
          duration: 0,
          label: 'Rótulo artista',
          target: '1',
        });
      });
      await expect
        .poll(async () =>
          (await admin.get('/api/devices')).body.devices.every(
            (d: { status: { connected: boolean } }) => d.status.connected,
          ),
        )
        .toBe(true);
      await admin.patch(live(), { mode: 'manual', armed: true });
      await admin.post(`${live()}/go`);
      await expect
        .poll(() => caspar.sent('CG').filter((c) => c.command.includes('TOT')).length, {
          timeout: 3000,
        })
        .toBeGreaterThan(0);
    } finally {
      await caspar.stop();
    }
  });
});
