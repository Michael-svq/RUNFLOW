import { createContext, useContext, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  formatDuration,
  graphicSummary,
  normalizeClip,
  TIMECODE_LINE_TYPES,
  type CgState,
  type MixerState,
  type StreamAction,
} from '@runflow/core';
import type { LineSnapshot, ScriptGraphicBlock } from '@runflow/sync';
import { api, errorMessage } from '../api/client';
import { useServerNow } from './useServerClock';

/*
 * RunFlow CG en la escaleta (PLAN §13 y §15): ▶/■ en la celda de rótulos,
 * columna PLAY con el estado del VTR y aviso de equipos.
 */

interface ClipList {
  clips: { name: string; duration: number | null }[];
  devices: number;
  connected: number;
}

export function useCgClips(enabled: boolean) {
  return useQuery({
    queryKey: ['cg-clips'],
    queryFn: () => api.get<ClipList>('/api/cg/clips'),
    refetchInterval: 30_000,
    enabled,
  });
}

interface CgContextValue {
  rundownId: string;
  state: CgState | null;
  graphics: Map<string, ScriptGraphicBlock[]>;
  clips: Map<string, number | null> | null;
  canFire: boolean;
  /** Error de la última orden (se muestra bajo la barra de directo). */
  setError: (msg: string | null) => void;
  apply: (state: CgState) => void;
}

const CgContext = createContext<CgContextValue | null>(null);
export const CgProvider = CgContext.Provider;

export function useCgContextValue(opts: {
  rundownId: string;
  state: CgState | null;
  graphics: Map<string, ScriptGraphicBlock[]>;
  canFire: boolean;
  apply: (state: CgState) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const hasDevices = Object.keys(opts.state?.devices ?? {}).length > 0;
  const clips = useCgClips(hasDevices);
  const clipMap = useMemo(() => {
    if (!clips.data || !clips.data.connected) return null;
    return new Map(clips.data.clips.map((c) => [normalizeClip(c.name), c.duration]));
  }, [clips.data]);
  const value = useMemo<CgContextValue>(
    () => ({ ...opts, clips: clipMap, setError }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [opts.rundownId, opts.state, opts.graphics, opts.canFire, opts.apply, clipMap],
  );
  return { value, error, setError };
}

/** Orden a RunFlow CG; el estado nuevo se aplica y los errores se muestran en la escaleta. */
export async function cgCommand(ctx: CgContextValue, path: string, body: unknown) {
  try {
    ctx.setError(null);
    const res = await api.post<{ cg: CgState }>(`/api/rundowns/${ctx.rundownId}/cg/${path}`, body);
    ctx.apply(res.cg);
  } catch (err) {
    ctx.setError(errorMessage(err));
  }
}

/** Celda GRAFISMO: cada rótulo con su ▶/■ y su estado (preparado, en aire, emitido). */
export function GraphicsCell({ lineId }: { lineId: string }) {
  const ctx = useContext(CgContext);
  const list = ctx?.graphics.get(lineId) ?? [];
  if (!ctx || !list.length) return null;
  return (
    <span className="rf-cg-cell">
      {list.map((g) => {
        const onAir = ctx.state?.graphics[g.id];
        const done = !onAir && !!ctx.state?.done[g.id];
        const summary = graphicSummary(g);
        return (
          <span
            key={g.id}
            className={`rf-cg-item${onAir ? ' is-onair' : done ? ' is-done' : ''}`}
            title={summary}
          >
            {ctx.canFire && (
              <button
                type="button"
                className="rf-cg-btn"
                aria-label={`${onAir ? 'Sacar' : 'Lanzar'} rótulo ${summary}`}
                onMouseDown={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  void cgCommand(ctx, onAir ? 'out' : 'take', { graphicId: g.id });
                }}
              >
                {onAir ? '■' : '▶'}
              </button>
            )}
            {done && <span aria-label="emitido">✔</span>}
            <span className="rf-cg-item__text">{summary}</span>
          </span>
        );
      })}
    </span>
  );
}

/** Celda PLAY: ◼ preparado + duración, ► en reproducción con barra y restante, 🔁 bucle, ⚠ falta. */
export function PlayCell({ line }: { line: LineSnapshot }) {
  const ctx = useContext(CgContext);
  const clip = typeof line.cells.clip === 'string' ? line.cells.clip.trim() : '';
  if (!ctx || !clip) return null;
  const playing = ctx.state?.clip?.lineId === line.id ? ctx.state.clip : null;
  if (playing && playing.state !== 'stopped') return <PlayingClip clip={playing} />;
  const known = ctx.clips?.get(normalizeClip(clip));
  const duration =
    known ?? (typeof line.cells.dur_vtr === 'number' ? line.cells.dur_vtr : null) ?? null;
  if (ctx.clips && known === undefined) {
    return (
      <span className="rf-play is-missing" title={`«${clip}» no está en CasparCG`}>
        ⚠ falta
      </span>
    );
  }
  const preloaded = ctx.state?.preroll?.lineId === line.id;
  const isVtr = TIMECODE_LINE_TYPES.has(String(line.cells.tipo ?? ''));
  return (
    <span
      className={`rf-play${preloaded ? ' is-preloaded' : ''}`}
      title={preloaded ? 'Precargado en CasparCG' : clip}
    >
      ◼ {duration !== null ? formatDuration(duration, { short: true }) : ''}
      {!isVtr && <span className="rf-muted"> (no es VTR)</span>}
    </span>
  );
}

function PlayingClip({ clip }: { clip: NonNullable<CgState['clip']> }) {
  const now = useServerNow(250);
  const duration = clip.duration ?? 0;
  const shown = clipPosition(clip, now);
  const remaining = Math.max(0, duration - shown);
  const pct = duration ? Math.min(100, (shown / duration) * 100) : 0;
  return (
    <span
      className={`rf-play is-playing${clip.state === 'paused' ? ' is-paused' : ''}${clip.state === 'loaded' ? ' is-loaded' : ''}`}
    >
      <span className="rf-play__label">
        {clip.loop ? '🔁' : clip.state === 'paused' ? '❚❚' : clip.state === 'loaded' ? '⏏' : '►'}{' '}
        {duration ? `-${formatDuration(remaining, { short: true })}` : formatDuration(shown)}
      </span>
      <span className="rf-play__bar" aria-hidden="true">
        <span style={{ width: `${pct}%` }} />
      </span>
    </span>
  );
}

/** Nombre corto del equipo («CasparCG (estudio virtual)» → «CasparCG»). */
const shortName = (name: string) => name.replace(/\s*\([^)]*\)\s*$/, '') || name;

/**
 * Cabecera de la escaleta: ● CasparCG ● OBS en verde/rojo y, en cada
 * mezclador, ● Emitir y ● Grabar.
 */
export function CgBar({
  canGo,
  mixers,
  rundownId,
  onMixers,
}: {
  canGo: boolean;
  mixers: MixerState | null;
  rundownId: string;
  onMixers: (state: MixerState) => void;
}) {
  const [streamError, setStreamError] = useState<string | null>(null);
  const [confirmStop, setConfirmStop] = useState<string | null>(null);
  const stream = async (deviceId: string, action: StreamAction) => {
    setStreamError(null);
    setConfirmStop(null);
    try {
      const res = await api.post<{ mixers: MixerState }>(
        `/api/rundowns/${rundownId}/mixers/stream`,
        { deviceId, action },
      );
      onMixers(res.mixers);
    } catch (err) {
      setStreamError(errorMessage(err));
    }
  };
  const ctx = useContext(CgContext);
  const cgDevices = Object.values(ctx?.state?.devices ?? {});
  const mixerDevices = Object.entries(mixers?.devices ?? {});
  if (!cgDevices.length && !mixerDevices.length) return null;
  const led = (on: boolean) => (
    <span className={`rf-led${on ? ' is-on' : ''}`} aria-hidden="true">
      ●
    </span>
  );
  return (
    <div className="rf-cgbar" role="group" aria-label="Equipos">
      {cgDevices.map((d) => (
        <span
          key={d.name}
          className={`rf-cgbar__device${d.connected ? ' is-ok' : ' is-down'}`}
          title={`${d.name}: ${d.connected ? (d.version ?? 'conectado') : (d.error ?? 'sin conexión')}`}
        >
          ● {shortName(d.name)}
        </span>
      ))}
      {mixerDevices.map(([id, d]) => {
        const out = mixers?.outputs?.[id];
        return (
          <span key={id} className="rf-cgbar__mixer">
            <span
              className={`rf-cgbar__device${d.connected ? ' is-ok' : ' is-down'}`}
              title={`${d.name}: ${d.connected ? (d.version ?? 'conectado') : (d.error ?? 'sin conexión')}`}
            >
              ● {shortName(d.name)}
            </span>
            {out?.streaming && <span className="rf-cgbar__onair">EN EMISIÓN</span>}
            {out?.recording && <span className="rf-cgbar__rec">● REC</span>}
            {canGo && d.connected && (
              <>
                {out?.streaming ? (
                  confirmStop === id ? (
                    <button
                      type="button"
                      className="rf-btn rf-btn--danger rf-btn--sm"
                      onClick={() => void stream(id, 'stopStream')}
                    >
                      Confirmar corte
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="rf-btn rf-btn--ghost rf-btn--sm rf-cgbar__btn"
                      onClick={() => setConfirmStop(id)}
                    >
                      {led(true)} Cortar emisión
                    </button>
                  )
                ) : (
                  <button
                    type="button"
                    className="rf-btn rf-btn--ghost rf-btn--sm rf-cgbar__btn"
                    onClick={() => void stream(id, 'startStream')}
                  >
                    {led(false)} Emitir
                  </button>
                )}
                <button
                  type="button"
                  className="rf-btn rf-btn--ghost rf-btn--sm rf-cgbar__btn"
                  aria-pressed={!!out?.recording}
                  onClick={() => void stream(id, out?.recording ? 'stopRecord' : 'startRecord')}
                >
                  {led(!!out?.recording)} {out?.recording ? 'Parar grabación' : 'Grabar'}
                </button>
              </>
            )}
          </span>
        );
      })}
      {streamError && (
        <span className="rf-cgbar__warning" role="alert">
          ⚠ {streamError}
        </span>
      )}
    </div>
  );
}

/** Barra de directo: programa del mezclador, avisos de equipos y «Sacar rótulos». */
export function CgStatus({ mixers }: { mixers: MixerState | null }) {
  const ctx = useContext(CgContext);
  const onAir = Object.keys(ctx?.state?.graphics ?? {}).length;
  const warnings = [ctx?.state?.warning, mixers?.warning].filter(Boolean).join(' · ');
  if (!mixers?.program && !warnings && !onAir) return null;
  return (
    <span className="rf-cgstatus">
      {mixers?.program && (
        <span className="rf-cgbar__program" title="Fuente de la línea en aire">
          PGM <strong>{mixers.program.source}</strong>
          {mixers.lastCutMs !== null && (
            <span className="rf-muted"> · corte {mixers.lastCutMs} ms</span>
          )}
        </span>
      )}
      {warnings && (
        <span className="rf-cgbar__warning" role="alert" title={warnings}>
          ⚠ {warnings}
        </span>
      )}
      {ctx && onAir > 0 && ctx.canFire && (
        <button
          type="button"
          className="rf-btn rf-btn--danger rf-btn--sm"
          onClick={() => void cgCommand(ctx, 'clear', {})}
        >
          Sacar rótulos ({onAir})
        </button>
      )}
    </span>
  );
}

const clipName = (line: LineSnapshot | undefined) =>
  typeof line?.cells.clip === 'string' ? line.cells.clip.trim() : '';

/** Posición actual (s) de un clip según su estado. */
export function clipPosition(clip: NonNullable<CgState['clip']>, now: number): number {
  const elapsed =
    clip.state === 'playing' && clip.startedAt !== null
      ? (now - clip.startedAt) / 1000
      : (clip.position ?? 0);
  const duration = clip.duration ?? 0;
  return clip.loop && duration ? elapsed % duration : elapsed;
}

/** Ordena al VTR (LOAD, PLAY, pausa, STOP, búsqueda) desde fuera de la barra. */
export function useClipCommand() {
  const ctx = useContext(CgContext);
  return ctx
    ? (body: { action: string; lineId?: string; seconds?: number }) =>
        void cgCommand(ctx, 'clip', body)
    : null;
}

/**
 * Transporte del VTR junto a ◀ Volver / ■ Terminar: LOAD (carga sin
 * reproducir), PLAY, PAUSA, STOP, bucle y deslizador para ir a un punto.
 * Actúa sobre el vídeo cargado o, si no hay, el de la línea en aire o el siguiente.
 */
export function VtrTransport({
  lines,
  onAirLineId,
  nextLineId,
}: {
  lines: LineSnapshot[];
  onAirLineId: string | null;
  nextLineId: string | null;
}) {
  const ctx = useContext(CgContext);
  const now = useServerNow(250);
  const [scrub, setScrub] = useState<number | null>(null);
  if (!ctx || !Object.keys(ctx.state?.devices ?? {}).length) return null;
  const clip = ctx.state?.clip ?? null;
  const active = clip && clip.state !== 'stopped' ? clip : null;
  // Vídeo de la línea en aire o, si no tiene, el siguiente con CLIP.
  const onAirIndex = lines.findIndex((l) => l.id === onAirLineId);
  const candidate =
    (clipName(lines[onAirIndex]) && lines[onAirIndex]) ||
    lines.find((l) => l.id === nextLineId && clipName(l)) ||
    lines.slice(onAirIndex + 1).find((l) => clipName(l));
  const target = active ? lines.find((l) => l.id === active.lineId) : candidate;
  const name = active?.name ?? clipName(target);
  const duration =
    active?.duration ??
    (target
      ? (ctx.clips?.get(normalizeClip(clipName(target))) ??
        (typeof target.cells.dur_vtr === 'number' ? target.cells.dur_vtr : null))
      : null) ??
    0;
  const position = active ? clipPosition(active, now) : 0;
  const shown = scrub ?? Math.min(position, duration || position);
  const send = (action: string, extra: { lineId?: string; seconds?: number } = {}) =>
    void cgCommand(ctx, 'clip', { action, ...extra });
  const seek = () => {
    if (scrub !== null) send('seek', { seconds: scrub });
    setScrub(null);
  };
  const loadTarget = candidate ?? target;
  return (
    <span className="rf-transport" role="group" aria-label="Vídeo">
      <button
        type="button"
        className="rf-transport__btn rf-transport__btn--load"
        aria-label="Cargar vídeo (LOAD)"
        title={loadTarget ? `LOAD ${clipName(loadTarget)} (sin reproducir)` : 'Sin vídeo'}
        disabled={!loadTarget}
        onClick={() => loadTarget && send('load', { lineId: loadTarget.id })}
      >
        LOAD
      </button>
      <button
        type="button"
        className={`rf-transport__btn${active?.state === 'playing' ? ' is-on' : ''}`}
        aria-label="Reproducir vídeo"
        title="PLAY"
        disabled={!target}
        onClick={() => send('play', active ? {} : target ? { lineId: target.id } : {})}
      >
        ▶
      </button>
      <button
        type="button"
        className={`rf-transport__btn${active?.state === 'paused' ? ' is-on' : ''}`}
        aria-label={active?.state === 'paused' ? 'Continuar' : 'Pausa'}
        aria-pressed={active?.state === 'paused'}
        title={active?.state === 'paused' ? 'Continuar' : 'Pausa'}
        disabled={!active || active.state === 'loaded'}
        onClick={() => send(active?.state === 'paused' ? 'resume' : 'pause')}
      >
        ❚❚
      </button>
      <button
        type="button"
        className="rf-transport__btn"
        aria-label="Parar vídeo"
        title="STOP"
        disabled={!active}
        onClick={() => send('stop')}
      >
        ■
      </button>
      <button
        type="button"
        className={`rf-transport__btn${active?.loop ? ' is-on' : ''}`}
        aria-label="Bucle"
        aria-pressed={!!active?.loop}
        title="Bucle"
        disabled={!active}
        onClick={() => send('loop')}
      >
        🔁
      </button>
      <input
        type="range"
        className="rf-transport__scrub"
        aria-label="Punto de reproducción"
        min={0}
        max={Math.max(duration, 0.1)}
        step={0.1}
        value={shown}
        disabled={!active || !duration}
        onChange={(e) => setScrub(Number(e.target.value))}
        onPointerUp={seek}
        onKeyUp={seek}
        onBlur={() => setScrub(null)}
      />
      <span className="rf-transport__time rf-tabular" title={name || undefined}>
        {formatDuration(shown, { short: true })}
        {duration ? ` / ${formatDuration(duration, { short: true })}` : ''}
        <span className="rf-transport__name">
          {name ? ` · ${name}` : ''}
          {active?.state === 'loaded' && ' (cargado)'}
        </span>
      </span>
    </span>
  );
}
