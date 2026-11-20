import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'react-router';
import {
  BUILTIN_VIEWS,
  COLUMN_BY_KEY,
  formatDuration,
  initialLiveState,
  isFloating,
  lineTypeLabel,
  type AsrunEntryDto,
  type RundownDto,
} from '@runflow/core';
import * as Y from 'yjs';
import { getScriptFragment, lineScript, readScript } from '@runflow/sync';
import { Alert, Spinner } from '@runflow/ui';
import { api, errorMessage } from '../api/client';
import { useSession } from '../auth/session';
import { locale } from '../i18n';
import { cellColors, displayValue } from '../rundown/cells';
import { useClockFormat, useRowInfo, useTiming } from '../rundown/live';
import { useLines, useRundownSession } from '../rundown/useRundownDoc';
import { useScriptColumns } from '../script/useScripts';
import { PRINT_VIEWS } from './RundownPage';

/** Vistas de impresión (PLAN §27). Imprimir → «Guardar como PDF» da el archivo. */
export function PrintPage() {
  const { id = '' } = useParams();
  const rundown = useQuery({
    queryKey: ['rundown', id],
    queryFn: async () => (await api.get<{ rundown: RundownDto }>(`/api/rundowns/${id}`)).rundown,
  });
  if (rundown.isPending) return <Spinner label="Cargando…" />;
  if (rundown.isError) return <Alert tone="error">{errorMessage(rundown.error)}</Alert>;
  return <PrintView rundown={rundown.data} />;
}

function PrintView({ rundown }: { rundown: RundownDto }) {
  const { me, org } = useSession();
  const [params, setParams] = useSearchParams();
  const view = params.get('vista') ?? 'completa';
  const user = useMemo(() => ({ id: me.user.id, name: me.user.name }), [me.user.id, me.user.name]);
  const { session, loaded, live } = useRundownSession(org.id, rundown.id, user);
  const lines = useLines(session?.doc);
  const timing = useTiming(lines, rundown, live ?? initialLiveState(), Date.now());
  const clock = useClockFormat(rundown.timezone);
  const scripts = useScriptColumns(session?.doc, lines);
  const rowInfo = useRowInfo(timing, clock, scripts);
  const asrun = useQuery({
    queryKey: ['asrun', rundown.id],
    queryFn: async () =>
      (await api.get<{ entries: AsrunEntryDto[] }>(`/api/rundowns/${rundown.id}/asrun`)).entries,
    enabled: view === 'asrun',
  });

  useEffect(() => {
    document.documentElement.dataset.print = '1';
    document.title = `${rundown.title} · ${PRINT_VIEWS.find((v) => v.value === view)?.label ?? ''}`;
    return () => {
      delete document.documentElement.dataset.print;
    };
  }, [rundown.title, view]);

  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'full' }).format(
    new Date(`${rundown.airDate}T12:00:00`),
  );
  const ready = !!session && loaded;
  const tableView = BUILTIN_VIEWS.find((v) => v.id === `builtin:${view}`);

  return (
    <div className={`rf-print rf-print--${tableView ? 'table' : view}`}>
      <div className="rf-print__tools no-print">
        <select
          className="rf-select"
          value={view}
          onChange={(e) => setParams({ vista: e.target.value })}
          aria-label="Vista de impresión"
        >
          {PRINT_VIEWS.map((v) => (
            <option key={v.value} value={v.value}>
              {v.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="rf-btn rf-btn--primary"
          onClick={() => window.print()}
          disabled={!ready}
        >
          Imprimir / Guardar PDF
        </button>
      </div>
      <header className="rf-print__head">
        <div>
          <h1>{rundown.title}</h1>
          <p>
            {rundown.programName} · {date} · {rundown.startTime.slice(0, 5)}–
            {rundown.endTime.slice(0, 5)}
          </p>
        </div>
        <div className="rf-print__meta">
          <strong>{PRINT_VIEWS.find((v) => v.value === view)?.label}</strong>
          <span>
            {lines.length} líneas · estimado {formatDuration(timing.totalEstimated)}
          </span>
          <span>
            Impreso{' '}
            {new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(
              new Date(),
            )}
          </span>
        </div>
      </header>

      {!ready ? (
        <Spinner label="Cargando…" />
      ) : tableView ? (
        <table className="rf-print__table">
          <thead>
            <tr>
              {tableView.columns.map((c) => (
                <th key={c.key}>{COLUMN_BY_KEY[c.key]?.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className={isFloating(l) ? 'is-floating' : undefined}>
                {tableView.columns.map((c) => {
                  const def = COLUMN_BY_KEY[c.key]!;
                  const colors = cellColors(def, l.cells[c.key]);
                  return (
                    <td
                      key={c.key}
                      style={colors ? { background: colors.bg, color: colors.fg } : undefined}
                      className={def.align ? `is-${def.align}` : undefined}
                    >
                      {def.kind === 'computed'
                        ? rowInfo.get(l.id)?.computed[c.key]
                        : displayValue(def, l.cells[c.key])}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      ) : view === 'presentador' || view === 'guion' ? (
        <div className="rf-print__script">
          {lines
            .filter((l) => !isFloating(l))
            .map((l) => {
              const s = lineScript(session!.doc, l.id);
              if (view === 'presentador' && !s.paso.length) return null;
              const blocks = view === 'guion' ? null : s.paso;
              return (
                <section key={l.id} className="rf-print__block">
                  <h2>
                    <span>{String(l.cells.num ?? '')}</span>{' '}
                    {String(l.cells.nombre ?? '') || lineTypeLabel(l.cells.tipo)}
                    <small>
                      {lineTypeLabel(l.cells.tipo)}
                      {typeof l.cells.t_est === 'number' && ` · ${formatDuration(l.cells.t_est)}`}
                    </small>
                  </h2>
                  {blocks ? (
                    blocks.map((p, i) => (
                      <p key={i} className="is-paso">
                        {p}
                      </p>
                    ))
                  ) : (
                    <FullScript doc={session!.doc} lineId={l.id} />
                  )}
                </section>
              );
            })}
        </div>
      ) : view === 'rotulos' ? (
        <table className="rf-print__table">
          <thead>
            <tr>
              <th>Nº</th>
              <th>Línea</th>
              <th>Tipo</th>
              <th>Texto</th>
              <th>TC entrada</th>
              <th>TC salida</th>
            </tr>
          </thead>
          <tbody>
            {lines.flatMap((l) =>
              lineScript(session!.doc, l.id).graphics.map((g) => (
                <tr key={`${l.id}-${g.id}`}>
                  <td>{String(l.cells.num ?? '')}</td>
                  <td>{String(l.cells.nombre ?? '')}</td>
                  <td>
                    <strong>{g.type}</strong>
                  </td>
                  <td>{[g.f0, g.f1, g.f2, g.f3].filter(Boolean).join(' // ')}</td>
                  <td>{g.tcIn}</td>
                  <td>{g.tcOut}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      ) : (
        <table className="rf-print__table">
          <thead>
            <tr>
              <th>Inicio</th>
              <th>Fin</th>
              <th>Duración</th>
              <th>Nº</th>
              <th>Nombre</th>
              <th>Tipo</th>
              <th>Ensayo</th>
            </tr>
          </thead>
          <tbody>
            {(asrun.data ?? []).map((e) => (
              <tr key={e.id}>
                <td>{clock(Date.parse(e.startedAt))}</td>
                <td>{e.endedAt ? clock(Date.parse(e.endedAt)) : ''}</td>
                <td>{e.durationS !== null ? formatDuration(e.durationS) : ''}</td>
                <td>{e.num}</td>
                <td>{e.name}</td>
                <td>{lineTypeLabel(e.type)}</td>
                <td>{e.rehearsal ? 'sí' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** Guion completo de una línea: paso, off, notas y rótulos. */
function FullScript({ doc, lineId }: { doc: Y.Doc; lineId: string }) {
  const blocks = readScript(getScriptFragment(doc, lineId));
  return (
    <>
      {blocks.map((b, i) =>
        b.kind === 'rotulo' ? (
          <div key={i} className="rf-print__rotulo">
            <strong>{b.type}</strong> {[b.f0, b.f1, b.f2, b.f3].filter(Boolean).join(' // ')}
            {b.tcIn && ` · TC ${b.tcIn}${b.tcOut ? `–${b.tcOut}` : ''}`}
          </div>
        ) : b.text.trim() ? (
          <p key={i} className={`is-${b.kind}`}>
            {b.text}
          </p>
        ) : null,
      )}
    </>
  );
}
