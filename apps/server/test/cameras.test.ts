import dgram from 'node:dgram';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { panasonicImage, visca, viscaImage, viscaPacket } from '../src/cameras/drivers';
import { SimulatedCamera } from '../src/cameras/simulated';
import {
  Client,
  createTestContext,
  resetDb,
  roleId,
  setupFirstOrg,
  PASSWORD,
  type TestContext,
} from './helpers';

/* Control de cámara: VISCA sobre IP, Panasonic AW y la cámara simulada. */

let ctx: TestContext;
let admin: Client;
let udp: dgram.Socket;
let web: http.Server;
const packets: Buffer[] = [];
const requests: string[] = [];

const hexOf = (b: number[] | Buffer) => Buffer.from(b).toString('hex');

beforeAll(async () => {
  ctx = await createTestContext({});
  // Cámara VISCA falsa: responde ACK a todo.
  udp = dgram.createSocket('udp4');
  udp.on('message', (m, rinfo) => {
    packets.push(m);
    udp.send(viscaPacket([0x90, 0x41, 0xff], m.readUInt32BE(4), 0x0111), rinfo.port, rinfo.address);
  });
  await new Promise<void>((r) => udp.bind(0, '127.0.0.1', () => r()));
  // Cámara Panasonic falsa.
  web = http.createServer((req, res) => {
    requests.push(decodeURIComponent(req.url ?? ''));
    if (req.url?.startsWith('/cgi-bin/camera')) {
      res.setHeader('content-type', 'image/jpeg');
      res.end(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
      return;
    }
    const cmd = new URL(req.url ?? '/', 'http://x').searchParams.get('cmd') ?? '';
    res.end(cmd === 'QID' ? 'OID:AW-UE150' : cmd);
  });
  await new Promise<void>((r) => web.listen(0, '127.0.0.1', r));
});
afterAll(async () => {
  udp.close();
  await new Promise<void>((r) => web.close(() => r()));
  await ctx.close();
});
beforeEach(async () => {
  await resetDb();
  admin = (await setupFirstOrg(ctx.app)).admin;
  packets.length = 0;
  requests.length = 0;
});

const portOf = (s: { address(): unknown }) => (s.address() as AddressInfo).port;
/** GET sin interpretar JSON (imágenes). */
const raw = (client: Client, url: string) =>
  ctx.app.inject({ method: 'GET', url, headers: client.cookie ? { cookie: client.cookie } : {} });

async function addCamera(name: string, config: Record<string, unknown>) {
  const res = await admin.post('/api/devices', { name, kind: 'camera', config });
  expect(res.status).toBe(201);
  return res.body.device.id as string;
}

describe('órdenes de cámara', () => {
  it('VISCA: movimiento, posiciones, imagen y cabecera IP', () => {
    expect(hexOf(visca.panTilt(1, 1, 0))).toBe('8101060118010203ff');
    expect(hexOf(visca.panTilt(1, -0.5, 0.5))).toBe('810106010c0c0101ff');
    expect(hexOf(visca.zoom(1, 1))).toBe('8101040727ff');
    expect(hexOf(visca.zoom(2, -1))).toBe('8201040737ff');
    expect(hexOf(visca.zoom(1, 0))).toBe('8101040700ff');
    expect(hexOf(visca.preset(1, 'recall', 3))).toBe('8101043f0202ff');
    expect(hexOf(visca.preset(1, 'save', 1))).toBe('8101043f0100ff');
    const pkt = viscaPacket([0x81, 0x09, 0x04, 0x00, 0xff], 7);
    expect(pkt.subarray(0, 8).toString('hex')).toBe('0100000500000007');
    const cmds = viscaImage(1, { iris: 100, rGain: -50 }).map(hexOf);
    expect(cmds).toEqual([
      '8101043903ff', // exposición manual
      '8101044b00000101ff', // iris 0x11
      '8101043505ff', // balance manual
      '8101044300000003ff', // R = 0x80 − 125 = 0x03
    ]);
  });

  it('Panasonic: traducción de los ajustes', () => {
    expect(panasonicImage({ iris: 0, gainDb: 6, rGain: 10, pedestal: -50 })).toEqual([
      { cgi: 'ptz', cmd: '#AXI555' },
      { cgi: 'cam', cmd: 'OGU:0E' },
      { cgi: 'cam', cmd: 'ORI:0B4' },
      { cgi: 'cam', cmd: 'OTD:000' },
    ]);
  });

  it('la cámara simulada responde a la exposición y a los balances', async () => {
    const cam = new SimulatedCamera({ light: 0.8, tintR: 0.14, tintB: -0.12, black: 0.05 });
    const before = cam.transfer();
    expect(before.r).toBeGreaterThan(before.g);
    const wb = await cam.balance('white');
    expect(wb).toEqual({ rGain: -12, bGain: 14 });
    const after = cam.transfer();
    expect(after.r / after.g).toBeCloseTo(1, 1);
    expect(after.b / after.g).toBeCloseTo(1, 1);
    expect(await cam.balance('black')).toEqual({ pedestal: -10 });
    expect(cam.transfer().offset).toBeCloseTo(0, 5);
    const g = cam.transfer().g;
    await cam.image({ iris: 65 }, { ...cam.settings, iris: 65 });
    expect(cam.transfer().g).toBeCloseTo(g * 2, 5);
    const svg = (await cam.snapshot()).body as string;
    expect(svg).toContain('<svg');
    expect(svg).toContain('feComponentTransfer');
  });
});

describe('API de cámaras', () => {
  it('VISCA sobre IP: prueba, movimiento, imagen y balance de negros no disponible', async () => {
    const config = { protocol: 'visca', host: '127.0.0.1', port: portOf(udp) };
    const test = await admin.post('/api/devices/test', { kind: 'camera', config });
    expect(test.body).toMatchObject({ ok: true, version: 'VISCA sobre IP' });
    const id = await addCamera('CAM 1', config);
    const list = await admin.get('/api/cameras');
    expect(list.body.cameras).toMatchObject([{ id, name: 'CAM 1', protocol: 'visca' }]);

    packets.length = 0;
    expect((await admin.post(`/api/cameras/${id}/move`, { pan: 1 })).status).toBe(200);
    await expect.poll(() => packets.length).toBeGreaterThanOrEqual(3);
    expect(packets.map((p) => p.subarray(8).toString('hex'))).toContain('8101060118010203ff');

    const img = await admin.patch(`/api/cameras/${id}/image`, { iris: 100 });
    expect(img.body.camera.state.image.iris).toBe(100);
    await expect
      .poll(() => packets.map((p) => p.subarray(8).toString('hex')))
      .toContain('8101044b00000101ff');

    const preset = await admin.post(`/api/cameras/${id}/preset`, { action: 'save', slot: 2 });
    expect(preset.body.camera.state.presets).toEqual([2]);

    const black = await admin.post(`/api/cameras/${id}/balance`, { kind: 'black' });
    expect(black.status).toBe(502);
    expect(black.body.error.message).toMatch(/balance de negros/);
    expect((await raw(admin, `/api/cameras/${id}/snapshot`)).statusCode).toBe(404);
  });

  it('Panasonic AW: imagen, balances, posiciones e imagen fija', async () => {
    const id = await addCamera('CAM 2', {
      protocol: 'panasonic',
      host: '127.0.0.1',
      port: portOf(web),
    });
    await admin.patch(`/api/cameras/${id}/image`, { gainDb: 6 });
    await admin.post(`/api/cameras/${id}/balance`, { kind: 'white' });
    await admin.post(`/api/cameras/${id}/balance`, { kind: 'black' });
    await admin.post(`/api/cameras/${id}/preset`, { action: 'recall', slot: 1 });
    expect(requests).toEqual(
      expect.arrayContaining([
        '/cgi-bin/aw_cam?cmd=OGU:0E&res=1',
        '/cgi-bin/aw_cam?cmd=OWS&res=1',
        '/cgi-bin/aw_cam?cmd=OAS&res=1',
        '/cgi-bin/aw_ptz?cmd=#R00&res=1',
      ]),
    );
    const snap = await raw(admin, `/api/cameras/${id}/snapshot`);
    expect(snap.statusCode).toBe(200);
    expect(snap.headers['content-type']).toBe('image/jpeg');
    expect(snap.rawPayload).toEqual(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  });

  it('simulada: balances, posiciones, imagen fija y permisos', async () => {
    const id = await addCamera('CAM SIM', { protocol: 'simulated' });
    const wb = await admin.post(`/api/cameras/${id}/balance`, { kind: 'white' });
    expect(wb.body.camera.state.image).toMatchObject({ rGain: -12, bGain: 14 });
    expect(wb.body.camera.state.whiteBalancedAt).toBeTypeOf('number');
    expect(
      (await admin.post(`/api/cameras/${id}/preset`, { action: 'recall', slot: 9 })).status,
    ).toBe(502);
    await admin.post(`/api/cameras/${id}/preset`, { action: 'save', slot: 9 });
    expect(
      (await admin.post(`/api/cameras/${id}/preset`, { action: 'recall', slot: 9 })).status,
    ).toBe(200);
    const snap = await raw(admin, `/api/cameras/${id}/snapshot`);
    expect(snap.headers['content-type']).toMatch(/image\/svg\+xml/);
    expect(snap.body).toContain('<svg');
    expect((await admin.patch(`/api/cameras/${id}/image`, { iris: 120 })).status).toBe(400);

    // Una redactora no maneja cámaras.
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
    expect((await rita.get('/api/cameras')).status).toBe(403);
    expect((await rita.post(`/api/cameras/${id}/move`, { pan: 1 })).status).toBe(403);
  });

  it('memorias de ajustes en la configuración de la empresa', async () => {
    const image = { iris: 60, gainDb: 3, shutter: 0, rGain: -5, bGain: 4, pedestal: 0, detail: 40 };
    const res = await admin.patch('/api/org/settings', {
      cameraProfiles: [{ id: 'p1', name: 'Plató noche', image }],
    });
    expect(res.status).toBe(200);
    const s = (await admin.get('/api/org/settings')).body.settings;
    expect(s.cameraProfiles).toMatchObject([{ id: 'p1', name: 'Plató noche', image }]);
    expect(s.cameraProfiles[0].auto.lumaTarget).toBe(45);
  });
});
