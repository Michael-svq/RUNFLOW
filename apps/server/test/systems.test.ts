import dgram from 'node:dgram';
import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fillTemplate } from '@runflow/core';
import { addCue, insertLine } from '@runflow/sync';
import { parseOsc } from '../src/lighting/packets';
import {
  createTestContext,
  resetDb,
  setupFirstOrg,
  type Client,
  type TestContext,
} from './helpers';

/* F4.4 Otros sistemas: HTTP, TCP (RossTalk), UDP y OSC desde las pistas del timeline. */

let ctx: TestContext;
let admin: Client;
let orgId: string;
let web: http.Server;
let tcp: net.Server;
let udp: dgram.Socket;
const got: { kind: string; data: string }[] = [];

beforeAll(async () => {
  ctx = await createTestContext({ MIN_GO_INTERVAL_MS: '0' });
  web = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      got.push({ kind: 'http', data: `${req.method} ${req.url} ${body}` });
      res.statusCode = req.url?.includes('falla') ? 500 : 200;
      res.end('ok');
    });
  });
  await new Promise<void>((r) => web.listen(0, '127.0.0.1', r));
  tcp = net.createServer((s) => {
    let data = '';
    s.on('data', (c) => (data += c));
    s.on('end', () => got.push({ kind: 'tcp', data }));
  });
  await new Promise<void>((r) => tcp.listen(0, '127.0.0.1', r));
  udp = dgram.createSocket('udp4');
  udp.on('message', (m) =>
    got.push({ kind: 'osc', data: parseOsc(m).address + ' ' + parseOsc(m).args.join(',') }),
  );
  await new Promise<void>((r) => udp.bind(0, '127.0.0.1', () => r()));
});
afterAll(async () => {
  udp.close();
  await new Promise<void>((r) => tcp.close(() => r()));
  await new Promise<void>((r) => web.close(() => r()));
  await ctx.close();
});
beforeEach(async () => {
  await resetDb();
  const setup = await setupFirstOrg(ctx.app);
  admin = setup.admin;
  orgId = setup.me.activeOrg.id;
  got.length = 0;
});

const port = (s: { address(): unknown }) => (s.address() as AddressInfo).port;

async function addSystem(name: string, config: Record<string, unknown>) {
  const res = await admin.post('/api/devices', { name, kind: 'generic', config });
  expect(res.status).toBe(201);
  return res.body.device.id as string;
}

describe('otros sistemas', () => {
  it('plantillas', () => {
    expect(
      fillTemplate(
        '/v1/shortcut?name={cue}&t={track}',
        {
          cue: 'ddr1 play',
          label: 'x',
          target: '',
          track: 'fx',
        },
        encodeURIComponent,
      ),
    ).toBe('/v1/shortcut?name=ddr1%20play&t=fx');
  });

  it('los cues de sus pistas llegan por HTTP, TCP y OSC en directo', async () => {
    await addSystem('TriCaster', {
      protocol: 'http',
      url: `http://127.0.0.1:${port(web)}/v1/shortcut?name={cue}`,
      tracks: ['fx'],
    });
    await addSystem('XPression', {
      protocol: 'tcp',
      host: '127.0.0.1',
      port: port(tcp),
      command: 'TAKE {target}',
      tracks: ['rotulos'],
    });
    await addSystem('Audio', {
      protocol: 'osc',
      host: '127.0.0.1',
      port: port(udp),
      oscAddress: '/audio/{cue}',
      oscArg: '{label}',
      tracks: ['audio'],
    });

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
      addCue(doc, line, { track: 'fx', at: 0.2, duration: 0, label: 'Humo', target: 'ddr1_play' });
      addCue(doc, line, {
        track: 'rotulos',
        at: 0.3,
        duration: 0,
        label: 'Artista',
        target: '1:0:1',
      });
      addCue(doc, line, { track: 'audio', at: 0.4, duration: 0, label: 'Aplausos', target: 'fx3' });
    });
    await admin.patch(`/api/rundowns/${rundownId}/live`, { mode: 'manual', armed: true });
    await admin.post(`/api/rundowns/${rundownId}/live/go`);
    await expect.poll(() => got.length, { timeout: 4000 }).toBe(3);
    expect(got.find((g) => g.kind === 'http')!.data).toBe('GET /v1/shortcut?name=ddr1_play ');
    expect(got.find((g) => g.kind === 'tcp')!.data).toBe('TAKE 1:0:1\r\n');
    expect(got.find((g) => g.kind === 'osc')!.data).toBe('/audio/fx3 Aplausos');
    // El de rótulos falla en CasparCG (no hay rótulo 1) pero XPression lo recibe: queda el aviso.
    const fired = ctx.deps.cues!.state(rundownId).fired;
    expect(fired.find((f) => f.track === 'fx')).toMatchObject({ executed: true, error: null });
    expect(fired.find((f) => f.track === 'audio')).toMatchObject({ executed: true });
  });

  it('prueba a mano, errores y POST', async () => {
    const id = await addSystem('API', {
      protocol: 'http',
      method: 'POST',
      url: `http://127.0.0.1:${port(web)}/cue`,
      body: '{"cue":"{cue}"}',
      tracks: ['notas'],
    });
    expect((await admin.post(`/api/devices/${id}/fire`, { target: 'abc' })).body).toEqual({
      ok: true,
    });
    await expect.poll(() => got[0]?.data).toBe('POST /cue {"cue":"abc"}');

    const bad = await addSystem('Roto', {
      protocol: 'http',
      url: `http://127.0.0.1:${port(web)}/falla`,
      tracks: ['notas'],
    });
    const res = await admin.post(`/api/devices/${bad}/fire`, { target: 'x' });
    expect(res.body).toMatchObject({ ok: false });
    expect(res.body.error).toContain('500');

    expect(
      (
        await admin.post('/api/devices/test', {
          kind: 'generic',
          config: { protocol: 'tcp', host: '127.0.0.1', port: port(tcp) },
        })
      ).body,
    ).toMatchObject({ ok: true, version: 'TCP: conexión correcta' });
    expect(
      (await admin.post('/api/devices', { name: 'X', kind: 'generic', config: { tracks: [] } }))
        .status,
    ).toBe(400);
  });
});
