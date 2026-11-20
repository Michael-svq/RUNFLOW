import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { Alert, Button, TextField } from '@runflow/ui';
import { api, errorMessage } from '../api/client';
import { AuthLayout } from '../layouts/AuthLayout';

/* Lanzamiento: recuperar contraseña, restablecerla y verificar el email. */

/** /recuperar — pide el enlace para poner una contraseña nueva. */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/password/forgot', { email });
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Recuperar la contraseña">
      {sent ? (
        <div className="rf-form">
          <Alert tone="success">
            Si hay una cuenta con ese email, te hemos enviado un enlace para poner una contraseña
            nueva. Caduca en una hora.
          </Alert>
          <p className="rf-small">
            <Link to="/entrar">Volver a entrar</Link>
          </p>
        </div>
      ) : (
        <form className="rf-form" onSubmit={onSubmit}>
          {error && <Alert tone="error">{error}</Alert>}
          <p className="rf-muted rf-small">
            Escribe el email de tu cuenta y te mandaremos un enlace para poner una contraseña nueva.
          </p>
          <TextField
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            autoFocus
            required
          />
          <Button type="submit" variant="primary" block loading={busy}>
            Enviar enlace
          </Button>
          <p className="rf-small rf-muted">
            <Link to="/entrar">Volver a entrar</Link>
          </p>
        </form>
      )}
    </AuthLayout>
  );
}

/** /restablecer/:token — contraseña nueva desde el enlace del email. */
export function ResetPasswordPage() {
  const { token = '' } = useParams();
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (password !== repeat) return setError('Las contraseñas no coinciden');
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/password/reset', { token, password });
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Contraseña nueva">
      {done ? (
        <div className="rf-form">
          <Alert tone="success">
            Contraseña cambiada. Se han cerrado las sesiones abiertas con la anterior.
          </Alert>
          <Link className="rf-btn rf-btn--primary rf-btn--block" to="/entrar">
            Entrar
          </Link>
        </div>
      ) : (
        <form className="rf-form" onSubmit={onSubmit}>
          {error && <Alert tone="error">{error}</Alert>}
          <TextField
            label="Contraseña nueva"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            hint="Mínimo 10 caracteres"
            autoComplete="new-password"
            autoFocus
            required
          />
          <TextField
            label="Repite la contraseña"
            type="password"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
            autoComplete="new-password"
            required
          />
          <Button type="submit" variant="primary" block loading={busy}>
            Guardar contraseña
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}

/** /verificar/:token — confirma el email al abrir el enlace. */
export function VerifyEmailPage() {
  const { token = '' } = useParams();
  const qc = useQueryClient();
  const [state, setState] = useState<'pending' | 'ok' | 'error'>('pending');
  const [error, setError] = useState('');
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    api
      .post('/api/auth/verify', { token })
      .then(() => {
        setState('ok');
        void qc.invalidateQueries({ queryKey: ['me'] });
      })
      .catch((err: unknown) => {
        setError(errorMessage(err));
        setState('error');
      });
  }, [token, qc]);

  return (
    <AuthLayout title="Verificar el email">
      <div className="rf-form">
        {state === 'pending' && <p className="rf-muted">Comprobando el enlace…</p>}
        {state === 'ok' && <Alert tone="success">Email verificado. ¡Gracias!</Alert>}
        {state === 'error' && <Alert tone="error">{error}</Alert>}
        {state !== 'pending' && (
          <Link className="rf-btn rf-btn--primary rf-btn--block" to="/">
            Ir a RunFlow
          </Link>
        )}
      </div>
    </AuthLayout>
  );
}

/** Aviso en la aplicación mientras el email no está verificado. */
export function VerifyEmailBanner({ email }: { email: string }) {
  const [state, setState] = useState<'idle' | 'sent' | 'error'>('idle');
  return (
    <Alert tone="warning">
      Verifica tu email: te hemos enviado un enlace a <strong>{email}</strong>.{' '}
      {state === 'sent' ? (
        'Enviado de nuevo.'
      ) : (
        <button
          type="button"
          className="rf-link"
          onClick={() =>
            void api
              .post('/api/auth/verify/send')
              .then(() => setState('sent'))
              .catch(() => setState('error'))
          }
        >
          Reenviar el enlace
        </button>
      )}
      {state === 'error' && ' No se pudo reenviar; inténtalo en un minuto.'}
    </Alert>
  );
}
