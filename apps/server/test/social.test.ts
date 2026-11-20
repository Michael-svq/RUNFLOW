import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getScriptFragment, insertLine, readLines, readScript } from '@runflow/sync';
import { socialGraphicFields } from '@runflow/core';
import { youtubeVideoId } from '../src/social/fetch';
import {
  Client,
  createTestContext,
  PASSWORD,
  resetDb,
  roleId,
  setupFirstOrg,
  type TestContext,
} from './helpers';

/* F3.4 Redes: búsquedas en Mastodon, Bluesky, X y YouTube; moderación; rótulo RRS. */

let ctx: TestContext;
let admin: Client;
let orgId: string;
let api: http.Server;
let base: string;
const seen: { url: string; auth?: string }[] = [];

const MASTO_TAG = [
  {
    id: '1',
    uri: 'https://masto.test/users/lucia/statuses/1',
    url: 'https://masto.test/@lucia/1',
    created_at: '2026-11-20T10:00:00Z',
    content: '<p>¡Qué gran <a href="#">#Gala2026</a>!</p>',
    account: { acct: 'lucia', username: 'lucia', display_name: 'Lucía Romero' },
    media_attachments: [{ preview_url: 'https://masto.test/m/1.jpg' }],
  },
  { id: '2', reblog: { id: '9' }, content: '<p>impulsado</p>', account: { acct: 'x' } },
];

beforeAll(async () => {
  api = http.createServer((req, res) => {
    seen.push({ url: req.url!, auth: req.headers.authorization });
    res.setHeader('content-type', 'application/json');
    const u = new URL(req.url!, 'http://x');
    if (u.pathname === '/api/v1/timelines/tag/Gala2026') return res.end(JSON.stringify(MASTO_TAG));
    if (u.pathname === '/xrpc/app.bsky.feed.searchPosts')
      return res.end(
        JSON.stringify({
          posts: [
            {
              uri: 'at://did:plc:abc/app.bsky.feed.post/3kxyz',
              author: { handle: 'pepe.bsky.social', displayName: 'Pepe' },
              record: { text: 'Viendo la gala #Gala2026', createdAt: '2026-11-20T11:00:00Z' },
            },
          ],
        }),
      );
    if (u.pathname === '/2/tweets/search/recent') {
      if (req.headers.authorization !== 'Bearer clave-x') {
        res.statusCode = 401;
        return res.end('{}');
      }
      return res.end(
        JSON.stringify({
          data: [
            { id: '77', text: 'Gala top', author_id: 'u1', created_at: '2026-11-20T12:00:00Z' },
          ],
          includes: { users: [{ id: 'u1', name: 'Ana', username: 'ana_tv' }] },
        }),
      );
    }
    if (u.pathname === '/youtube/v3/commentThreads')
      return res.end(
        JSON.stringify({
          items: [
            {
              id: 'c1',
              snippet: {
                topLevelComment: {
                  snippet: {
                    authorDisplayName: '@maria',
                    textOriginal: 'Saludos desde Huelva',
                    publishedAt: '2026-11-20T12:30:00Z',
                  },
                },
              },
            },
          ],
        }),
      );
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise<void>((r) => api.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
  ctx = await createTestContext({
    SOCIAL_POLL_MS: '0',
    SOCIAL_BLUESKY_API: base,
    SOCIAL_X_API: base,
    SOCIAL_YOUTUBE_API: base,
  });
});
afterAll(async () => {
  await ctx.close();
  await new Promise<void>((r) => api.close(() => r()));
});
beforeEach(async () => {
  await resetDb();
  const setup = await setupFirstOrg(ctx.app);
  admin = setup.admin;
  orgId = setup.me.activeOrg.id;
  seen.length = 0;
});

async function userWithRole(role: string, email: string) {
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

describe('redes', () => {
  it('lee Mastodon, Bluesky, X y YouTube sin duplicados', async () => {
    const masto = await admin.post('/api/social/feeds', {
      network: 'mastodon',
      query: '#Gala2026',
      instance: `${base}/`,
    });
    expect(masto.status).toBe(201);
    expect(masto.body).toMatchObject({ added: 1, feed: { lastError: null, hasKey: false } });

    const bsky = await admin.post('/api/social/feeds', { network: 'bluesky', query: '#Gala2026' });
    expect(bsky.body.added).toBe(1);
    expect(seen.some((s) => s.url.includes('q=%23Gala2026'))).toBe(true);

    // X sin clave: no; con clave: va cifrada y no se devuelve.
    expect(
      (await admin.post('/api/social/feeds', { network: 'x', query: '#Gala2026' })).status,
    ).toBe(400);
    const xf = await admin.post('/api/social/feeds', {
      network: 'x',
      query: '#Gala2026',
      apiKey: 'clave-x',
    });
    expect(xf.body).toMatchObject({ added: 1, feed: { hasKey: true } });
    expect(JSON.stringify(xf.body)).not.toContain('clave-x');

    const yt = await admin.post('/api/social/feeds', {
      network: 'youtube',
      query: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      apiKey: 'clave-yt',
    });
    expect(yt.body.added).toBe(1);

    // Releer no duplica.
    const again = await admin.post(`/api/social/feeds/${masto.body.feed.id}/refresh`);
    expect(again.body).toEqual({ added: 0, error: null });

    const posts = await admin.get('/api/social/posts?status=nuevo');
    expect(posts.body.posts).toHaveLength(4);
    expect(posts.body.counts).toEqual({ nuevo: 4 });
    const lucia = posts.body.posts.find((p: { network: string }) => p.network === 'mastodon');
    expect(lucia).toMatchObject({
      author: 'Lucía Romero',
      handle: 'lucia',
      text: '¡Qué gran #Gala2026!',
      mediaUrl: 'https://masto.test/m/1.jpg',
    });
    const tweet = posts.body.posts.find((p: { network: string }) => p.network === 'x');
    expect(tweet).toMatchObject({ handle: 'ana_tv', url: 'https://x.com/ana_tv/status/77' });

    // Errores a la vista en la búsqueda.
    const bad = await admin.post('/api/social/feeds', {
      network: 'mastodon',
      query: '#NoExiste',
      instance: base,
    });
    expect(bad.body.feed.lastError).toContain('404');
    // Máximo 6 búsquedas.
    await admin.post('/api/social/feeds', { network: 'bluesky', query: 'gala' });
    expect(
      (await admin.post('/api/social/feeds', { network: 'bluesky', query: 'otra' })).status,
    ).toBe(409);
  });

  it('moderación y rótulo RRS en la escaleta', async () => {
    const manual = await admin.post('/api/social/posts', {
      network: 'whatsapp',
      author: 'Carmen',
      text: 'Saludos a mi nieta, que actúa hoy en la gala',
    });
    expect(manual.status).toBe(201);
    expect(manual.body.post.status).toBe('aprobado');

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
    let existing = '';
    await ctx.collab.withDoc(rundownId, orgId, (doc) => {
      existing = insertLine(doc, { cells: { nombre: 'Saludos', tipo: 'ACTING' } });
    });

    // A una línea nueva de GRAFISMO
    const r1 = await admin.post(`/api/social/posts/${manual.body.post.id}/rundown`, { rundownId });
    expect(r1.status).toBe(201);
    // A una línea existente
    const r2 = await admin.post(`/api/social/posts/${manual.body.post.id}/rundown`, {
      rundownId,
      lineId: existing,
    });
    expect(r2.body.lineId).toBe(existing);
    await ctx.collab.withDoc(rundownId, orgId, (doc) => {
      const lines = readLines(doc);
      expect(lines.map((l) => l.cells.tipo)).toEqual(['ACTING', 'GRAFISMO']);
      expect(lines[1]!.cells.nombre).toBe('RRSS Carmen');
      const g = readScript(getScriptFragment(doc, existing))[0];
      expect(g).toMatchObject({
        kind: 'rotulo',
        type: 'RRS',
        f0: 'Carmen',
        f2: 'Saludos a mi nieta, que actúa hoy en la gala',
        f3: 'WhatsApp',
      });
    });
    expect(
      (
        await admin.post(`/api/social/posts/${manual.body.post.id}/rundown`, {
          rundownId,
          lineId: 'no-existe',
        })
      ).status,
    ).toBe(404);

    // Descartar y filtrar
    await admin.patch(`/api/social/posts/${manual.body.post.id}`, { status: 'descartado' });
    expect((await admin.get('/api/social/posts?status=descartado')).body.posts).toHaveLength(1);
    expect((await admin.get('/api/social/posts?q=nieta')).body.posts).toHaveLength(1);
  });

  it('permisos y utilidades', async () => {
    const lectura = await userWithRole('lectura', 'lec@chaneltv.test');
    expect((await lectura.get('/api/social/posts')).status).toBe(200);
    expect((await lectura.post('/api/social/posts', { author: 'X', text: 'Y' })).status).toBe(403);
    expect(
      (await lectura.post('/api/social/feeds', { network: 'bluesky', query: 'x' })).status,
    ).toBe(403);
    expect(
      (await admin.post('/api/social/feeds', { network: 'mastodon', query: '#x' })).status,
    ).toBe(400);

    expect(youtubeVideoId('https://youtu.be/dQw4w9WgXcQ?t=3')).toBe('dQw4w9WgXcQ');
    expect(youtubeVideoId('https://www.youtube.com/live/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeVideoId('nada')).toBeNull();
    const f = socialGraphicFields({
      author: 'Ana',
      handle: 'ana',
      text: 'x'.repeat(400),
      network: 'bluesky',
    });
    expect(f.f1).toBe('@ana');
    expect(f.f2).toHaveLength(280);
    expect(f.f2.endsWith('…')).toBe(true);
    expect(f.f3).toBe('Bluesky');
  });
});
