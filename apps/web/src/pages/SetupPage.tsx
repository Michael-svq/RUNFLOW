import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { setupInput, type MeResponse } from '@runflow/core';
import { Alert, Button, TextField } from '@runflow/ui';
import { api } from '../api/client';
import { useApplyMe } from '../auth/session';
import { t } from '../i18n';
import { useFormState, validate } from '../lib/forms';
import { AuthLayout } from '../layouts/AuthLayout';

export function SetupPage() {
  const [values, setValues] = useState({ orgName: '', name: '', email: '', password: '' });
  const form = useFormState();
  const applyMe = useApplyMe();
  const navigate = useNavigate();

  const set = (key: keyof typeof values) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const { data, errors } = validate(setupInput, values);
    if (!data) return form.setFieldErrors(errors);
    const me = await form.submit(() => api.post<MeResponse>('/api/setup', data));
    if (me) {
      applyMe(me);
      navigate('/inicio', { replace: true });
    }
  }

  return (
    <AuthLayout title={t('setup.title')} intro={t('setup.intro')}>
      <form className="rf-form" onSubmit={onSubmit} noValidate>
        {form.formError && <Alert tone="error">{form.formError}</Alert>}
        <TextField
          label={t('setup.orgName')}
          placeholder={t('setup.orgNamePlaceholder')}
          value={values.orgName}
          onChange={set('orgName')}
          error={form.fieldErrors.orgName}
          autoFocus
          required
        />
        <TextField
          label={t('setup.name')}
          value={values.name}
          onChange={set('name')}
          error={form.fieldErrors.name}
          autoComplete="name"
          required
        />
        <TextField
          label={t('setup.email')}
          type="email"
          value={values.email}
          onChange={set('email')}
          error={form.fieldErrors.email}
          autoComplete="email"
          required
        />
        <TextField
          label={t('setup.password')}
          type="password"
          value={values.password}
          onChange={set('password')}
          error={form.fieldErrors.password}
          hint={t('setup.passwordHint')}
          autoComplete="new-password"
          required
        />
        <Button type="submit" variant="primary" block loading={form.submitting}>
          {t('setup.submit')}
        </Button>
      </form>
    </AuthLayout>
  );
}
