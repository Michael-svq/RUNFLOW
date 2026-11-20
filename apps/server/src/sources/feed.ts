import { lookup } from 'node:dns/promises';
import net from 'node:net';
import { XMLParser } from 'fast-xml-parser';

/*
 * Lector de RSS 2.0 y Atom (F2.2). En la nube no se permite leer direcciones
 * de la red interna (protección SSRF); en una Station sí (agencias locales).
 */

export interface FeedItem {
  guid: string;
  title: string;
  summary: string;
  link: string;
  publishedAt: Date | null;
}

const MAX_BYTES = 2 * 1024 * 1024;

function isPrivate(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  const v6 = ip.toLowerCase();
  return (
    v6 === '::1' ||
    v6 === '::' ||
    v6.startsWith('fc') ||
    v6.startsWith('fd') ||
    v6.startsWith('fe80') ||
    (v6.startsWith('::ffff:') && isPrivate(v6.slice(7)))
  );
}

export async function assertPublicUrl(url: string): Promise<void> {
  const u = new URL(url);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Solo http o https');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addresses = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (addresses.some((a) => isPrivate(a.address)))
    throw new Error('No se pueden leer direcciones de la red interna');
}

const text = (v: unknown): string => {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (typeof v === 'object' && '#text' in (v as Record<string, unknown>))
    return String((v as Record<string, unknown>)['#text']);
  return '';
};

/** Texto plano a partir de HTML sencillo (descripciones de RSS). */
export function plain(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

const date = (v: unknown): Date | null => {
  const t = Date.parse(text(v));
  return Number.isFinite(t) ? new Date(t) : null;
};

const asArray = <T>(v: T | T[] | undefined): T[] =>
  v === undefined ? [] : Array.isArray(v) ? v : [v];

export function parseFeed(xml: string): FeedItem[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@',
    processEntities: true,
    htmlEntities: true,
  });
  const doc = parser.parse(xml) as Record<string, any>;
  const items: FeedItem[] = [];
  if (doc.rss?.channel) {
    for (const it of asArray(doc.rss.channel.item)) {
      const title = plain(text(it.title));
      const link = text(it.link);
      const guid = text(it.guid) || link || title;
      if (!title || !guid) continue;
      items.push({
        guid,
        title,
        summary: plain(text(it['content:encoded']) || text(it.description)).slice(0, 4000),
        link,
        publishedAt: date(it.pubDate ?? it['dc:date']),
      });
    }
  } else if (doc.feed) {
    for (const it of asArray(doc.feed.entry)) {
      const title = plain(text(it.title));
      const links = asArray(it.link) as Record<string, string>[];
      const link =
        links.find((l) => !l['@rel'] || l['@rel'] === 'alternate')?.['@href'] ??
        links[0]?.['@href'] ??
        '';
      const guid = text(it.id) || link || title;
      if (!title || !guid) continue;
      items.push({
        guid,
        title,
        summary: plain(text(it.summary) || text(it.content)).slice(0, 4000),
        link,
        publishedAt: date(it.updated ?? it.published),
      });
    }
  } else {
    throw new Error('No es un RSS ni un Atom');
  }
  return items.slice(0, 200);
}

/**
 * GET con protección SSRF: comprueba cada destino (también tras redirecciones),
 * con tiempo y tamaño máximos. Devuelve el cuerpo como texto.
 */
export async function safeGetText(
  url: string,
  opts: { allowPrivate: boolean; headers?: Record<string, string>; maxBytes?: number },
): Promise<string> {
  const max = opts.maxBytes ?? MAX_BYTES;
  let current = url;
  let res: Response | undefined;
  // Las redirecciones se siguen a mano para comprobar cada destino.
  for (let hop = 0; hop < 4; hop++) {
    if (!opts.allowPrivate) await assertPublicUrl(current);
    res = await fetch(current, {
      headers: { 'user-agent': 'RunFlow/1.0', ...opts.headers },
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    });
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      current = new URL(location, current).toString();
      continue;
    }
    break;
  }
  if (!res || (res.status >= 300 && res.status < 400)) throw new Error('Demasiadas redirecciones');
  if (!res.ok) throw new Error(`La fuente respondió ${res.status}`);
  const length = Number(res.headers.get('content-length') ?? 0);
  if (length > max) throw new Error('La respuesta es demasiado grande');
  const body = await res.text();
  if (body.length > max) throw new Error('La respuesta es demasiado grande');
  return body;
}

export async function fetchFeed(url: string, opts: { allowPrivate: boolean }): Promise<FeedItem[]> {
  const body = await safeGetText(url, {
    allowPrivate: opts.allowPrivate,
    headers: {
      'user-agent': 'RunFlow/1.0 (lector de fuentes)',
      accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
    },
  });
  return parseFeed(body);
}
