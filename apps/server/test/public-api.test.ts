import { createHmac } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertLine, writeScript } from '@runflow/sync';
import {
  createTestContext,
  resetDb,
  setupFirstOrg,
  type Client,
  type TestContext,
} from './helpers';

/* F2.4 API pública: tokens con alcances, REST v1 y webhooks firmados. */

let ctx: TestContext;
let admin: Client;
let orgId: string;
let rundownId: string;
const ids: Record<string, string> = {};
let receiver: http.Server;
let receiverUrl: string;
const received: { headers: http.IncomingHttpHeaders; body: string }[] = [];

beforeAll(async () => {
  receiver = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({ headers: req.headers, body });
      res.end('ok');
    });
  });
  await new Promise<void>((r) => receiver.listen(0, '127.0.0.1', r));
  receiverUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/hook`;
  ctx = await createTestContext({ MIN_GO_INTERVAL_MS: '0' });
});
afterAll(async () => {
  await ctx.close();
  await new Promise<void>((r) => receiver.close(() => r()));
});
beforeEach(async () => {
  received.length = 0;
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
    ids.a = insertLine(doc, { cells: { nombre: 'Presentación', tipo: 'ACTING', t_est: 30 } });
    ids.b = insertLine(doc, { cells: { nombre: 'Gobierno', tipo: 'TEMA', t_est: 60 } });
    writeScript(doc, ids.a, [
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

const api = (method: 'GET' | 'POST' | 'PATCH', url: string, token: string, payload?: unknown) =>
  ctx.app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${token}` },
    ...(payload ? { payload: payload as object } : {}),
  });

async function token(scopes: string[]) {
  const res = await admin.post('/api/api-tokens', { name: `t-${scopes.join('-')}`, scopes });
  expect(res.status).toBe(201);
  expect(res.body.token).toMatch(/^rf_/);
  return res.body as { token: string; id: string };
}

describe('API pública v1', () => {
  it('lee escaletas y líneas, escribe líneas y da GO según los alcances del token', async () => {
    const read = await token(['read']);
    const list = await api('GET', '/api/v1/rundowns', read.token);
    expect(list.statusCode).toBe(200);
    expect(list.json().rundowns[0]).toMatchObject({ id: rundownId, program: 'Noticias' });
    const detail = (await api('GET', `/api/v1/rundowns/${rundownId}`, read.token)).json();
    expect(detail.lines.map((l: { cells: { nombre: string } }) => l.cells.nombre)).toEqual([
      'Presentación',
      'Gobierno',
    ]);
    // Sin el permiso «live» o «write», no.
    expect(
      (await api('POST', `/api/v1/rundowns/${rundownId}/live/go`, read.token)).statusCode,
    ).toBe(403);
    expect(
      (
        await api('POST', `/api/v1/rundowns/${rundownId}/lines`, read.token, {
          cells: { nombre: 'X' },
        })
      ).statusCode,
    ).toBe(403);

    const full = await token(['read', 'live', 'write']);
    const added = await api('POST', `/api/v1/rundowns/${rundownId}/lines`, full.token, {
      cells: { nombre: 'Desde la API', tipo: 'TEMA', t_est: 45 },
    });
    expect(added.statusCode).toBe(201);
    const patched = await api(
      'PATCH',
      `/api/v1/rundowns/${rundownId}/lines/${added.json().lineId}`,
      full.token,
      {
        cells: { presenta: 'EDU' },
      },
    );
    expect(patched.statusCode).toBe(200);
    const go = await api('POST', `/api/v1/rundowns/${rundownId}/live/go`, full.token);
    expect(go.json().live.onAir.lineId).toBe(ids.a);
    const take = await api('POST', `/api/v1/rundowns/${rundownId}/cg/take`, full.token, {
      graphicId: 'g1',
    });
    expect(Object.keys(take.json().cg.graphics)).toEqual(['g1']);
    const lines = (await api('GET', `/api/v1/rundowns/${rundownId}`, full.token)).json().lines;
    expect(lines.at(-1).cells).toMatchObject({ nombre: 'Desde la API', presenta: 'EDU' });

    // Revocado: fuera.
    await admin.delete(`/api/api-tokens/${full.id}`);
    expect((await api('GET', '/api/v1/rundowns', full.token)).statusCode).toBe(401);
    expect((await api('GET', '/api/v1/rundowns', 'rf_no-existe-000000000000000')).statusCode).toBe(
      401,
    );
    expect((await ctx.app.inject({ method: 'GET', url: '/api/v1/rundowns' })).statusCode).toBe(401);
    const listed = (await admin.get('/api/api-tokens')).body.tokens;
    expect(listed.map((t: { name: string }) => t.name)).toEqual(['t-read']);
    expect(listed[0].lastUsedAt).not.toBeNull();
  });
});

describe('webhooks', () => {
  it('avisos firmados del GO y de los rótulos', async () => {
    const created = await admin.post('/api/webhooks', {
      url: receiverUrl,
      events: ['live.go', 'graphic.in', 'graphic.out'],
    });
    expect(created.status).toBe(201);
    const secret = created.body.secret as string;
    expect(secret).toMatch(/^whsec_/);

    await admin.patch(`/api/rundowns/${rundownId}/live`, { mode: 'manual' });
    await admin.post(`/api/rundowns/${rundownId}/live/go`);
    await admin.post(`/api/rundowns/${rundownId}/cg/take`, { graphicId: 'g1' });
    await admin.post(`/api/rundowns/${rundownId}/cg/out`, { graphicId: 'g1' });
    await expect.poll(() => received.length, { timeout: 3000 }).toBe(3);
    const events = received.map((r) => JSON.parse(r.body));
    expect(events.map((e) => e.event).sort()).toEqual(['graphic.in', 'graphic.out', 'live.go']);
    const go = events.find((e) => e.event === 'live.go');
    expect(go.data.onAir).toMatchObject({ lineId: ids.a, name: 'Presentación', type: 'ACTING' });

    // Firma comprobable con el secreto.
    const r = received[0]!;
    const sig = String(r.headers['x-runflow-signature']);
    const t = /t=(\d+)/.exec(sig)![1];
    const v1 = /v1=([0-9a-f]+)/.exec(sig)![1];
    expect(v1).toBe(createHmac('sha256', secret).update(`${t}.${r.body}`).digest('hex'));

    // Prueba manual y estado de la última entrega.
    const test = await admin.post(`/api/webhooks/${created.body.webhook.id}/test`);
    expect(test.body).toEqual({ status: 200, error: null });
    expect((await admin.get('/api/webhooks')).body.webhooks[0]).toMatchObject({ lastStatus: 200 });
  });
});
