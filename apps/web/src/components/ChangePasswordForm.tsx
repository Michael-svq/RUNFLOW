import { useState, type FormEvent } from 'react';
import { changePasswordInput, type MeResponse } from '@runflow/core';
import { Alert, Button, TextField } from '@runflow/ui';
import { api } from '../api/client';
import { useApplyMe } from '../auth/session';
import { t } from '../i18n';
import { useFormState, validate } from '../lib/forms';

export function ChangePasswordForm({ onDone }: { onDone?: (me: MeResponse) => void }) {
  const empty = { currentPassword: '', newPassword: '', confirm: '' };
  const [values, setValues] = useState(empty);
  const [done, setDone] = useState(false);
  const form = useFormState();
  const applyMe = useApplyMe();

  const set = (key: keyof typeof values) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setDone(false);
    const { data, errors } = validate(changePasswordInput, values);
    if (values.confirm !== values.newPassword) errors.confirm = t('changePassword.mismatch');
    if (!data || errors.confirm) return form.setFieldErrors(errors);
    const me = await form.submit(() => api.post<MeResponse>('/api/me/password', data));
    if (me) {
      setValues(empty);
      setDone(true);
      applyMe(me);
      onDone?.(me);
    }
  }

  return (
    <form className="rf-form" onSubmit={onSubmit} noValidate>
      {form.formError && <Alert tone="error">{form.formError}</Alert>}
      {done && <Alert tone="success">{t('changePassword.done')}</Alert>}
      <TextField
        label={t('changePassword.current')}
        type="password"
        value={values.currentPassword}
        onChange={set('currentPassword')}
        error={form.fieldErrors.currentPassword}
        autoComplete="current-password"
        required
      />
      <TextField
        label={t('changePassword.new')}
        type="password"
        value={values.newPassword}
        onChange={set('newPassword')}
        error={form.fieldErrors.newPassword}
        hint={t('setup.passwordHint')}
        autoComplete="new-password"
        required
      />
      <TextField
        label={t('changePassword.confirm')}
        type="password"
        value={values.confirm}
        onChange={set('confirm')}
        error={form.fieldErrors.confirm}
        autoComplete="new-password"
        required
      />
      <div>
        <Button type="submit" variant="primary" loading={form.submitting}>
          {t('changePassword.submit')}
        </Button>
      </div>
    </form>
  );
}
