import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  Client,
  createTestContext,
  PASSWORD,
  resetDb,
  setupFirstOrg,
  type TestContext,
} from './helpers';

/* Lanzamiento: verificación de email (obligatoria en esta prueba) y recuperación de contraseña. */

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext({
    SIGNUP_ENABLED: 'true',
    REQUIRE_EMAIL_VERIFICATION: 'true',
    PUBLIC_URL: 'https://runflow.test',
  });
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await resetDb();
  ctx.deps.mailer!.outbox.length = 0;
  await setupFirstOrg(ctx.app);
});

const linkToken = (text: string, path: string) =>
  new RegExp(`https://runflow\\.test/${path}/([A-Za-z0-9_-]+)`).exec(text)?.[1] ?? '';

describe('email', () => {
  it('registro: hay que verificar el email antes de usar la aplicación', async () => {
    const user = new Client(ctx.app);
    const res = await user.post('/api/signup', {
      orgName: 'Escuela de Cine',
      name: 'Pablo',
      email: 'pablo@escuela.test',
      password: PASSWORD,
      acceptTerms: true,
    });
    expect(res.status).toBe(201);
    expect(res.body.user.emailVerified).toBe(false);
    const mail = ctx.deps.mailer!.outbox.at(-1)!;
    expect(mail.to).toBe('pablo@escuela.test');
    const token = linkToken(mail.text, 'verificar');
    expect(token).not.toBe('');

    const blocked = await user.get('/api/programs');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('email_unverified');
    // /me y reenviar sí funcionan.
    expect((await user.get('/api/auth/me')).status).toBe(200);
    expect((await user.post('/api/auth/verify/send')).body).toEqual({ ok: true });
    // El reenvío anula el enlace anterior.
    expect((await user.post('/api/auth/verify', { token })).status).toBe(400);
    const fresh = linkToken(ctx.deps.mailer!.outbox.at(-1)!.text, 'verificar');
    expect((await user.post('/api/auth/verify', { token: fresh })).body).toEqual({ ok: true });
    expect((await user.get('/api/auth/me')).body.user.emailVerified).toBe(true);
    expect((await user.get('/api/programs')).status).toBe(200);
    // Un enlace solo vale una vez.
    expect((await user.post('/api/auth/verify', { token: fresh })).status).toBe(400);
  });

  it('recuperar la contraseña por email', async () => {
    const old = new Client(ctx.app);
    await old.login('ana@chaneltv.test', PASSWORD);
    const anon = new Client(ctx.app);
    // Sin pistas sobre si la cuenta existe.
    expect((await anon.post('/api/auth/password/forgot', { email: 'nadie@x.test' })).body).toEqual({
      ok: true,
    });
    expect(ctx.deps.mailer!.outbox).toHaveLength(0);
    await anon.post('/api/auth/password/forgot', { email: 'ANA@chaneltv.test' });
    const token = linkToken(ctx.deps.mailer!.outbox.at(-1)!.text, 'restablecer');
    expect((await anon.post('/api/auth/password/reset', { token, password: 'corta' })).status).toBe(
      400,
    );
    expect(
      (await anon.post('/api/auth/password/reset', { token, password: 'otra-clave-segura-2' }))
        .body,
    ).toEqual({ ok: true });
    // Las sesiones anteriores se cierran y la contraseña vieja ya no vale.
    expect((await old.get('/api/auth/me')).status).toBe(401);
    expect(
      (await anon.post('/api/auth/login', { email: 'ana@chaneltv.test', password: PASSWORD }))
        .status,
    ).toBe(401);
    await anon.login('ana@chaneltv.test', 'otra-clave-segura-2');
    expect(
      (await anon.post('/api/auth/password/reset', { token, password: 'tercera-clave-3' })).status,
    ).toBe(400);
  });
});
