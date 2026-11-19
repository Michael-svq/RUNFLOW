import type { ReactNode } from 'react';
import { Logo } from '@runflow/ui';

/** Pantallas de acceso: tarjeta centrada sobre el fondo de marca. */
export function AuthLayout({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="rf-auth">
      <div className="rf-auth__brand">
        <Logo size={34} />
        <span className="rf-auth__tv">.TV</span>
      </div>
      <section className="rf-auth__card" aria-labelledby="rf-auth-title">
        <h1 id="rf-auth-title" className="rf-auth__title">
          {title}
        </h1>
        {intro && <p className="rf-auth__intro">{intro}</p>}
        {children}
      </section>
    </main>
  );
}
