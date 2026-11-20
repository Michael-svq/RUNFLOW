import type { AddressInfo } from 'node:net';
import * as decoding from 'lib0/decoding';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import type { LiveState } from '@runflow/core';
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
let ids: Record<string, string>;

beforeAll(async () => {
  ctx = await createTestContext({ MIN_GO_INTERVAL_MS: '150' });
  await ctx.app.listen({ port: 0, host: '127.0.0.1' });
});
afterAll(async () => {
  await ctx.close();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(check: () => boolean | Promise<boolean>, timeout = 5000) {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeout) throw new Error('Tiempo de espera agotado');
    await sleep(25);
  }
}

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
  // Escaleta: acting, VTR corto (autonext), flotante, tema, colas
  ids = await ctx.collab.withDoc(rundownId, orgId, (doc) => ({
    a: insertLine(doc, { cells: { nombre: 'Presentación', tipo: 'ACTING', t_est: 30 } }),
    b: insertLine(doc, { cells: { nombre: 'VTR', tipo: 'VTR', dur_vtr: 1 } }),
    c: insertLine(doc, { cells: { nombre: 'Reserva', tipo: 'VARIOS', t_est: 60, _float: '1' } }),
    d: insertLine(doc, { cells: { nombre: 'Tema', tipo: 'TEMA', t_est: 120 } }),
    e: insertLine(doc, { cells: { nombre: 'Colas', tipo: 'COLAS', dur_vtr: 20 } }),
  }));
});

const url = () => `/api/rundowns/${rundownId}/live`;

async function go(client: Client = admin, expectedOnAir?: string | null) {
  await sleep(160); // respeta el intervalo mínimo entre GO
  return client.post(`${url()}/go`, expectedOnAir === undefined ? {} : { expectedOnAir });
}

async function cellOf(lineId: string, key: string) {
  return ctx.collab.withDoc(
    rundownId,
    orgId,
    (doc) => readLines(doc).find((l) => l.id === lineId)?.cells[key],
  );
}

describe('GO', () => {
  it('arranca, avanza saltando flotantes, marca EMITIDO y registra el as-run', async () => {
    let res = await go();
    expect(res.status).toBe(200);
    const first: LiveState = res.body.live;
    expect(first.onAir?.lineId).toBe(ids.a);
    expect(first.showStartedAt).toBe(first.onAir?.startedAt);
    expect((await admin.get(`/api/rundowns/${rundownId}`)).body.rundown.status).toBe('en_aire');

    await admin.patch(url(), { mode: 'manual' }); // sin autonext para esta prueba
    res = await go();
    expect(res.body.live.onAir.lineId).toBe(ids.b);
    expect(res.body.live.played[ids.a!].duration).toBeGreaterThan(0);
    expect(await cellOf(ids.a!, 'estado')).toBe('E');

    res = await go();
    expect(res.body.live.onAir.lineId).toBe(ids.d); // salta la flotante
    await go();
    res = await go(); // después de la última: fin
    expect(res.body.live.onAir).toBeNull();
    expect(res.body.live.showEndedAt).not.toBeNull();
    expect((await admin.get(`/api/rundowns/${rundownId}`)).body.rundown.status).toBe('cerrada');

    const asrun = (await admin.get(`/api/rundowns/${rundownId}/asrun`)).body.entries;
    expect(asrun.map((e: any) => e.name)).toEqual(['Presentación', 'VTR', 'Tema', 'Colas']);
    expect(asrun.every((e: any) => e.endedAt && e.durationS !== null)).toBe(true);
  });

  it('protege contra la doble pulsación y contra órdenes obsoletas', async () => {
    await go();
    await admin.patch(url(), { mode: 'manual' });
    const quick = await admin.post(`${url()}/go`, {});
    expect(quick.status).toBe(409);
    expect(quick.body.error.code).toBe('too_fast');

    // Dos operadores pulsan GO viendo la misma línea en aire: solo vale uno.
    const ok = await go(admin, ids.a);
    expect(ok.status).toBe(200);
    const stale = await go(admin, ids.a);
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('stale');
  });

  it('se puede elegir la siguiente y volver atrás', async () => {
    await admin.patch(url(), { mode: 'manual' });
    await go();
    let res = await admin.post(`${url()}/next`, { lineId: ids.e });
    expect(res.body.live.next).toBe(ids.e);
    res = await go();
    expect(res.body.live.onAir.lineId).toBe(ids.e);
    res = await admin.post(`${url()}/back`);
    expect(res.body.live.onAir.lineId).toBe(ids.a);
    expect(res.body.live.played[ids.a!]).toBeUndefined();
    expect((await admin.post(`${url()}/next`, { lineId: ids.c })).status).toBe(409); // flotante
  });

  it('en ensayo no cambia estados ni el estado de la escaleta', async () => {
    await admin.patch(url(), { mode: 'manual', rehearsal: true });
    await go();
    await go();
    expect(await cellOf(ids.a!, 'estado')).toBeUndefined();
    expect((await admin.get(`/api/rundowns/${rundownId}`)).body.rundown.status).toBe('borrador');
    const asrun = (await admin.get(`/api/rundowns/${rundownId}/asrun`)).body.entries;
    expect(asrun.every((e: any) => e.rehearsal)).toBe(true);
  });

  it('terminar y volver a preparación', async () => {
    await go();
    let res = await admin.post(`${url()}/stop`);
    expect(res.body.live.onAir).toBeNull();
    expect(res.body.live.showEndedAt).not.toBeNull();
    res = await admin.post(`${url()}/reset`);
    expect(res.body.live).toMatchObject({
      onAir: null,
      showStartedAt: null,
      showEndedAt: null,
      played: {},
    });
  });
});

describe('avance automático', () => {
  it('híbrido: el VTR pasa solo al terminar; el ACTING espera al GO', async () => {
    await admin.patch(url(), { mode: 'hibrido' });
    await go(); // Presentación (ACTING, 30 s): no avanza sola
    await go(); // VTR de 1 s: autonext
    await waitFor(async () => (await admin.get(url())).body.live.onAir?.lineId === ids.d, 4000);
    const asrun = (await admin.get(`/api/rundowns/${rundownId}/asrun`)).body.entries;
    expect(asrun.map((e: any) => e.trigger)).toEqual(['go', 'go', 'auto']);
  });

  it('manual: nunca avanza solo', async () => {
    await admin.patch(url(), { mode: 'manual' });
    await go();
    await go(); // VTR de 1 s
    await sleep(1400);
    expect((await admin.get(url())).body.live.onAir.lineId).toBe(ids.b);
  });
});

describe('permisos y aislamiento', () => {
  it('sin permiso de directo se puede ver pero no dar GO', async () => {
    await admin.post('/api/users', {
      name: 'Rafa',
      email: 'rafa@chaneltv.test',
      roleId: await roleId(admin, 'redactor'),
      password: 'temporal-12345',
    });
    const rafa = new Client(ctx.app);
    await rafa.login('rafa@chaneltv.test', 'temporal-12345');
    await rafa.post('/api/me/password', {
      currentPassword: 'temporal-12345',
      newPassword: PASSWORD,
    });
    expect((await rafa.get(url())).status).toBe(200);
    expect((await rafa.post(`${url()}/go`, {})).status).toBe(403);
  });

  it('otra empresa no ve el directo', async () => {
    await admin.post('/api/platform/orgs', {
      orgName: 'Escuela',
      adminName: 'Bea',
      adminEmail: 'bea@escuela.test',
      adminPassword: 'temporal-12345',
    });
    const bea = new Client(ctx.app);
    await bea.login('bea@escuela.test', 'temporal-12345');
    await bea.post('/api/me/password', {
      currentPassword: 'temporal-12345',
      newPassword: PASSWORD,
    });
    expect((await bea.get(url())).status).toBe(404);
    expect((await bea.post(`${url()}/go`, {})).status).toBe(404);
  });
});

describe('tiempo real', () => {
  it('quien está conectado recibe el estado del directo al instante', async () => {
    const { port } = ctx.app.server.address() as AddressInfo;
    const doc = new Y.Doc();
    const cookie = admin.cookie!;
    class CookieWebSocket extends WebSocket {
      constructor(u: string, p?: string | string[]) {
        super(u, p, { headers: { cookie } });
      }
    }
    const provider = new WebsocketProvider(`ws://127.0.0.1:${port}/api/collab`, rundownId, doc, {
      WebSocketPolyfill: CookieWebSocket as unknown as typeof globalThis.WebSocket,
      disableBc: true,
    });
    const received: LiveState[] = [];
    provider.messageHandlers[100] = (_enc, decoder: decoding.Decoder) => {
      received.push(JSON.parse(decoding.readVarString(decoder)));
    };
    try {
      await waitFor(() => provider.synced && received.length > 0);
      expect(received[0]!.onAir).toBeNull();
      await go();
      await waitFor(() => received.at(-1)?.onAir?.lineId === ids.a);
    } finally {
      provider.destroy();
    }
  });

  it('la hora del servidor está disponible para sincronizar relojes', async () => {
    const before = Date.now();
    const res = await new Client(ctx.app).get('/api/time');
    expect(res.body.now).toBeGreaterThanOrEqual(before);
  });
});
