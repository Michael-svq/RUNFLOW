import { createContext, useContext, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  formatDuration,
  graphicSummary,
  normalizeClip,
  TIMECODE_LINE_TYPES,
  type CgState,
  type MixerState,
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

async function command(ctx: CgContextValue, path: string, body: unknown) {
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
                  void command(ctx, onAir ? 'out' : 'take', { graphicId: g.id });
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
  const elapsed =
    clip.state === 'paused'
      ? (clip.position ?? 0)
      : clip.startedAt !== null
        ? (now - clip.startedAt) / 1000
        : 0;
  const duration = clip.duration ?? 0;
  const shown = clip.loop && duration ? elapsed % duration : elapsed;
  const remaining = Math.max(0, duration - shown);
  const pct = duration ? Math.min(100, (shown / duration) * 100) : 0;
  return (
    <span className={`rf-play is-playing${clip.state === 'paused' ? ' is-paused' : ''}`}>
      <span className="rf-play__label">
        {clip.loop ? '🔁' : clip.state === 'paused' ? '❚❚' : '►'}{' '}
        {duration ? `-${formatDuration(remaining, { short: true })}` : formatDuration(shown)}
      </span>
      <span className="rf-play__bar" aria-hidden="true">
        <span style={{ width: `${pct}%` }} />
      </span>
    </span>
  );
}

/** En la barra de directo: equipos, programa del mezclador, aviso ⚠ y controles del VTR. */
export function CgBar({ canGo, mixers }: { canGo: boolean; mixers: MixerState | null }) {
  const ctx = useContext(CgContext);
  const cgDevices = Object.values(ctx?.state?.devices ?? {});
  const mixerDevices = Object.values(mixers?.devices ?? {});
  const onAir = Object.keys(ctx?.state?.graphics ?? {}).length;
  const clip = ctx?.state?.clip ?? null;
  if (!cgDevices.length && !mixerDevices.length && !onAir) return null;
  const warnings = [ctx?.state?.warning, mixers?.warning].filter(Boolean).join(' · ');
  return (
    <div className="rf-cgbar" role="group" aria-label="Equipos">
      {[...cgDevices, ...mixerDevices].map((d) => (
        <span
          key={d.name}
          className={`rf-cgbar__device${d.connected ? ' is-ok' : ' is-down'}`}
          title={d.connected ? (d.version ?? 'Conectado') : (d.error ?? 'Sin conexión')}
        >
          ● {d.name}
        </span>
      ))}
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
      {ctx && clip && clip.state !== 'stopped' && canGo && (
        <span className="rf-cgbar__clip">
          <span className="rf-muted">VTR {clip.name}</span>
          <button
            type="button"
            className="rf-btn rf-btn--ghost rf-btn--sm"
            onClick={() =>
              void command(ctx, 'clip', { action: clip.state === 'paused' ? 'resume' : 'pause' })
            }
          >
            {clip.state === 'paused' ? 'Continuar' : 'Pausa'}
          </button>
          <button
            type="button"
            className="rf-btn rf-btn--ghost rf-btn--sm"
            aria-pressed={clip.loop}
            onClick={() => void command(ctx, 'clip', { action: 'loop' })}
          >
            Bucle
          </button>
          <button
            type="button"
            className="rf-btn rf-btn--ghost rf-btn--sm"
            onClick={() => void command(ctx, 'clip', { action: 'stop' })}
          >
            Parar
          </button>
        </span>
      )}
      {ctx && onAir > 0 && ctx.canFire && (
        <button
          type="button"
          className="rf-btn rf-btn--danger rf-btn--sm"
          onClick={() => void command(ctx, 'clear', {})}
        >
          Sacar rótulos ({onAir})
        </button>
      )}
    </div>
  );
}
