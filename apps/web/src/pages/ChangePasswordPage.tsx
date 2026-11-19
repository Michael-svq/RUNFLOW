import { Navigate, useNavigate } from 'react-router';
import { useMe } from '../auth/session';
import { ChangePasswordForm } from '../components/ChangePasswordForm';
import { t } from '../i18n';
import { AuthLayout } from '../layouts/AuthLayout';

/** Cambio obligatorio de la contraseña provisional. */
export function ChangePasswordPage() {
  const { data: me } = useMe();
  const navigate = useNavigate();
  if (me && !me.user.mustChangePassword) return <Navigate to="/" replace />;
  return (
    <AuthLayout title={t('changePassword.title')} intro={t('changePassword.forcedIntro')}>
      <ChangePasswordForm onDone={() => navigate('/', { replace: true })} />
    </AuthLayout>
  );
}
