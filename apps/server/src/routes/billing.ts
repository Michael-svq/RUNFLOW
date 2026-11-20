import { createHmac, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  checkoutInput,
  PLAN_KEYS,
  PLANS,
  planOf,
  type BillingDto,
  type PlanPrice,
} from '@runflow/core';
import { organizations, withSystem, withTenant } from '@runflow/db';
import { HttpError, parse } from '../errors';
import { requirePermission, requirePlatformAdmin } from '../auth/guards';
import { audit } from '../services/audit';
import { planUsage } from '../services/plans';
import type { AppDeps } from '../app';

/*
 * Plan y facturación (lanzamiento, PLAN §29): Stripe Checkout para contratar,
 * portal de cliente para gestionar y webhooks firmados que actualizan el plan.
 */

const PRICE_TTL_MS = 60 * 60 * 1000;

/** Llamada a la API de Stripe (formulario, como pide Stripe). */
async function stripe(
  deps: AppDeps,
  method: 'GET' | 'POST',
  path: string,
  form?: Record<string, string>,
): Promise<Record<string, unknown>> {
  const cfg = deps.config.stripe!;
  const res = await fetch(`${cfg.apiBase}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${cfg.secretKey}`,
      ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
    },
    ...(form ? { body: new URLSearchParams(form).toString() } : {}),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const msg = (json.error as { message?: string } | undefined)?.message;
    throw new HttpError(502, 'stripe_error', `Stripe: ${msg ?? res.status}`);
  }
  return json;
}

/** Comprueba la firma `Stripe-Signature` (t=…,v1=…) de un webhook. */
export function verifyStripeSignature(
  payload: string,
  header: string | undefined,
  secret: string,
  toleranceSec = 300,
  now = Date.now(),
): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(',').map((p) => {
      const i = p.indexOf('=');
      return [p.slice(0, i).trim(), p.slice(i + 1)];
    }),
  ) as Record<string, string>;
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(now / 1000 - t) > toleranceSec) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  const signatures = header
    .split(',')
    .filter((p) => p.trim().startsWith('v1='))
    .map((p) => p.trim().slice(3));
  return signatures.some(
    (s) => s.length === expected.length && timingSafeEqual(Buffer.from(s), Buffer.from(expected)),
  );
}

const planFromPrice = (deps: AppDeps, priceId: string | undefined) => {
  const prices = deps.config.stripe?.prices ?? {};
  return (Object.entries(prices).find(([, id]) => id === priceId)?.[0] ?? null) as
    | 'basic'
    | 'pro'
    | null;
};

export async function billingRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const configure = requirePermission(deps.db, 'org.configure');
  const priceCache = new Map<string, { at: number; price: PlanPrice | null }>();

  const priceOf = async (priceId: string | undefined): Promise<PlanPrice | null> => {
    if (!priceId || !deps.config.stripe) return null;
    const cached = priceCache.get(priceId);
    if (cached && Date.now() - cached.at < PRICE_TTL_MS) return cached.price;
    try {
      const p = await stripe(deps, 'GET', `/v1/prices/${encodeURIComponent(priceId)}`);
      const price: PlanPrice = {
        amount: Number(p.unit_amount ?? 0) / 100,
        currency: String(p.currency ?? 'eur').toUpperCase(),
        interval: (p.recurring as { interval?: string } | null)?.interval ?? null,
      };
      priceCache.set(priceId, { at: Date.now(), price });
      return price;
    } catch {
      return null;
    }
  };

  const plansWithPrices = async () =>
    Promise.all(
      PLANS.map(async (p) => {
        const priceId =
          p.key === 'basic' || p.key === 'pro' ? deps.config.stripe?.prices[p.key] : undefined;
        return { ...p, price: await priceOf(priceId), purchasable: !!priceId };
      }),
    );

  /** Planes con precio (público: lo usa la portada). */
  app.get('/api/public/plans', async () => ({
    plans: await plansWithPrices(),
    billingEnabled: !!deps.config.stripe,
    signupEnabled: deps.config.signupEnabled && deps.config.mode === 'cloud',
  }));

  app.get('/api/billing', { preHandler: configure }, async (req): Promise<BillingDto> => {
    const t = req.tenant!;
    const [org] = await withTenant(deps.db, t, (tx) =>
      tx.select().from(organizations).where(eq(organizations.id, t.orgId)),
    );
    return {
      plan: planOf(org?.plan).key,
      status: org?.subscriptionStatus ?? null,
      renewsAt: org?.planRenewsAt?.toISOString() ?? null,
      billingEnabled: !!deps.config.stripe,
      limitsEnforced: deps.config.planLimits,
      hasCustomer: !!org?.stripeCustomerId,
      usage: await planUsage(deps.db, t),
      plans: await plansWithPrices(),
    };
  });

  const origin = (req: FastifyRequest) =>
    deps.config.publicUrl?.replace(/\/+$/, '') ??
    `${req.protocol}://${req.headers.host ?? 'localhost'}`;

  app.post('/api/billing/checkout', { preHandler: configure }, async (req) => {
    if (!deps.config.stripe) throw new HttpError(409, 'billing_disabled', 'Cobro no disponible');
    const { plan } = parse(checkoutInput, req.body);
    const priceId = deps.config.stripe.prices[plan];
    if (!priceId) throw new HttpError(409, 'plan_unavailable', 'Ese plan no se contrata en la web');
    const t = req.tenant!;
    const [org] = await withTenant(deps.db, t, (tx) =>
      tx.select().from(organizations).where(eq(organizations.id, t.orgId)),
    );
    const base = origin(req);
    const session = await stripe(deps, 'POST', '/v1/checkout/sessions', {
      mode: 'subscription',
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': '1',
      success_url: `${base}/configuracion?facturacion=ok`,
      cancel_url: `${base}/configuracion?facturacion=cancelada`,
      client_reference_id: t.orgId,
      'metadata[orgId]': t.orgId,
      'metadata[plan]': plan,
      'subscription_data[metadata][orgId]': t.orgId,
      'subscription_data[metadata][plan]': plan,
      allow_promotion_codes: 'true',
      ...(org?.stripeCustomerId ? { customer: org.stripeCustomerId } : {}),
    });
    await withTenant(deps.db, t, (tx) =>
      audit(tx, {
        orgId: t.orgId,
        userId: t.userId,
        action: 'billing.checkout',
        targetType: 'organization',
        targetId: t.orgId,
        data: { plan },
      }),
    );
    return { url: String(session.url) };
  });

  app.post('/api/billing/portal', { preHandler: configure }, async (req) => {
    if (!deps.config.stripe) throw new HttpError(409, 'billing_disabled', 'Cobro no disponible');
    const t = req.tenant!;
    const [org] = await withTenant(deps.db, t, (tx) =>
      tx.select().from(organizations).where(eq(organizations.id, t.orgId)),
    );
    if (!org?.stripeCustomerId)
      throw new HttpError(409, 'no_customer', 'Todavía no hay ninguna suscripción');
    const session = await stripe(deps, 'POST', '/v1/billing_portal/sessions', {
      customer: org.stripeCustomerId,
      return_url: `${origin(req)}/configuracion`,
    });
    return { url: String(session.url) };
  });

  /* ---------- Webhook de Stripe (firma, sin sesión) ---------- */

  await app.register(async (scope) => {
    // La firma se calcula sobre el cuerpo tal cual llega.
    scope.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) =>
      done(null, body),
    );
    scope.post('/api/billing/webhook', async (req, reply) => {
      const cfg = deps.config.stripe;
      if (!cfg?.webhookSecret) throw new HttpError(404, 'not_found', 'No disponible');
      const payload = String(req.body ?? '');
      if (
        !verifyStripeSignature(
          payload,
          req.headers['stripe-signature'] as string,
          cfg.webhookSecret,
        )
      ) {
        throw new HttpError(400, 'bad_signature', 'Firma no válida');
      }
      const event = JSON.parse(payload) as {
        type: string;
        data: { object: Record<string, unknown> };
      };
      const obj = event.data.object;
      const meta = (obj.metadata ?? {}) as Record<string, string>;
      if (event.type === 'checkout.session.completed') {
        const orgId = meta.orgId ?? (obj.client_reference_id as string | undefined);
        const plan = meta.plan;
        if (orgId && plan && (PLAN_KEYS as readonly string[]).includes(plan)) {
          await withSystem(deps.db, async (tx) => {
            await tx
              .update(organizations)
              .set({
                plan,
                stripeCustomerId: String(obj.customer ?? '') || null,
                stripeSubscriptionId: String(obj.subscription ?? '') || null,
                subscriptionStatus: 'active',
                updatedAt: new Date(),
              })
              .where(eq(organizations.id, orgId));
            await audit(tx, {
              orgId,
              userId: null,
              action: 'billing.plan',
              targetType: 'organization',
              targetId: orgId,
              data: { plan, source: 'checkout' },
            });
          });
        }
      } else if (
        event.type === 'customer.subscription.updated' ||
        event.type === 'customer.subscription.deleted'
      ) {
        const subId = String(obj.id ?? '');
        const status = String(obj.status ?? '');
        const items = (obj.items as { data?: { price?: { id?: string } }[] } | undefined)?.data;
        const pricePlan = planFromPrice(deps, items?.[0]?.price?.id);
        const ended = event.type === 'customer.subscription.deleted' || status === 'canceled';
        const periodEnd = Number(obj.current_period_end ?? 0);
        await withSystem(deps.db, async (tx) => {
          const [org] = await tx
            .select({ id: organizations.id })
            .from(organizations)
            .where(eq(organizations.stripeSubscriptionId, subId));
          const orgId = org?.id ?? meta.orgId;
          if (!orgId) return;
          await tx
            .update(organizations)
            .set({
              // Al terminar la suscripción, la empresa vuelve al plan Gratis.
              ...(ended ? { plan: 'free' } : pricePlan ? { plan: pricePlan } : {}),
              stripeSubscriptionId: ended ? null : subId,
              subscriptionStatus: status || null,
              planRenewsAt: periodEnd && !ended ? new Date(periodEnd * 1000) : null,
              updatedAt: new Date(),
            })
            .where(eq(organizations.id, orgId));
          await audit(tx, {
            orgId,
            userId: null,
            action: 'billing.subscription',
            targetType: 'organization',
            targetId: orgId,
            data: { status, ended, plan: ended ? 'free' : pricePlan },
          });
        });
      }
      return reply.send({ received: true });
    });
  });

  /* ---------- Plataforma: plan a mano (educación, acuerdos) ---------- */

  app.patch('/api/platform/orgs/:id/plan', { preHandler: requirePlatformAdmin() }, async (req) => {
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    const { plan } = parse(z.object({ plan: z.enum(PLAN_KEYS) }), req.body);
    const rows = await withSystem(deps.db, async (tx) => {
      const updated = await tx
        .update(organizations)
        .set({ plan, updatedAt: new Date() })
        .where(eq(organizations.id, id))
        .returning({ id: organizations.id });
      if (updated[0])
        await audit(tx, {
          orgId: id,
          userId: req.auth!.userId,
          action: 'billing.plan',
          targetType: 'organization',
          targetId: id,
          data: { plan, source: 'platform' },
        });
      return updated;
    });
    if (!rows.length) throw new HttpError(404, 'not_found', 'Empresa no encontrada');
    return { ok: true };
  });
}
