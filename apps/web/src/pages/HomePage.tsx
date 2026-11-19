import { Link } from 'react-router';
import { Badge } from '@runflow/ui';
import { useCan, useSession } from '../auth/session';
import { PageHeader } from '../components/PageHeader';
import { t } from '../i18n';

export function HomePage() {
  const { me, org } = useSession();
  const canManageUsers = useCan('users.manage');
  return (
    <>
      <PageHeader
        title={t('home.welcome', { name: me.user.name.split(' ')[0] ?? me.user.name })}
        intro={t('home.intro', { org: org.name, role: org.role.name })}
      />
      <div className="rf-grid">
        <section className="rf-card rf-tile">
          <h2 className="rf-tile__title">
            {t('home.rundownsTitle')} <Badge tone="muted">M1</Badge>
          </h2>
          <p className="rf-tile__body">{t('home.rundownsBody')}</p>
        </section>
        {canManageUsers && (
          <section className="rf-card rf-tile">
            <h2 className="rf-tile__title">{t('home.teamTitle')}</h2>
            <p className="rf-tile__body">{t('home.teamBody')}</p>
            <Link to="/usuarios" className="rf-btn rf-btn--secondary rf-btn--sm">
              {t('home.teamAction')}
            </Link>
          </section>
        )}
        <section className="rf-card rf-tile">
          <h2 className="rf-tile__title">{t('home.systemTitle')}</h2>
          <p className="rf-tile__body">
            <Badge tone="accent">
              {t(me.mode === 'station' ? 'home.mode.station' : 'home.mode.cloud')}
            </Badge>
          </p>
        </section>
      </div>
    </>
  );
}
