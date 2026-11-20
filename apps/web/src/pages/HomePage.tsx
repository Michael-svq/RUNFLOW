import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { RundownDto } from '@runflow/core';
import { api } from '../api/client';
import { rundownsKey, statusLabel } from './RundownsPage';
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
        <TodayRundowns />
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

function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function TodayRundowns() {
  const navigate = useNavigate();
  const day = today();
  const rundowns = useQuery({
    queryKey: [...rundownsKey, day, day, ''],
    queryFn: async () =>
      (await api.get<{ rundowns: RundownDto[] }>(`/api/rundowns?from=${day}&to=${day}`)).rundowns,
  });
  return (
    <section className="rf-card rf-tile">
      <h2 className="rf-tile__title">{t('home.rundownsTitle')}</h2>
      {rundowns.data && rundowns.data.length > 0 ? (
        <ul className="rf-plain-list rf-today">
          {rundowns.data.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className="rf-today__item"
                onClick={() => navigate(`/escaletas/${r.id}`)}
              >
                <span className="rf-tabular">{r.startTime.slice(0, 5)}</span>
                <strong>{r.title}</strong>
                <Badge>{statusLabel(r.status)}</Badge>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rf-tile__body">{t('home.rundownsBody')}</p>
      )}
      <Link to="/escaletas" className="rf-btn rf-btn--secondary rf-btn--sm">
        {t('nav.rundowns')}
      </Link>
    </section>
  );
}
