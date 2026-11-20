import { useMemo, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import {
  createProgramInput,
  createRundownInput,
  formatDuration,
  parseClock,
  PROGRAM_TYPES,
  RUNDOWN_STATUSES,
  type ProgramDto,
  type RundownDto,
  type TemplateDto,
} from '@runflow/core';
import { Alert, Badge, Button, Dialog, SelectField, Spinner, TextField } from '@runflow/ui';
import { api, errorMessage } from '../api/client';
import { useCan } from '../auth/session';
import { PageHeader } from '../components/PageHeader';
import { locale, t } from '../i18n';
import { useFormState, validate } from '../lib/forms';

export const programsKey = ['programs'] as const;
export const rundownsKey = ['rundowns'] as const;

export function usePrograms() {
  return useQuery({
    queryKey: programsKey,
    queryFn: async () => (await api.get<{ programs: ProgramDto[] }>('/api/programs')).programs,
  });
}

function isoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function monthRange(year: number, month: number) {
  return { from: isoDate(new Date(year, month, 1)), to: isoDate(new Date(year, month + 1, 0)) };
}

/** Duración prevista entre inicio y fin (si fin < inicio, cruza medianoche). */
export function plannedSeconds(start: string, end: string): number {
  const s = parseClock(start) ?? 0;
  const e = parseClock(end) ?? 0;
  return e > s ? e - s : e + 86400 - s;
}

export function statusLabel(status: string): string {
  return RUNDOWN_STATUSES.find((s) => s.value === status)?.label ?? status;
}

export function RundownsPage() {
  const navigate = useNavigate();
  const canCreate = useCan('rundown.edit_structure');
  const canConfigure = useCan('program.configure');
  const now = new Date();
  const [month, setMonth] = useState({ year: now.getFullYear(), month: now.getMonth() });
  const [programId, setProgramId] = useState('');
  const [dialog, setDialog] = useState<'new' | 'programs' | null>(null);
  const range = monthRange(month.year, month.month);
  const programs = usePrograms();

  const rundowns = useQuery({
    queryKey: [...rundownsKey, range.from, range.to, programId],
    queryFn: async () => {
      const qs = new URLSearchParams({ from: range.from, to: range.to });
      if (programId) qs.set('programId', programId);
      return (await api.get<{ rundowns: RundownDto[] }>(`/api/rundowns?${qs}`)).rundowns;
    },
  });

  const monthLabel = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(
    new Date(month.year, month.month, 1),
  );
  const shift = (delta: number) =>
    setMonth(({ year, month: m }) => {
      const d = new Date(year, m + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  const dayFormat = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

  return (
    <>
      <PageHeader
        number="04"
        title={t('rundowns.title')}
        intro={t('rundowns.intro')}
        actions={
          <>
            {canConfigure && (
              <Button onClick={() => setDialog('programs')}>{t('rundowns.programs')}</Button>
            )}
            {canCreate && (
              <Button variant="primary" onClick={() => setDialog('new')}>
                + {t('rundowns.new')}
              </Button>
            )}
          </>
        }
      />

      <div className="rf-filters">
        <div className="rf-month">
          <Button
            size="sm"
            variant="ghost"
            aria-label={t('rundowns.prevMonth')}
            onClick={() => shift(-1)}
          >
            ‹
          </Button>
          <span className="rf-month__label">{monthLabel}</span>
          <Button
            size="sm"
            variant="ghost"
            aria-label={t('rundowns.nextMonth')}
            onClick={() => shift(1)}
          >
            ›
          </Button>
          <Button
            size="sm"
            onClick={() => setMonth({ year: now.getFullYear(), month: now.getMonth() })}
          >
            {t('rundowns.today')}
          </Button>
        </div>
        <select
          className="rf-select rf-filters__program"
          aria-label={t('rundowns.field.program')}
          value={programId}
          onChange={(e) => setProgramId(e.target.value)}
        >
          <option value="">{t('rundowns.allPrograms')}</option>
          {(programs.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {programs.data?.length === 0 && (
        <div className="rf-notice">
          <Alert tone="info">{t('rundowns.noPrograms')}</Alert>
        </div>
      )}

      {rundowns.isPending ? (
        <div className="rf-center">
          <Spinner label={t('common.loading')} />
        </div>
      ) : rundowns.isError ? (
        <Alert tone="error">{errorMessage(rundowns.error)}</Alert>
      ) : rundowns.data.length === 0 ? (
        <div className="rf-card rf-empty">{t('rundowns.empty')}</div>
      ) : (
        <div className="rf-table-wrap">
          <table className="rf-table rf-rundowns-table">
            <thead>
              <tr>
                <th>{t('rundowns.col.date')}</th>
                <th>{t('rundowns.col.time')}</th>
                <th>{t('rundowns.col.title')}</th>
                <th>{t('rundowns.col.lines')}</th>
                <th>{t('rundowns.col.duration')}</th>
                <th>{t('rundowns.col.status')}</th>
              </tr>
            </thead>
            <tbody>
              {rundowns.data.map((r) => {
                const planned = plannedSeconds(r.startTime, r.endTime);
                const over = r.estimatedSeconds > planned;
                return (
                  <tr
                    key={r.id}
                    className="rf-clickable"
                    onClick={() => navigate(`/escaletas/${r.id}`)}
                  >
                    <td className="rf-nowrap">
                      {dayFormat.format(new Date(`${r.airDate}T12:00:00`))}
                    </td>
                    <td className="rf-tabular rf-nowrap">
                      {r.startTime.slice(0, 5)}–{r.endTime.slice(0, 5)}
                    </td>
                    <td>
                      <a
                        href={`/escaletas/${r.id}`}
                        className="rf-link-strong"
                        onClick={(e) => {
                          e.preventDefault();
                          navigate(`/escaletas/${r.id}`);
                        }}
                      >
                        {r.title}
                      </a>
                      {r.title !== r.programName && (
                        <div className="rf-muted rf-small">{r.programName}</div>
                      )}
                    </td>
                    <td className="rf-tabular">{r.lineCount}</td>
                    <td className="rf-tabular rf-nowrap">
                      <span className={over ? 'rf-text-danger' : undefined}>
                        {formatDuration(r.estimatedSeconds)}
                      </span>{' '}
                      / {formatDuration(planned)}
                    </td>
                    <td>
                      <Badge
                        tone={
                          r.status === 'en_aire'
                            ? 'accent'
                            : r.status === 'lista'
                              ? 'success'
                              : 'default'
                        }
                      >
                        {statusLabel(r.status)}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {dialog === 'new' && (
        <NewRundownDialog
          programs={(programs.data ?? []).filter((p) => !p.archived)}
          defaultDate={isoDate(new Date())}
          onClose={() => setDialog(null)}
          onCreated={(r) => navigate(`/escaletas/${r.id}`)}
          onManagePrograms={canConfigure ? () => setDialog('programs') : undefined}
        />
      )}
      {dialog === 'programs' && (
        <ProgramsDialog programs={programs.data ?? []} onClose={() => setDialog(null)} />
      )}
    </>
  );
}

function addMinutes(clock: string, minutes: number): string {
  const s = ((parseClock(clock) ?? 0) + minutes * 60) % 86400;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}`;
}

function NewRundownDialog({
  programs,
  defaultDate,
  onClose,
  onCreated,
  onManagePrograms,
}: {
  programs: ProgramDto[];
  defaultDate: string;
  onClose: () => void;
  onCreated: (r: RundownDto) => void;
  onManagePrograms?: () => void;
}) {
  const qc = useQueryClient();
  const first = programs[0];
  const defaults = (p: ProgramDto | undefined) => {
    const start = p?.defaultStartTime?.slice(0, 5) ?? '14:00';
    return { startTime: start, endTime: addMinutes(start, p?.defaultDurationMin ?? 60) };
  };
  const templates = useQuery({
    queryKey: ['templates'],
    queryFn: async () => (await api.get<{ templates: TemplateDto[] }>('/api/templates')).templates,
  });
  const [values, setValues] = useState({
    programId: first?.id ?? '',
    templateId: '',
    title: '',
    airDate: defaultDate,
    ...defaults(first),
  });
  const form = useFormState();
  const set = (key: keyof typeof values) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const { data, errors } = validate(createRundownInput, {
      ...values,
      templateId: values.templateId || undefined,
    });
    if (!data) return form.setFieldErrors(errors);
    const res = await form.submit(() => api.post<{ rundown: RundownDto }>('/api/rundowns', data));
    if (res) {
      void qc.invalidateQueries({ queryKey: rundownsKey });
      onCreated(res.rundown);
    }
  }

  return (
    <Dialog
      open
      title={t('rundowns.new')}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="new-rundown"
            loading={form.submitting}
            disabled={programs.length === 0}
          >
            {t('common.create')}
          </Button>
        </>
      }
    >
      {programs.length === 0 ? (
        <>
          <Alert tone="info">{t('rundowns.noPrograms')}</Alert>
          {onManagePrograms && (
            <div>
              <Button onClick={onManagePrograms}>{t('programs.new')}</Button>
            </div>
          )}
        </>
      ) : (
        <form id="new-rundown" className="rf-form" onSubmit={onSubmit} noValidate>
          {form.formError && <Alert tone="error">{form.formError}</Alert>}
          <SelectField
            label={t('rundowns.field.program')}
            value={values.programId}
            options={programs.map((p) => ({ value: p.id, label: p.name }))}
            error={form.fieldErrors.programId}
            onChange={(e) => {
              const p = programs.find((x) => x.id === e.target.value);
              setValues((v) => ({ ...v, programId: e.target.value, ...defaults(p) }));
            }}
          />
          {(templates.data?.length ?? 0) > 0 && (
            <SelectField
              label="Plantilla"
              value={values.templateId}
              onChange={set('templateId')}
              options={[
                { value: '', label: 'Escaleta vacía' },
                ...(templates.data ?? []).map((tp) => ({
                  value: tp.id,
                  label: `${tp.name} (${tp.lineCount} líneas)`,
                })),
              ]}
              error={form.fieldErrors.templateId}
            />
          )}
          <TextField
            label={t('rundowns.field.title')}
            value={values.title}
            onChange={set('title')}
            hint={t('rundowns.field.titleHint')}
            error={form.fieldErrors.title}
          />
          <TextField
            label={t('rundowns.field.date')}
            type="date"
            value={values.airDate}
            onChange={set('airDate')}
            error={form.fieldErrors.airDate}
          />
          <div className="rf-form__row">
            <TextField
              label={t('rundowns.field.start')}
              type="time"
              value={values.startTime}
              onChange={set('startTime')}
              error={form.fieldErrors.startTime}
            />
            <TextField
              label={t('rundowns.field.end')}
              type="time"
              value={values.endTime}
              onChange={set('endTime')}
              error={form.fieldErrors.endTime}
            />
          </div>
        </form>
      )}
    </Dialog>
  );
}

function ProgramsDialog({ programs, onClose }: { programs: ProgramDto[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [values, setValues] = useState({
    name: '',
    type: 'informativo',
    defaultStartTime: '',
    defaultDurationMin: '',
  });
  const form = useFormState();
  const toggle = useFormState();
  const sorted = useMemo(
    () =>
      [...programs].sort(
        (a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name),
      ),
    [programs],
  );
  const set = (key: keyof typeof values) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const input = {
      name: values.name,
      type: values.type,
      defaultStartTime: values.defaultStartTime || null,
      defaultDurationMin: values.defaultDurationMin ? Number(values.defaultDurationMin) : null,
    };
    const { data, errors } = validate(createProgramInput, input);
    if (!data) return form.setFieldErrors(errors);
    const res = await form.submit(() => api.post('/api/programs', data));
    if (res) {
      setValues({ name: '', type: values.type, defaultStartTime: '', defaultDurationMin: '' });
      void qc.invalidateQueries({ queryKey: programsKey });
    }
  }

  return (
    <Dialog open title={t('programs.title')} onClose={onClose}>
      <p className="rf-muted">{t('programs.intro')}</p>
      {toggle.formError && <Alert tone="error">{toggle.formError}</Alert>}
      {sorted.length === 0 ? (
        <p className="rf-muted">{t('programs.empty')}</p>
      ) : (
        <ul className="rf-program-list">
          {sorted.map((p) => (
            <li key={p.id} className={p.archived ? 'is-archived' : undefined}>
              <span>
                <strong>{p.name}</strong>{' '}
                <span className="rf-muted rf-small">
                  {PROGRAM_TYPES.find((x) => x.value === p.type)?.label}
                  {p.defaultStartTime && ` · ${p.defaultStartTime.slice(0, 5)}`}
                  {p.defaultDurationMin && ` · ${p.defaultDurationMin} min`}
                </span>{' '}
                {p.archived && <Badge tone="muted">{t('programs.archived')}</Badge>}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  const r = await toggle.submit(() =>
                    api.patch(`/api/programs/${p.id}`, { archived: !p.archived }),
                  );
                  if (r) void qc.invalidateQueries({ queryKey: programsKey });
                }}
              >
                {p.archived ? t('programs.unarchive') : t('programs.archive')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form className="rf-form rf-form--boxed" onSubmit={onSubmit} noValidate>
        <h3 className="rf-form__title">{t('programs.new')}</h3>
        {form.formError && <Alert tone="error">{form.formError}</Alert>}
        <TextField
          label={t('programs.name')}
          value={values.name}
          onChange={set('name')}
          error={form.fieldErrors.name}
        />
        <SelectField
          label={t('programs.type')}
          value={values.type}
          onChange={set('type')}
          options={PROGRAM_TYPES.map((p) => ({ value: p.value, label: p.label }))}
        />
        <div className="rf-form__row">
          <TextField
            label={t('programs.defaultStart')}
            type="time"
            value={values.defaultStartTime}
            onChange={set('defaultStartTime')}
            error={form.fieldErrors.defaultStartTime}
          />
          <TextField
            label={t('programs.defaultDuration')}
            type="number"
            min={1}
            max={1440}
            value={values.defaultDurationMin}
            onChange={set('defaultDurationMin')}
            error={form.fieldErrors.defaultDurationMin}
          />
        </div>
        <div>
          <Button type="submit" variant="primary" loading={form.submitting}>
            {t('common.create')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
