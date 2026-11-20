import Anthropic from '@anthropic-ai/sdk';
import type { AiKind } from '@runflow/core';

/*
 * Capa común de IA (PLAN §18): un mismo `complete()` para cada proveedor que
 * configure la empresa. Las llamadas se hacen siempre desde el servidor.
 */

export const AI_DEFAULT_BASE_URL: Record<AiKind, string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  mistral: 'https://api.mistral.ai/v1',
  ollama: 'http://127.0.0.1:11434',
};

export interface AiProviderConfig {
  kind: AiKind;
  model: string;
  /** Vacío: la dirección oficial del proveedor. */
  baseUrl?: string | null;
  apiKey?: string | null;
}

export interface CompletionRequest {
  system: string;
  prompt: string;
  /** Límite de la respuesta (tokens). */
  maxTokens?: number;
  timeoutMs?: number;
}

export interface CompletionResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  /** Modelo que respondió (puede ser el de respaldo de Anthropic). */
  model: string;
}

export class AiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

const base = (cfg: AiProviderConfig) =>
  (cfg.baseUrl?.trim() || AI_DEFAULT_BASE_URL[cfg.kind]).replace(/\/+$/, '');

async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new AiError(
      err instanceof Error && err.name === 'TimeoutError'
        ? 'El proveedor de IA tarda demasiado'
        : 'No se puede conectar con el proveedor de IA',
    );
  }
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    // respuesta no JSON
  }
  if (!res.ok) {
    const err = json.error as { message?: string } | string | undefined;
    const msg = typeof err === 'string' ? err : err?.message;
    throw new AiError(
      `El proveedor de IA respondió ${res.status}${msg ? `: ${msg}` : ''}`,
      res.status,
    );
  }
  return json;
}

/** Anthropic (Claude) con el SDK oficial. */
async function anthropic(cfg: AiProviderConfig, req: CompletionRequest): Promise<CompletionResult> {
  const client = new Anthropic({
    apiKey: cfg.apiKey ?? '',
    // Siempre explícita: no depender de variables de entorno del servidor.
    baseURL: base(cfg),
    timeout: req.timeoutMs ?? 120_000,
    maxRetries: 1,
  });
  try {
    // Si el modelo rechaza la petición, la API la repite sola con el modelo de
    // respaldo adecuado (fallbacks «default»).
    const response = await client.beta.messages.create({
      model: cfg.model,
      max_tokens: req.maxTokens ?? 16_000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: req.system,
      messages: [{ role: 'user', content: req.prompt }],
    });
    if (response.stop_reason === 'refusal') {
      throw new AiError('La IA ha rechazado la petición');
    }
    const text = response.content
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('')
      .trim();
    return {
      text,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      model: response.model,
    };
  } catch (err) {
    if (err instanceof AiError) throw err;
    if (err instanceof Anthropic.AuthenticationError)
      throw new AiError('La clave de Anthropic no es válida', 401);
    if (err instanceof Anthropic.RateLimitError)
      throw new AiError('Anthropic: límite de uso alcanzado, prueba en un momento', 429);
    if (err instanceof Anthropic.APIConnectionError)
      throw new AiError('No se puede conectar con Anthropic');
    if (err instanceof Anthropic.APIError)
      throw new AiError(`Anthropic respondió ${err.status}: ${err.message}`, err.status);
    throw err;
  }
}

/** OpenAI y compatibles (Mistral usa el mismo formato). */
async function openaiLike(
  cfg: AiProviderConfig,
  req: CompletionRequest,
): Promise<CompletionResult> {
  const json = await postJson(
    `${base(cfg)}/chat/completions`,
    {
      model: cfg.model,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.prompt },
      ],
      ...(cfg.kind === 'openai'
        ? { max_completion_tokens: req.maxTokens ?? 16_000 }
        : { max_tokens: req.maxTokens ?? 16_000 }),
    },
    cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {},
    req.timeoutMs ?? 120_000,
  );
  const choice = (json.choices as { message?: { content?: string } }[] | undefined)?.[0];
  const usage = json.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
  return {
    text: (choice?.message?.content ?? '').trim(),
    inputTokens: usage?.prompt_tokens ?? 0,
    outputTokens: usage?.completion_tokens ?? 0,
    model: String(json.model ?? cfg.model),
  };
}

async function gemini(cfg: AiProviderConfig, req: CompletionRequest): Promise<CompletionResult> {
  const json = await postJson(
    `${base(cfg)}/models/${encodeURIComponent(cfg.model)}:generateContent`,
    {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
      generationConfig: { maxOutputTokens: req.maxTokens ?? 16_000 },
    },
    cfg.apiKey ? { 'x-goog-api-key': cfg.apiKey } : {},
    req.timeoutMs ?? 120_000,
  );
  const parts =
    (json.candidates as { content?: { parts?: { text?: string }[] } }[] | undefined)?.[0]?.content
      ?.parts ?? [];
  const usage = json.usageMetadata as
    | { promptTokenCount?: number; candidatesTokenCount?: number }
    | undefined;
  return {
    text: parts
      .map((p) => p.text ?? '')
      .join('')
      .trim(),
    inputTokens: usage?.promptTokenCount ?? 0,
    outputTokens: usage?.candidatesTokenCount ?? 0,
    model: cfg.model,
  };
}

/** Ollama en local (o en la Station): sin clave y sin salir de la red. */
async function ollama(cfg: AiProviderConfig, req: CompletionRequest): Promise<CompletionResult> {
  const json = await postJson(
    `${base(cfg)}/api/chat`,
    {
      model: cfg.model,
      stream: false,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.prompt },
      ],
      options: { num_predict: req.maxTokens ?? 4096 },
    },
    cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {},
    req.timeoutMs ?? 300_000,
  );
  const message = json.message as { content?: string } | undefined;
  return {
    text: (message?.content ?? '').trim(),
    inputTokens: Number(json.prompt_eval_count ?? 0),
    outputTokens: Number(json.eval_count ?? 0),
    model: String(json.model ?? cfg.model),
  };
}

export async function complete(
  cfg: AiProviderConfig,
  req: CompletionRequest,
): Promise<CompletionResult> {
  if (!cfg.model.trim()) throw new AiError('Falta el modelo del proveedor de IA');
  switch (cfg.kind) {
    case 'anthropic':
      return anthropic(cfg, req);
    case 'openai':
    case 'mistral':
      return openaiLike(cfg, req);
    case 'gemini':
      return gemini(cfg, req);
    case 'ollama':
      return ollama(cfg, req);
  }
}
