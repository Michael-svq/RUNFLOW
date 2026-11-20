import dgram from 'node:dgram';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parseDmxSpec } from '@runflow/core';
import { addCue, insertLine } from '@runflow/sync';
import { artDmx, mscGo, oscMessage, parseOsc, sacnPacket } from '../src/lighting/packets';
import {
  createTestContext,
  resetDb,
  setupFirstOrg,
  type Client,
  type TestContext,
} from './helpers';

/* F4.3 Iluminación: OSC, MIDI Show Control (ipMIDI), Art-Net y sACN. */

let ctx: TestContext;
let admin: Client;
let orgId: string;
let desk: dgram.Socket;
let port: number;
const packets: Buffer[] = [];

beforeAll(async () => {
  ctx = await createTestContext({ MIN_GO_INTERVAL_MS: '0' });
  desk = dgram.createSocket('udp4');
  desk.on('message', (m) => packets.push(m));
  await new Promise<void>((r) => desk.bind(0, '127.0.0.1', () => r()));
  port = (desk.address() as AddressInfo).port;
});
afterAll(async () => {
  desk.close();
  await ctx.close();
});
beforeEach(async () => {
  await resetDb();
  const setup = await setupFirstOrg(ctx.app);
  admin = setup.admin;
  orgId = setup.me.activeOrg.id;
  packets.length = 0;
});

async function addLight(config: Record<string, unknown>) {
  const res = await admin.post('/api/devices', {
    name: 'Mesa de luces',
    kind: 'lighting',
    config: { host: '127.0.0.1', port, ...config },
  });
  expect(res.status).toBe(201);
  return res.body.device.id as string;
}

describe('iluminación', () => {
  it('paquetes: OSC, MSC, Art-Net y sACN', () => {
    const osc = parseOsc(oscMessage('/gma3/cmd', ['Go+ Sequence 1 Cue 5', 3, 0.5]));
    expect(osc.address).toBe('/gma3/cmd');
    expect(osc.args[0]).toBe('Go+ Sequence 1 Cue 5');
    expect(osc.args[1]).toBe(3);
    expect(osc.args[2]).toBeCloseTo(0.5);
    expect([...mscGo(1, '12.5')]).toEqual([
      0xf0, 0x7f, 0x01, 0x02, 0x01, 0x01, 0x31, 0x32, 0x2e, 0x35, 0xf7,
    ]);
    expect([...mscGo(127, '3', '2')].slice(-4)).toEqual([0x33, 0x00, 0x32, 0xf7]);

    const data = new Uint8Array(512);
    data[0] = 255;
    data[511] = 7;
    const art = artDmx(0x123, 9, data);
    expect(art.toString('ascii', 0, 7)).toBe('Art-Net');
    expect(art.readUInt16LE(8)).toBe(0x5000);
    expect(art[14]).toBe(0x23);
    expect(art[15]).toBe(0x01);
    expect(art[18]).toBe(255);
    expect(art.length).toBe(530);

    const sacn = sacnPacket(7, 3, data, { cid: Buffer.alloc(16, 1), sourceName: 'RunFlow' });
    expect(sacn.length).toBe(638);
    expect(sacn.toString('ascii', 4, 13)).toBe('ASC-E1.17');
    expect(sacn.readUInt16BE(113)).toBe(7);
    expect(sacn[125]).toBe(0);
    expect(sacn[126]).toBe(255);
    expect(sacn[637]).toBe(7);

    expect(parseDmxSpec('1=255, 10-12=50%')).toEqual(
      new Map([
        [1, 255],
        [10, 128],
        [11, 128],
        [12, 128],
      ]),
    );
    expect(parseDmxSpec('Calle', { CALLE: '5=100' })).toEqual(new Map([[5, 100]]));
    expect(parseDmxSpec('600=1')).toBeNull();
    expect(parseDmxSpec('hola')).toBeNull();
  });

  it('OSC a mano y con el cue de luces del timeline en directo', async () => {
    const id = await addLight({ protocol: 'osc', oscAddress: '/eos/cue/{cue}/fire' });
    const manual = await admin.post(`/api/devices/${id}/fire`, { target: '12.5' });
    expect(manual.body).toEqual({ ok: true });
    await expect.poll(() => packets.length).toBe(1);
    expect(parseOsc(packets[0]!).address).toBe('/eos/cue/12.5/fire');
    const devices = (await admin.get('/api/devices')).body.devices;
    expect(devices[0]).toMatchObject({ kind: 'lighting', status: { connected: true } });

    const program = (await admin.post('/api/programs', { name: 'Gala', type: 'evento' })).body
      .program;
    const rundownId = (
      await admin.post('/api/rundowns', {
        programId: program.id,
        airDate: '2026-12-18',
        startTime: '20:00',
        endTime: '22:00',
      })
    ).body.rundown.id;
    await ctx.collab.withDoc(rundownId, orgId, (doc) => {
      const line = insertLine(doc, { cells: { nombre: 'Canción', tipo: 'VARIOS', t_est: 60 } });
      addCue(doc, line, { track: 'luces', at: 0.3, duration: 0, label: 'Azul', target: '7' });
    });
    await admin.patch(`/api/rundowns/${rundownId}/live`, { mode: 'manual', armed: true });
    await admin.post(`/api/rundowns/${rundownId}/live/go`);
    await expect.poll(() => packets.length, { timeout: 3000 }).toBe(2);
    expect(parseOsc(packets[1]!).address).toBe('/eos/cue/7/fire');
    expect(ctx.deps.cues!.state(rundownId).fired[0]).toMatchObject({
      track: 'luces',
      executed: true,
    });
  });

  it('Art-Net con escena y fundido; MSC; errores', async () => {
    const art = await addLight({
      protocol: 'artnet',
      universe: 0,
      presets: { Calle: '1=200,2=100' },
    });
    expect(
      (await admin.post(`/api/devices/${art}/fire`, { target: 'calle', seconds: 0.3 })).body,
    ).toEqual({
      ok: true,
    });
    await expect
      .poll(() => packets.filter((p) => p.toString('ascii', 0, 7) === 'Art-Net').at(-1)?.[18])
      .toBe(200);
    const artPackets = packets.filter((p) => p.toString('ascii', 0, 7) === 'Art-Net');
    // Fundido: hay valores intermedios.
    expect(artPackets.some((p) => p[18]! > 0 && p[18]! < 200)).toBe(true);
    expect(artPackets.at(-1)![19]).toBe(100);

    const bad = await admin.post(`/api/devices/${art}/fire`, { target: 'nada' });
    expect(bad.body.ok).toBe(false);
    expect(bad.body.error).toContain('no es una escena');

    await admin.patch(`/api/devices/${art}`, { enabled: false });
    packets.length = 0;
    const msc = await addLight({ protocol: 'msc', mscDevice: 1 });
    expect((await admin.post(`/api/devices/${msc}/fire`, { target: '3' })).body).toEqual({
      ok: true,
    });
    await expect.poll(() => packets.some((p) => p[0] === 0xf0)).toBe(true);
    expect(
      (
        await admin.post('/api/devices/test', {
          kind: 'lighting',
          config: { protocol: 'osc', host: '' },
        })
      ).body,
    ).toMatchObject({ ok: false });
  });
});
