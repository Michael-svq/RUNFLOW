import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';
import {
  CALL_STATUSES,
  EVENT_KINDS,
  GUEST_STATUSES,
  LOGISTICS_CATEGORIES,
  labelOf,
  type ProductionEventDetail,
  type PublicCallDto,
} from '@runflow/core';
import { Alert, Badge, Button, Logo, Spinner } from '@runflow/ui';
import { api, errorMessage } from '../api/client';
import { useSession } from '../auth/session';
import { fmtDateTime, fmtDay, fmtTime } from '../production/dates';

/* Hoja de llamada imprimible (Imprimir → «Guardar como PDF»). */

const time = (iso: string | null) => (iso ? fmtTime.format(new Date(iso)) : '—');

export function CallSheetPage() {
  const { id = '' } = useParams();
  const { org } = useSession();
  const detail = useQuery({
    queryKey: ['production-events', 'detail', id],
    queryFn: () => api.get<ProductionEventDetail>(`/api/production/events/${id}`),
  });
  useEffect(() => {
    document.documentElement.dataset.print = '1';
    return () => {
      delete document.documentElement.dataset.print;
    };
  }, []);
  useEffect(() => {
    if (detail.data) document.title = `Hoja de llamada · ${detail.data.event.title}`;
  }, [detail.data]);

  if (detail.isPending) return <Spinner label="Cargando…" />;
  if (detail.isError) return <Alert tone="error">{errorMessage(detail.error)}</Alert>;
  const { event, calls, guests, logistics } = detail.data;
  const start = new Date(event.startsAt);
  const crew = [...calls]
    .filter((c) => c.status !== 'rechazado')
    .sort((a, b) => (a.callAt ?? '').localeCompare(b.callAt ?? ''));

  return (
    <div className="rf-print rf-callsheet">
      <div className="rf-print__tools no-print">
        <button type="button" className="rf-btn rf-btn--primary" onClick={() => window.print()}>
          Imprimir / Guardar PDF
        </button>
      </div>
      <header className="rf-print__head">
        <div>
          <h1>Hoja de llamada · {event.title}</h1>
          <p>
            {org.name} · {labelOf(EVENT_KINDS, event.kind)} · {fmtDay.format(start)} ·{' '}
            {fmtTime.format(start)}
            {event.endsAt && `–${fmtTime.format(new Date(event.endsAt))}`}
            {event.location && ` · ${event.location}`}
          </p>
        </div>
        <div className="rf-print__meta">
          {event.programName && <strong>{event.programName}</strong>}
          <span>
            {event.crewConfirmed}/{event.crewTotal} confirmados
          </span>
          <span>Impresa {fmtDateTime.format(new Date())}</span>
        </div>
      </header>
      {event.notes && <p className="rf-print__notes">{event.notes}</p>}

      <h2>Equipo</h2>
      <table className="rf-print__table">
        <thead>
          <tr>
            <th>Citación</th>
            <th>Puesto</th>
            <th>Nombre</th>
            <th>Teléfono</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody>
          {crew.map((c) => (
            <tr key={c.id}>
              <td>{time(c.callAt)}</td>
              <td>{c.role}</td>
              <td>{c.name}</td>
              <td>{c.phone}</td>
              <td>{labelOf(CALL_STATUSES, c.status)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {guests.length > 0 && (
        <>
          <h2>Invitados</h2>
          <table className="rf-print__table">
            <thead>
              <tr>
                <th>Llegada</th>
                <th>Maquillaje</th>
                <th>Set</th>
                <th>Invitado</th>
                <th>Teléfono</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {guests.map((g) => (
                <tr key={g.id}>
                  <td>{time(g.arrivalAt)}</td>
                  <td>{time(g.makeupAt)}</td>
                  <td>{time(g.setAt)}</td>
                  <td>
                    {g.name}
                    {g.description && ` · ${g.description}`}
                  </td>
                  <td>{g.phone}</td>
                  <td>{labelOf(GUEST_STATUSES, g.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {logistics.length > 0 && (
        <>
          <h2>Logística</h2>
          <table className="rf-print__table">
            <thead>
              <tr>
                <th>Cuándo</th>
                <th>Categoría</th>
                <th>Qué</th>
                <th>Proveedor</th>
                <th>Responsable</th>
                <th>Hecho</th>
              </tr>
            </thead>
            <tbody>
              {logistics.map((l) => (
                <tr key={l.id}>
                  <td>{l.at ? fmtDateTime.format(new Date(l.at)) : '—'}</td>
                  <td>{labelOf(LOGISTICS_CATEGORIES, l.category)}</td>
                  <td>{l.description}</td>
                  <td>{l.provider}</td>
                  <td>{l.assignee}</td>
                  <td>{l.done ? '✓' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

/** /convocatoria/:token — la persona convocada confirma sin cuenta. */
export function CallReplyPage() {
  const { token = '' } = useParams();
  const [reply, setReply] = useState('');
  const call = useQuery({
    queryKey: ['public-call', token],
    queryFn: async () => (await api.get<{ call: PublicCallDto }>(`/api/public/call/${token}`)).call,
    retry: false,
  });
  const answer = useMutation({
    mutationFn: (status: 'confirmado' | 'rechazado') =>
      api.post<{ call: PublicCallDto }>(`/api/public/call/${token}`, { status, reply }),
    onSuccess: () => void call.refetch(),
  });

  if (call.isPending) return <Spinner label="Cargando…" />;
  if (call.isError)
    return (
      <main className="rf-callreply">
        <Alert tone="error">{errorMessage(call.error)}</Alert>
      </main>
    );
  const c = call.data;
  const start = new Date(c.event.startsAt);
  return (
    <main className="rf-callreply">
      <Logo />
      <h1>{c.event.title}</h1>
      <p className="rf-muted">
        {c.orgName} · {labelOf(EVENT_KINDS, c.event.kind)}
      </p>
      <dl>
        <dt>Persona</dt>
        <dd>{c.name}</dd>
        {c.role && (
          <>
            <dt>Puesto</dt>
            <dd>{c.role}</dd>
          </>
        )}
        <dt>Día</dt>
        <dd>{fmtDay.format(start)}</dd>
        <dt>Citación</dt>
        <dd>{c.callAt ? fmtDateTime.format(new Date(c.callAt)) : fmtTime.format(start)}</dd>
        {c.event.location && (
          <>
            <dt>Lugar</dt>
            <dd>{c.event.location}</dd>
          </>
        )}
      </dl>
      {c.event.notes && <p className="rf-prod__notes">{c.event.notes}</p>}
      <p>
        Estado:{' '}
        <Badge
          tone={
            c.status === 'confirmado' ? 'success' : c.status === 'rechazado' ? 'danger' : 'muted'
          }
        >
          {labelOf(CALL_STATUSES, c.status)}
        </Badge>
      </p>
      {answer.isError && <Alert tone="error">{errorMessage(answer.error)}</Alert>}
      <label className="rf-field">
        <span className="rf-field__label">Mensaje para producción (opcional)</span>
        <textarea
          className="rf-input rf-textarea"
          rows={2}
          maxLength={500}
          value={reply}
          onChange={(e) => setReply(e.target.value)}
        />
      </label>
      <div className="rf-form__actions">
        <Button
          variant="primary"
          disabled={answer.isPending}
          onClick={() => answer.mutate('confirmado')}
        >
          Confirmo
        </Button>
        <Button disabled={answer.isPending} onClick={() => answer.mutate('rechazado')}>
          No puedo
        </Button>
      </div>
    </main>
  );
}
