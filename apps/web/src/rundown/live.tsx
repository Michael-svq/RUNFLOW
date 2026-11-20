import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  computeTiming,
  formatDuration,
  initialLiveState,
  LIVE_MODES,
  lineColeo,
  lineDuration,
  lineTypeLabel,
  rundownWindow,
  type AsrunEntryDto,
  type LiveMode,
  type LiveState,
  type RundownDto,
  type RundownTiming,
  type TimingLine,
} from '@runflow/core';
import type { LineSnapshot } from '@runflow/sync';
import { Alert, Button, Dialog, Spinner, TextField } from '@runflow/ui';
import { api, errorMessage } from '../api/client';
import { t } from '../i18n';
import type { RowInfo } from './RundownGrid';

/* ---------- Formatos ---------- */

/** Reloj con signo como en la referencia: -01:41:57, +32:26. */
export function fmtSigned(seconds: number, forceSign = true): string {
  const sign = seconds < 0 ? '-' : forceSign ? '+' : '';
  const s = Math.abs(Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${sign}${pad(h)}:${pad(m)}:${pad(sec)}` : `${sign}${pad(m)}:${pad(sec)}`;
}

export function useClockFormat(timeZone: string) {
  return useMemo(() => {
    const f = new Intl.DateTimeFormat('es-ES', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    return (epoch: number) => f.format(new Date(epoch));
  }, [timeZone]);
}

/* ---------- Cálculo de tiempos ---------- */

export function useTiming(
  lines: LineSnapshot[],
  rundown: RundownDto,
  live: LiveState | null,
  now: number,
): RundownTiming {
  const window = useMemo(
    () => rundownWindow(rundown.airDate, rundown.startTime, rundown.endTime, rundown.timezone),
    [rundown.airDate, rundown.startTime, rundown.endTime, rundown.timezone],
  );
  return useMemo(
    () => computeTiming(lines as TimingLine[], window, live ?? initialLiveState(), now),
    [lines, window, live, now],
  );
}

/** Estado y columnas calculadas por línea; reutiliza los objetos que no cambian. */
export function useRowInfo(
  timing: RundownTiming,
  clock: (epoch: number) => string,
): Map<string, RowInfo> {
  const cache = useRef(new Map<string, { key: string; info: RowInfo }>());
  return useMemo(() => {
    const out = new Map<string, RowInfo>();
    const next = new Map<string, { key: string; info: RowInfo }>();
    timing.lines.forEach((lt, id) => {
      const computed: Record<string, string> =
        lt.state === 'floating'
          ? { sum_vtr: lt.vtrSum ? formatDuration(lt.vtrSum) : '' }
          : {
              hora: clock(lt.start),
              back: clock(lt.backTime),
              real: lt.actual !== null ? formatDuration(lt.actual) : '',
              sum_vtr: lt.vtrSum ? formatDuration(lt.vtrSum) : '',
            };
      const key = `${lt.state}|${computed.hora}|${computed.back}|${computed.real}|${computed.sum_vtr}`;
      const prev = cache.current.get(id);
      const entry = prev && prev.key === key ? prev : { key, info: { state: lt.state, computed } };
      next.set(id, entry);
      out.set(id, entry.info);
    });
    cache.current = next;
    return out;
  }, [timing, clock]);
}

/* ---------- Relojes (cabecera, como en la referencia) ---------- */

export function LiveClocks({
  rundown,
  timing,
  live,
  lines,
  now,
}: {
  rundown: RundownDto;
  timing: RundownTiming;
  live: LiveState | null;
  lines: LineSnapshot[];
  now: number;
}) {
  const clock = useClockFormat(rundown.timezone);
  const started = !!live?.showStartedAt;
  const ended = !!live?.showEndedAt;
  const toStart = (timing.plannedStart - now) / 1000;
  const toEnd = (timing.plannedEnd - now) / 1000;
  const onAir = live?.onAir ? lines.find((l) => l.id === live.onAir!.lineId) : undefined;

  let lineBlock = null;
  if (onAir && live?.onAir) {
    const elapsed = Math.max(0, (now - live.onAir.startedAt) / 1000);
    const duration = lineDuration(onAir as TimingLine);
    const coleo = lineColeo(onAir as TimingLine);
    const remaining = duration - elapsed;
    const inColeo = duration > 0 && remaining < 0 && remaining >= -coleo;
    const over = duration > 0 && remaining < -coleo;
    const tone = over
      ? 'is-over'
      : inColeo
        ? 'is-coleo'
        : duration > 0 && remaining <= 10
          ? 'is-danger'
          : duration > 0 && remaining <= 30
            ? 'is-warning'
            : '';
    lineBlock = (
      <div className={`rf-clock rf-clock--line ${tone}`} data-testid="clock-line">
        <span className="rf-clock__label">
          EN AIRE · {String(onAir.cells.num ?? '')}{' '}
          {String(onAir.cells.nombre ?? lineTypeLabel(onAir.cells.tipo))}
        </span>
        <span className="rf-clock__values">
          <span className="rf-clock__value" title="Transcurrido">
            {fmtSigned(elapsed)}
          </span>
          {duration > 0 && (
            <span className="rf-clock__value rf-clock__value--main" title="Restante">
              {inColeo ? `COLEO ${fmtSigned(remaining + coleo, false)}` : fmtSigned(-remaining)}
            </span>
          )}
        </span>
        {duration > 0 && coleo > 0 && (
          <span className="rf-clock__hint">
            {formatDuration(duration, { short: true })} +{coleo}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="rf-clocks" role="timer" aria-live="off">
      <div className="rf-clock rf-clock--now">
        <span className="rf-clock__label">HORA</span>
        <span className="rf-clock__value rf-clock__value--main">{clock(now)}</span>
      </div>
      <div className="rf-clock">
        <span className="rf-clock__label">INICIO {clock(timing.plannedStart).slice(0, 5)}</span>
        <span className={`rf-clock__value ${!started ? 'is-good' : ''}`} data-testid="clock-start">
          {started && live?.showStartedAt
            ? fmtSigned(Math.max(0, (now - live.showStartedAt) / 1000))
            : fmtSigned(-toStart)}
        </span>
      </div>
      <div className="rf-clock">
        <span className="rf-clock__label">FIN {clock(timing.plannedEnd).slice(0, 5)}</span>
        <span className={`rf-clock__value ${toEnd < 0 ? 'is-bad' : 'is-good'}`}>
          {ended ? '—' : fmtSigned(-toEnd)}
        </span>
      </div>
      <div className="rf-clock">
        <span className="rf-clock__label">DESCUADRE</span>
        <span
          className={`rf-clock__value ${timing.overUnder > 0 ? 'is-bad' : 'is-good'}`}
          title={timing.overUnder > 0 ? 'Vamos largos' : 'Vamos cortos'}
          data-testid="clock-overunder"
        >
          {fmtSigned(timing.overUnder)}
        </span>
      </div>
      {lineBlock}
      <Stopwatch />
    </div>
  );
}

function Stopwatch() {
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [accum, setAccum] = useState(0);
  const [, force] = useState(0);
  useEffect(() => {
    if (startedAt === null) return;
    const id = setInterval(() => force((n) => n + 1), 200);
    return () => clearInterval(id);
  }, [startedAt]);
  const value = accum + (startedAt !== null ? (Date.now() - startedAt) / 1000 : 0);
  return (
    <div className="rf-clock rf-clock--stopwatch">
      <span className="rf-clock__label">CRONÓMETRO</span>
      <span className="rf-clock__row">
        <button
          type="button"
          className="rf-clock__btn"
          aria-label={startedAt === null ? 'Arrancar cronómetro' : 'Parar cronómetro'}
          onClick={() => {
            if (startedAt === null) setStartedAt(Date.now());
            else {
              setAccum(value);
              setStartedAt(null);
            }
          }}
        >
          {startedAt === null ? '▶' : '❚❚'}
        </button>
        <span className="rf-clock__value">{fmtSigned(value, false)}</span>
        <button
          type="button"
          className="rf-clock__btn"
          aria-label="Reiniciar cronómetro"
          onClick={() => {
            setAccum(0);
            setStartedAt(null);
          }}
        >
          ↺
        </button>
      </span>
    </div>
  );
}

/* ---------- Barra de directo ---------- */

export interface LiveCommands {
  go(): Promise<void>;
  back(): Promise<void>;
  stop(): Promise<void>;
  reset(): Promise<void>;
  setNext(lineId: string | null): Promise<void>;
  settings(
    input: Partial<Pick<LiveState, 'mode' | 'armed' | 'rehearsal' | 'autonextAt'>>,
  ): Promise<void>;
}

export function useLiveCommands(
  rundownId: string,
  live: LiveState | null,
  apply: ((s: LiveState) => void) | undefined,
  onError: (message: string) => void,
): LiveCommands {
  const liveRef = useRef(live);
  liveRef.current = live;
  return useMemo(() => {
    const base = `/api/rundowns/${rundownId}/live`;
    const run = async (fn: () => Promise<{ live: LiveState }>) => {
      try {
        const res = await fn();
        apply?.(res.live);
      } catch (err) {
        onError(errorMessage(err));
      }
    };
    return {
      go: () =>
        run(() =>
          api.post(`${base}/go`, { expectedOnAir: liveRef.current?.onAir?.lineId ?? null }),
        ),
      back: () => run(() => api.post(`${base}/back`)),
      stop: () => run(() => api.post(`${base}/stop`)),
      reset: () => run(() => api.post(`${base}/reset`)),
      setNext: (lineId) => run(() => api.post(`${base}/next`, { lineId })),
      settings: (input) => run(() => api.patch(base, input)),
    };
  }, [rundownId, apply, onError]);
}

const KEYBOARD_KEY = 'rf-live-keyboard';

export function LiveBar({
  live,
  lines,
  timing,
  commands,
  canGo,
  error,
  onShowAsrun,
  keyboard,
  onKeyboardChange,
}: {
  live: LiveState | null;
  lines: LineSnapshot[];
  timing: RundownTiming;
  commands: LiveCommands;
  canGo: boolean;
  error: string | null;
  onShowAsrun: () => void;
  keyboard: boolean;
  onKeyboardChange: (v: boolean) => void;
}) {
  const [cooldown, setCooldown] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const next = timing.nextLineId ? lines.find((l) => l.id === timing.nextLineId) : undefined;
  const state = live ?? initialLiveState();
  const ended = !!state.showEndedAt && !state.onAir;

  const pressGo = async () => {
    if (cooldown) return;
    setCooldown(true);
    setTimeout(() => setCooldown(false), 700);
    await commands.go();
  };

  return (
    <div
      className={`rf-livebar${state.rehearsal ? ' is-rehearsal' : ''}`}
      role="region"
      aria-label="Directo"
    >
      {canGo && (
        <button
          type="button"
          className="rf-go"
          onClick={pressGo}
          disabled={cooldown || (ended && !next)}
          title={keyboard ? 'GO (Espacio)' : 'GO'}
        >
          GO
        </button>
      )}
      <div className="rf-livebar__next">
        <span className="rf-livebar__label">
          {state.onAir ? 'SIGUIENTE' : ended ? 'TERMINADO' : 'PRIMERA'}
        </span>
        <span className="rf-livebar__next-name" data-testid="next-line">
          {next
            ? `${String(next.cells.num ?? '')} · ${String(next.cells.nombre ?? lineTypeLabel(next.cells.tipo))}`
            : '—'}
          {state.next && <span className="rf-livebar__pinned"> (elegida)</span>}
        </span>
      </div>
      {canGo && (
        <div className="rf-livebar__actions">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void commands.back()}
            title="Volver a la línea anterior"
          >
            ◀ Volver
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void commands.stop()}
            disabled={!state.onAir}
          >
            ■ Terminar
          </Button>
          {confirmReset ? (
            <>
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  setConfirmReset(false);
                  void commands.reset();
                }}
              >
                Confirmar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmReset(false)}>
                {t('common.cancel')}
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirmReset(true)}
              disabled={!state.showStartedAt}
              title="Volver a preparación (no borra el registro de emisión)"
            >
              ↺ Preparación
            </Button>
          )}
          <span className="rf-toolbar__sep" />
          <label className="rf-livebar__field">
            <span>Modo</span>
            <select
              className="rf-select"
              value={state.mode}
              onChange={(e) => void commands.settings({ mode: e.target.value as LiveMode })}
              title={LIVE_MODES.find((m) => m.value === state.mode)?.description}
            >
              {LIVE_MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className="rf-livebar__field">
            <span>Autonext</span>
            <select
              className="rf-select"
              value={state.autonextAt}
              onChange={(e) =>
                void commands.settings({ autonextAt: e.target.value as 'duration' | 'coleo' })
              }
            >
              <option value="duration">al final</option>
              <option value="coleo">tras el coleo</option>
            </select>
          </label>
          <label className="rf-livebar__check">
            <input
              type="checkbox"
              checked={state.rehearsal}
              onChange={(e) => void commands.settings({ rehearsal: e.target.checked })}
            />
            Ensayo
          </label>
          <label
            className="rf-livebar__check"
            title="Los equipos (CasparCG, mezclador) llegan en M7–M8"
          >
            <input
              type="checkbox"
              checked={state.armed}
              onChange={(e) => void commands.settings({ armed: e.target.checked })}
            />
            Armar equipos
          </label>
          <label
            className="rf-livebar__check"
            title="La barra espaciadora hace GO (fuera de las celdas en edición)"
          >
            <input
              type="checkbox"
              checked={keyboard}
              onChange={(e) => {
                onKeyboardChange(e.target.checked);
                try {
                  localStorage.setItem(KEYBOARD_KEY, e.target.checked ? '1' : '0');
                } catch {
                  // sin almacenamiento
                }
              }}
            />
            Espacio = GO
          </label>
        </div>
      )}
      <span className="rf-toolbar__spacer" />
      {state.rehearsal && <span className="rf-livebar__badge">ENSAYO</span>}
      <Button size="sm" variant="ghost" onClick={onShowAsrun}>
        Registro de emisión
      </Button>
      {error && (
        <div className="rf-livebar__error">
          <Alert tone="error">{error}</Alert>
        </div>
      )}
    </div>
  );
}

export function readKeyboardPref(): boolean {
  try {
    return localStorage.getItem(KEYBOARD_KEY) === '1';
  } catch {
    return false;
  }
}

/* ---------- Registro de emisión ---------- */

const TRIGGERS: Record<string, string> = {
  go: 'GO',
  auto: 'Automático',
  event: 'Evento',
  back: 'Volver',
};

export function AsrunDialog({ rundown, onClose }: { rundown: RundownDto; onClose: () => void }) {
  const clock = useClockFormat(rundown.timezone);
  const entries = useQuery({
    queryKey: ['asrun', rundown.id],
    queryFn: async () =>
      (await api.get<{ entries: AsrunEntryDto[] }>(`/api/rundowns/${rundown.id}/asrun`)).entries,
    refetchInterval: 5000,
  });

  const download = () => {
    const rows = [
      ['Inicio', 'Fin', 'Duración', 'Nº', 'Nombre', 'Tipo', 'Origen', 'Ensayo'],
      ...(entries.data ?? []).map((e) => [
        clock(Date.parse(e.startedAt)),
        e.endedAt ? clock(Date.parse(e.endedAt)) : '',
        e.durationS !== null ? formatDuration(e.durationS) : '',
        e.num,
        e.name,
        lineTypeLabel(e.type),
        TRIGGERS[e.trigger] ?? e.trigger,
        e.rehearsal ? 'sí' : 'no',
      ]),
    ];
    const csv = rows
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';'))
      .join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `as-run-${rundown.airDate}-${rundown.title.replace(/[^\w-]+/g, '_')}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <Dialog
      open
      title="Registro de emisión"
      onClose={onClose}
      footer={
        <>
          <Button onClick={download} disabled={!entries.data?.length}>
            Descargar CSV
          </Button>
          <Button variant="primary" onClick={onClose}>
            {t('common.close')}
          </Button>
        </>
      }
    >
      {entries.isPending ? (
        <Spinner label={t('common.loading')} />
      ) : entries.isError ? (
        <Alert tone="error">{errorMessage(entries.error)}</Alert>
      ) : entries.data.length === 0 ? (
        <p className="rf-muted">Todavía no ha salido nada al aire.</p>
      ) : (
        <div className="rf-table-wrap rf-asrun">
          <table className="rf-table">
            <thead>
              <tr>
                <th>Inicio</th>
                <th>Dur.</th>
                <th>Nº</th>
                <th>Nombre</th>
                <th>Origen</th>
              </tr>
            </thead>
            <tbody>
              {entries.data.map((e) => (
                <tr key={e.id}>
                  <td className="rf-tabular">{clock(Date.parse(e.startedAt))}</td>
                  <td className="rf-tabular">
                    {e.durationS !== null ? formatDuration(e.durationS) : 'en aire'}
                  </td>
                  <td>{e.num}</td>
                  <td>
                    {e.name || lineTypeLabel(e.type)}
                    {e.rehearsal && <span className="rf-muted rf-small"> · ensayo</span>}
                  </td>
                  <td className="rf-muted">{TRIGGERS[e.trigger] ?? e.trigger}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Dialog>
  );
}

/* ---------- Hora fija ---------- */

export function HardTimeDialog({
  current,
  onSave,
  onClose,
}: {
  current: string;
  onSave: (value: string | null) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(current.slice(0, 8));
  const [error, setError] = useState<string | undefined>();
  return (
    <Dialog
      open
      title="Hora fija de la línea"
      onClose={onClose}
      footer={
        <>
          {current && (
            <Button
              variant="ghost"
              className="rf-dialog__left"
              onClick={() => {
                onSave(null);
                onClose();
              }}
            >
              Quitar hora fija
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              if (!/^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(value)) {
                setError('Hora no válida (HH:MM:SS)');
                return;
              }
              const [h, m, s] = value.split(':');
              onSave(`${h!.padStart(2, '0')}:${m}:${s ?? '00'}`);
              onClose();
            }}
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <p className="rf-muted rf-small">
        En modo Evento, la línea entra sola a esta hora aunque la anterior no haya terminado.
      </p>
      <TextField
        label="Hora (HH:MM:SS)"
        type="time"
        step={1}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setError(undefined);
        }}
        error={error}
        autoFocus
      />
    </Dialog>
  );
}
