import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  formatDuration,
  type DeviceDto,
  type ProductionEventDto,
  type RundownDto,
  type SourceItemDto,
} from '@runflow/core';
import { Badge, Spinner } from '@runflow/ui';
import { api } from '../api/client';
import { rundownsKey, plannedSeconds, statusLabel } from './RundownsPage';
import { useCan, useSession } from '../auth/session';
import { PageHeader } from '../components/PageHeader';
import { useArea } from '../layouts/useArea';
import { todayIso } from '../layouts/HeaderMenus';
import { locale, t } from '../i18n';

/* Inicio de cada área: las escaletas de hoy (tipo hoja de cálculo) y lo propio del área. */

const timeFmt = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });
const dayTimeFmt = new Intl.DateTimeFormat(locale, {
  weekday: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function HomePage() {
  const { me, org } = useSession();
  const area = useArea().current;
  return (
    <>
      <PageHeader
        title={t('home.welcome', { name: me.user.name.split(' ')[0] ?? me.user.name })}
        intro={`${area ? `${area.label} · ` : ''}${org.name} · ${org.role.name}`}
      />
      <TodayRundowns />
      <div className="rf-grid rf-home__extra">
        {area?.key === 'redaccion' && <LatestNews />}
        {area?.key === 'direccion' && <DevicesStatus />}
        {area?.key === 'produccion' && <UpcomingEvents />}
      </div>
    </>
  );
}

function TodayRundowns() {
  const navigate = useNavigate();
  const day = todayIso();
  const rundowns = useQuery({
    queryKey: [...rundownsKey, day, day, ''],
    queryFn: async () =>
      (await api.get<{ rundowns: RundownDto[] }>(`/api/rundowns?from=${day}&to=${day}`)).rundowns,
    refetchInterval: 15_000,
  });
  return (
    <section className="rf-card rf-home__today" aria-label="Escaletas de hoy">
      <div className="rf-home__head">
        <h2 className="rf-tile__title">Escaletas de hoy</h2>
        <Link to="/escaletas" className="rf-btn rf-btn--secondary rf-btn--sm">
          Todas las escaletas
        </Link>
      </div>
      {rundowns.isPending ? (
        <Spinner label="Cargando…" />
      ) : !rundowns.data?.length ? (
        <p className="rf-tile__body">{t('home.rundownsBody')}</p>
      ) : (
        <div className="rf-table-wrap">
          <table className="rf-table rf-sheet" aria-label="Escaletas de hoy">
            <thead>
              <tr>
                <th>Inicio</th>
                <th>Fin</th>
                <th>Escaleta</th>
                <th>Programa</th>
                <th>Estado</th>
                <th className="is-num">Líneas</th>
                <th className="is-num">Estimado</th>
                <th className="is-num">Previsto</th>
              </tr>
            </thead>
            <tbody>
              {rundowns.data.map((r) => {
                const planned = plannedSeconds(r.startTime, r.endTime);
                return (
                  <tr
                    key={r.id}
                    className={r.status === 'en_aire' ? 'is-live' : undefined}
                    tabIndex={0}
                    role="link"
                    aria-label={`Abrir ${r.title}`}
                    onClick={() => navigate(`/escaletas/${r.id}`)}
                    onKeyDown={(e) => e.key === 'Enter' && navigate(`/escaletas/${r.id}`)}
                  >
                    <td className="rf-tabular">{r.startTime.slice(0, 5)}</td>
                    <td className="rf-tabular">{r.endTime.slice(0, 5)}</td>
                    <td>
                      <strong>{r.title}</strong>
                    </td>
                    <td>{r.programName}</td>
                    <td>
                      <Badge tone={r.status === 'en_aire' ? 'danger' : undefined}>
                        {statusLabel(r.status)}
                      </Badge>
                    </td>
                    <td className="is-num rf-tabular">{r.lineCount}</td>
                    <td
                      className={`is-num rf-tabular${r.estimatedSeconds > planned ? ' rf-text-danger' : ''}`}
                    >
                      {formatDuration(r.estimatedSeconds)}
                    </td>
                    <td className="is-num rf-tabular">{formatDuration(planned)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function LatestNews() {
  const items = useQuery({
    queryKey: ['source-items', 'home'],
    queryFn: async () =>
      (await api.get<{ items: SourceItemDto[] }>('/api/source-items?limit=8')).items,
  });
  return (
    <section className="rf-card rf-tile">
      <h2 className="rf-tile__title">Últimas noticias de las fuentes</h2>
      {items.data?.length ? (
        <ul className="rf-plain-list rf-home__list">
          {items.data.map((i) => (
            <li key={i.id}>
              <strong>{i.title}</strong>
              <span className="rf-muted rf-small">
                {' '}
                {i.sourceName}
                {i.publishedAt && ` · ${timeFmt.format(new Date(i.publishedAt))}`}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rf-tile__body rf-muted">Sin noticias. Añade fuentes RSS en Fuentes.</p>
      )}
      <Link to="/fuentes" className="rf-btn rf-btn--secondary rf-btn--sm">
        Fuentes
      </Link>
    </section>
  );
}

function DevicesStatus() {
  const canDevices = useCan('devices.configure');
  const canOrg = useCan('org.configure');
  const devices = useQuery({
    queryKey: ['devices'],
    queryFn: async () => (await api.get<{ devices: DeviceDto[] }>('/api/devices')).devices,
    refetchInterval: 5000,
    enabled: canDevices || canOrg,
  });
  return (
    <section className="rf-card rf-tile">
      <h2 className="rf-tile__title">Equipos del estudio</h2>
      {devices.data?.length ? (
        <ul className="rf-plain-list rf-home__list">
          {devices.data.map((d) => (
            <li key={d.id}>
              <span
                className={`rf-dot ${d.status.connected ? 'is-on' : d.enabled ? 'is-off' : 'is-idle'}`}
                aria-hidden="true"
              />{' '}
              <strong>{d.name}</strong>{' '}
              <span className="rf-muted rf-small">
                {d.status.connected ? 'Conectado' : d.enabled ? 'Sin conexión' : 'Desactivado'}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rf-tile__body rf-muted">Sin equipos configurados.</p>
      )}
      <Link to="/station" className="rf-btn rf-btn--secondary rf-btn--sm">
        RunFlow Station
      </Link>
    </section>
  );
}

function UpcomingEvents() {
  const from = new Date();
  const to = new Date(from.getTime() + 7 * 86_400_000);
  const events = useQuery({
    queryKey: ['production-events', 'home'],
    queryFn: async () =>
      (
        await api.get<{ events: ProductionEventDto[] }>(
          `/api/production/events?${new URLSearchParams({
            from: from.toISOString(),
            to: to.toISOString(),
          })}`,
        )
      ).events,
  });
  return (
    <section className="rf-card rf-tile">
      <h2 className="rf-tile__title">Próximos 7 días</h2>
      {events.data?.length ? (
        <ul className="rf-plain-list rf-home__list">
          {events.data.map((e) => (
            <li key={e.id}>
              <span className="rf-tabular">{dayTimeFmt.format(new Date(e.startsAt))}</span>{' '}
              <strong>{e.title}</strong>{' '}
              <span className="rf-muted rf-small">
                {e.crewConfirmed}/{e.crewTotal} confirmados
                {e.logisticsPending > 0 && ` · ${e.logisticsPending} pendientes`}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rf-tile__body rf-muted">Sin convocatorias.</p>
      )}
      <Link to="/produccion" className="rf-btn rf-btn--secondary rf-btn--sm">
        Producción
      </Link>
    </section>
  );
}
