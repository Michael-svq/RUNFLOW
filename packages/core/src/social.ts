import { z } from 'zod';
import { GRAPHIC_TYPE_BY_KEY } from './graphics';

/*
 * F3.4 Redes: publicaciones de redes sociales que se moderan y se rotulan
 * (tipo de rótulo RRS). Hasta 6 búsquedas (hashtags o cuentas) por empresa.
 */

export const SOCIAL_NETWORKS = [
  { value: 'bluesky', label: 'Bluesky', auto: true, needsKey: false },
  { value: 'mastodon', label: 'Mastodon', auto: true, needsKey: false },
  { value: 'x', label: 'X', auto: true, needsKey: true },
  { value: 'youtube', label: 'YouTube', auto: true, needsKey: true },
  { value: 'whatsapp', label: 'WhatsApp', auto: false, needsKey: false },
  { value: 'instagram', label: 'Instagram', auto: false, needsKey: false },
  { value: 'otra', label: 'Otra', auto: false, needsKey: false },
] as const;
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number]['value'];
const networks = SOCIAL_NETWORKS.map((n) => n.value) as [SocialNetwork, ...SocialNetwork[]];
export type AutoNetwork = 'bluesky' | 'mastodon' | 'x' | 'youtube';

/** Máximo de búsquedas automáticas por empresa (PLAN §20). */
export const MAX_SOCIAL_FEEDS = 6;

export const networkLabel = (n: string): string =>
  SOCIAL_NETWORKS.find((x) => x.value === n)?.label ?? n;

export const socialFeedInput = z
  .object({
    network: z.enum(['bluesky', 'mastodon', 'x', 'youtube']),
    /**
     * Qué seguir: «#hashtag», «@cuenta» o palabras (Bluesky, Mastodon, X);
     * en YouTube, el id o la dirección de un vídeo (sus comentarios).
     */
    query: z.string().trim().min(1, 'Obligatorio').max(120),
    /** Servidor de Mastodon (p. ej. https://mastodon.social). */
    instance: z.string().trim().max(200).default(''),
    /** Clave de la API (X, YouTube); se guarda cifrada y no se devuelve. */
    apiKey: z.string().trim().max(500).optional(),
    enabled: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (v.network === 'mastodon' && !/^https?:\/\/[^/\s]+\/?$/i.test(v.instance))
      ctx.addIssue({
        code: 'custom',
        path: ['instance'],
        message: 'Indica el servidor de Mastodon (https://…)',
      });
  });
export type SocialFeedInput = z.infer<typeof socialFeedInput>;

export const socialFeedPatch = z
  .object({
    query: z.string().trim().min(1).max(120),
    instance: z.string().trim().max(200),
    apiKey: z.string().trim().max(500),
    enabled: z.boolean(),
  })
  .partial();

export interface SocialFeedDto {
  id: string;
  network: AutoNetwork;
  query: string;
  instance: string;
  hasKey: boolean;
  enabled: boolean;
  lastFetchedAt: string | null;
  lastError: string | null;
}

export const SOCIAL_STATUSES = [
  { value: 'nuevo', label: 'Nuevas' },
  { value: 'aprobado', label: 'Aprobadas' },
  { value: 'descartado', label: 'Descartadas' },
] as const;
export type SocialStatus = (typeof SOCIAL_STATUSES)[number]['value'];
const statuses = SOCIAL_STATUSES.map((s) => s.value) as [SocialStatus, ...SocialStatus[]];

/** Publicación escrita a mano (p. ej. mensajes de WhatsApp de la audiencia). */
export const socialPostInput = z.object({
  network: z.enum(networks).default('whatsapp'),
  author: z.string().trim().min(1, 'Obligatorio').max(80),
  handle: z.string().trim().max(80).default(''),
  text: z.string().trim().min(1, 'Obligatorio').max(2000),
  url: z.union([z.literal(''), z.url().max(500)]).default(''),
  /** Las manuales ya entran aprobadas. */
  status: z.enum(statuses).default('aprobado'),
});

export const socialPostsQuery = z.object({
  status: z.enum(statuses).optional(),
  feedId: z.uuid().optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export interface SocialPostDto {
  id: string;
  feedId: string | null;
  network: SocialNetwork;
  author: string;
  handle: string;
  text: string;
  url: string;
  mediaUrl: string;
  postedAt: string | null;
  status: SocialStatus;
  createdAt: string;
}

/** Llevar una publicación a la escaleta: a una línea existente o a una nueva. */
export const socialToRundown = z.object({
  rundownId: z.uuid(),
  lineId: z.string().min(1).max(64).optional(),
});

/** Campos del rótulo RRS a partir de una publicación (recortados a sus longitudes). */
export function socialGraphicFields(
  p: Pick<SocialPostDto, 'author' | 'handle' | 'text' | 'network'>,
): { f0: string; f1: string; f2: string; f3: string } {
  const type = GRAPHIC_TYPE_BY_KEY.RRS!;
  const cut = (v: string, key: 'f0' | 'f1' | 'f2' | 'f3') => {
    const max = type.fields.find((f) => f.key === key)?.maxLength ?? 280;
    const clean = v.replace(/\s+/g, ' ').trim();
    return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
  };
  const handle = p.handle && !p.handle.startsWith('@') ? `@${p.handle}` : p.handle;
  return {
    f0: cut(p.author, 'f0'),
    f1: cut(handle, 'f1'),
    f2: cut(p.text, 'f2'),
    f3: cut(networkLabel(p.network), 'f3'),
  };
}
