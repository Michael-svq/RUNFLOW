import { useState, type FormEvent } from 'react';
import { updateMeInput, type MeResponse } from '@runflow/core';
import { Alert, Badge, Button, TextField } from '@runflow/ui';
import { api } from '../api/client';
import { useApplyMe, useSession } from '../auth/session';
import { ChangePasswordForm } from '../components/ChangePasswordForm';
import { PageHeader } from '../components/PageHeader';
import { t } from '../i18n';
import { useFormState, validate } from '../lib/forms';
import { useTheme } from '../lib/theme';

export function ProfilePage() {
  const { me } = useSession();
  const applyMe = useApplyMe();
  const [name, setName] = useState(me.user.name);
  const [saved, setSaved] = useState(false);
  const form = useFormState();
  const [theme, setTheme] = useTheme();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaved(false);
    const { data, errors } = validate(updateMeInput, { name });
    if (!data) return form.setFieldErrors(errors);
    const next = await form.submit(() => api.patch<MeResponse>('/api/me', data));
    if (next) {
      applyMe(next);
      setSaved(true);
    }
  }

  return (
    <>
      <PageHeader title={t('profile.title')} />
      <div className="rf-stack">
        <section className="rf-card rf-section">
          <h2 className="rf-section__title">{t('profile.data')}</h2>
          <form className="rf-form rf-form--narrow" onSubmit={onSubmit} noValidate>
            {form.formError && <Alert tone="error">{form.formError}</Alert>}
            {saved && <Alert tone="success">{t('profile.saved')}</Alert>}
            <TextField
              label={t('profile.name')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              error={form.fieldErrors.name}
              autoComplete="name"
            />
            <TextField label={t('profile.email')} value={me.user.email} readOnly disabled />
            <div>
              <Button type="submit" variant="primary" loading={form.submitting}>
                {t('common.save')}
              </Button>
            </div>
          </form>
        </section>

        <section className="rf-card rf-section">
          <h2 className="rf-section__title">{t('profile.password')}</h2>
          <div className="rf-form--narrow">
            <ChangePasswordForm />
          </div>
        </section>

        <section className="rf-card rf-section">
          <h2 className="rf-section__title">{t('profile.appearance')}</h2>
          <fieldset className="rf-choice-group">
            <legend className="rf-field__label">{t('theme.label')}</legend>
            {(['interior', 'exterior'] as const).map((value) => (
              <label key={value} className={`rf-choice${theme === value ? ' is-active' : ''}`}>
                <input
                  type="radio"
                  name="theme"
                  value={value}
                  checked={theme === value}
                  onChange={() => setTheme(value)}
                />
                <span
                  className={`rf-choice__swatch rf-choice__swatch--${value}`}
                  aria-hidden="true"
                />
                <span>
                  <strong>{t(`theme.${value}`)}</strong>
                  <span className="rf-choice__hint">{t(`theme.${value}Hint`)}</span>
                </span>
              </label>
            ))}
          </fieldset>
        </section>

        <section className="rf-card rf-section">
          <h2 className="rf-section__title">{t('profile.orgs')}</h2>
          <p className="rf-muted">{t('profile.orgsIntro')}</p>
          <ul className="rf-plain-list">
            {me.organizations.map((o) => (
              <li key={o.id}>
                <strong>{o.name}</strong> <Badge>{o.role.name}</Badge>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
