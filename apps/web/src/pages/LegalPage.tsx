import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { Logo } from '@runflow/ui';
import { useSetupStatus } from '../auth/session';

/*
 * Textos legales (plantillas). Los datos del titular vienen de LEGAL_OWNER,
 * LEGAL_TAX_ID, LEGAL_ADDRESS y LEGAL_EMAIL. Revísalos con asesoría antes de
 * publicar el servicio.
 */

type Legal = { owner: string; taxId: string; address: string; email: string };

const PAGES: Record<string, { title: string; body: (l: Legal) => ReactNode }> = {
  terminos: {
    title: 'Aviso legal y condiciones del servicio',
    body: (l) => (
      <>
        <h2>Titular</h2>
        <p>
          {l.owner} {l.taxId && `(NIF ${l.taxId})`}
          {l.address && `, ${l.address}`}. Contacto: {l.email}.
        </p>
        <h2>Objeto</h2>
        <p>
          RunFlow es una aplicación para preparar y ejecutar escaletas, guiones, rótulos y directos
          de televisión, educación y eventos, en la nube o en un servidor local (RunFlow Station).
        </p>
        <h2>Cuenta y uso</h2>
        <p>
          Quien crea una empresa es responsable de sus usuarios, de los permisos que les da y de
          guardar sus contraseñas. No se permite usar el servicio para fines ilícitos ni intentar
          acceder a datos de otras empresas.
        </p>
        <h2>Planes y pago</h2>
        <p>
          Los planes de pago se cobran por adelantado mediante Stripe y se renuevan hasta que se
          cancelan desde «Plan y facturación». Al cancelar, el plan sigue activo hasta el final del
          periodo pagado.
        </p>
        <h2>Tus contenidos</h2>
        <p>
          Las escaletas, guiones, medios y demás contenidos son de la empresa que los crea. El
          titular solo los trata para prestar el servicio. Puedes exportarlos en cualquier momento
          y, al dar de baja la empresa, se borran.
        </p>
        <h2>Disponibilidad y responsabilidad</h2>
        <p>
          Se procura la máxima disponibilidad, pero el servicio se presta «tal cual». En emisiones
          en directo recomendamos usar RunFlow Station en el estudio y tener un plan alternativo. El
          titular no responde de daños indirectos ni de interrupciones de emisión ajenas a su
          control.
        </p>
        <h2>Cambios y ley aplicable</h2>
        <p>
          Estas condiciones pueden cambiar; los cambios importantes se avisarán con antelación. Se
          rigen por la ley española.
        </p>
      </>
    ),
  },
  privacidad: {
    title: 'Política de privacidad',
    body: (l) => (
      <>
        <h2>Responsable</h2>
        <p>
          {l.owner} {l.taxId && `(NIF ${l.taxId})`}
          {l.address && `, ${l.address}`}. Contacto: {l.email}.
        </p>
        <h2>Qué datos tratamos</h2>
        <ul>
          <li>Cuenta: nombre, email y contraseña (guardada cifrada, nunca en claro).</li>
          <li>Contenido que creas: escaletas, guiones, personal, invitados, presupuestos…</li>
          <li>Datos técnicos: sesiones, dirección IP y registro de actividad por seguridad.</li>
          <li>Facturación: la gestiona Stripe; RunFlow no guarda datos de tarjetas.</li>
        </ul>
        <h2>Para qué y con qué base</h2>
        <p>
          Para prestar el servicio contratado (ejecución del contrato), mantener su seguridad
          (interés legítimo) y cumplir obligaciones legales y fiscales.
        </p>
        <h2>Con quién se comparten</h2>
        <p>
          Con proveedores necesarios: alojamiento, envío de emails y Stripe para los pagos. Las
          funciones de IA solo envían texto al proveedor que la empresa active con su propia clave
          (o a un modelo local con Ollama). No vendemos datos ni hay publicidad.
        </p>
        <h2>Cuánto tiempo</h2>
        <p>
          Mientras la cuenta esté activa y, después, el tiempo que exija la ley. Los datos
          personales de invitados y personal los decide y borra la propia empresa.
        </p>
        <h2>Tus derechos</h2>
        <p>
          Puedes pedir acceso, rectificación, supresión, oposición, limitación y portabilidad
          escribiendo a {l.email}. También puedes reclamar ante la Agencia Española de Protección de
          Datos (aepd.es).
        </p>
        <h2>Seguridad</h2>
        <p>
          Conexiones cifradas (HTTPS), aislamiento de los datos de cada empresa en la base de datos
          y claves de terceros guardadas cifradas.
        </p>
      </>
    ),
  },
  cookies: {
    title: 'Política de cookies',
    body: () => (
      <>
        <p>
          RunFlow solo usa una cookie técnica, <code>rf_session</code>, para mantener la sesión
          iniciada. Es imprescindible para que el servicio funcione, por eso no pide consentimiento.
        </p>
        <p>
          También guarda en tu navegador preferencias como el tema o la disposición de la escaleta.
          No hay cookies de analítica ni de publicidad.
        </p>
      </>
    ),
  },
};

export function LegalPage() {
  const { page = 'terminos' } = useParams();
  const status = useSetupStatus(true);
  const doc = PAGES[page] ?? PAGES.terminos!;
  const raw = status.data?.legal;
  const legal: Legal = {
    owner: raw?.owner || '[Titular del servicio]',
    taxId: raw?.taxId ?? '',
    address: raw?.address ?? '',
    email: raw?.email || '[email de contacto]',
  };
  return (
    <div className="rf-legal">
      <header className="rf-legal__head">
        <Link to="/" aria-label="RunFlow">
          <Logo />
        </Link>
        <nav aria-label="Textos legales">
          <Link to="/legal/terminos">Condiciones</Link>
          <Link to="/legal/privacidad">Privacidad</Link>
          <Link to="/legal/cookies">Cookies</Link>
        </nav>
      </header>
      <article className="rf-legal__body">
        <h1>{doc.title}</h1>
        {doc.body(legal)}
      </article>
    </div>
  );
}
