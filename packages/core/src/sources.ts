import { z } from 'zod';

/* F2.2 Fuentes: RSS/Atom de agencias y medios. */

export const sourceInput = z.object({
  name: z.string().trim().min(1, 'Obligatorio').max(80),
  url: z
    .string()
    .trim()
    .url('Dirección no válida')
    .max(500)
    .refine((u) => /^https?:\/\//i.test(u), 'Solo direcciones http o https'),
  enabled: z.boolean().default(true),
});
export type SourceInput = z.infer<typeof sourceInput>;

export interface SourceDto {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  lastFetchedAt: string | null;
  lastError: string | null;
}

export interface SourceItemDto {
  id: string;
  sourceId: string;
  sourceName: string;
  title: string;
  summary: string;
  link: string;
  publishedAt: string | null;
}

export const sourceItemsQuery = z.object({
  sourceId: z.uuid().optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
