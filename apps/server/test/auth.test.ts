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

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await resetDb();
});

describe('primera configuración', () => {
  it('indica que hace falta configurar cuando no hay usuarios', async () => {
    const res = await new Client(ctx.app).get('/api/setup/status');
    expect(res.body).toMatchObject({ needsSetup: true, signupEnabled: false });
  });

  it('crea empresa, roles y administrador de plataforma, y deja la sesión iniciada', async () => {
    const { admin, me } = await setupFirstOrg(ctx.app);
    expect(me.user.email).toBe('ana@chaneltv.test');
    expect(me.user.isPlatformAdmin).toBe(true);
    expect(me.user.mustChangePassword).toBe(false);
    expect(me.activeOrg.name).toBe('Chanel TV');
    expect(me.activeOrg.role.key).toBe('admin');
    expect(me.activeOrg.permissions).toContain('users.manage');

    const roles = await admin.get('/api/roles');
    expect(roles.body.roles.map((r: { key: string }) => r.key)).toContain('redactor');
    expect((await new Client(ctx.app).get('/api/setup/status')).body).toMatchObject({
      needsSetup: false,
      signupEnabled: false,
    });
  });

  it('no se puede repetir', async () => {
    await setupFirstOrg(ctx.app);
    const res = await new Client(ctx.app).post('/api/setup', {
      orgName: 'Otra',
      name: 'Intruso',
      email: 'intruso@x.test',
      password: PASSWORD,
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('setup_done');
  });

  it('valida los campos', async () => {
    const res = await new Client(ctx.app).post('/api/setup', {
      orgName: '',
      email: 'x',
      password: '1',
    });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.fields)).toEqual(
      expect.arrayContaining(['orgName', 'name', 'email', 'password']),
    );
  });
});

describe('inicio de sesión', () => {
  beforeEach(async () => {
    await setupFirstOrg(ctx.app);
  });

  it('rechaza credenciales incorrectas sin revelar si el email existe', async () => {
    const c = new Client(ctx.app);
    const wrongPass = await c.post('/api/auth/login', {
      email: 'ana@chaneltv.test',
      password: 'mala-clave-123',
    });
    const noUser = await c.post('/api/auth/login', {
      email: 'nadie@chaneltv.test',
      password: 'mala-clave-123',
    });
    expect(wrongPass.status).toBe(401);
    expect(noUser.status).toBe(401);
    expect(wrongPass.body).toEqual(noUser.body);
  });

  it('acepta el email en mayúsculas y elige la empresa automáticamente', async () => {
    const c = new Client(ctx.app);
    const me = await c.login('ANA@ChanelTV.test', PASSWORD);
    expect(me.activeOrg.name).toBe('Chanel TV');
    expect((await c.get('/api/auth/me')).status).toBe(200);
  });

  it('cerrar sesión invalida la cookie', async () => {
    const c = new Client(ctx.app);
    await c.login('ana@chaneltv.test', PASSWORD);
    const cookie = c.cookie;
    await c.post('/api/auth/logout');
    const stale = new Client(ctx.app);
    stale.cookie = cookie;
    expect((await stale.get('/api/auth/me')).status).toBe(401);
  });

  it('sin sesión la API responde 401', async () => {
    expect((await new Client(ctx.app).get('/api/auth/me')).status).toBe(401);
    expect((await new Client(ctx.app).get('/api/users')).status).toBe(401);
  });

  it('bloquea peticiones que modifican datos sin la cabecera anti-CSRF', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'ana@chaneltv.test', password: PASSWORD },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('csrf');
  });

  it('bloquea peticiones de otro origen', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: {
        'x-runflow-request': '1',
        origin: 'https://malicioso.test',
        host: 'app.runflow.tv',
      },
      payload: { email: 'ana@chaneltv.test', password: PASSWORD },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('límite de intentos', () => {
  it('bloquea el login tras demasiados intentos', async () => {
    await setupFirstOrg(ctx.app);
    const limited = await createTestContext({ AUTH_RATE_LIMIT: '3' });
    try {
      const c = new Client(limited.app);
      const statuses: number[] = [];
      for (let i = 0; i < 4; i++) {
        statuses.push(
          (
            await c.post('/api/auth/login', {
              email: 'ana@chaneltv.test',
              password: 'mala-clave-123',
            })
          ).status,
        );
      }
      expect(statuses).toEqual([401, 401, 401, 429]);
    } finally {
      await limited.close();
    }
  });
});

describe('contraseñas', () => {
  it('un usuario nuevo debe cambiar la contraseña antes de usar la aplicación', async () => {
    const { admin } = await setupFirstOrg(ctx.app);
    await admin.post('/api/users', {
      name: 'Rafa Redactor',
      email: 'rafa@chaneltv.test',
      roleId: await roleId(admin, 'redactor'),
      password: 'temporal-12345',
    });

    const rafa = new Client(ctx.app);
    const me = await rafa.login('rafa@chaneltv.test', 'temporal-12345');
    expect(me.user.mustChangePassword).toBe(true);
    const blocked = await rafa.get('/api/roles');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('password_change_required');

    const wrong = await rafa.post('/api/me/password', {
      currentPassword: 'no-es-esta-123',
      newPassword: 'nueva-clave-segura',
    });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.fields.currentPassword).toBeDefined();

    const ok = await rafa.post('/api/me/password', {
      currentPassword: 'temporal-12345',
      newPassword: 'nueva-clave-segura',
    });
    expect(ok.status).toBe(200);
    expect(ok.body.user.mustChangePassword).toBe(false);
    expect((await rafa.get('/api/roles')).status).toBe(200);
  });

  it('cambiar la contraseña cierra las demás sesiones', async () => {
    await setupFirstOrg(ctx.app);
    const a = new Client(ctx.app);
    const b = new Client(ctx.app);
    await a.login('ana@chaneltv.test', PASSWORD);
    await b.login('ana@chaneltv.test', PASSWORD);
    await a.post('/api/me/password', {
      currentPassword: PASSWORD,
      newPassword: 'otra-clave-segura-2',
    });
    expect((await a.get('/api/auth/me')).status).toBe(200);
    expect((await b.get('/api/auth/me')).status).toBe(401);
  });

  it('cada usuario puede cambiar su nombre', async () => {
    const { admin } = await setupFirstOrg(ctx.app);
    const res = await admin.patch('/api/me', { name: 'Ana María' });
    expect(res.body.user.name).toBe('Ana María');
  });
});

describe('último acceso', () => {
  it('se registra al configurar y al entrar', async () => {
    const { admin } = await setupFirstOrg(ctx.app);
    const list = await admin.get('/api/users');
    expect(list.body.members[0].lastLoginAt).not.toBeNull();
  });
});
