import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertPublicUrl, parseFeed } from '../src/sources/feed';
import {
  createTestContext,
  resetDb,
  setupFirstOrg,
  type Client,
  type TestContext,
} from './helpers';

/* F2.2 Fuentes: RSS 2.0 y Atom → noticias → nevera. */

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Agencia</title>
<item><title>El Gobierno aprueba los presupuestos</title><link>https://agencia.test/1</link>
<guid>a-1</guid><pubDate>Fri, 20 Nov 2026 10:00:00 GMT</pubDate>
<description><![CDATA[<p>El Consejo de Ministros ha aprobado hoy las cuentas &amp; las medidas.</p>]]></description></item>
<item><title>Lluvias en Sevilla</title><link>https://agencia.test/2</link><guid>a-2</guid>
<pubDate>Fri, 20 Nov 2026 09:00:00 GMT</pubDate><description>Aviso amarillo.</description></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>Medio</title>
<entry><title>Elecciones en la universidad</title><id>urn:e-1</id>
<link rel="alternate" href="https://medio.test/e1"/><updated>2026-11-20T08:00:00Z</updated>
<summary>Resultados provisionales.</summary></entry></feed>`;

let ctx: TestContext;
let admin: Client;
let feeds: http.Server;
let base: string;
let rssBody = RSS;

beforeAll(async () => {
  feeds = http.createServer((req, res) => {
    if (req.url === '/rss') {
      res.setHeader('content-type', 'application/rss+xml');
      return res.end(rssBody);
    }
    if (req.url === '/atom') return res.end(ATOM);
    if (req.url === '/redirige') {
      res.statusCode = 301;
      res.setHeader('location', '/rss');
      return res.end();
    }
    res.statusCode = 404;
    res.end('no');
  });
  await new Promise<void>((r) => feeds.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(feeds.address() as AddressInfo).port}`;
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.close();
  await new Promise<void>((r) => feeds.close(() => r()));
});
beforeEach(async () => {
  rssBody = RSS;
  await resetDb();
  ({ admin } = await setupFirstOrg(ctx.app));
});

describe('fuentes', () => {
  it('lee RSS 2.0 y Atom', () => {
    const rss = parseFeed(RSS);
    expect(rss[0]).toMatchObject({
      guid: 'a-1',
      title: 'El Gobierno aprueba los presupuestos',
      summary: 'El Consejo de Ministros ha aprobado hoy las cuentas & las medidas.',
      link: 'https://agencia.test/1',
    });
    expect(rss[0]!.publishedAt?.toISOString()).toBe('2026-11-20T10:00:00.000Z');
    expect(parseFeed(ATOM)).toEqual([
      {
        guid: 'urn:e-1',
        title: 'Elecciones en la universidad',
        summary: 'Resultados provisionales.',
        link: 'https://medio.test/e1',
        publishedAt: new Date('2026-11-20T08:00:00Z'),
      },
    ]);
    expect(() => parseFeed('<html><body>hola</body></html>')).toThrow(/RSS/);
  });

  it('en la nube no lee direcciones internas', async () => {
    await expect(assertPublicUrl('http://127.0.0.1/rss')).rejects.toThrow(/red interna/);
    await expect(assertPublicUrl('http://192.168.1.10/rss')).rejects.toThrow(/red interna/);
    await expect(assertPublicUrl('http://[::1]/rss')).rejects.toThrow(/red interna/);
    await expect(assertPublicUrl('file:///etc/passwd')).rejects.toThrow(/http/);
  });

  it('alta, lectura sin duplicados, búsqueda y a la nevera', async () => {
    const created = await admin.post('/api/sources', { name: 'Agencia', url: `${base}/redirige` });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ added: 2, source: { lastError: null } });
    await admin.post('/api/sources', { name: 'Medio', url: `${base}/atom` });

    // Una noticia nueva: solo se añade esa.
    rssBody = RSS.replace(
      '</channel>',
      '<item><title>Última hora</title><guid>a-3</guid><pubDate>Fri, 20 Nov 2026 11:00:00 GMT</pubDate></item></channel>',
    );
    const again = await admin.post(`/api/sources/${created.body.source.id}/refresh`);
    expect(again.body).toEqual({ added: 1, error: null });

    const items = (await admin.get('/api/source-items')).body.items;
    expect(items.map((i: { title: string }) => i.title)).toEqual([
      'Última hora',
      'El Gobierno aprueba los presupuestos',
      'Lluvias en Sevilla',
      'Elecciones en la universidad',
    ]);
    const search = (await admin.get('/api/source-items?q=sevilla')).body.items;
    expect(search).toHaveLength(1);

    const toFridge = await admin.post(`/api/source-items/${items[1].id}/fridge`);
    expect(toFridge.status).toBe(201);
    const fridge = (await admin.get('/api/fridge')).body.items;
    expect(fridge[0]).toMatchObject({
      name: 'El Gobierno aprueba los presupuestos',
      cells: { tipo: 'TEMA', nombre: 'EL GOBIERNO APRUEBA LOS PRESUPUESTOS' },
    });
    expect(fridge[0].script[0].text).toContain('https://agencia.test/1');
  });

  it('una fuente que falla guarda el error', async () => {
    const created = await admin.post('/api/sources', { name: 'Rota', url: `${base}/no-existe` });
    expect(created.body.source.lastError).toMatch(/404/);
    expect((await admin.post('/api/sources', { name: 'X', url: 'ftp://x' })).status).toBe(400);
  });
});
