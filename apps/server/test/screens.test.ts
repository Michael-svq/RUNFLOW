import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertLine } from '@runflow/sync';
import type { PublicScreenState } from '@runflow/core';
import {
  createTestContext,
  resetDb,
  setupFirstOrg,
  type Client,
  type TestContext,
} from './helpers';

/* F3.3 Pantallas: contenido por defecto, escenas a mano y con PANTALLAS en el GO. */

let ctx: TestContext;
let admin: Client;
let orgId: string;
let dir: string;
let base: string;
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'runflow-screens-'));
  ctx = await createTestContext({ DATA_DIR: dir });
  await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${(ctx.app.server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await ctx.close();
  await rm(dir, { recursive: true, force: true });
});
beforeEach(async () => {
  await resetDb();
  const setup = await setupFirstOrg(ctx.app);
  admin = setup.admin;
  orgId = setup.me.activeOrg.id;
});

async function uploadPng() {
  const boundary = '----runflow';
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/media',
    headers: {
      cookie: admin.cookie!,
      'x-runflow-request': '1',
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="Fondo gala.png"\r\nContent-Type: image/png\r\n\r\n`,
      ),
      PNG,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  });
  expect(res.statusCode).toBe(201);
  return res.json().media.id as string;
}

/** Lee eventos SSE de una pantalla. */
async function listen(token: string) {
  const ctrl = new AbortController();
  const res = await fetch(`${base}/api/public/screens/${token}/events`, { signal: ctrl.signal });
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  const reader = res.body!.getReader();
  const states: (PublicScreenState | 'gone')[] = [];
  let buf = '';
  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += new TextDecoder().decode(value);
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          if (chunk.startsWith('event: gone')) states.push('gone');
          else if (chunk.startsWith('data: ')) states.push(JSON.parse(chunk.slice(6)));
        }
      }
    } catch {
      /* cerrado */
    }
  })();
  return { states, close: () => ctrl.abort() };
}

const last = (s: { states: unknown[] }) => s.states[s.states.length - 1] as PublicScreenState;

describe('pantallas', () => {
  it('contenido por defecto, escena a mano y con el GO', async () => {
    const mediaId = await uploadPng();
    const wall = (
      await admin.post('/api/screens', {
        name: 'Videowall',
        content: { type: 'text', text: 'RunFlow TV' },
      })
    ).body.screen;
    const desk = (await admin.post('/api/screens', { name: 'Mesa', content: { type: 'clock' } }))
      .body.screen;
    expect(wall.token).toMatch(/^[A-Za-z0-9_-]{20,}$/);

    const pub = await admin.get(`/api/public/screens/${wall.token}`);
    expect(pub.body.state).toMatchObject({
      orgName: 'Chanel TV',
      name: 'Videowall',
      scene: null,
      content: { type: 'text', text: 'RunFlow TV', color: '#FFFFFF' },
    });

    const stream = await listen(wall.token);
    await expect.poll(() => stream.states.length).toBe(1);

    const scene = await admin.post('/api/screens/scenes', {
      name: 'Apertura',
      contents: { [wall.id]: { type: 'media', mediaId, fit: 'contain' } },
    });
    expect(scene.status).toBe(201);
    // Mismo nombre (sin acentos ni mayúsculas): no.
    expect((await admin.post('/api/screens/scenes', { name: 'APERTURA' })).status).toBe(409);

    // A mano
    expect((await admin.post(`/api/screens/scenes/${scene.body.scene.id}/take`)).status).toBe(200);
    await expect.poll(() => last(stream)?.scene).toBe('Apertura');
    const c = last(stream).content;
    expect(c).toMatchObject({ type: 'media', kind: 'image', fit: 'contain' });
    const file = await fetch(`${base}${(c as { src: string }).src}`);
    expect(file.status).toBe(200);
    expect(Buffer.from(await file.arrayBuffer()).equals(PNG)).toBe(true);
    // La mesa no está en la escena: sigue con su reloj.
    expect((await admin.get(`/api/public/screens/${desk.token}`)).body.state.content).toEqual({
      type: 'clock',
    });

    await admin.post('/api/screens/release');
    await expect.poll(() => last(stream)?.scene).toBeNull();

    // Con el GO: la línea con PANTALLAS = «apertura» activa la escena.
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
      insertLine(doc, { cells: { nombre: 'Cabecera', tipo: 'ACTING', pantallas: 'apertura' } });
      insertLine(doc, { cells: { nombre: 'Saludo', tipo: 'ACTING' } });
    });
    await admin.post(`/api/rundowns/${rundownId}/live/go`);
    await expect.poll(() => last(stream)?.scene).toBe('Apertura');
    // Una línea sin PANTALLAS no cambia la escena.
    await admin.post(`/api/rundowns/${rundownId}/live/go`);
    await new Promise((r) => setTimeout(r, 200));
    expect(last(stream).scene).toBe('Apertura');

    // Enlace regenerado: el cliente antiguo recibe «gone».
    await admin.post(`/api/screens/${wall.id}/token`);
    await expect.poll(() => stream.states.includes('gone')).toBe(true);
    expect((await admin.get(`/api/public/screens/${wall.token}`)).status).toBe(404);
    stream.close();
  });

  it('validaciones', async () => {
    const res = await admin.post('/api/screens', {
      name: 'X',
      content: { type: 'media', mediaId: '00000000-0000-4000-8000-000000000000' },
    });
    expect(res.status).toBe(404);
    expect(
      (await admin.post('/api/screens', { name: 'X', content: { type: 'url', url: 'ftp://a' } }))
        .status,
    ).toBe(400);
    expect(
      (
        await admin.post('/api/screens/scenes', {
          name: 'Y',
          contents: { '00000000-0000-4000-8000-000000000000': { type: 'clock' } },
        })
      ).status,
    ).toBe(404);
    expect((await admin.get('/api/public/screens/no-existe-este-token-xx')).status).toBe(404);
  });
});
