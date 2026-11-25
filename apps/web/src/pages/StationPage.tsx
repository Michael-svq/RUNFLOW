import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { StationDto, StationLicenseStatus, StationStatusDto } from '@runflow/core';
import { Alert, Badge, Button, Spinner, TextField } from '@runflow/ui';
import { api, errorMessage } from '../api/client';
import { useMe } from '../auth/session';
import { locale } from '../i18n';

const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' });
const dateOnly = new Intl.DateTimeFormat(locale, { dateStyle: 'long' });

export const stationStatusKey = ['station-status'] as const;

export function useStationStatus(enabled = true) {
  return useQuery({
    queryKey: stationStatusKey,
    queryFn: () => api.get<StationStatusDto>('/api/station/status'),
    refetchInterval: 15_000,
    enabled,
  });
}

/** 09 RunFlow Station: en la nube, alta de Stations; en una Station, su consola. */
/** Stations de la empresa (nube) o consola de esta Station. */
export function StationPanel() {
  const { data: me } = useMe();
  return me?.mode === 'station' ? <StationConsole /> : <CloudStations />;
}

/* ---------- Nube: Stations de la empresa ---------- */

function CloudStations() {
  const qc = useQueryClient();
  const key = ['stations'];
  const stations = useQuery({
    queryKey: key,
    queryFn: async () => (await api.get<{ stations: StationDto[] }>('/api/stations')).stations,
    refetchInterval: 15_000,
  });
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ name: string; token: string } | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ station: { name: string }; token: string }>('/api/stations', {
        name,
      });
      setCreated({ name: res.station.name, token: res.token });
      setName('');
      void qc.invalidateQueries({ queryKey: key });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const command = created ? `runflow-station link ${window.location.origin} ${created.token}` : '';

  return (
    <>
      <p className="rf-muted rf-small">
        Un ordenador del estudio que hace de servidor: si se cae internet, el directo sigue y, al
        volver, todo se fusiona con la nube.
      </p>
      <section className="rf-card rf-station">
        <h2 className="rf-form__title">Enlazar una Station nueva</h2>
        <form className="rf-station__form" onSubmit={onCreate}>
          <TextField
            label="Nombre"
            value={name}
            maxLength={60}
            placeholder="Plató 1"
            onChange={(e) => setName(e.target.value)}
            required
          />
          <Button type="submit" variant="primary" loading={busy} disabled={!name.trim()}>
            Crear enlace
          </Button>
        </form>
        {error && <Alert tone="error">{error}</Alert>}
        {created && (
          <div className="rf-station__token" role="status">
            <Alert tone="success">
              Station «{created.name}» creada. Copia ahora el token: no se volverá a mostrar.
            </Alert>
            <p className="rf-small">
              En el ordenador de la Station, ejecuta y reinicia la Station:
            </p>
            <code className="rf-code">{command}</code>
            <div className="rf-form__actions">
              <Button size="sm" onClick={() => void navigator.clipboard?.writeText(command)}>
                Copiar orden
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setCreated(null)}>
                Hecho
              </Button>
            </div>
          </div>
        )}
      </section>

      {stations.isPending ? (
        <Spinner label="Cargando…" />
      ) : stations.isError ? (
        <Alert tone="error">{errorMessage(stations.error)}</Alert>
      ) : stations.data.length === 0 ? (
        <div className="rf-card rf-empty">Todavía no hay ninguna Station enlazada.</div>
      ) : (
        <div className="rf-table-wrap">
          <table className="rf-table">
            <thead>
              <tr>
                <th>Station</th>
                <th>Última conexión</th>
                <th>Versión</th>
                <th className="rf-table__actions">
                  <span className="rf-visually-hidden">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {stations.data.map((s) => {
                const online = !!s.lastSeenAt && Date.now() - Date.parse(s.lastSeenAt) < 2 * 60_000;
                return (
                  <tr key={s.id}>
                    <td>
                      <strong>{s.name}</strong>{' '}
                      <Badge tone={online ? 'success' : 'muted'}>
                        {online ? 'Conectada' : 'Sin conexión'}
                      </Badge>
                    </td>
                    <td>{s.lastSeenAt ? dateTime.format(new Date(s.lastSeenAt)) : 'Nunca'}</td>
                    <td className="rf-muted">{s.lastVersion ?? '—'}</td>
                    <td className="rf-table__actions">
                      {confirm === s.id ? (
                        <>
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={async () => {
                              try {
                                await api.delete(`/api/stations/${s.id}`);
                                void qc.invalidateQueries({ queryKey: key });
                              } catch (err) {
                                setError(errorMessage(err));
                              } finally {
                                setConfirm(null);
                              }
                            }}
                          >
                            Confirmar
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
                            No
                          </Button>
                        </>
                      ) : (
                        <Button size="sm" onClick={() => setConfirm(s.id)}>
                          Revocar
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* ---------- Station: consola ---------- */

const LICENSE_LABEL: Record<StationLicenseStatus['state'], string> = {
  cloud: 'Cubierta por la nube',
  valid: 'En vigor',
  grace: 'Periodo de gracia',
  trial: 'Prueba',
  expired: 'Caducada',
  unchecked: 'Sin comprobación',
};

const LICENSE_TONE: Record<
  StationLicenseStatus['state'],
  'success' | 'warning' | 'danger' | 'muted'
> = {
  cloud: 'success',
  valid: 'success',
  grace: 'warning',
  trial: 'warning',
  expired: 'danger',
  unchecked: 'muted',
};

function StationConsole() {
  const status = useStationStatus();
  const qc = useQueryClient();
  const [license, setLicense] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  async function onLicense(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      await api.post('/api/station/license', { license });
      setLicense('');
      setNotice({ tone: 'success', text: 'Licencia instalada.' });
      void qc.invalidateQueries({ queryKey: stationStatusKey });
    } catch (err) {
      setNotice({ tone: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  if (status.isPending) return <Spinner label="Cargando…" />;
  if (status.isError) return <Alert tone="error">{errorMessage(status.error)}</Alert>;
  const s = status.data;
  const lic = s.license;

  return (
    <>
      <p className="rf-muted rf-small">
        Este ordenador hace de servidor del estudio. El resto de equipos de la red entra con el
        navegador.
      </p>
      <div className="rf-station__grid">
        <section className="rf-card rf-station">
          <h2 className="rf-form__title">Estado</h2>
          <dl className="rf-station__facts">
            <dt>Modo</dt>
            <dd>{s.linked ? 'Híbrido (enlazada con la nube)' : 'Local (sin nube)'}</dd>
            <dt>Versión</dt>
            <dd>{s.version}</dd>
            <dt>Dirección</dt>
            <dd>
              <code className="rf-code">{window.location.origin}</code>
            </dd>
            {s.sync && (
              <>
                <dt>Nube</dt>
                <dd>
                  <Badge tone={s.sync.online ? 'success' : 'danger'}>
                    {s.sync.online ? 'Conectada' : 'Sin conexión'}
                  </Badge>
                  {s.sync.lastError && !s.sync.online && (
                    <span className="rf-muted rf-small"> {s.sync.lastError}</span>
                  )}
                </dd>
                <dt>Última sincronización</dt>
                <dd>
                  {s.sync.lastSyncAt ? dateTime.format(new Date(s.sync.lastSyncAt)) : 'Todavía no'}
                </dd>
                <dt>Escaletas sincronizadas</dt>
                <dd>{s.sync.syncedRundowns} (de dos días atrás a dos semanas vista)</dd>
              </>
            )}
          </dl>
          {!s.linked && (
            <p className="rf-muted rf-small">
              Para enlazarla con la nube, crea el enlace en RunFlow (en la nube) → RunFlow Station y
              ejecuta en este ordenador la orden <code>runflow-station link …</code>.
            </p>
          )}
        </section>

        {lic && (
          <section className="rf-card rf-station">
            <h2 className="rf-form__title">Licencia</h2>
            <p>
              <Badge tone={LICENSE_TONE[lic.state]}>{LICENSE_LABEL[lic.state]}</Badge> {lic.message}
            </p>
            {lic.license && (
              <dl className="rf-station__facts">
                <dt>Titular</dt>
                <dd>{lic.license.licensee}</dd>
                <dt>Plan</dt>
                <dd>{lic.license.plan}</dd>
                <dt>Caduca</dt>
                <dd>{dateOnly.format(new Date(lic.license.expiresAt))}</dd>
              </dl>
            )}
            {lic.until && lic.state !== 'valid' && (
              <p className="rf-small">Hasta el {dateOnly.format(new Date(lic.until))}.</p>
            )}
            {lic.state !== 'cloud' && lic.state !== 'unchecked' && (
              <form className="rf-station__license" onSubmit={onLicense}>
                <label className="rf-field">
                  <span className="rf-field__label">Añadir o renovar licencia</span>
                  <textarea
                    className="rf-input rf-textarea"
                    rows={3}
                    value={license}
                    placeholder="RFL1.…"
                    onChange={(e) => setLicense(e.target.value)}
                  />
                </label>
                <Button type="submit" variant="primary" loading={busy} disabled={!license.trim()}>
                  Instalar licencia
                </Button>
              </form>
            )}
            {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
          </section>
        )}
      </div>
    </>
  );
}
