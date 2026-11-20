import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { signupInput, type MeResponse } from '@runflow/core';
import { Alert, Button, TextField } from '@runflow/ui';
import { api } from '../api/client';
import { useApplyMe, useSetupStatus } from '../auth/session';
import { FullScreenLoader } from '../components/FullScreen';
import { useFormState, validate } from '../lib/forms';
import { AuthLayout } from '../layouts/AuthLayout';

/** Registro autoservicio (nube): empresa nueva en el plan Gratis. */
export function SignupPage() {
  const status = useSetupStatus(true);
  const [values, setValues] = useState({ orgName: '', name: '', email: '', password: '' });
  const [accept, setAccept] = useState(false);
  const form = useFormState();
  const applyMe = useApplyMe();
  const navigate = useNavigate();

  if (status.isPending) return <FullScreenLoader />;
  if (!status.data?.signupEnabled) return <Navigate to="/entrar" replace />;

  const set = (key: keyof typeof values) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const { data, errors } = validate(signupInput, { ...values, acceptTerms: accept });
    if (!data) return form.setFieldErrors(errors);
    const me = await form.submit(() => api.post<MeResponse>('/api/signup', data));
    if (me) {
      applyMe(me);
      navigate('/inicio', { replace: true });
    }
  }

  return (
    <AuthLayout
      title="Crea tu cuenta"
      intro="Empieza gratis: 1 programa y 3 personas, sin publicidad. Mejora el plan cuando lo necesites."
    >
      <form className="rf-form" onSubmit={onSubmit} noValidate>
        {form.formError && <Alert tone="error">{form.formError}</Alert>}
        <TextField
          label="Nombre de la televisión, centro o productora"
          value={values.orgName}
          onChange={set('orgName')}
          error={form.fieldErrors.orgName}
          autoFocus
          required
        />
        <TextField
          label="Tu nombre"
          value={values.name}
          onChange={set('name')}
          error={form.fieldErrors.name}
          autoComplete="name"
          required
        />
        <TextField
          label="Email"
          type="email"
          value={values.email}
          onChange={set('email')}
          error={form.fieldErrors.email}
          autoComplete="email"
          required
        />
        <TextField
          label="Contraseña"
          type="password"
          value={values.password}
          onChange={set('password')}
          error={form.fieldErrors.password}
          hint="Mínimo 10 caracteres"
          autoComplete="new-password"
          required
        />
        <label className="rf-check">
          <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} />
          <span>
            Acepto las{' '}
            <Link to="/legal/terminos" target="_blank">
              condiciones del servicio
            </Link>{' '}
            y la{' '}
            <Link to="/legal/privacidad" target="_blank">
              política de privacidad
            </Link>
            {form.fieldErrors.acceptTerms && (
              <span className="rf-field__error"> · {form.fieldErrors.acceptTerms}</span>
            )}
          </span>
        </label>
        <Button type="submit" variant="primary" block loading={form.submitting}>
          Crear cuenta gratis
        </Button>
        <p className="rf-small rf-muted">
          ¿Ya tienes cuenta? <Link to="/entrar">Entra</Link>
        </p>
      </form>
    </AuthLayout>
  );
}
