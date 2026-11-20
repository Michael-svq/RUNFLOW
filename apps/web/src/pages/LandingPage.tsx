import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import type { PlanDef, PlanPrice } from '@runflow/core';
import { Logo } from '@runflow/ui';
import { api } from '../api/client';

/*
 * Portada pública (lanzamiento): qué es RunFlow, para quién, planes y acceso.
 * Sin publicidad (D12).
 */

const FEATURES: { title: string; text: string }[] = [
  {
    title: 'Escaleta en tiempo real',
    text: 'Como la hoja de cálculo de siempre, pero compartida: varias personas a la vez, colores por tipo de línea, vistas por puesto y funciona sin conexión.',
  },
  {
    title: 'Directo con GO',
    text: 'EN AIRE y SIGUIENTE, autonext en los VTR, horas fijas, bloques con su reloj, descuadre al segundo y registro de emisión.',
  },
  {
    title: 'Guion y rótulos',
    text: 'Paso en verde, off en negro y rótulos estructurados (TOT, LOC, INF…) con sus longitudes y TC sobre la pieza.',
  },
  {
    title: 'Teleprompter y pantallas',
    text: 'Prompter con espejo y mando, presentador, relojes, agenda, mensajes al plató y un mando para dar GO desde una tablet o Stream Deck.',
  },
  {
    title: 'RunFlow Station',
    text: 'Un ordenador del estudio hace de servidor: si se cae internet, el directo sigue y al volver todo se fusiona.',
  },
  {
    title: 'CasparCG y mezcladores',
    text: 'Rótulos ▶/■ y por TC en CasparCG, VTR con precarga y corte en OBS, vMix o ATEM con cada GO.',
  },
  {
    title: 'Inteligencia artificial',
    text: 'Corregir, escribir el paso o el off, ajustar a una duración, resumir teletipos y sugerir rótulos, con el proveedor que elijáis (o en local).',
  },
];

const money = (p: PlanPrice) =>
  `${new Intl.NumberFormat('es-ES', { style: 'currency', currency: p.currency }).format(p.amount)}${
    p.interval === 'month' ? '/mes' : p.interval === 'year' ? '/año' : ''
  }`;

export function LandingPage() {
  const info = useQuery({
    queryKey: ['public-plans'],
    queryFn: () =>
      api.get<{
        plans: (PlanDef & { price: PlanPrice | null; purchasable: boolean })[];
        billingEnabled: boolean;
        signupEnabled: boolean;
      }>('/api/public/plans'),
  });
  const signup = !!info.data?.signupEnabled;
  return (
    <div className="rf-landing">
      <header className="rf-landing__top">
        <span className="rf-landing__logo">
          <Logo size={26} />
          <span className="rf-auth__tv">.TV</span>
        </span>
        <nav className="rf-landing__nav" aria-label="Portada">
          <a href="#planes">Planes</a>
          <Link to="/ayuda">Ayuda</Link>
          <Link to="/entrar" className="rf-btn rf-btn--secondary rf-btn--sm">
            Entrar
          </Link>
        </nav>
      </header>

      <section className="rf-landing__hero">
        <h1>
          Escaletas, guiones, rótulos y directo
          <span> para TV local, educación y eventos</span>
        </h1>
        <p>
          RunFlow reúne en el navegador lo que hoy está repartido entre hojas de cálculo, documentos
          y mensajes: la redacción escribe, realización da el GO y los equipos se mueven solos.
        </p>
        <div className="rf-landing__cta">
          {signup && (
            <Link to="/registro" className="rf-btn rf-btn--primary">
              Crear cuenta gratis
            </Link>
          )}
          <Link to="/entrar" className="rf-btn rf-btn--secondary">
            Entrar
          </Link>
        </div>
      </section>

      <section className="rf-landing__features" aria-label="Qué hace RunFlow">
        {FEATURES.map((f) => (
          <article key={f.title} className="rf-landing__feature">
            <h2>{f.title}</h2>
            <p>{f.text}</p>
          </article>
        ))}
      </section>

      <section id="planes" className="rf-landing__plans" aria-labelledby="planes-title">
        <h2 id="planes-title">Planes</h2>
        <p className="rf-muted">Sin publicidad en ningún plan.</p>
        <div className="rf-landing__plan-grid">
          {(info.data?.plans ?? []).map((p) => (
            <article
              key={p.key}
              className={`rf-landing__plan${p.key === 'pro' ? ' is-featured' : ''}`}
            >
              <h3>{p.name}</h3>
              <p className="rf-landing__plan-for">{p.for}</p>
              <p className="rf-landing__price">
                {p.key === 'free' ? 'Gratis' : p.price ? money(p.price) : 'Consúltanos'}
              </p>
              <ul>
                {p.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <footer className="rf-landing__footer">
        <span>RunFlow</span>
        <Link to="/ayuda">Ayuda</Link>
      </footer>
    </div>
  );
}
