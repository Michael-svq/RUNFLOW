import { Link, Navigate, useNavigate } from 'react-router';
import type { MeResponse } from '@runflow/core';
import { Alert, Button } from '@runflow/ui';
import { api } from '../api/client';
import { useApplyMe, useLogout, useMe } from '../auth/session';
import { t } from '../i18n';
import { useFormState } from '../lib/forms';
import { AuthLayout } from '../layouts/AuthLayout';

export function ChooseOrgPage() {
  const { data: me } = useMe();
  const applyMe = useApplyMe();
  const logout = useLogout();
  const navigate = useNavigate();
  const form = useFormState();

  if (!me) return null;
  if (me.user.mustChangePassword) return <Navigate to="/cambiar-contrasena" replace />;

  async function choose(orgId: string) {
    const next = await form.submit(() => api.post<MeResponse>('/api/auth/active-org', { orgId }));
    if (next) {
      applyMe(next);
      navigate('/inicio', { replace: true });
    }
  }

  return (
    <AuthLayout
      title={t('chooseOrg.title')}
      intro={me.organizations.length > 0 ? t('chooseOrg.intro') : undefined}
    >
      {form.formError && <Alert tone="error">{form.formError}</Alert>}
      {me.organizations.length === 0 && <Alert tone="warning">{t('chooseOrg.none')}</Alert>}
      <ul className="rf-org-list">
        {me.organizations.map((o) => (
          <li key={o.id}>
            <button
              type="button"
              className="rf-org-list__item"
              onClick={() => choose(o.id)}
              disabled={form.submitting}
            >
              <span className="rf-org-list__name">{o.name}</span>
              <span className="rf-org-list__role">{o.role.name}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="rf-form__actions">
        {me.user.isPlatformAdmin && (
          <Link to="/plataforma" className="rf-btn rf-btn--secondary">
            {t('chooseOrg.platform')}
          </Link>
        )}
        <Button
          variant="ghost"
          onClick={async () => {
            await logout();
            navigate('/entrar', { replace: true });
          }}
        >
          {t('nav.logout')}
        </Button>
      </div>
    </AuthLayout>
  );
}
