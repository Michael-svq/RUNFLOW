import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import type * as Y from 'yjs';
import {
  CUE_TRACKS,
  LINE_TYPE_BY_KEY,
  formatCueTime,
  isFloating,
  nextCue,
  parseCueTime,
  placeCues,
  type Cue,
  type AutomationState,
  type CueTrack,
  type LiveState,
  type PlacedCue,
  type RundownTiming,
} from '@runflow/core';
import { addCue, deleteCue, readAllCues, updateCue, type LineSnapshot } from '@runflow/sync';
import { Alert, Badge, Button, Dialog, SelectField, TextField } from '@runflow/ui';
import { LOCAL_ORIGIN } from './useRundownDoc';

/* F4.1 Timeline: vista horizontal con pistas, cue list y shot list. */

const TRACK_BY_KEY = Object.fromEntries(CUE_TRACKS.map((t) => [t.key, t])) as Record<
  CueTrack,
  (typeof CUE_TRACKS)[number]
>;
const LABEL_W = 110;
const ZOOMS = [1, 2, 4, 8, 16, 32, 64];
const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800];

/** Cues del documento, recalculados con cada cambio. */
export function useCues(doc: Y.Doc | undefined, lines: LineSnapshot[]): Map<string, Cue[]> {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!doc) return;
    const bump = () => setVersion((v) => v + 1);
    doc.on('update', bump);
    return () => doc.off('update', bump);
  }, [doc]);
  const ids = lines.map((l) => l.id).join(',');
  return useMemo(
    () => (doc ? readAllCues(doc, ids ? ids.split(',') : []) : new Map()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc, ids, version],
  );
}

/** Hora de inicio prevista (o real) de cada línea, en epoch ms. */
export function lineStarts(lines: LineSnapshot[], timing: RundownTiming): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of lines) {
    const t = timing.lines.get(l.id);
    if (t && !isFloating(l)) m.set(l.id, t.start);
  }
  return m;
}

const lineName = (l: LineSnapshot) =>
  `${l.cells.num ?? ''} ${String(l.cells.nombre ?? '').trim() || '(sin nombre)'}`.trim();

type Editing = { lineId: string; cue: Cue | null; at: number; track: CueTrack };

export function TimelineView({
  doc,
  lines,
  timing,
  live,
  now,
  clock,
  canEdit,
  selectedLineId,
  onSelectLine,
  automation,
}: {
  doc: Y.Doc;
  lines: LineSnapshot[];
  timing: RundownTiming;
  live: LiveState | null;
  now: number;
  clock: (epoch: number) => string;
  canEdit: boolean;
  automation: AutomationState | null;
  selectedLineId: string | null;
  onSelectLine: (id: string) => void;
}) {
  const cues = useCues(doc, lines);
  const starts = useMemo(() => lineStarts(lines, timing), [lines, timing]);
  const placed = useMemo(() => placeCues(lines, starts, cues), [lines, starts, cues]);
  const [zoom, setZoom] = useState(8);
  const [follow, setFollow] = useState(true);
  const [editing, setEditing] = useState<Editing | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const timed = lines.filter((l) => starts.has(l.id));
  const origin = timed.length ? Math.min(...timed.map((l) => starts.get(l.id)!)) : now;
  const end = timed.length
    ? Math.max(
        ...timed.map((l) => starts.get(l.id)! + (timing.lines.get(l.id)?.duration ?? 0) * 1000),
      )
    : now;
  const totalS = Math.max(60, (end - origin) / 1000 + 30);
  const x = (epoch: number) => ((epoch - origin) / 1000) * zoom;
  const width = totalS * zoom;
  const step = STEPS.find((s) => s * zoom >= 70) ?? 1800;
  const onAir = !!live?.onAir;
  const playX = onAir ? x(now) : null;

  // Seguir el cabezal en directo.
  useEffect(() => {
    const el = scroller.current;
    if (!el || playX === null || !follow) return;
    const target = playX - el.clientWidth * 0.3;
    if (Math.abs(el.scrollLeft - target) > el.clientWidth * 0.4)
      el.scrollLeft = Math.max(0, target);
  }, [playX, follow]);

  /** Clic en una pista vacía: cue nuevo en esa línea y ese tiempo. */
  const addAt = (track: CueTrack, e: MouseEvent<HTMLDivElement>) => {
    if (!canEdit) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const epoch = origin + ((e.clientX - rect.left) / zoom) * 1000;
    const line = [...timed].reverse().find((l) => starts.get(l.id)! <= epoch) ?? timed[0];
    if (!line) return;
    const at = Math.max(0, Math.round(((epoch - starts.get(line.id)!) / 1000) * 25) / 25);
    setEditing({ lineId: line.id, cue: null, at, track });
  };

  const next = onAir ? nextCue(placed, now) : null;
  const fired = new Map((automation?.fired ?? []).map((f) => [f.cueId, f]));
  const last = automation?.fired[0];

  return (
    <div className="rf-timeline">
      <div className="rf-timeline__bar">
        <span className="rf-small rf-muted">Zoom</span>
        <Button
          size="sm"
          variant="ghost"
          aria-label="Alejar"
          disabled={zoom === ZOOMS[0]}
          onClick={() => setZoom(ZOOMS[Math.max(0, ZOOMS.indexOf(zoom) - 1)]!)}
        >
          −
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label="Acercar"
          disabled={zoom === ZOOMS[ZOOMS.length - 1]}
          onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + 1)]!)}
        >
          +
        </Button>
        <label className="rf-check">
          <input type="checkbox" checked={follow} onChange={() => setFollow(!follow)} />
          <span>Seguir el directo</span>
        </label>
        {next && (
          <span className="rf-timeline__next" aria-live="polite">
            Siguiente cue: <strong>{next.label || TRACK_BY_KEY[next.track].label}</strong> (
            {TRACK_BY_KEY[next.track].label}) en{' '}
            <span className="rf-tabular">{formatCueTime((next.absAt - now) / 1000)}</span>
          </span>
        )}
        {last && onAir && (
          <span
            className={`rf-timeline__fired${last.error ? ' is-error' : ''}`}
            data-testid="last-cue"
            title={last.error ?? undefined}
          >
            Último cue: {last.label || TRACK_BY_KEY[last.track].label}{' '}
            {last.error
              ? `⚠ ${last.error}`
              : last.executed
                ? '✓ ejecutado'
                : live?.rehearsal
                  ? '· ensayo'
                  : live?.armed
                    ? '· aviso'
                    : '· sin armar'}
          </span>
        )}
        {canEdit && (
          <span className="rf-small rf-muted">Clic en una pista para añadir un cue.</span>
        )}
      </div>
      <div className="rf-timeline__frame">
        <div className="rf-timeline__labels" style={{ width: LABEL_W }}>
          <div className="rf-timeline__ruler-label" />
          <div className="rf-timeline__label rf-timeline__label--lines">Líneas</div>
          {CUE_TRACKS.map((t) => (
            <div key={t.key} className="rf-timeline__label">
              <span className="rf-timeline__swatch" style={{ background: t.color }} />
              {t.label}
            </div>
          ))}
        </div>
        <div className="rf-timeline__scroll" ref={scroller}>
          <div className="rf-timeline__canvas" style={{ width }}>
            <div className="rf-timeline__ruler">
              {Array.from({ length: Math.ceil(totalS / step) + 1 }, (_, i) => (
                <span key={i} className="rf-timeline__tick" style={{ left: i * step * zoom }}>
                  {clock(origin + i * step * 1000)}
                </span>
              ))}
            </div>
            <div className="rf-timeline__row rf-timeline__row--lines">
              {timed.map((l) => {
                const t = timing.lines.get(l.id)!;
                const type = LINE_TYPE_BY_KEY[String(l.cells.tipo ?? '')];
                return (
                  <button
                    key={l.id}
                    type="button"
                    className={[
                      'rf-timeline__line',
                      l.id === selectedLineId && 'is-selected',
                      t.state === 'onAir' && 'is-onair',
                      t.state === 'played' && 'is-played',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    style={{
                      left: x(starts.get(l.id)!),
                      width: Math.max(4, t.duration * zoom),
                      background: type?.bg,
                      color: type?.fg,
                    }}
                    title={`${lineName(l)} · ${clock(t.start)}`}
                    onClick={() => onSelectLine(l.id)}
                  >
                    {lineName(l)}
                  </button>
                );
              })}
            </div>
            {CUE_TRACKS.map((track) => (
              <div
                key={track.key}
                className={`rf-timeline__row${canEdit ? ' is-editable' : ''}`}
                data-track={track.key}
                onClick={(e) => e.target === e.currentTarget && addAt(track.key, e)}
              >
                {placed
                  .filter((c) => c.track === track.key)
                  .map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className={`rf-timeline__cue${c.duration ? '' : ' is-instant'}${
                        c.absAt < now && onAir ? ' is-past' : ''
                      }${fired.get(c.id)?.error ? ' is-error' : fired.get(c.id)?.executed ? ' is-done' : ''}`}
                      style={{
                        left: x(c.absAt),
                        width: c.duration ? Math.max(8, c.duration * zoom) : undefined,
                        background: track.color,
                      }}
                      title={`${formatCueTime(c.at)} · ${c.label}${c.target ? ` → ${c.target}` : ''}`}
                      aria-label={`Cue ${c.label || track.label} en ${formatCueTime(c.at)}`}
                      onClick={() =>
                        canEdit
                          ? setEditing({ lineId: c.lineId, cue: c, at: c.at, track: c.track })
                          : onSelectLine(c.lineId)
                      }
                    >
                      {c.label}
                    </button>
                  ))}
              </div>
            ))}
            {playX !== null && <div className="rf-timeline__playhead" style={{ left: playX }} />}
          </div>
        </div>
      </div>
      {editing && (
        <CueDialog doc={doc} lines={timed} editing={editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function CueDialog({
  doc,
  lines,
  editing,
  onClose,
}: {
  doc: Y.Doc;
  lines: LineSnapshot[];
  editing: Editing;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    lineId: editing.lineId,
    track: editing.track,
    at: formatCueTime(editing.at),
    duration: editing.cue?.duration ? formatCueTime(editing.cue.duration) : '',
    label: editing.cue?.label ?? '',
    target: editing.cue?.target ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const track = TRACK_BY_KEY[form.track];

  const save = () => {
    const at = parseCueTime(form.at);
    const duration = form.duration.trim() ? parseCueTime(form.duration) : 0;
    if (at === null) return setError('Tiempo no válido (m:ss:ff)');
    if (duration === null) return setError('Duración no válida (m:ss:ff)');
    const data = {
      track: form.track,
      at,
      duration,
      label: form.label.trim().slice(0, 200),
      target: form.target.trim().slice(0, 200),
    };
    if (editing.cue && editing.cue && form.lineId === editing.lineId) {
      updateCue(doc, editing.lineId, editing.cue.id, data, LOCAL_ORIGIN);
    } else {
      doc.transact(() => {
        if (editing.cue) deleteCue(doc, editing.lineId, editing.cue.id, LOCAL_ORIGIN);
        addCue(doc, form.lineId, data, LOCAL_ORIGIN);
      }, LOCAL_ORIGIN);
    }
    onClose();
  };

  return (
    <Dialog
      open
      title={editing.cue ? 'Editar cue' : 'Nuevo cue'}
      onClose={onClose}
      footer={
        <>
          {editing.cue && (
            <Button
              variant="danger"
              onClick={() => {
                deleteCue(doc, editing.lineId, editing.cue!.id, LOCAL_ORIGIN);
                onClose();
              }}
            >
              Borrar
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={save}>
            Guardar
          </Button>
        </>
      }
    >
      {error && <Alert tone="error">{error}</Alert>}
      <div className="rf-form">
        <div className="rf-form__row">
          <SelectField
            label="Pista"
            value={form.track}
            onChange={(e) => setForm({ ...form, track: e.target.value as CueTrack })}
            options={CUE_TRACKS.map((t) => ({ value: t.key, label: t.label }))}
          />
          <SelectField
            label="Línea"
            value={form.lineId}
            onChange={(e) => setForm({ ...form, lineId: e.target.value })}
            options={lines.map((l) => ({ value: l.id, label: lineName(l) }))}
          />
        </div>
        <div className="rf-form__row">
          <TextField
            label="Tiempo en la línea (m:ss:ff)"
            value={form.at}
            onChange={(e) => setForm({ ...form, at: e.target.value })}
          />
          <TextField
            label="Duración (opcional)"
            value={form.duration}
            placeholder="0:04:00"
            onChange={(e) => setForm({ ...form, duration: e.target.value })}
          />
        </div>
        <TextField
          label="Texto"
          value={form.label}
          placeholder={track.hint}
          maxLength={200}
          autoFocus
          onChange={(e) => setForm({ ...form, label: e.target.value })}
        />
        <TextField
          label="Dato para automatizar (opcional)"
          value={form.target}
          maxLength={200}
          hint={
            form.track === 'camara'
              ? 'Fuente del mezclador (p. ej. CAM 2): con los equipos armados corta sola en el directo.'
              : form.track === 'vtr'
                ? 'Fuente del mezclador del VTR (p. ej. VTR 1).'
                : form.track === 'rotulos'
                  ? 'Nº del rótulo en el guion de la línea (1, 2…); sale solo con los equipos armados.'
                  : form.track === 'luces'
                    ? 'Número de cue de la mesa de luces.'
                    : 'Lo que necesite el equipo que lo ejecute.'
          }
          onChange={(e) => setForm({ ...form, target: e.target.value })}
        />
      </div>
    </Dialog>
  );
}

/* ---------- Cue list y shot list ---------- */

export function CueList({
  doc,
  lines,
  timing,
  live,
  now,
  clock,
  onSelectLine,
}: {
  doc: Y.Doc;
  lines: LineSnapshot[];
  timing: RundownTiming;
  live: LiveState | null;
  now: number;
  clock: (epoch: number) => string;
  onSelectLine: (id: string) => void;
}) {
  const cues = useCues(doc, lines);
  const starts = useMemo(() => lineStarts(lines, timing), [lines, timing]);
  const placed = useMemo(() => placeCues(lines, starts, cues), [lines, starts, cues]);
  const [track, setTrack] = useState<CueTrack | ''>('');
  const byId = new Map(lines.map((l) => [l.id, l]));
  const shown = track ? placed.filter((c) => c.track === track) : placed;
  const onAir = !!live?.onAir;
  const next = onAir ? nextCue(shown, now) : null;
  const shots = track === 'camara';

  return (
    <div className="rf-cuelist">
      <div className="rf-timeline__bar">
        <SelectField
          label="Pista"
          value={track}
          onChange={(e) => setTrack(e.target.value as CueTrack | '')}
          options={[
            { value: '', label: 'Todas (cue list)' },
            ...CUE_TRACKS.map((t) => ({
              value: t.key,
              label: t.key === 'camara' ? 'Cámaras (shot list)' : t.label,
            })),
          ]}
        />
        <span className="rf-muted rf-small">{shown.length} cues</span>
      </div>
      {shown.length === 0 ? (
        <div className="rf-card rf-empty">
          No hay cues. Se añaden en la vista Timeline haciendo clic en una pista.
        </div>
      ) : (
        <div className="rf-table-wrap">
          <table
            className="rf-table rf-cuelist__table"
            aria-label={shots ? 'Shot list' : 'Cue list'}
          >
            <thead>
              <tr>
                <th>{shots ? 'Plano' : 'Nº'}</th>
                <th>Hora</th>
                <th>Línea</th>
                <th>TC en línea</th>
                <th>Pista</th>
                <th>Texto</th>
                <th>Dato</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((c: PlacedCue, i) => {
                const line = byId.get(c.lineId);
                return (
                  <tr
                    key={c.id}
                    className={[c.id === next?.id && 'is-next', onAir && c.absAt < now && 'is-past']
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => onSelectLine(c.lineId)}
                  >
                    <td className="rf-tabular">{i + 1}</td>
                    <td className="rf-tabular">{clock(c.absAt)}</td>
                    <td>{line ? lineName(line) : ''}</td>
                    <td className="rf-tabular">{formatCueTime(c.at)}</td>
                    <td>
                      <Badge>
                        <span
                          className="rf-timeline__swatch"
                          style={{ background: TRACK_BY_KEY[c.track].color }}
                        />
                        {TRACK_BY_KEY[c.track].label}
                      </Badge>
                    </td>
                    <td>{c.label}</td>
                    <td className="rf-small">{c.target}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
