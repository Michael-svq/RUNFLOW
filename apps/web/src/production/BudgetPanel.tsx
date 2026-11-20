import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BUDGET_CATEGORIES,
  labelOf,
  moneyInput,
  parseMoney,
  type BudgetCategory,
  type BudgetLineDto,
  type BudgetSummary,
  type ProgramDto,
} from '@runflow/core';
import { Alert, Button, SelectField, Spinner, TextField } from '@runflow/ui';
import { api, errorMessage } from '../api/client';
import { useCan } from '../auth/session';
import { locale } from '../i18n';

/* F3.2 Presupuesto: partidas, previsto frente a real, por categoría y exportable. */

export const budgetKey = ['budget'];
const money = new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' });
const fmt = (c: number | null) => (c === null ? '—' : money.format(c / 100));
const signed = (c: number) => (c > 0 ? '+' : '') + money.format(c / 100);

export function BudgetPanel({ eventId }: { eventId?: string }) {
  const qc = useQueryClient();
  const canManage = useCan('budget.manage');
  const [filters, setFilters] = useState({ programId: '', from: '', to: '' });
  const params = new URLSearchParams();
  if (eventId) params.set('eventId', eventId);
  else for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
  const qs = params.toString();
  const data = useQuery({
    queryKey: [...budgetKey, qs],
    queryFn: () =>
      api.get<{ lines: BudgetLineDto[]; summary: BudgetSummary }>(`/api/budget/lines?${qs}`),
  });
  const programs = useQuery({
    queryKey: ['programs'],
    queryFn: async () => (await api.get<{ programs: ProgramDto[] }>('/api/programs')).programs,
    enabled: !eventId,
  });
  const [error, setError] = useState<string | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: budgetKey });
  const patch = async (id: string, body: Partial<BudgetLineDto>) => {
    setError(null);
    try {
      await api.patch(`/api/budget/lines/${id}`, body);
    } catch (err) {
      setError(errorMessage(err));
    }
    refresh();
  };
  /** Importe editado a mano: vacío = sin real; inválido = aviso. */
  const saveMoney = (id: string, field: 'plannedCents' | 'actualCents', text: string) => {
    if (!text.trim()) return field === 'actualCents' ? patch(id, { actualCents: null }) : undefined;
    const c = parseMoney(text);
    if (c === null) return setError(`«${text}» no es un importe válido`);
    return patch(id, { [field]: c });
  };

  const empty = {
    category: 'otros' as BudgetCategory,
    concept: '',
    provider: '',
    planned: '',
    actual: '',
    date: '',
  };
  const [form, setForm] = useState(empty);

  return (
    <div className="rf-budget">
      {!eventId && (
        <div className="rf-config__inline" aria-label="Filtros del presupuesto">
          <SelectField
            label="Programa"
            value={filters.programId}
            onChange={(e) => setFilters({ ...filters, programId: e.target.value })}
            options={[
              { value: '', label: 'Todos' },
              ...(programs.data ?? []).map((p) => ({ value: p.id, label: p.name })),
            ]}
          />
          <TextField
            label="Desde"
            type="date"
            value={filters.from}
            onChange={(e) => setFilters({ ...filters, from: e.target.value })}
          />
          <TextField
            label="Hasta"
            type="date"
            value={filters.to}
            onChange={(e) => setFilters({ ...filters, to: e.target.value })}
          />
        </div>
      )}
      {error && <Alert tone="error">{error}</Alert>}
      {data.isPending ? (
        <Spinner label="Cargando…" />
      ) : data.isError ? (
        <Alert tone="error">{errorMessage(data.error)}</Alert>
      ) : (
        <>
          <div className="rf-table-wrap">
            <table className="rf-table rf-budget__summary" aria-label="Resumen por categoría">
              <thead>
                <tr>
                  <th>Categoría</th>
                  <th className="is-num">Previsto</th>
                  <th className="is-num">Real</th>
                  <th className="is-num">Desviación</th>
                  <th className="is-num">Pendiente de pago</th>
                </tr>
              </thead>
              <tbody>
                {data.data.summary.byCategory.map((c) => (
                  <tr key={c.category}>
                    <td>{labelOf(BUDGET_CATEGORIES, c.category)}</td>
                    <td className="is-num">{fmt(c.plannedCents)}</td>
                    <td className="is-num">{fmt(c.actualCents)}</td>
                    <td className={`is-num ${c.deviationCents > 0 ? 'is-over' : ''}`}>
                      {c.plannedWithActualCents || c.actualCents ? signed(c.deviationCents) : '—'}
                    </td>
                    <td className="is-num">{fmt(c.pendingPaymentCents)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th>Total</th>
                  <th className="is-num" data-testid="budget-planned">
                    {fmt(data.data.summary.total.plannedCents)}
                  </th>
                  <th className="is-num" data-testid="budget-actual">
                    {fmt(data.data.summary.total.actualCents)}
                  </th>
                  <th
                    className={`is-num ${data.data.summary.total.deviationCents > 0 ? 'is-over' : ''}`}
                    data-testid="budget-deviation"
                  >
                    {signed(data.data.summary.total.deviationCents)}
                  </th>
                  <th className="is-num">{fmt(data.data.summary.total.pendingPaymentCents)}</th>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="rf-muted rf-small">
            La desviación compara lo gastado con lo previsto solo en las partidas que ya tienen
            importe real.{' '}
            <a className="rf-link" href={`/api/budget/export.csv?${qs}`} download>
              Exportar CSV
            </a>
          </p>

          <div className="rf-table-wrap">
            <table className="rf-table rf-prod__table rf-budget__lines" aria-label="Partidas">
              <thead>
                <tr>
                  {!eventId && <th>Fecha</th>}
                  <th>Categoría</th>
                  <th>Concepto</th>
                  <th>Proveedor</th>
                  {!eventId && <th>Programa / convocatoria</th>}
                  <th className="is-num">Previsto</th>
                  <th className="is-num">Real</th>
                  <th className="is-num">Desv.</th>
                  <th>Pagado</th>
                  {canManage && <th aria-label="Acciones" />}
                </tr>
              </thead>
              <tbody>
                {data.data.lines.map((l) =>
                  canManage ? (
                    <tr key={`${l.id}:${l.plannedCents}:${l.actualCents}:${l.date}`}>
                      {!eventId && (
                        <td>
                          <input
                            type="date"
                            className="rf-input rf-input--sm rf-budget__date"
                            aria-label={`Fecha de ${l.concept}`}
                            defaultValue={l.date ?? ''}
                            onBlur={(e) =>
                              e.target.value !== (l.date ?? '') &&
                              void patch(l.id, { date: e.target.value || null })
                            }
                          />
                        </td>
                      )}
                      <td>
                        <select
                          className="rf-select rf-select--sm"
                          aria-label={`Categoría de ${l.concept}`}
                          value={l.category}
                          onChange={(e) =>
                            void patch(l.id, { category: e.target.value as BudgetCategory })
                          }
                        >
                          {BUDGET_CATEGORIES.map((c) => (
                            <option key={c.value} value={c.value}>
                              {c.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          className="rf-input rf-input--sm"
                          aria-label={`Concepto ${l.concept}`}
                          defaultValue={l.concept}
                          onBlur={(e) =>
                            e.target.value.trim() &&
                            e.target.value !== l.concept &&
                            void patch(l.id, { concept: e.target.value })
                          }
                        />
                      </td>
                      <td>
                        <input
                          className="rf-input rf-input--sm"
                          aria-label={`Proveedor de ${l.concept}`}
                          defaultValue={l.provider}
                          onBlur={(e) =>
                            e.target.value !== l.provider &&
                            void patch(l.id, { provider: e.target.value })
                          }
                        />
                      </td>
                      {!eventId && (
                        <td className="rf-small">
                          {[l.programName, l.eventTitle].filter(Boolean).join(' · ') || '—'}
                        </td>
                      )}
                      <td>
                        <input
                          className="rf-input rf-input--sm rf-budget__money"
                          inputMode="decimal"
                          aria-label={`Previsto de ${l.concept}`}
                          defaultValue={moneyInput(l.plannedCents)}
                          onBlur={(e) =>
                            e.target.value !== moneyInput(l.plannedCents) &&
                            void saveMoney(l.id, 'plannedCents', e.target.value)
                          }
                        />
                      </td>
                      <td>
                        <input
                          className="rf-input rf-input--sm rf-budget__money"
                          inputMode="decimal"
                          aria-label={`Real de ${l.concept}`}
                          defaultValue={moneyInput(l.actualCents)}
                          onBlur={(e) =>
                            e.target.value !== moneyInput(l.actualCents) &&
                            void saveMoney(l.id, 'actualCents', e.target.value)
                          }
                        />
                      </td>
                      <Deviation line={l} />
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`${l.concept} pagado`}
                          checked={l.paid}
                          onChange={() => void patch(l.id, { paid: !l.paid })}
                        />
                      </td>
                      <td>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Quitar ${l.concept}`}
                          onClick={async () => {
                            await api.delete(`/api/budget/lines/${l.id}`).catch(() => undefined);
                            refresh();
                          }}
                        >
                          Quitar
                        </Button>
                      </td>
                    </tr>
                  ) : (
                    <tr key={l.id}>
                      {!eventId && <td>{l.date ?? '—'}</td>}
                      <td>{labelOf(BUDGET_CATEGORIES, l.category)}</td>
                      <td>{l.concept}</td>
                      <td>{l.provider}</td>
                      {!eventId && (
                        <td className="rf-small">
                          {[l.programName, l.eventTitle].filter(Boolean).join(' · ') || '—'}
                        </td>
                      )}
                      <td className="is-num">{fmt(l.plannedCents)}</td>
                      <td className="is-num">{fmt(l.actualCents)}</td>
                      <Deviation line={l} />
                      <td>{l.paid ? 'Sí' : 'No'}</td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {canManage && (
        <form
          className="rf-config__inline rf-prod__add"
          aria-label="Nueva partida"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            const planned = form.planned.trim() ? parseMoney(form.planned) : 0;
            const actual = form.actual.trim() ? parseMoney(form.actual) : null;
            if (planned === null || (form.actual.trim() && actual === null))
              return setError('Revisa los importes');
            try {
              await api.post('/api/budget/lines', {
                category: form.category,
                concept: form.concept,
                provider: form.provider,
                plannedCents: planned,
                actualCents: actual,
                date: form.date || null,
                eventId: eventId ?? null,
                programId: eventId ? null : filters.programId || null,
              });
              setForm({ ...empty, category: form.category });
              refresh();
            } catch (err) {
              setError(errorMessage(err));
            }
          }}
        >
          <SelectField
            label="Categoría"
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value as BudgetCategory })}
            options={BUDGET_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))}
          />
          <TextField
            label="Concepto"
            value={form.concept}
            onChange={(e) => setForm({ ...form, concept: e.target.value })}
            required
          />
          <TextField
            label="Proveedor"
            value={form.provider}
            onChange={(e) => setForm({ ...form, provider: e.target.value })}
          />
          <TextField
            label="Previsto (€)"
            inputMode="decimal"
            value={form.planned}
            placeholder="0,00"
            onChange={(e) => setForm({ ...form, planned: e.target.value })}
          />
          <TextField
            label="Real (€)"
            inputMode="decimal"
            value={form.actual}
            onChange={(e) => setForm({ ...form, actual: e.target.value })}
          />
          {!eventId && (
            <TextField
              label="Fecha"
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
            />
          )}
          <Button type="submit" size="sm" disabled={!form.concept.trim()}>
            Añadir partida
          </Button>
        </form>
      )}
    </div>
  );
}

function Deviation({ line }: { line: BudgetLineDto }) {
  if (line.actualCents === null) return <td className="is-num rf-muted">—</td>;
  const d = line.actualCents - line.plannedCents;
  return <td className={`is-num ${d > 0 ? 'is-over' : ''}`}>{signed(d)}</td>;
}
