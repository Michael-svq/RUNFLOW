import type { AddressInfo } from 'node:net';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import { insertLine, readLines } from '@runflow/sync';
import {
  Client,
  createTestContext,
  PASSWORD,
  resetDb,
  roleId,
  setupFirstOrg,
  type TestContext,
} from './helpers';

let ctx: TestContext;
let admin: Client;
let rundownId: string;
let orgId: string;
let port: number;
const providers: WebsocketProvider[] = [];

beforeAll(async () => {
  ctx = await createTestContext();
  await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  port = (ctx.app.server.address() as AddressInfo).port;
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  for (const p of providers.splice(0)) p.destroy();
  await resetDb();
  const s = await setupFirstOrg(ctx.app);
  admin = s.admin;
  orgId = s.me.activeOrg.id;
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
  await ctx.collab.withDoc(rundownId, orgId, (doc) =>
    insertLine(doc, { cells: { nombre: 'Uno' } }),
  );
});

async function waitFor(check: () => boolean, timeout = 5000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error('Tiempo de espera agotado');
    await new Promise((r) => setTimeout(r, 20));
  }
}

function connect(path: string, room: string, cookie?: string) {
  const doc = new Y.Doc();
  class WS extends WebSocket {
    constructor(u: string, p?: string | string[]) {
      super(u, p, cookie ? { headers: { cookie } } : undefined);
    }
  }
  const provider = new WebsocketProvider(`ws://127.0.0.1:${port}${path}`, room, doc, {
    WebSocketPolyfill: WS as unknown as typeof globalThis.WebSocket,
    disableBc: true,
  });
  providers.push(provider);
  const custom: Record<number, unknown[]> = { 100: [], 101: [], 102: [], 103: [] };
  for (const type of [100, 101, 102, 103]) {
    provider.messageHandlers[type] = (_e: unknown, decoder: decoding.Decoder) => {
      custom[type]!.push(JSON.parse(decoding.readVarString(decoder)));
    };
  }
  let closeCode: number | undefined;
  provider.on('connection-close', (e) => {
    closeCode ??= (e as { code?: number } | null)?.code;
  });
  return { doc, provider, custom, closeCode: () => closeCode };
}

function sendCustom(provider: WebsocketProvider, type: number, payload: unknown) {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, type);
  encoding.writeVarString(enc, JSON.stringify(payload));
  provider.ws!.send(encoding.toUint8Array(enc));
}

async function createOutput(kind = 'prompter') {
  const res = await admin.post(`/api/rundowns/${rundownId}/outputs`, {
    kind,
    name: 'Prompter cámara 1',
    settings: { mirror: true },
  });
  expect(res.status).toBe(201);
  return res.body as {
    output: { id: string; settings: { mirror: boolean; fontSize: number } };
    token: string;
  };
}

describe('salidas por enlace', () => {
  it('se crean (token una sola vez), se listan y se revocan', async () => {
    const { output, token } = await createOutput();
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(output.settings).toMatchObject({ mirror: true, fontSize: 64 });
    const list = await admin.get(`/api/rundowns/${rundownId}/outputs`);
    expect(list.body.outputs).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain(token);

    const pub = await new Client(ctx.app).get(`/api/public/outputs/${token}`);
    expect(pub.status).toBe(200);
    expect(pub.body.output).toMatchObject({
      kind: 'prompter',
      orgName: 'Chanel TV',
      rundown: { id: rundownId },
    });

    expect((await admin.delete(`/api/outputs/${output.id}`)).status).toBe(200);
    expect((await new Client(ctx.app).get(`/api/public/outputs/${token}`)).status).toBe(404);
  });

  it('un token inventado no da acceso', async () => {
    expect(
      (await new Client(ctx.app).get('/api/public/outputs/inventado-inventado-inventado')).status,
    ).toBe(404);
  });

  it('la salida recibe la escaleta en vivo pero no puede modificarla', async () => {
    const { token } = await createOutput();
    const out = connect('/api/collab-output', token);
    await waitFor(() => out.provider.synced && readLines(out.doc).length === 1);
    await waitFor(() => out.custom[100]!.length > 0); // estado del directo

    const editor = connect('/api/collab', rundownId, admin.cookie);
    await waitFor(() => editor.provider.synced);
    insertLine(editor.doc, { cells: { nombre: 'Dos' } });
    await waitFor(() => readLines(out.doc).length === 2);

    insertLine(out.doc, { cells: { nombre: 'Intruso' } });
    await new Promise((r) => setTimeout(r, 300));
    expect(readLines(editor.doc).map((l) => l.cells.nombre)).toEqual(['Uno', 'Dos']);
  });

  it('el operador mueve el prompter y manda mensajes; la salida los recibe (y no puede enviarlos)', async () => {
    const { token } = await createOutput();
    const out = connect('/api/collab-output', token);
    const operator = connect('/api/collab', rundownId, admin.cookie);
    await waitFor(() => out.provider.synced && operator.provider.synced);
    sendCustom(operator.provider, 101, {
      lineId: 'x',
      fraction: 0.5,
      running: true,
      speed: 2,
      followLive: true,
      seq: 1,
    });
    await waitFor(() => out.custom[101]!.length === 1);
    sendCustom(operator.provider, 102, {
      text: 'Un minuto',
      color: 'yellow',
      flash: false,
      sentAt: 1,
      from: 'Ana',
    });
    await waitFor(() => out.custom[102]!.length === 1);
    expect(out.custom[102]![0]).toMatchObject({ text: 'Un minuto' });

    // Quien se conecta después recibe el último estado.
    const late = connect('/api/collab-output', token);
    await waitFor(() => late.custom[101]!.length === 1 && late.custom[102]!.length === 1);

    // Una salida no puede mover el prompter de las demás.
    sendCustom(out.provider, 101, {
      lineId: 'hack',
      fraction: 0,
      running: false,
      speed: 0,
      followLive: false,
      seq: 9,
    });
    await new Promise((r) => setTimeout(r, 300));
    expect(late.custom[101]!.length).toBe(1);
  });

  it('un rol sin control (redactor) no mueve el prompter', async () => {
    const { token } = await createOutput();
    await admin.post('/api/users', {
      name: 'Rafa',
      email: 'r@chaneltv.test',
      roleId: await roleId(admin, 'redactor'),
      password: 'temporal-12345',
    });
    const rafa = new Client(ctx.app);
    await rafa.login('r@chaneltv.test', 'temporal-12345');
    await rafa.post('/api/me/password', {
      currentPassword: 'temporal-12345',
      newPassword: PASSWORD,
    });
    expect(
      (await rafa.post(`/api/rundowns/${rundownId}/outputs`, { kind: 'clocks', name: 'X' })).status,
    ).toBe(403);
    const out = connect('/api/collab-output', token);
    const r = connect('/api/collab', rundownId, rafa.cookie);
    await waitFor(() => out.provider.synced && r.provider.synced);
    sendCustom(r.provider, 101, {
      lineId: 'x',
      fraction: 0,
      running: true,
      speed: 1,
      followLive: false,
      seq: 1,
    });
    await new Promise((res) => setTimeout(res, 300));
    expect(out.custom[101]).toHaveLength(0);
  });

  it('cambiar los ajustes llega a la salida; revocarla la desconecta', async () => {
    const { output, token } = await createOutput();
    const out = connect('/api/collab-output', token);
    await waitFor(() => out.provider.synced);
    await admin.patch(`/api/outputs/${output.id}`, { settings: { fontSize: 90 } });
    await waitFor(() => out.custom[103]!.length === 1);
    expect(out.custom[103]![0]).toMatchObject({ fontSize: 90, mirror: true });
    await admin.delete(`/api/outputs/${output.id}`);
    await waitFor(() => out.closeCode() !== undefined);
    expect(out.closeCode()).toBe(4404);
  });
});
