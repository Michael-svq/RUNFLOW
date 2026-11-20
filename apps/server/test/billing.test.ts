import { createHmac } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { verifyStripeSignature } from '../src/routes/billing';
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
 * Lanzamiento: registro autoservicio, límites de plan y cobro con Stripe
 * (simulado). «Hecho cuando…»: alta y pago sin intervención manual.
 */

const WEBHOOK_SECRET = 'whsec_prueba';
let ctx: TestContext;
let stripeServer: http.Server;
const stripeCalls: { method: string; path: string; form: URLSearchParams }[] = [];

beforeAll(async () => {
  stripeServer = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      stripeCalls.push({ method: req.method!, path: req.url!, form: new URLSearchParams(raw) });
      res.setHeader('content-type', 'application/json');
      if (req.headers.authorization !== 'Bearer sk_test_runflow') {
        res.statusCode = 401;
        return res.end(JSON.stringify({ error: { message: 'Invalid API Key' } }));
      }
      if (req.url!.startsWith('/v1/prices/')) {
        const id = req.url!.split('/').pop();
        return res.end(
          JSON.stringify({
            id,
            unit_amount: id === 'price_pro' ? 4900 : 1900,
            currency: 'eur',
            recurring: { interval: 'month' },
          }),
        );
      }
      if (req.url === '/v1/checkout/sessions')
        return res.end(JSON.stringify({ id: 'cs_1', url: 'https://checkout.stripe.test/cs_1' }));
      if (req.url === '/v1/billing_portal/sessions')
        return res.end(JSON.stringify({ id: 'bps_1', url: 'https://billing.stripe.test/bps_1' }));
      res.statusCode = 404;
      res.end('{}');
    });
  });
  await new Promise<void>((r) => stripeServer.listen(0, '127.0.0.1', r));
  ctx = await createTestContext({
    PLAN_LIMITS: 'true',
    SIGNUP_ENABLED: 'true',
    STRIPE_SECRET_KEY: 'sk_test_runflow',
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    STRIPE_PRICE_BASIC: 'price_basic',
    STRIPE_PRICE_PRO: 'price_pro',
    STRIPE_API_BASE: `http://127.0.0.1:${(stripeServer.address() as AddressInfo).port}`,
    PUBLIC_URL: 'https://app.runflow.test',
  });
});
afterAll(async () => {
  await ctx.close();
  await new Promise<void>((r) => stripeServer.close(() => r()));
});
beforeEach(async () => {
  stripeCalls.length = 0;
  await resetDb();
});

async function signup(email = 'lola@tvlocal.test') {
  const c = new Client(ctx.app);
  const res = await c.post('/api/signup', {
    orgName: 'TV Local',
    name: 'Lola',
    email,
    password: PASSWORD,
    acceptTerms: true,
  });
  return { c, res };
}

function webhook(event: unknown, secret = WEBHOOK_SECRET) {
  const payload = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  return ctx.app.inject({
    method: 'POST',
    url: '/api/billing/webhook',
    headers: { 'content-type': 'application/json', 'stripe-signature': `t=${t},v1=${sig}` },
    payload,
  });
}

describe('registro autoservicio', () => {
  it('crea la empresa en el plan Gratis y entra; no vale con un email que ya existe', async () => {
    expect((await new Client(ctx.app).get('/api/setup/status')).body).toMatchObject({
      signupEnabled: true,
    });
    const { c, res } = await signup();
    expect(res.status).toBe(201);
    const me = (await c.get('/api/auth/me')).body;
    expect(me.activeOrg).toMatchObject({ name: 'TV Local' });
    expect(me.user.isPlatformAdmin).toBe(false);
    expect((await c.get('/api/billing')).body).toMatchObject({
      plan: 'free',
      limitsEnforced: true,
    });

    const again = await signup();
    expect(again.res.status).toBe(409);
    expect(again.res.body.error.code).toBe('email_taken');
    const noTerms = await new Client(ctx.app).post('/api/signup', {
      orgName: 'X',
      name: 'Y',
      email: 'y@x.test',
      password: PASSWORD,
      acceptTerms: false,
    });
    expect(noTerms.status).toBe(400);
  });
});

describe('planes y Stripe', () => {
  it('aceptación: alta, límites del plan Gratis, pago y plan Profesional sin intervención manual', async () => {
    const { c } = await signup();

    // Plan Gratis: 1 programa, 3 usuarios, sin equipos ni IA.
    expect((await c.post('/api/programs', { name: 'Noticias', type: 'informativo' })).status).toBe(
      201,
    );
    const second = await c.post('/api/programs', { name: 'Deportes', type: 'deportes' });
    expect(second.status).toBe(402);
    expect(second.body.error.message).toMatch(/plan Gratis permite hasta 1 programa/);
    for (const n of [1, 2]) {
      const u = await c.post('/api/users', {
        name: `Persona ${n}`,
        email: `p${n}@tvlocal.test`,
        roleId: await roleId(c, 'redactor'),
        password: 'temporal-12345',
      });
      expect(u.status).toBe(201);
    }
    expect(
      (
        await c.post('/api/users', {
          name: 'Cuarta',
          email: 'p4@tvlocal.test',
          roleId: await roleId(c, 'redactor'),
          password: 'temporal-12345',
        })
      ).status,
    ).toBe(402);
    const device = { name: 'CasparCG', kind: 'casparcg', config: { host: '127.0.0.1' } };
    expect((await c.post('/api/devices', device)).status).toBe(402);
    expect(
      (await c.post('/api/ai/providers', { kind: 'ollama', name: 'O', model: 'm' })).status,
    ).toBe(402);
    expect((await c.post('/api/stations', { name: 'Plató' })).status).toBe(402);

    // Precios desde Stripe
    const billing = (await c.get('/api/billing')).body;
    expect(billing.usage).toEqual({ users: 3, programs: 1 });
    expect(billing.plans.find((p: { key: string }) => p.key === 'pro')).toMatchObject({
      purchasable: true,
      price: { amount: 49, currency: 'EUR', interval: 'month' },
    });
    expect(billing.plans.find((p: { key: string }) => p.key === 'edu').purchasable).toBe(false);

    // Contratar Profesional con Stripe Checkout
    const checkout = await c.post('/api/billing/checkout', { plan: 'pro' });
    expect(checkout.body.url).toBe('https://checkout.stripe.test/cs_1');
    const form = stripeCalls.find((s) => s.path === '/v1/checkout/sessions')!.form;
    const orgId = form.get('client_reference_id')!;
    expect(form.get('line_items[0][price]')).toBe('price_pro');
    expect(form.get('success_url')).toBe('https://app.runflow.test/configuracion?facturacion=ok');

    // Stripe avisa (webhook firmado): pasa a Profesional sin intervención manual.
    expect(
      (
        await webhook(
          {
            type: 'checkout.session.completed',
            data: {
              object: {
                client_reference_id: orgId,
                customer: 'cus_1',
                subscription: 'sub_1',
                metadata: { orgId, plan: 'pro' },
              },
            },
          },
          'otro-secreto',
        )
      ).statusCode,
    ).toBe(400);
    const ok = await webhook({
      type: 'checkout.session.completed',
      data: {
        object: {
          client_reference_id: orgId,
          customer: 'cus_1',
          subscription: 'sub_1',
          metadata: { orgId, plan: 'pro' },
        },
      },
    });
    expect(ok.statusCode).toBe(200);
    expect((await c.get('/api/billing')).body).toMatchObject({
      plan: 'pro',
      status: 'active',
      hasCustomer: true,
    });
    expect((await c.post('/api/devices', device)).status).toBe(201);
    expect((await c.post('/api/programs', { name: 'Deportes', type: 'deportes' })).status).toBe(
      201,
    );

    // Portal de cliente
    expect((await c.post('/api/billing/portal')).body.url).toBe(
      'https://billing.stripe.test/bps_1',
    );

    // Renovación y baja
    await webhook({
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_1',
          status: 'active',
          current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
          items: { data: [{ price: { id: 'price_pro' } }] },
        },
      },
    });
    expect((await c.get('/api/billing')).body.renewsAt).not.toBeNull();
    await webhook({
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_1', status: 'canceled' } },
    });
    expect((await c.get('/api/billing')).body).toMatchObject({ plan: 'free', status: 'canceled' });
  });

  it('la plataforma asigna planes a mano (educación) y los planes son públicos', async () => {
    const { admin } = await setupFirstOrg(ctx.app);
    const orgs = (await admin.get('/api/platform/orgs')).body.organizations;
    expect(
      (await admin.patch(`/api/platform/orgs/${orgs[0].id}/plan`, { plan: 'edu' })).status,
    ).toBe(200);
    expect((await admin.get('/api/billing')).body.plan).toBe('edu');
    const pub = (await new Client(ctx.app).get('/api/public/plans')).body;
    expect(pub.billingEnabled).toBe(true);
    expect(pub.plans.map((p: { key: string }) => p.key)).toEqual([
      'free',
      'basic',
      'pro',
      'edu',
      'local',
    ]);
  });

  it('firma de Stripe: tolerancia de tiempo', () => {
    const payload = '{"a":1}';
    const t = 1_700_000_000;
    const sig = createHmac('sha256', 's').update(`${t}.${payload}`).digest('hex');
    expect(verifyStripeSignature(payload, `t=${t},v1=${sig}`, 's', 300, t * 1000)).toBe(true);
    expect(verifyStripeSignature(payload, `t=${t},v1=${sig}`, 's', 300, (t + 3600) * 1000)).toBe(
      false,
    );
    expect(verifyStripeSignature(payload, undefined, 's')).toBe(false);
  });
});

describe('sin límites de plan (instalación propia)', () => {
  it('no se aplican límites ni hay registro', async () => {
    const own = await createTestContext();
    try {
      const { admin } = await setupFirstOrg(own.app);
      for (const name of ['A', 'B', 'C'])
        expect((await admin.post('/api/programs', { name, type: 'informativo' })).status).toBe(201);
      expect(
        (
          await new Client(own.app).post('/api/signup', {
            orgName: 'X',
            name: 'Y',
            email: 'y@x.test',
            password: PASSWORD,
            acceptTerms: true,
          })
        ).status,
      ).toBe(404);
    } finally {
      await own.close();
    }
  });
});
