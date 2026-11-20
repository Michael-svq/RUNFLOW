import { z } from 'zod';

/* IA multiproveedor (PLAN §18): catálogos, entradas de la API y DTO. */

export const AI_KINDS = ['anthropic', 'openai', 'gemini', 'mistral', 'ollama'] as const;
export type AiKind = (typeof AI_KINDS)[number];

export const AI_KIND_LABEL: Record<AiKind, string> = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI',
  gemini: 'Google Gemini',
  mistral: 'Mistral',
  ollama: 'Ollama (local)',
};

/** Modelo propuesto al dar de alta un proveedor (vacío: hay que escribirlo). */
export const AI_DEFAULT_MODEL: Record<AiKind, string> = {
  anthropic: 'claude-opus-5-5',
  openai: '',
  gemini: '',
  mistral: '',
  ollama: '',
};

export const AI_FEATURES = [
  { key: 'corregir', label: 'Corregir ortografía y estilo' },
  { key: 'paso_desde_off', label: 'Escribir el paso a partir del off' },
  { key: 'off_desde_paso', label: 'Escribir el off a partir del paso' },
  { key: 'ajustar', label: 'Ajustar a una duración' },
  { key: 'teletipo', label: 'Resumir un teletipo en una noticia' },
  { key: 'rotulos', label: 'Sugerir rótulos' },
  { key: 'traducir', label: 'Traducir' },
] as const;
export type AiFeature = (typeof AI_FEATURES)[number]['key'];
const FEATURE_KEYS = AI_FEATURES.map((f) => f.key) as [AiFeature, ...AiFeature[]];

export const aiProviderInput = z.object({
  kind: z.enum(AI_KINDS),
  name: z.string().trim().min(1, 'Obligatorio').max(60),
  model: z.string().trim().min(1, 'Obligatorio').max(120),
  /** Vacío: la dirección oficial (o http://127.0.0.1:11434 en Ollama). */
  baseUrl: z.union([z.literal(''), z.string().trim().url('Dirección no válida')]).default(''),
  /** Sin enviar: se conserva la guardada. Vacía: se borra. */
  apiKey: z.string().max(400).optional(),
  isDefault: z.boolean().default(false),
  enabled: z.boolean().default(true),
});
export type AiProviderInput = z.infer<typeof aiProviderInput>;

export interface AiProviderDto {
  id: string;
  kind: AiKind;
  name: string;
  model: string;
  baseUrl: string;
  /** Tiene clave guardada (nunca se devuelve). */
  hasKey: boolean;
  isDefault: boolean;
  enabled: boolean;
}

export const aiRunInput = z.object({
  feature: z.enum(FEATURE_KEYS),
  text: z.string().trim().min(1, 'No hay texto').max(20_000, 'Texto demasiado largo'),
  providerId: z.uuid().optional(),
  options: z
    .object({
      seconds: z.number().min(3).max(3600).optional(),
      language: z.string().trim().max(40).optional(),
    })
    .default({}),
});
export type AiRunInput = z.infer<typeof aiRunInput>;

export type AiOutput =
  | { kind: 'text'; text: string }
  | { kind: 'script'; paso: string; off: string }
  | { kind: 'graphics'; graphics: { type: string; f0: string; f1: string }[] };

export interface AiRunResult {
  output: AiOutput;
  provider: { id: string; name: string; model: string };
  usage: { inputTokens: number; outputTokens: number };
}

export interface AiUsageDto {
  /** Mes en curso (AAAA-MM). */
  month: string;
  totalTokens: number;
  /** 0 = sin límite. */
  limit: number;
  byFeature: { feature: string; requests: number; tokens: number }[];
  byProvider: { providerId: string | null; name: string; requests: number; tokens: number }[];
}
