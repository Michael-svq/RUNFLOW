import http from 'node:http';
import type { AddressInfo } from 'node:net';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  Client,
  createTestContext,
  PASSWORD,
  resetDb,
  roleId,
  setupFirstOrg,
  type TestContext,
} from './helpers';

/*
 * M9: IA multiproveedor. Un servidor de pruebas imita las API de Anthropic,
 * OpenAI, Gemini y Ollama (local). Aceptación: las funciones funcionan con al
 * menos 2 proveedores y en local.
 */

interface Seen {
  path: string;
  headers: http.IncomingHttpHeaders;
  body: Record<string, unknown>;
}

let ctx: TestContext;
let admin: Client;
let fake: http.Server;
let fakeUrl: string;
const seen: Seen[] = [];
let failNext: number | null = null;

/** Respuesta según la función pedida (se reconoce por las instrucciones). */
function answer(system: string, prompt: string): string {
  if (system.includes('rótulos de una noticia'))
    return 'Aquí tienes: [{"type":"TOT","f0":"María Jesús Montero Cuadrado de la Hacienda Pública Española","f1":"Ministra de Hacienda"},{"type":"LOC","f0":"Sevilla, Andalucía"},{"type":"XYZ","f0":"nada"}]';
  if (system.includes('teletipos'))
    return 'PASO: El Gobierno aprueba hoy los presupuestos.\nOFF: El Consejo de Ministros ha dado luz verde a las cuentas.';
  if (system.includes('Corrige')) return '«El Gobierno aprueba hoy los presupuestos.»';
  return `RESPUESTA: ${prompt.slice(0, 20)}`;
}

beforeAll(async () => {
  fake = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      seen.push({ path: req.url ?? '', headers: req.headers, body });
      res.setHeader('content-type', 'application/json');
      if (failNext) {
        res.statusCode = failNext;
        failNext = null;
        return res.end(
          JSON.stringify({ error: { type: 'authentication_error', message: 'clave no válida' } }),
        );
      }
      const url = req.url ?? '';
      if (url.startsWith('/v1/messages')) {
        const text = answer(
          String(body.system ?? ''),
          String((body.messages as { content: string }[])[0]!.content),
        );
        return res.end(
          JSON.stringify({
            id: 'msg_1',
            type: 'message',
            role: 'assistant',
            model: body.model,
            content: [{ type: 'text', text }],
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: { input_tokens: 120, output_tokens: 30 },
          }),
        );
      }
      const messages = body.messages as { role: string; content: string }[] | undefined;
      if (url === '/v1/chat/completions') {
        return res.end(
          JSON.stringify({
            model: body.model,
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: answer(messages![0]!.content, messages![1]!.content),
                },
              },
            ],
            usage: { prompt_tokens: 100, completion_tokens: 20 },
          }),
        );
      }
      if (url === '/api/chat') {
        return res.end(
          JSON.stringify({
            model: body.model,
            message: {
              role: 'assistant',
              content: answer(messages![0]!.content, messages![1]!.content),
            },
            done: true,
            prompt_eval_count: 80,
            eval_count: 10,
          }),
        );
      }
      if (url.includes(':generateContent')) {
        const sys = (body.systemInstruction as { parts: { text: string }[] }).parts[0]!.text;
        const prompt = (body.contents as { parts: { text: string }[] }[])[0]!.parts[0]!.text;
        return res.end(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: answer(sys, prompt) }] } }],
            usageMetadata: { promptTokenCount: 90, candidatesTokenCount: 15 },
          }),
        );
      }
      res.statusCode = 404;
      res.end('{}');
    });
  });
  await new Promise<void>((r) => fake.listen(0, '127.0.0.1', r));
  fakeUrl = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.close();
  await new Promise<void>((r) => fake.close(() => r()));
});
beforeEach(async () => {
  seen.length = 0;
  failNext = null;
  await resetDb();
  ({ admin } = await setupFirstOrg(ctx.app));
});

async function provider(body: Record<string, unknown>) {
  const res = await admin.post('/api/ai/providers', body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.provider as { id: string; hasKey: boolean };
}

const anthropic = () =>
  provider({
    kind: 'anthropic',
    name: 'Claude',
    model: 'claude-opus-5-5',
    baseUrl: fakeUrl,
    apiKey: 'sk-ant-secreta-123',
    isDefault: true,
  });

describe('IA multiproveedor', () => {
  it('guarda la clave cifrada y no la devuelve nunca', async () => {
    const p = await anthropic();
    expect(p.hasKey).toBe(true);
    const list = (await admin.get('/api/ai/providers')).body.providers;
    expect(JSON.stringify(list)).not.toContain('secreta');
    const db = new pg.Client({ connectionString: process.env.TEST_OWNER_URL });
    await db.connect();
    const { rows } = await db.query('select api_key_enc from ai_providers');
    await db.end();
    expect(rows[0].api_key_enc).toMatch(/^v1\./);
    expect(rows[0].api_key_enc).not.toContain('secreta');
    // Editar sin enviar la clave la conserva; enviarla vacía la borra.
    const kept = await admin.patch(`/api/ai/providers/${p.id}`, {
      kind: 'anthropic',
      name: 'Claude',
      model: 'claude-opus-5-5',
      baseUrl: fakeUrl,
      isDefault: true,
    });
    expect(kept.body.provider.hasKey).toBe(true);
    const removed = await admin.patch(`/api/ai/providers/${p.id}`, {
      kind: 'anthropic',
      name: 'Claude',
      model: 'claude-opus-5-5',
      baseUrl: fakeUrl,
      apiKey: '',
    });
    expect(removed.body.provider.hasKey).toBe(false);
  });

  it('aceptación: las funciones funcionan con Anthropic, OpenAI, Gemini y Ollama en local', async () => {
    await anthropic();
    const openai = await provider({
      kind: 'openai',
      name: 'OpenAI',
      model: 'gpt-prueba',
      baseUrl: `${fakeUrl}/v1`,
      apiKey: 'sk-openai',
    });
    const gemini = await provider({
      kind: 'gemini',
      name: 'Gemini',
      model: 'gemini-prueba',
      baseUrl: `${fakeUrl}/v1beta`,
      apiKey: 'g-key',
    });
    const ollama = await provider({
      kind: 'ollama',
      name: 'Ollama',
      model: 'llama-local',
      baseUrl: fakeUrl,
    });

    // Anthropic (por defecto): SDK oficial, respaldo ante rechazos activado.
    const fixed = await admin.post('/api/ai/run', {
      feature: 'corregir',
      text: 'el gobierno aprueva hoy los presupuestos',
    });
    expect(fixed.status).toBe(200);
    expect(fixed.body.output).toEqual({
      kind: 'text',
      text: 'El Gobierno aprueba hoy los presupuestos.',
    });
    expect(fixed.body.provider.model).toBe('claude-opus-5-5');
    const call = seen.find((s) => s.path.startsWith('/v1/messages'))!;
    // La clave (descifrada) va en la cabecera de autenticación.
    expect(
      call.headers['x-api-key'] ?? String(call.headers.authorization).replace(/^Bearer /, ''),
    ).toBe('sk-ant-secreta-123');
    expect(String(call.headers['anthropic-beta'])).toContain('server-side-fallback-2026-07-01');
    expect(call.body).toMatchObject({ model: 'claude-opus-5-5', fallbacks: 'default' });
    expect(JSON.stringify(call.body.messages)).toContain('<texto>');

    // OpenAI: teletipo → paso + off
    const news = await admin.post('/api/ai/run', {
      feature: 'teletipo',
      text: 'MADRID, 20 (AGENCIA) El Consejo de Ministros aprobó...',
      providerId: openai.id,
    });
    expect(news.body.output).toEqual({
      kind: 'script',
      paso: 'El Gobierno aprueba hoy los presupuestos.',
      off: 'El Consejo de Ministros ha dado luz verde a las cuentas.',
    });
    const oa = seen.find((s) => s.path === '/v1/chat/completions')!;
    expect(oa.headers.authorization).toBe('Bearer sk-openai');

    // Gemini: rótulos validados (longitudes, tipos) y en mayúsculas
    const graphics = await admin.post('/api/ai/run', {
      feature: 'rotulos',
      text: 'La ministra María Jesús Montero ha presentado en Sevilla...',
      providerId: gemini.id,
    });
    expect(graphics.body.output.kind).toBe('graphics');
    expect(graphics.body.output.graphics).toEqual([
      { type: 'TOT', f0: 'MARÍA JESÚS MONTERO CUADRADO DE LA HACIE', f1: 'MINISTRA DE HACIENDA' },
      { type: 'LOC', f0: 'SEVILLA, ANDALUCÍA', f1: '' },
    ]);
    expect(seen.find((s) => s.path.includes(':generateContent'))!.headers['x-goog-api-key']).toBe(
      'g-key',
    );

    // Ollama en local, sin clave: ajustar a duración
    const fit = await admin.post('/api/ai/run', {
      feature: 'ajustar',
      text: 'Un texto demasiado largo para el tiempo disponible.',
      options: { seconds: 10 },
      providerId: ollama.id,
    });
    expect(fit.body.output.kind).toBe('text');
    const ol = seen.find((s) => s.path === '/api/chat')!;
    expect(ol.headers.authorization).toBeUndefined();
    expect(JSON.stringify(ol.body.messages)).toContain('unas 30 palabras');

    // Consumo registrado por función y proveedor
    const usage = (await admin.get('/api/ai/usage')).body;
    expect(usage.totalTokens).toBe(150 + 120 + 105 + 90);
    expect(usage.byProvider).toHaveLength(4);
  });

  it('límite mensual de la empresa', async () => {
    await anthropic();
    await admin.patch('/api/org/settings', { aiMonthlyTokens: 100 });
    expect((await admin.post('/api/ai/run', { feature: 'traducir', text: 'Hola' })).status).toBe(
      200,
    );
    const blocked = await admin.post('/api/ai/run', { feature: 'traducir', text: 'Hola' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('ai_limit');
  });

  it('errores del proveedor, sin proveedor y permisos', async () => {
    expect((await admin.post('/api/ai/run', { feature: 'corregir', text: 'x' })).status).toBe(409);
    const p = await anthropic();
    failNext = 401;
    const bad = await admin.post('/api/ai/run', { feature: 'corregir', text: 'x' });
    expect(bad.status).toBe(502);
    expect(bad.body.error.message).toMatch(/clave de Anthropic no es válida/);
    expect((await admin.post(`/api/ai/providers/${p.id}/test`)).body.ok).toBe(true);

    for (const [role, email] of [
      ['redactor', 'rita@chaneltv.test'],
      ['lectura', 'luis@chaneltv.test'],
    ] as const) {
      await admin.post('/api/users', {
        name: role,
        email,
        roleId: await roleId(admin, role),
        password: 'temporal-12345',
      });
    }
    const login = async (email: string) => {
      const c = new Client(ctx.app);
      await c.login(email, 'temporal-12345');
      await c.post('/api/me/password', {
        currentPassword: 'temporal-12345',
        newPassword: PASSWORD,
      });
      return c;
    };
    const rita = await login('rita@chaneltv.test');
    expect((await rita.post('/api/ai/run', { feature: 'corregir', text: 'x' })).status).toBe(200);
    expect(
      (await rita.post('/api/ai/providers', { kind: 'ollama', name: 'x', model: 'y' })).status,
    ).toBe(403);
    const luis = await login('luis@chaneltv.test');
    expect((await luis.post('/api/ai/run', { feature: 'corregir', text: 'x' })).status).toBe(403);
  });
});
