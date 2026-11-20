import { plain, safeGetText } from '../sources/feed';

/*
 * F3.4 Lectores de redes. Bluesky y Mastodon usan sus API públicas (sin clave);
 * X y YouTube necesitan la clave de la empresa. Cada lector devuelve las
 * publicaciones más recientes de la búsqueda.
 */

export interface SocialItem {
  externalId: string;
  author: string;
  handle: string;
  text: string;
  url: string;
  mediaUrl: string;
  postedAt: Date | null;
}

export interface SocialBases {
  bluesky: string;
  x: string;
  youtube: string;
}

export const DEFAULT_SOCIAL_BASES: SocialBases = {
  bluesky: 'https://public.api.bsky.app',
  x: 'https://api.x.com',
  youtube: 'https://www.googleapis.com',
};

export interface FeedSpec {
  network: string;
  query: string;
  instance: string;
  apiKey: string | null;
}

type Opts = { allowPrivate: boolean; bases: SocialBases };

const date = (v: unknown): Date | null => {
  if (typeof v !== 'string') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const trimBase = (u: string) => u.replace(/\/+$/, '');

async function getJson(url: string, opts: Opts, headers: Record<string, string> = {}) {
  const body = await safeGetText(url, {
    allowPrivate: opts.allowPrivate,
    headers: { accept: 'application/json', ...headers },
  });
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    throw new Error('La red no devolvió datos válidos');
  }
}

/** «#tag», «@cuenta» o palabras. */
export function parseQuery(q: string): { kind: 'tag' | 'account' | 'words'; value: string } {
  const t = q.trim();
  if (t.startsWith('#')) return { kind: 'tag', value: t.slice(1).trim() };
  if (t.startsWith('@')) return { kind: 'account', value: t.slice(1).trim() };
  return { kind: 'words', value: t };
}

/* ---------- Bluesky ---------- */

function bskyItem(post: Record<string, unknown>): SocialItem | null {
  const author = (post.author ?? {}) as Record<string, unknown>;
  const record = (post.record ?? {}) as Record<string, unknown>;
  const uri = str(post.uri);
  const text = str(record.text);
  if (!uri || !text) return null;
  const handle = str(author.handle);
  const rkey = uri.split('/').pop() ?? '';
  const embed = (post.embed ?? {}) as Record<string, unknown>;
  const images = Array.isArray(embed.images) ? (embed.images as Record<string, unknown>[]) : [];
  return {
    externalId: uri,
    author: str(author.displayName) || handle,
    handle,
    text,
    url: handle && rkey ? `https://bsky.app/profile/${handle}/post/${rkey}` : '',
    mediaUrl: str(images[0]?.thumb),
    postedAt: date(record.createdAt) ?? date(post.indexedAt),
  };
}

async function bluesky(spec: FeedSpec, opts: Opts): Promise<SocialItem[]> {
  const base = trimBase(opts.bases.bluesky);
  const q = parseQuery(spec.query);
  if (q.kind === 'account') {
    const data = await getJson(
      `${base}/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(q.value)}&limit=30&filter=posts_no_replies`,
      opts,
    );
    const feed = Array.isArray(data.feed) ? (data.feed as Record<string, unknown>[]) : [];
    return feed.flatMap((f) => {
      const item = bskyItem((f.post ?? {}) as Record<string, unknown>);
      return item ? [item] : [];
    });
  }
  const term = q.kind === 'tag' ? `#${q.value}` : q.value;
  const data = await getJson(
    `${base}/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(term)}&limit=30&sort=latest`,
    opts,
  );
  const posts = Array.isArray(data.posts) ? (data.posts as Record<string, unknown>[]) : [];
  return posts.flatMap((p) => {
    const item = bskyItem(p);
    return item ? [item] : [];
  });
}

/* ---------- Mastodon ---------- */

function mastoItem(s: Record<string, unknown>): SocialItem | null {
  if (s.reblog) return null;
  const account = (s.account ?? {}) as Record<string, unknown>;
  const text = plain(str(s.content));
  if (!text) return null;
  const media = Array.isArray(s.media_attachments)
    ? (s.media_attachments as Record<string, unknown>[])
    : [];
  return {
    externalId: str(s.uri) || str(s.id),
    author: str(account.display_name) || str(account.username),
    handle: str(account.acct),
    text,
    url: str(s.url) || str(s.uri),
    mediaUrl: str(media[0]?.preview_url),
    postedAt: date(s.created_at),
  };
}

async function mastodon(spec: FeedSpec, opts: Opts): Promise<SocialItem[]> {
  const base = trimBase(spec.instance);
  const q = parseQuery(spec.query);
  let statuses: unknown;
  if (q.kind === 'account') {
    const account = await getJson(
      `${base}/api/v1/accounts/lookup?acct=${encodeURIComponent(q.value)}`,
      opts,
    );
    if (!account.id) throw new Error('Cuenta no encontrada');
    statuses = await getJson(
      `${base}/api/v1/accounts/${encodeURIComponent(str(account.id))}/statuses?limit=30&exclude_replies=true&exclude_reblogs=true`,
      opts,
    );
  } else {
    // Sin sesión, Mastodon solo busca por hashtag: las palabras se juntan en uno.
    const tag = q.value.replace(/\s+/g, '');
    statuses = await getJson(
      `${base}/api/v1/timelines/tag/${encodeURIComponent(tag)}?limit=30`,
      opts,
    );
  }
  if (!Array.isArray(statuses)) throw new Error('Mastodon no devolvió publicaciones');
  return (statuses as Record<string, unknown>[]).flatMap((s) => {
    const item = mastoItem(s);
    return item ? [item] : [];
  });
}

/* ---------- X ---------- */

async function x(spec: FeedSpec, opts: Opts): Promise<SocialItem[]> {
  if (!spec.apiKey) throw new Error('Falta la clave de la API de X');
  const q = parseQuery(spec.query);
  const query = `${q.kind === 'account' ? `from:${q.value}` : q.kind === 'tag' ? `#${q.value}` : q.value} -is:retweet`;
  const data = await getJson(
    `${trimBase(opts.bases.x)}/2/tweets/search/recent?query=${encodeURIComponent(query)}&max_results=25&tweet.fields=created_at,author_id&expansions=author_id&user.fields=name,username`,
    opts,
    { authorization: `Bearer ${spec.apiKey}` },
  );
  const includes = (data.includes ?? {}) as Record<string, unknown>;
  const users = new Map(
    (Array.isArray(includes.users) ? (includes.users as Record<string, unknown>[]) : []).map(
      (u) => [str(u.id), u],
    ),
  );
  const tweets = Array.isArray(data.data) ? (data.data as Record<string, unknown>[]) : [];
  return tweets.flatMap((t) => {
    const id = str(t.id);
    const text = str(t.text);
    if (!id || !text) return [];
    const user = users.get(str(t.author_id)) ?? {};
    const username = str(user.username);
    return [
      {
        externalId: id,
        author: str(user.name) || username,
        handle: username,
        text,
        url: username ? `https://x.com/${username}/status/${id}` : '',
        mediaUrl: '',
        postedAt: date(t.created_at),
      },
    ];
  });
}

/* ---------- YouTube (comentarios de un vídeo o directo) ---------- */

export function youtubeVideoId(input: string): string | null {
  const t = input.trim();
  if (/^[\w-]{11}$/.test(t)) return t;
  const m = /(?:v=|youtu\.be\/|\/live\/|\/shorts\/|\/embed\/)([\w-]{11})/.exec(t);
  return m?.[1] ?? null;
}

async function youtube(spec: FeedSpec, opts: Opts): Promise<SocialItem[]> {
  if (!spec.apiKey) throw new Error('Falta la clave de la API de YouTube');
  const videoId = youtubeVideoId(spec.query);
  if (!videoId) throw new Error('Indica el id o la dirección de un vídeo de YouTube');
  const data = await getJson(
    `${trimBase(opts.bases.youtube)}/youtube/v3/commentThreads?part=snippet&videoId=${videoId}&maxResults=50&order=time&textFormat=plainText&key=${encodeURIComponent(spec.apiKey)}`,
    opts,
  );
  const items = Array.isArray(data.items) ? (data.items as Record<string, unknown>[]) : [];
  return items.flatMap((it) => {
    const snippet = (((it.snippet ?? {}) as Record<string, unknown>).topLevelComment ??
      {}) as Record<string, unknown>;
    const c = (snippet.snippet ?? {}) as Record<string, unknown>;
    const id = str(it.id);
    const text = str(c.textOriginal) || str(c.textDisplay);
    if (!id || !text) return [];
    return [
      {
        externalId: id,
        author: str(c.authorDisplayName).replace(/^@/, ''),
        handle: str(c.authorDisplayName),
        text,
        url: `https://www.youtube.com/watch?v=${videoId}&lc=${id}`,
        mediaUrl: '',
        postedAt: date(c.publishedAt),
      },
    ];
  });
}

export async function fetchSocial(spec: FeedSpec, opts: Opts): Promise<SocialItem[]> {
  switch (spec.network) {
    case 'bluesky':
      return bluesky(spec, opts);
    case 'mastodon':
      return mastodon(spec, opts);
    case 'x':
      return x(spec, opts);
    case 'youtube':
      return youtube(spec, opts);
    default:
      throw new Error('Red no compatible');
  }
}
