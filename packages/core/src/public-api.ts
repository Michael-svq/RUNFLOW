import { z } from 'zod';

/* F2.4 API pública: tokens con alcances y webhooks firmados. */

export const API_SCOPES = [
  { value: 'read', label: 'Leer escaletas y directo' },
  { value: 'live', label: 'Directo: GO, volver, parar y rótulos' },
  { value: 'write', label: 'Escribir líneas de la escaleta' },
] as const;
export type ApiScope = (typeof API_SCOPES)[number]['value'];
const SCOPE_KEYS = API_SCOPES.map((s) => s.value) as [ApiScope, ...ApiScope[]];

export const apiTokenInput = z.object({
  name: z.string().trim().min(1, 'Obligatorio').max(60),
  scopes: z.array(z.enum(SCOPE_KEYS)).min(1, 'Elige al menos un permiso').max(3),
});

export interface ApiTokenDto {
  id: string;
  name: string;
  scopes: ApiScope[];
  lastUsedAt: string | null;
  createdAt: string;
}

export const WEBHOOK_EVENTS = [
  { value: 'live.go', label: 'Cambia la línea EN AIRE' },
  { value: 'live.ended', label: 'Termina el directo' },
  { value: 'graphic.in', label: 'Entra un rótulo' },
  { value: 'graphic.out', label: 'Sale un rótulo' },
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number]['value'];
const EVENT_KEYS = WEBHOOK_EVENTS.map((e) => e.value) as [WebhookEvent, ...WebhookEvent[]];

export const webhookInput = z.object({
  url: z
    .string()
    .trim()
    .url('Dirección no válida')
    .max(500)
    .refine((u) => /^https?:\/\//i.test(u), 'Solo direcciones http o https'),
  events: z.array(z.enum(EVENT_KEYS)).min(1, 'Elige al menos un evento'),
  enabled: z.boolean().default(true),
});

export interface WebhookDto {
  id: string;
  url: string;
  events: WebhookEvent[];
  enabled: boolean;
  lastStatus: number | null;
  lastError: string | null;
  lastDeliveryAt: string | null;
}

export const apiLineInput = z.object({
  cells: z.record(z.string().max(40), z.union([z.string().max(2000), z.number()])),
  /** Posición (0 = la primera); sin indicar, al final. */
  index: z.number().int().min(0).optional(),
});
export const apiCellsInput = z.object({
  cells: z.record(z.string().max(40), z.union([z.string().max(2000), z.number(), z.null()])),
});
