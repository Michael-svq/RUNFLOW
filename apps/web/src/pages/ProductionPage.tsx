import { useMemo, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import {
  CALL_STATUSES,
  EVENT_KINDS,
  EVENT_STATUSES,
  GUEST_STATUSES,
  LOGISTICS_CATEGORIES,
  labelOf,
  type CallDto,
  type CallStatus,
  type CrewDto,
  type EventStatus,
  type GuestDto,
  type GuestStatus,
  type LogisticsCategory,
  type ProductionEventDetail,
  type ProductionEventDto,
  type ProgramDto,
  type RundownDto,
} from '@runflow/core';
import { Alert, Badge, Button, Dialog, SelectField, Spinner, TextField } from '@runflow/ui';
import { api, errorMessage } from '../api/client';
import { useCan } from '../auth/session';
import { PageHeader } from '../components/PageHeader';
import { BudgetPanel } from '../production/BudgetPanel';
import {
  dayKey,
  fmtDateTime,
  fmtDay,
  fmtMonth,
  fmtTime,
  fromLocalInput,
  monthGrid,
  toLocalInput,
  WEEKDAYS,
} from '../production/dates';

/* 11 Producción (F3.1): calendario, hojas de llamada, invitados, logística y personal. */

const eventsKey = ['production-events'];
const crewKey = ['production-crew'];
const REFRESH = 15_000;

const statusTone = (s: EventStatus | CallStatus | GuestStatus) =>
  s === 'confirmado' || s === 'llegado'
    ? 'success'
    : s === 'cancelado' || s === 'rechazado'
      ? 'danger'
      : 'muted';

export function ProductionPage() {
  const [tab, setTab] = useState<'calendar' | 'crew' | 'budget'>('calendar');
  const canBudget = useCan('budget.view');
  const tabs = [
    ['calendar', 'Calendario'],
    ['crew', 'Personal'],
    ...(canBudget ? [['budget', 'Presupuesto']] : []),
  ] as [typeof tab, string][];
  return (
    <>
      <PageHeader
        title="Producción"
        intro="Directos, grabaciones y ensayos: quién va y a qué hora, invitados, logística y presupuesto, al día para todo el equipo."
        actions={
          <div className="rf-tabs" role="tablist" aria-label="Producción">
            {tabs.map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                className={`rf-tabs__tab${tab === k ? ' is-active' : ''}`}
                onClick={() => setTab(k)}
              >
                {label}
              </button>
            ))}
          </div>
        }
      />
      {tab === 'calendar' ? (
        <Calendar />
      ) : tab === 'crew' ? (
        <CrewDirectory />
      ) : (
        <section className="rf-card" aria-label="Presupuesto">
          <BudgetPanel />
        </section>
      )}
    </>
  );
}

/* ---------- Calendario ---------- */

function Calendar() {
  const canManage = useCan('production.manage');
  const today = new Date();
  const [month, setMonth] = useState({ y: today.getFullYear(), m: today.getMonth() });
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const days = useMemo(() => monthGrid(month.y, month.m), [month]);
  const from = days[0]!.toISOString();
  const to = new Date(
    days[41]!.getFullYear(),
    days[41]!.getMonth(),
    days[41]!.getDate() + 1,
  ).toISOString();
  const events = useQuery({
    queryKey: [...eventsKey, from, to],
    queryFn: async () =>
      (
        await api.get<{ events: ProductionEventDto[] }>(
          `/api/production/events?${new URLSearchParams({ from, to })}`,
        )
      ).events,
    refetchInterval: REFRESH,
  });
  const byDay = useMemo(() => {
    const map = new Map<string, ProductionEventDto[]>();
    for (const e of events.data ?? []) {
      const k = dayKey(new Date(e.startsAt));
      map.set(k, [...(map.get(k) ?? []), e]);
    }
    return map;
  }, [events.data]);
  const shift = (n: number) =>
    setMonth(({ y, m }) => ({
      y: m + n < 0 ? y - 1 : m + n > 11 ? y + 1 : y,
      m: (m + n + 12) % 12,
    }));
  const monthEvents = (events.data ?? []).filter(
    (e) => new Date(e.startsAt).getMonth() === month.m,
  );

  return (
    <div className="rf-prod">
      <section className="rf-card rf-prod__calendar" aria-label="Calendario">
        <div className="rf-prod__month">
          <Button size="sm" variant="ghost" aria-label="Mes anterior" onClick={() => shift(-1)}>
            ‹
          </Button>
          <h2 className="rf-form__title">{fmtMonth.format(new Date(month.y, month.m, 1))}</h2>
          <Button size="sm" variant="ghost" aria-label="Mes siguiente" onClick={() => shift(1)}>
            ›
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setMonth({ y: today.getFullYear(), m: today.getMonth() })}
          >
            Hoy
          </Button>
          {canManage && (
            <Button size="sm" variant="primary" onClick={() => setCreating(dayKey(today))}>
              Nueva convocatoria
            </Button>
          )}
        </div>
        <div className="rf-prod__grid" role="grid" aria-label="Días del mes">
          {WEEKDAYS.map((d) => (
            <div key={d} className="rf-prod__weekday" role="columnheader">
              {d}
            </div>
          ))}
          {days.map((d) => {
            const k = dayKey(d);
            const list = byDay.get(k) ?? [];
            return (
              <div
                key={k}
                role="gridcell"
                className={[
                  'rf-prod__day',
                  d.getMonth() !== month.m && 'is-out',
                  k === dayKey(today) && 'is-today',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onDoubleClick={() => canManage && setCreating(k)}
              >
                <span className="rf-prod__daynum">{d.getDate()}</span>
                {list.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    className={`rf-prod__chip rf-prod__chip--${e.kind}${
                      e.status === 'cancelado' ? ' is-cancelled' : ''
                    }${selected === e.id ? ' is-selected' : ''}`}
                    onClick={() => setSelected(e.id)}
                    title={e.title}
                  >
                    {fmtTime.format(new Date(e.startsAt))} {e.title}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
        <h3 className="rf-small">Este mes</h3>
        {events.isPending ? (
          <Spinner label="Cargando…" />
        ) : monthEvents.length === 0 ? (
          <p className="rf-muted rf-small">Sin convocatorias.</p>
        ) : (
          <ul className="rf-sidelist__items">
            {monthEvents.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  className={`rf-sources__pick${selected === e.id ? ' is-active' : ''}`}
                  onClick={() => setSelected(e.id)}
                >
                  <strong>{e.title}</strong>{' '}
                  <span className="rf-muted rf-small">
                    {fmtDateTime.format(new Date(e.startsAt))} · {e.crewConfirmed}/{e.crewTotal}{' '}
                    confirmados
                    {e.crewDeclined > 0 && ` · ${e.crewDeclined} no pueden`}
                    {e.logisticsPending > 0 && ` · ${e.logisticsPending} pendientes`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="rf-prod__detail" aria-label="Convocatoria">
        {selected ? (
          <EventDetail id={selected} onDeleted={() => setSelected(null)} onOpen={setSelected} />
        ) : (
          <div className="rf-card rf-empty">
            Elige una convocatoria del calendario
            {canManage && ' o haz doble clic en un día para crear una'}.
          </div>
        )}
      </section>
      {creating && (
        <EventDialog
          initial={{ startsAt: `${creating}T10:00` }}
          onClose={() => setCreating(null)}
          onSaved={(d) => {
            setCreating(null);
            setSelected(d.event.id);
          }}
        />
      )}
    </div>
  );
}

/* ---------- Alta / edición de convocatoria ---------- */

function EventDialog({
  initial,
  event,
  onClose,
  onSaved,
}: {
  initial?: { startsAt: string };
  event?: ProductionEventDto;
  onClose: () => void;
  onSaved: (d: ProductionEventDetail) => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    title: event?.title ?? '',
    kind: event?.kind ?? 'grabacion',
    status: event?.status ?? 'previsto',
    startsAt: event ? toLocalInput(event.startsAt) : (initial?.startsAt ?? ''),
    endsAt: toLocalInput(event?.endsAt),
    location: event?.location ?? '',
    notes: event?.notes ?? '',
    programId: event?.programId ?? '',
    rundownId: event?.rundownId ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const programs = useQuery({
    queryKey: ['programs'],
    queryFn: async () => (await api.get<{ programs: ProgramDto[] }>('/api/programs')).programs,
  });
  const day = form.startsAt.slice(0, 10);
  const rundowns = useQuery({
    queryKey: ['rundowns', day, day, ''],
    queryFn: async () =>
      (
        await api.get<{ rundowns: RundownDto[] }>(
          `/api/rundowns?${new URLSearchParams({ from: day, to: day })}`,
        )
      ).rundowns,
    enabled: /^\d{4}-\d{2}-\d{2}$/.test(day),
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm({ ...form, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const body = {
      ...form,
      startsAt: fromLocalInput(form.startsAt),
      endsAt: fromLocalInput(form.endsAt),
      programId: form.programId || null,
      rundownId: form.rundownId || null,
    };
    try {
      const d = event
        ? await api.patch<ProductionEventDetail>(`/api/production/events/${event.id}`, body)
        : await api.post<ProductionEventDetail>('/api/production/events', body);
      void qc.invalidateQueries({ queryKey: eventsKey });
      qc.setQueryData([...eventsKey, 'detail', d.event.id], d);
      onSaved(d);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <Dialog
      open
      title={event ? 'Editar convocatoria' : 'Nueva convocatoria'}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="rf-event-form" variant="primary">
            Guardar
          </Button>
        </>
      }
    >
      <form id="rf-event-form" className="rf-form rf-prod__form" onSubmit={submit}>
        {error && <Alert tone="error">{error}</Alert>}
        <TextField label="Título" value={form.title} onChange={set('title')} required autoFocus />
        <div className="rf-form__row">
          <SelectField
            label="Tipo"
            value={form.kind}
            onChange={set('kind')}
            options={EVENT_KINDS.map((k) => ({ value: k.value, label: k.label }))}
          />
          <SelectField
            label="Estado"
            value={form.status}
            onChange={set('status')}
            options={EVENT_STATUSES.map((k) => ({ value: k.value, label: k.label }))}
          />
        </div>
        <div className="rf-form__row">
          <TextField
            label="Empieza"
            type="datetime-local"
            value={form.startsAt}
            onChange={set('startsAt')}
            required
          />
          <TextField
            label="Acaba"
            type="datetime-local"
            value={form.endsAt}
            onChange={set('endsAt')}
          />
        </div>
        <TextField label="Lugar" value={form.location} onChange={set('location')} />
        <div className="rf-form__row">
          <SelectField
            label="Programa"
            value={form.programId}
            onChange={set('programId')}
            options={[
              { value: '', label: '—' },
              ...(programs.data ?? []).map((p) => ({ value: p.id, label: p.name })),
            ]}
          />
          <SelectField
            label="Escaleta de ese día"
            value={form.rundownId}
            onChange={set('rundownId')}
            options={[
              { value: '', label: '—' },
              ...(rundowns.data ?? []).map((r) => ({ value: r.id, label: r.title })),
            ]}
          />
        </div>
        <label className="rf-field">
          <span className="rf-field__label">Notas para el equipo</span>
          <textarea
            className="rf-input rf-textarea"
            rows={4}
            value={form.notes}
            onChange={set('notes')}
            maxLength={4000}
          />
        </label>
      </form>
    </Dialog>
  );
}

/* ---------- Detalle ---------- */

function EventDetail({
  id,
  onDeleted,
  onOpen,
}: {
  id: string;
  onDeleted: () => void;
  onOpen: (id: string) => void;
}) {
  const qc = useQueryClient();
  const canManage = useCan('production.manage');
  const key = [...eventsKey, 'detail', id];
  const detail = useQuery({
    queryKey: key,
    queryFn: () => api.get<ProductionEventDetail>(`/api/production/events/${id}`),
    refetchInterval: REFRESH,
  });
  const [tab, setTab] = useState<'calls' | 'guests' | 'logistics' | 'budget'>('calls');
  const canBudget = useCan('budget.view');
  const [editing, setEditing] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  /** Cambios: el servidor devuelve el detalle completo actualizado. */
  const run = async (fn: () => Promise<ProductionEventDetail>) => {
    setNotice(null);
    try {
      qc.setQueryData(key, await fn());
      void qc.invalidateQueries({ queryKey: eventsKey, exact: false });
      return true;
    } catch (err) {
      setNotice({ tone: 'error', text: errorMessage(err) });
      return false;
    }
  };

  if (detail.isPending) return <Spinner label="Cargando…" />;
  if (detail.isError) return <Alert tone="error">{errorMessage(detail.error)}</Alert>;
  const { event, calls, guests, logistics } = detail.data;
  const start = new Date(event.startsAt);

  return (
    <div className="rf-card rf-prod__event">
      <header className="rf-prod__eventhead">
        <div>
          <h2 className="rf-form__title">{event.title}</h2>
          <p className="rf-muted rf-small">
            {fmtDay.format(start)} · {fmtTime.format(start)}
            {event.endsAt && `–${fmtTime.format(new Date(event.endsAt))}`}
            {event.location && ` · ${event.location}`}
          </p>
          <p>
            <Badge tone="accent">{labelOf(EVENT_KINDS, event.kind)}</Badge>{' '}
            <Badge tone={statusTone(event.status)}>{labelOf(EVENT_STATUSES, event.status)}</Badge>{' '}
            {event.programName && <Badge>{event.programName}</Badge>}{' '}
            {event.rundownId && (
              <Link className="rf-link" to={`/escaletas/${event.rundownId}`}>
                Escaleta: {event.rundownTitle}
              </Link>
            )}
          </p>
        </div>
        <div className="rf-form__actions">
          <a
            className="rf-btn rf-btn--sm rf-btn--ghost"
            href={`/produccion/${event.id}/hoja`}
            target="_blank"
            rel="noreferrer"
          >
            Hoja de llamada
          </a>
          {canManage && (
            <>
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                Editar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDuplicating(true)}>
                Duplicar
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  if (!window.confirm(`¿Borrar «${event.title}»?`)) return;
                  await api.delete(`/api/production/events/${event.id}`).catch(() => undefined);
                  void qc.invalidateQueries({ queryKey: eventsKey });
                  onDeleted();
                }}
              >
                Borrar
              </Button>
            </>
          )}
        </div>
      </header>
      {event.notes && <p className="rf-prod__notes">{event.notes}</p>}
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}

      <div className="rf-tabs" role="tablist" aria-label="Detalle">
        {(
          [
            ['calls', `Equipo (${event.crewConfirmed}/${calls.length})`],
            ['guests', `Invitados (${guests.length})`],
            ['logistics', `Logística (${logistics.filter((l) => !l.done).length} pend.)`],
            ...(canBudget ? ([['budget', 'Presupuesto']] as const) : []),
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            className={`rf-tabs__tab${tab === k ? ' is-active' : ''}`}
            onClick={() => setTab(k)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'calls' && (
        <CallsTab
          eventId={event.id}
          eventTitle={event.title}
          calls={calls}
          canManage={canManage}
          run={run}
          onCopied={(text) => setNotice({ tone: 'success', text })}
        />
      )}
      {tab === 'guests' && (
        <GuestsTab eventId={event.id} guests={guests} canManage={canManage} run={run} />
      )}
      {tab === 'logistics' && (
        <LogisticsTab eventId={event.id} items={logistics} canManage={canManage} run={run} />
      )}
      {tab === 'budget' && <BudgetPanel eventId={event.id} />}

      {editing && (
        <EventDialog
          event={event}
          onClose={() => setEditing(false)}
          onSaved={() => setEditing(false)}
        />
      )}
      {duplicating && (
        <DuplicateDialog
          event={event}
          onClose={() => setDuplicating(false)}
          onDone={(d) => {
            setDuplicating(false);
            void qc.invalidateQueries({ queryKey: eventsKey });
            onOpen(d.event.id);
          }}
        />
      )}
    </div>
  );
}

function DuplicateDialog({
  event,
  onClose,
  onDone,
}: {
  event: ProductionEventDto;
  onClose: () => void;
  onDone: (d: ProductionEventDetail) => void;
}) {
  const week = new Date(new Date(event.startsAt).getTime() + 7 * 86_400_000).toISOString();
  const [startsAt, setStartsAt] = useState(toLocalInput(week));
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog
      open
      title="Duplicar convocatoria"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            onClick={async () => {
              try {
                onDone(
                  await api.post<ProductionEventDetail>(
                    `/api/production/events/${event.id}/duplicate`,
                    { startsAt: fromLocalInput(startsAt) },
                  ),
                );
              } catch (err) {
                setError(errorMessage(err));
              }
            }}
          >
            Duplicar
          </Button>
        </>
      }
    >
      {error && <Alert tone="error">{error}</Alert>}
      <p className="rf-muted rf-small">
        Copia el equipo (pendiente de confirmar) y la logística, con las mismas horas relativas.
      </p>
      <TextField
        label="Nueva fecha y hora"
        type="datetime-local"
        value={startsAt}
        onChange={(e) => setStartsAt(e.target.value)}
      />
    </Dialog>
  );
}

type Run = (fn: () => Promise<ProductionEventDetail>) => Promise<boolean>;

/** Enlace de confirmación para enviar por WhatsApp o email. */
const callLink = (c: CallDto) => `${window.location.origin}/convocatoria/${c.token}`;
const callMessage = (c: CallDto, title: string) =>
  `Hola ${c.name}: convocatoria «${title}»${
    c.callAt ? ` (citación ${fmtDateTime.format(new Date(c.callAt))})` : ''
  }. Confirma aquí: ${callLink(c)}`;

function CallsTab({
  eventId,
  eventTitle,
  calls,
  canManage,
  run,
  onCopied,
}: {
  eventId: string;
  eventTitle: string;
  calls: CallDto[];
  canManage: boolean;
  run: Run;
  onCopied: (text: string) => void;
}) {
  const crew = useQuery({
    queryKey: crewKey,
    queryFn: async () => (await api.get<{ crew: CrewDto[] }>('/api/production/crew')).crew,
    enabled: canManage,
  });
  const [add, setAdd] = useState({ crewId: '', callAt: '' });
  const free = (crew.data ?? []).filter((c) => c.active && !calls.some((x) => x.crewId === c.id));

  return (
    <>
      {calls.length === 0 ? (
        <p className="rf-muted rf-small">Nadie convocado todavía.</p>
      ) : (
        <div className="rf-table-wrap">
          <table className="rf-table rf-prod__table">
            <thead>
              <tr>
                <th>Persona</th>
                <th>Puesto</th>
                <th>Citación</th>
                <th>Estado</th>
                <th>Respuesta</th>
                {canManage && <th aria-label="Acciones" />}
              </tr>
            </thead>
            <tbody>
              {calls.map((c) => (
                <tr key={c.id}>
                  <td>
                    <strong>{c.name}</strong>
                    {c.phone && <div className="rf-muted rf-small">{c.phone}</div>}
                  </td>
                  <td>
                    {canManage ? (
                      <input
                        className="rf-input rf-input--sm"
                        aria-label={`Puesto de ${c.name}`}
                        defaultValue={c.role}
                        onBlur={(e) =>
                          e.target.value !== c.role &&
                          void run(() =>
                            api.patch(`/api/production/calls/${c.id}`, { role: e.target.value }),
                          )
                        }
                      />
                    ) : (
                      c.role
                    )}
                  </td>
                  <td>
                    {canManage ? (
                      <input
                        type="datetime-local"
                        className="rf-input rf-input--sm"
                        aria-label={`Citación de ${c.name}`}
                        defaultValue={toLocalInput(c.callAt)}
                        onBlur={(e) =>
                          e.target.value !== toLocalInput(c.callAt) &&
                          void run(() =>
                            api.patch(`/api/production/calls/${c.id}`, {
                              callAt: fromLocalInput(e.target.value),
                            }),
                          )
                        }
                      />
                    ) : c.callAt ? (
                      fmtDateTime.format(new Date(c.callAt))
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    {canManage ? (
                      <select
                        className="rf-select rf-select--sm"
                        aria-label={`Estado de ${c.name}`}
                        value={c.status}
                        onChange={(e) =>
                          void run(() =>
                            api.patch(`/api/production/calls/${c.id}`, { status: e.target.value }),
                          )
                        }
                      >
                        {CALL_STATUSES.map((s) => (
                          <option key={s.value} value={s.value}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Badge tone={statusTone(c.status)}>{labelOf(CALL_STATUSES, c.status)}</Badge>
                    )}
                  </td>
                  <td className="rf-small">{c.reply || <span className="rf-muted">—</span>}</td>
                  {canManage && (
                    <td className="rf-prod__actions">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          void navigator.clipboard?.writeText(callLink(c));
                          onCopied(`Enlace de ${c.name} copiado.`);
                        }}
                      >
                        Copiar enlace
                      </Button>
                      {c.phone && (
                        <a
                          className="rf-btn rf-btn--sm rf-btn--ghost"
                          href={`https://wa.me/${c.phone.replace(/[^\d]/g, '')}?text=${encodeURIComponent(
                            callMessage(c, eventTitle),
                          )}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          WhatsApp
                        </a>
                      )}
                      {c.email && (
                        <a
                          className="rf-btn rf-btn--sm rf-btn--ghost"
                          href={`mailto:${c.email}?subject=${encodeURIComponent(
                            `Convocatoria: ${eventTitle}`,
                          )}&body=${encodeURIComponent(callMessage(c, eventTitle))}`}
                        >
                          Email
                        </a>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Quitar a ${c.name}`}
                        onClick={() => void run(() => api.delete(`/api/production/calls/${c.id}`))}
                      >
                        Quitar
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canManage && (
        <form
          className="rf-config__inline"
          aria-label="Convocar"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!add.crewId) return;
            const ok = await run(() =>
              api.post(`/api/production/events/${eventId}/calls`, {
                crewId: add.crewId,
                callAt: fromLocalInput(add.callAt),
              }),
            );
            if (ok) setAdd({ crewId: '', callAt: add.callAt });
          }}
        >
          <SelectField
            label="Convocar a"
            value={add.crewId}
            onChange={(e) => setAdd({ ...add, crewId: e.target.value })}
            options={[
              { value: '', label: free.length ? 'Elige…' : 'Añade personas en «Personal»' },
              ...free.map((c) => ({
                value: c.id,
                label: c.role ? `${c.name} · ${c.role}` : c.name,
              })),
            ]}
          />
          <TextField
            label="Citación"
            type="datetime-local"
            value={add.callAt}
            onChange={(e) => setAdd({ ...add, callAt: e.target.value })}
          />
          <Button type="submit" size="sm" disabled={!add.crewId}>
            Convocar
          </Button>
        </form>
      )}
    </>
  );
}

function GuestsTab({
  eventId,
  guests,
  canManage,
  run,
}: {
  eventId: string;
  guests: GuestDto[];
  canManage: boolean;
  run: Run;
}) {
  const empty = { name: '', description: '', phone: '', arrivalAt: '', makeupAt: '', setAt: '' };
  const [form, setForm] = useState(empty);
  const time = (iso: string | null) => (iso ? fmtTime.format(new Date(iso)) : '—');
  return (
    <>
      {guests.length === 0 ? (
        <p className="rf-muted rf-small">Sin invitados.</p>
      ) : (
        <div className="rf-table-wrap">
          <table className="rf-table rf-prod__table">
            <thead>
              <tr>
                <th>Invitado</th>
                <th>Teléfono</th>
                <th>Llegada</th>
                <th>Maquillaje</th>
                <th>Set</th>
                <th>Estado</th>
                {canManage && <th aria-label="Acciones" />}
              </tr>
            </thead>
            <tbody>
              {guests.map((g) => (
                <tr key={g.id}>
                  <td>
                    <strong>{g.name}</strong>
                    {g.description && <div className="rf-muted rf-small">{g.description}</div>}
                  </td>
                  <td>{g.phone ? <a href={`tel:${g.phone}`}>{g.phone}</a> : '—'}</td>
                  <td>{time(g.arrivalAt)}</td>
                  <td>{time(g.makeupAt)}</td>
                  <td>{time(g.setAt)}</td>
                  <td>
                    {canManage ? (
                      <select
                        className="rf-select rf-select--sm"
                        aria-label={`Estado de ${g.name}`}
                        value={g.status}
                        onChange={(e) =>
                          void run(() =>
                            api.patch(`/api/production/guests/${g.id}`, { status: e.target.value }),
                          )
                        }
                      >
                        {GUEST_STATUSES.map((s) => (
                          <option key={s.value} value={s.value}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Badge tone={statusTone(g.status)}>{labelOf(GUEST_STATUSES, g.status)}</Badge>
                    )}
                  </td>
                  {canManage && (
                    <td>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Quitar a ${g.name}`}
                        onClick={() => void run(() => api.delete(`/api/production/guests/${g.id}`))}
                      >
                        Quitar
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canManage && (
        <form
          className="rf-config__inline rf-prod__add"
          aria-label="Nuevo invitado"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await run(() =>
              api.post(`/api/production/events/${eventId}/guests`, {
                ...form,
                arrivalAt: fromLocalInput(form.arrivalAt),
                makeupAt: fromLocalInput(form.makeupAt),
                setAt: fromLocalInput(form.setAt),
              }),
            );
            if (ok) setForm(empty);
          }}
        >
          <TextField
            label="Invitado"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
          <TextField
            label="Cargo o motivo"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
          <TextField
            label="Teléfono"
            type="tel"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
          <TextField
            label="Llegada"
            type="datetime-local"
            value={form.arrivalAt}
            onChange={(e) => setForm({ ...form, arrivalAt: e.target.value })}
          />
          <TextField
            label="Maquillaje"
            type="datetime-local"
            value={form.makeupAt}
            onChange={(e) => setForm({ ...form, makeupAt: e.target.value })}
          />
          <TextField
            label="Set"
            type="datetime-local"
            value={form.setAt}
            onChange={(e) => setForm({ ...form, setAt: e.target.value })}
          />
          <Button type="submit" size="sm" disabled={!form.name.trim()}>
            Añadir invitado
          </Button>
        </form>
      )}
    </>
  );
}

function LogisticsTab({
  eventId,
  items,
  canManage,
  run,
}: {
  eventId: string;
  items: ProductionEventDetail['logistics'];
  canManage: boolean;
  run: Run;
}) {
  const empty = {
    category: 'transporte' as LogisticsCategory,
    description: '',
    provider: '',
    at: '',
    assignee: '',
  };
  const [form, setForm] = useState(empty);
  return (
    <>
      {items.length === 0 ? (
        <p className="rf-muted rf-small">Sin tareas de logística.</p>
      ) : (
        <ul className="rf-prod__logistics">
          {items.map((l) => (
            <li key={l.id} className={l.done ? 'is-done' : undefined}>
              <label className="rf-check">
                <input
                  type="checkbox"
                  checked={l.done}
                  disabled={!canManage}
                  onChange={() =>
                    void run(() =>
                      api.patch(`/api/production/logistics/${l.id}`, { done: !l.done }),
                    )
                  }
                />
                <span>
                  <Badge>{labelOf(LOGISTICS_CATEGORIES, l.category)}</Badge> {l.description}
                </span>
              </label>
              <span className="rf-muted rf-small">
                {[
                  l.provider,
                  l.at && fmtDateTime.format(new Date(l.at)),
                  l.assignee && `→ ${l.assignee}`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              {canManage && (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Quitar ${l.description}`}
                  onClick={() => void run(() => api.delete(`/api/production/logistics/${l.id}`))}
                >
                  Quitar
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <form
          className="rf-config__inline rf-prod__add"
          aria-label="Nueva tarea de logística"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await run(() =>
              api.post(`/api/production/events/${eventId}/logistics`, {
                ...form,
                at: fromLocalInput(form.at),
              }),
            );
            if (ok) setForm({ ...empty, category: form.category });
          }}
        >
          <SelectField
            label="Categoría"
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value as LogisticsCategory })}
            options={LOGISTICS_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))}
          />
          <TextField
            label="Qué hace falta"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            required
          />
          <TextField
            label="Proveedor"
            value={form.provider}
            onChange={(e) => setForm({ ...form, provider: e.target.value })}
          />
          <TextField
            label="Cuándo"
            type="datetime-local"
            value={form.at}
            onChange={(e) => setForm({ ...form, at: e.target.value })}
          />
          <TextField
            label="Responsable"
            value={form.assignee}
            onChange={(e) => setForm({ ...form, assignee: e.target.value })}
          />
          <Button type="submit" size="sm" disabled={!form.description.trim()}>
            Añadir
          </Button>
        </form>
      )}
    </>
  );
}

/* ---------- Personal ---------- */

function CrewDirectory() {
  const qc = useQueryClient();
  const canManage = useCan('production.manage');
  const crew = useQuery({
    queryKey: crewKey,
    queryFn: async () => (await api.get<{ crew: CrewDto[] }>('/api/production/crew')).crew,
  });
  const empty = { name: '', role: '', phone: '', email: '' };
  const [form, setForm] = useState(empty);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: crewKey });
  const patch = async (id: string, body: Partial<CrewDto>) => {
    setError(null);
    await api
      .patch(`/api/production/crew/${id}`, body)
      .catch((e: unknown) => setError(errorMessage(e)));
    refresh();
  };

  return (
    <section className="rf-card" aria-label="Personal">
      <p className="rf-muted rf-small">
        Directorio del equipo técnico y artístico (con o sin cuenta en RunFlow) para las hojas de
        llamada.
      </p>
      {error && <Alert tone="error">{error}</Alert>}
      {crew.isPending ? (
        <Spinner label="Cargando…" />
      ) : (
        <div className="rf-table-wrap">
          <table className="rf-table rf-prod__table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Puesto</th>
                <th>Teléfono</th>
                <th>Email</th>
                <th>Activo</th>
                {canManage && <th aria-label="Acciones" />}
              </tr>
            </thead>
            <tbody>
              {(crew.data ?? []).map((c) => (
                <tr key={c.id} className={c.active ? undefined : 'is-muted'}>
                  {(['name', 'role', 'phone', 'email'] as const).map((k) => (
                    <td key={k}>
                      {canManage ? (
                        <input
                          className="rf-input rf-input--sm"
                          aria-label={`${k} de ${c.name}`}
                          defaultValue={c[k]}
                          onBlur={(e) =>
                            e.target.value !== c[k] && void patch(c.id, { [k]: e.target.value })
                          }
                        />
                      ) : (
                        c[k]
                      )}
                    </td>
                  ))}
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`${c.name} activo`}
                      checked={c.active}
                      disabled={!canManage}
                      onChange={() => void patch(c.id, { active: !c.active })}
                    />
                  </td>
                  {canManage && (
                    <td>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          if (!window.confirm(`¿Borrar a ${c.name} y sus convocatorias?`)) return;
                          await api.delete(`/api/production/crew/${c.id}`).catch(() => undefined);
                          refresh();
                        }}
                      >
                        Borrar
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canManage && (
        <form
          className="rf-config__inline rf-prod__add"
          aria-label="Nueva persona"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            try {
              await api.post('/api/production/crew', form);
              setForm(empty);
              refresh();
            } catch (err) {
              setError(errorMessage(err));
            }
          }}
        >
          <TextField
            label="Nombre"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
          <TextField
            label="Puesto"
            value={form.role}
            placeholder="Cámara, sonido, realización…"
            onChange={(e) => setForm({ ...form, role: e.target.value })}
          />
          <TextField
            label="Teléfono"
            type="tel"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
          <TextField
            label="Email"
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <Button type="submit" size="sm" disabled={!form.name.trim()}>
            Añadir persona
          </Button>
        </form>
      )}
    </section>
  );
}
