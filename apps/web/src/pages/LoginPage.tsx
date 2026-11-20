import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { loginInput, type MeResponse } from '@runflow/core';
import { Alert, Button, TextField } from '@runflow/ui';
import { api } from '../api/client';
import { useApplyMe, useSetupStatus } from '../auth/session';
import { t } from '../i18n';
import { useFormState, validate } from '../lib/forms';
import { AuthLayout } from '../layouts/AuthLayout';

/** Solo se permite volver a rutas internas (evita redirecciones abiertas). */
function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const form = useFormState();
  const applyMe = useApplyMe();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const status = useSetupStatus(true);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const { data, errors } = validate(loginInput, { email, password });
    if (!data) return form.setFieldErrors(errors);
    const me = await form.submit(() => api.post<MeResponse>('/api/auth/login', data));
    if (me) {
      applyMe(me);
      navigate(safeNext(params.get('next')), { replace: true });
    }
  }

  return (
    <AuthLayout title={t('login.title')}>
      <form className="rf-form" onSubmit={onSubmit} noValidate>
        {form.formError && <Alert tone="error">{form.formError}</Alert>}
        <TextField
          label={t('login.email')}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={form.fieldErrors.email}
          autoComplete="username"
          autoFocus
          required
        />
        <TextField
          label={t('login.password')}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={form.fieldErrors.password}
          autoComplete="current-password"
          required
        />
        <Button type="submit" variant="primary" block loading={form.submitting}>
          {t('login.submit')}
        </Button>
        <p className="rf-small rf-muted rf-auth__links">
          {status.data?.signupEnabled && (
            <>
              ¿Aún no tienes cuenta? <Link to="/registro">Créala gratis</Link> ·{' '}
            </>
          )}
          <Link to="/recuperar">¿Has olvidado la contraseña?</Link> · <Link to="/ayuda">Ayuda</Link>
        </p>
      </form>
    </AuthLayout>
  );
}
