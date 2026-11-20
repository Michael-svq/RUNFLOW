import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  formatDuration,
  isFloating,
  lineColeo,
  lineDuration,
  lineTypeLabel,
  type LiveState,
  type OutputSettings,
  type RundownDto,
  type RundownTiming,
  type StageMessage,
  type TimingLine,
} from '@runflow/core';
import type { LineSnapshot } from '@runflow/sync';
import { fmtSigned, useClockFormat } from '../rundown/live';
import { PrompterView, type PrompterBlock } from './Prompter';

/* Vistas de las salidas (pantallas de plató, tablets, mini-PC). */

export type RundownInfo = Pick<
  RundownDto,
  'id' | 'title' | 'airDate' | 'startTime' | 'endTime' | 'timezone'
>;

export function onAirInfo(lines: LineSnapshot[], live: LiveState | null, now: number) {
  const line = live?.onAir ? lines.find((l) => l.id === live.onAir!.lineId) : undefined;
  if (!line || !live?.onAir) return null;
  const elapsed = Math.max(0, (now - live.onAir.startedAt) / 1000);
  const duration = lineDuration(line as TimingLine);
  const coleo = lineColeo(line as TimingLine);
  const remaining = duration - elapsed;
  return {
    line,
    elapsed,
    duration,
    remaining,
    coleo,
    inColeo: duration > 0 && remaining < 0 && remaining >= -coleo,
    over: duration > 0 && remaining < -coleo,
  };
}

function lineLabel(l: LineSnapshot | undefined): string {
  if (!l) return '—';
  return `${String(l.cells.num ?? '')} · ${String(l.cells.nombre ?? '') || lineTypeLabel(l.cells.tipo)}`;
}

/** Relojes grandes. */
export function ClocksView({
  rundown,
  lines,
  live,
  timing,
  now,
}: {
  rundown: RundownInfo;
  lines: LineSnapshot[];
  live: LiveState | null;
  timing: RundownTiming;
  now: number;
}) {
  const clock = useClockFormat(rundown.timezone);
  const info = onAirInfo(lines, live, now);
  const next = timing.nextLineId ? lines.find((l) => l.id === timing.nextLineId) : undefined;
  const tone = !info
    ? ''
    : info.over
      ? 'is-over'
      : info.inColeo
        ? 'is-coleo'
        : info.duration > 0 && info.remaining <= 10
          ? 'is-danger'
          : info.duration > 0 && info.remaining <= 30
            ? 'is-warning'
            : '';
  return (
    <div className="rf-out-clocks">
      <div className="rf-out-clocks__now">
        <span className="rf-out-label">HORA</span>
        <span className="rf-out-big" data-testid="out-now">
          {clock(now)}
        </span>
      </div>
      <div className={`rf-out-clocks__line ${tone}`}>
        <span className="rf-out-label">
          {info ? `EN AIRE · ${lineLabel(info.line)}` : 'SIN LÍNEA EN AIRE'}
        </span>
        <span className="rf-out-huge" data-testid="out-remaining">
          {info
            ? info.duration > 0
              ? info.inColeo
                ? `COLEO ${fmtSigned(info.remaining + info.coleo, false)}`
                : fmtSigned(-info.remaining)
              : fmtSigned(info.elapsed)
            : '--:--'}
        </span>
      </div>
      <div className="rf-out-clocks__row">
        <div>
          <span className="rf-out-label">SIGUIENTE</span>
          <span className="rf-out-mid">{lineLabel(next)}</span>
        </div>
        <div>
          <span className="rf-out-label">FIN {clock(timing.plannedEnd).slice(0, 5)}</span>
          <span className="rf-out-mid">{fmtSigned((now - timing.plannedEnd) / 1000)}</span>
        </div>
        <div>
          <span className="rf-out-label">DESCUADRE</span>
          <span className={`rf-out-mid ${timing.overUnder > 0 ? 'is-bad' : 'is-good'}`}>
            {fmtSigned(timing.overUnder)}
          </span>
        </div>
      </div>
    </div>
  );
}

/** Escaleta simplificada con horas; sigue a la línea en aire. */
export function AgendaView({
  rundown,
  lines,
  timing,
}: {
  rundown: RundownInfo;
  lines: LineSnapshot[];
  timing: RundownTiming;
}) {
  const clock = useClockFormat(rundown.timezone);
  const ref = useRef<HTMLOListElement>(null);
  const onAir = timing.onAirLineId;
  useEffect(() => {
    if (!onAir) return;
    ref.current
      ?.querySelector(`[data-agenda-line="${CSS.escape(onAir)}"]`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [onAir]);
  return (
    <div className="rf-out-agenda">
      <h1 className="rf-out-agenda__title">{rundown.title}</h1>
      <ol ref={ref} className="rf-out-agenda__list">
        {lines
          .filter((l) => !isFloating(l))
          .map((l) => {
            const t = timing.lines.get(l.id);
            return (
              <li key={l.id} data-agenda-line={l.id} className={`is-${t?.state ?? 'pending'}`}>
                <span className="rf-out-agenda__time">{t ? clock(t.start).slice(0, 8) : ''}</span>
                <span className="rf-out-agenda__num">{String(l.cells.num ?? '')}</span>
                <span className="rf-out-agenda__name">
                  {String(l.cells.nombre ?? '') || lineTypeLabel(l.cells.tipo)}
                </span>
                <span className="rf-out-agenda__dur">
                  {t?.duration ? formatDuration(t.duration, { short: true }) : ''}
                </span>
              </li>
            );
          })}
      </ol>
    </div>
  );
}

/** Mensaje del control al plató. */
export function MessageView({ message, now }: { message: StageMessage | null; now: number }) {
  if (!message?.text) {
    return (
      <div className="rf-out-message is-empty">
        <span className="rf-out-label">Sin mensajes</span>
      </div>
    );
  }
  const ago = Math.max(0, Math.round((now - message.sentAt) / 1000));
  return (
    <div
      className={`rf-out-message is-${message.color}${message.flash ? ' is-flash' : ''}`}
      role="alert"
    >
      <p className="rf-out-message__text" data-testid="out-message">
        {message.text}
      </p>
      <span className="rf-out-label">
        {message.from} · hace {ago < 60 ? `${ago} s` : `${Math.floor(ago / 60)} min`}
      </span>
    </div>
  );
}

/** Presentador: prompter + relojes + siguiente + mensajes. */
export function PresenterView(props: {
  rundown: RundownInfo;
  lines: LineSnapshot[];
  live: LiveState | null;
  timing: RundownTiming;
  now: number;
  blocks: PrompterBlock[];
  settings: OutputSettings;
  message: StageMessage | null;
  scrollRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="rf-out-presenter">
      <div className="rf-out-presenter__prompter">
        <PrompterView
          blocks={props.blocks}
          settings={props.settings}
          live={props.live}
          scrollRef={props.scrollRef}
        />
      </div>
      <aside className="rf-out-presenter__side">
        <ClocksView
          rundown={props.rundown}
          lines={props.lines}
          live={props.live}
          timing={props.timing}
          now={props.now}
        />
        <MessageView message={props.message} now={props.now} />
      </aside>
    </div>
  );
}

/** Multivista: relojes, agenda, prompter y mensajes. */
export function MultiView(props: {
  rundown: RundownInfo;
  lines: LineSnapshot[];
  live: LiveState | null;
  timing: RundownTiming;
  now: number;
  blocks: PrompterBlock[];
  settings: OutputSettings;
  message: StageMessage | null;
  scrollRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="rf-out-multi">
      <ClocksView
        rundown={props.rundown}
        lines={props.lines}
        live={props.live}
        timing={props.timing}
        now={props.now}
      />
      <AgendaView rundown={props.rundown} lines={props.lines} timing={props.timing} />
      <PrompterView
        blocks={props.blocks}
        settings={props.settings}
        live={props.live}
        scrollRef={props.scrollRef}
        compact
      />
      <MessageView message={props.message} now={props.now} />
    </div>
  );
}

/** Mando por enlace (tablet): GO, volver, rótulos. Las mismas órdenes que Companion. */
export function ControlView({
  token,
  rundown,
  lines,
  live,
  timing,
  now,
}: {
  token: string;
  rundown: { title: string };
  lines: LineSnapshot[];
  live: LiveState | null;
  timing: RundownTiming;
  now: number;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const info = onAirInfo(lines, live, now);
  const next = timing.nextLineId ? lines.find((l) => l.id === timing.nextLineId) : undefined;
  const send = async (action: string) => {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/public/control/${encodeURIComponent(token)}/${action}`, {
        method: 'POST',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setError(body?.error?.message ?? `Error ${res.status}`);
      }
    } catch {
      setError('Sin conexión');
    } finally {
      setBusy(null);
    }
  };
  const label = lineLabel;
  return (
    <div className="rf-control">
      <header className="rf-control__head">
        <strong>{rundown.title}</strong>
        {live?.rehearsal && <span className="rf-control__tag">ENSAYO</span>}
        {live && !live.armed && <span className="rf-control__tag">EQUIPOS DESARMADOS</span>}
      </header>
      <div className="rf-control__now">
        <span className="rf-control__label">EN AIRE</span>
        <span className="rf-control__line">{info ? label(info.line) : '—'}</span>
        {info && info.duration > 0 && (
          <span className={`rf-control__time${info.remaining < 0 ? ' is-over' : ''}`}>
            {fmtSigned(-info.remaining, false)}
          </span>
        )}
      </div>
      <div className="rf-control__next">
        <span className="rf-control__label">SIGUIENTE</span>
        <span className="rf-control__line">{label(next)}</span>
      </div>
      <div className="rf-control__buttons">
        <button
          type="button"
          className="rf-control__go"
          disabled={busy === 'go'}
          onClick={() => void send('go')}
        >
          GO
        </button>
        <button type="button" onClick={() => void send('back')} disabled={!!busy}>
          ◀ Volver
        </button>
        <button type="button" onClick={() => void send('next-graphic')} disabled={!!busy}>
          ▶ Siguiente rótulo
        </button>
        <button type="button" onClick={() => void send('clear-graphics')} disabled={!!busy}>
          ■ Sacar rótulos
        </button>
      </div>
      {error && (
        <p className="rf-control__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
