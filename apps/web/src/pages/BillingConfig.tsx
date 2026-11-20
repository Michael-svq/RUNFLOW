import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import type { BillingDto, PlanPrice } from '@runflow/core';
import { Alert, Badge, Button, Spinner } from '@runflow/ui';
import { api, errorMessage } from '../api/client';
import { locale } from '../i18n';

/* Configuración → Plan y facturación (Stripe). */

const money = (p: PlanPrice) =>
  `${new Intl.NumberFormat(locale, { style: 'currency', currency: p.currency }).format(p.amount)}${
    p.interval === 'month' ? '/mes' : p.interval === 'year' ? '/año' : ''
  }`;

const STATUS: Record<string, string> = {
  active: 'Activa',
  trialing: 'En prueba',
  past_due: 'Pago pendiente',
  unpaid: 'Impagada',
  canceled: 'Cancelada',
  incomplete: 'Incompleta',
};

export function BillingConfig() {
  const billing = useQuery({
    queryKey: ['billing'],
    queryFn: () => api.get<BillingDto>('/api/billing'),
  });
  const [params] = useSearchParams();
  const result = params.get('facturacion');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const go = async (path: string, body: unknown, key: string) => {
    setBusy(key);
    setError(null);
    try {
      const res = await api.post<{ url: string }>(path, body);
      window.location.assign(res.url);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(null);
    }
  };

  if (billing.isPending) return <Spinner label="Cargando…" />;
  if (billing.isError) return <Alert tone="error">{errorMessage(billing.error)}</Alert>;
  const b = billing.data;
  if (!b.billingEnabled && !b.limitsEnforced) return null; // instalación propia: sin planes
  const current = b.plans.find((p) => p.key === b.plan);

  return (
    <section className="rf-card rf-config" aria-labelledby="billing-title">
      <div className="rf-config__head">
        <h2 id="billing-title" className="rf-form__title">
          Plan y facturación
        </h2>
        {b.hasCustomer && b.billingEnabled && (
          <Button
            size="sm"
            loading={busy === 'portal'}
            onClick={() => void go('/api/billing/portal', {}, 'portal')}
          >
            Gestionar suscripción y facturas
          </Button>
        )}
      </div>
      {result === 'ok' && (
        <Alert tone="success">
          Pago recibido. El plan se actualiza en cuanto Stripe lo confirma (unos segundos).
        </Alert>
      )}
      {result === 'cancelada' && <Alert tone="info">Pago cancelado: no se ha cobrado nada.</Alert>}
      <p>
        Plan actual: <strong>{current?.name ?? b.plan}</strong>{' '}
        {b.status && (
          <Badge tone={b.status === 'active' ? 'success' : 'warning'}>
            {STATUS[b.status] ?? b.status}
          </Badge>
        )}
        {b.renewsAt && (
          <span className="rf-muted rf-small">
            {' '}
            · se renueva el{' '}
            {new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date(b.renewsAt))}
          </span>
        )}
      </p>
      {current && (
        <p className="rf-small rf-muted">
          Usuarios: {b.usage.users}
          {current.maxUsers !== null && ` de ${current.maxUsers}`} · Programas: {b.usage.programs}
          {current.maxPrograms !== null && ` de ${current.maxPrograms}`}
          {!current.devices && ' · sin equipos'}
          {!current.ai && ' · sin IA'}
        </p>
      )}
      {error && <Alert tone="error">{error}</Alert>}
      <div className="rf-landing__plan-grid rf-landing__plan-grid--compact">
        {b.plans
          .filter((p) => p.key !== 'local')
          .map((p) => (
            <article
              key={p.key}
              className={`rf-landing__plan${p.key === b.plan ? ' is-current' : ''}`}
            >
              <h3>{p.name}</h3>
              <p className="rf-landing__price">
                {p.key === 'free' ? 'Gratis' : p.price ? money(p.price) : 'Consúltanos'}
              </p>
              <ul>
                {p.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              {p.key === b.plan ? (
                <Badge tone="accent">Tu plan</Badge>
              ) : p.purchasable && b.billingEnabled && !b.hasCustomer ? (
                <Button
                  size="sm"
                  variant="primary"
                  loading={busy === p.key}
                  onClick={() => void go('/api/billing/checkout', { plan: p.key }, p.key)}
                >
                  Contratar {p.name}
                </Button>
              ) : p.purchasable && b.hasCustomer ? (
                <span className="rf-muted rf-small">Cámbialo en «Gestionar suscripción»</span>
              ) : (
                <span className="rf-muted rf-small">Escríbenos para contratarlo</span>
              )}
            </article>
          ))}
      </div>
    </section>
  );
}
