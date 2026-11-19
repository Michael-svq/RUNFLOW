import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import { insertLine, readLines, setCell } from '@runflow/sync';
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
 * Colaboración en tiempo real por WebSocket con clientes y-websocket reales.
 */

let ctx: TestContext;
let baseUrl: string;
let admin: Client;
let rundownId: string;
const providers: WebsocketProvider[] = [];

beforeAll(async () => {
  ctx = await createTestContext();
  await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = ctx.app.server.address() as AddressInfo;
  baseUrl = `ws://127.0.0.1:${port}/api/collab`;
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  for (const p of providers.splice(0)) p.destroy();
  await resetDb();
  ({ admin } = await setupFirstOrg(ctx.app));
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
});

async function waitFor(check: () => boolean, timeout = 5000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error('Tiempo de espera agotado');
    await new Promise((r) => setTimeout(r, 20));
  }
}

function connect(cookie: string | undefined, room = rundownId, origin?: string) {
  const doc = new Y.Doc();
  class CookieWebSocket extends WebSocket {
    constructor(url: string, protocols?: string | string[]) {
      super(url, protocols, {
        headers: { ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}) },
      });
    }
  }
  const provider = new WebsocketProvider(baseUrl, room, doc, {
    WebSocketPolyfill: CookieWebSocket as unknown as typeof globalThis.WebSocket,
    disableBc: true,
  });
  providers.push(provider);
  let closeCode: number | undefined;
  provider.on('connection-close', (event) => {
    closeCode ??= (event as { code?: number } | null)?.code;
  });
  return {
    doc,
    provider,
    synced: () => waitFor(() => provider.synced),
    closeCode: () => closeCode,
  };
}

async function userWithRole(role: string, email: string): Promise<Client> {
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

const names = (doc: Y.Doc) => readLines(doc).map((l) => l.cells.nombre);

describe('colaboración en tiempo real', () => {
  it('los cambios de una persona llegan a las demás', async () => {
    const a = connect(admin.cookie);
    const b = connect(admin.cookie);
    await Promise.all([a.synced(), b.synced()]);
    const id = insertLine(a.doc, { cells: { nombre: 'Presentación', tipo: 'ACTING', t_est: 30 } });
    await waitFor(() => names(b.doc).length === 1);
    setCell(b.doc, id, 'presenta', 'EDU');
    await waitFor(() => readLines(a.doc)[0]?.cells.presenta === 'EDU');
    expect(readLines(a.doc)).toEqual(readLines(b.doc));
  });

  it('guarda la escaleta: quien entra después la recibe y el listado se actualiza', async () => {
    const a = connect(admin.cookie);
    await a.synced();
    insertLine(a.doc, { cells: { nombre: 'Uno', t_est: 30 } });
    insertLine(a.doc, { cells: { nombre: 'Dos', t_est: 45 } });
    a.provider.destroy();
    await waitFor(() => ctx.collab.openDocuments === 0);

    const later = connect(admin.cookie);
    await later.synced();
    await waitFor(() => names(later.doc).length === 2);
    expect(names(later.doc)).toEqual(['Uno', 'Dos']);
    const res = await admin.get(`/api/rundowns/${rundownId}`);
    expect(res.body.rundown).toMatchObject({ lineCount: 2, estimatedSeconds: 75 });
  });

  it('el rol de solo lectura recibe cambios pero no puede modificar', async () => {
    const lector = await userWithRole('lectura', 'lector@chaneltv.test');
    const editor = connect(admin.cookie);
    const reader = connect(lector.cookie);
    await Promise.all([editor.synced(), reader.synced()]);
    insertLine(editor.doc, { cells: { nombre: 'Oficial' } });
    await waitFor(() => names(reader.doc).length === 1);

    insertLine(reader.doc, { cells: { nombre: 'Intruso' } });
    await new Promise((r) => setTimeout(r, 300));
    expect(names(editor.doc)).toEqual(['Oficial']);
    // Ni se guarda.
    editor.provider.destroy();
    reader.provider.destroy();
    await waitFor(() => ctx.collab.openDocuments === 0);
    const fresh = connect(admin.cookie);
    await fresh.synced();
    await waitFor(() => names(fresh.doc).length >= 1);
    expect(names(fresh.doc)).toEqual(['Oficial']);
  });

  it('rechaza conexiones sin sesión (sin reintentos)', async () => {
    const anon = connect(undefined);
    await waitFor(() => anon.closeCode() !== undefined);
    expect(anon.closeCode()).toBe(4401);
  });

  it('rechaza escaletas de otra empresa', async () => {
    const created = await admin.post('/api/platform/orgs', {
      orgName: 'Escuela',
      adminName: 'Bea',
      adminEmail: 'bea@escuela.test',
      adminPassword: 'temporal-12345',
    });
    expect(created.status).toBe(201);
    const bea = new Client(ctx.app);
    await bea.login('bea@escuela.test', 'temporal-12345');
    await bea.post('/api/me/password', {
      currentPassword: 'temporal-12345',
      newPassword: PASSWORD,
    });
    const intruder = connect(bea.cookie);
    await waitFor(() => intruder.closeCode() !== undefined);
    expect(intruder.closeCode()).toBe(4404);
    expect(names(intruder.doc)).toEqual([]);
  });

  it('rechaza conexiones desde otro origen (secuestro de WebSocket)', async () => {
    const evil = connect(admin.cookie, rundownId, 'https://malicioso.test');
    await waitFor(() => evil.closeCode() !== undefined);
    expect(evil.closeCode()).toBe(4403);
  });

  it('tres clientes con desconexión intermedia convergen', async () => {
    const [a, b, c] = [connect(admin.cookie), connect(admin.cookie), connect(admin.cookie)];
    await Promise.all([a.synced(), b.synced(), c.synced()]);
    const base = insertLine(a.doc, { cells: { nombre: 'Base' } });
    await waitFor(() => names(c.doc).length === 1);

    c.provider.disconnect(); // c se queda sin red
    insertLine(a.doc, { cells: { nombre: 'De A' } });
    setCell(b.doc, base, 'observaciones', 'De B');
    insertLine(c.doc, { index: 0, cells: { nombre: 'De C (sin red)' } });
    await new Promise((r) => setTimeout(r, 200));
    expect(names(a.doc)).not.toContain('De C (sin red)');

    c.provider.connect(); // vuelve la red
    await waitFor(() => [a, b, c].every((x) => names(x.doc).length === 3));
    await waitFor(
      () => readLines(c.doc).find((l) => l.id === base)?.cells.observaciones === 'De B',
    );
    expect(readLines(a.doc)).toEqual(readLines(b.doc));
    expect(readLines(b.doc)).toEqual(readLines(c.doc));
    expect(names(a.doc)).toEqual(['De C (sin red)', 'Base', 'De A']);
  });
});
