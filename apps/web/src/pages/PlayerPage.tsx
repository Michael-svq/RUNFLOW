import { useMemo, useState, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  formatDuration,
  normalizeClip,
  type MediaDto,
  type RundownDto,
} from '@runflow/core';
import { moveLines, type LineSnapshot, type ScriptGraphicBlock } from '@runflow/sync';
import { Spinner } from '@runflow/ui';
import { api } from '../api/client';
import { useCan, useSession } from '../auth/session';
import { PageHeader } from '../components/PageHeader';
import { RundownPicker, useRundownChoice } from '../direction/RundownPicker';
import { CgProvider, useCgContextValue, VtrTransport } from '../rundown/cg';
import { LOCAL_ORIGIN, useLines, useRundownSession } from '../rundown/useRundownDoc';

/*
 * Dirección TV → Reproductor de vídeos: los vídeos de la escaleta en su orden,
 * con vista previa, paso de uno a otro y orden (mover aquí mueve la línea en
 * la escaleta, y al revés). El transporte manda el vídeo elegido a CasparCG.
 */

export function PlayerPage() {
  const choice = useRundownChoice();
  return (
    <>
      <PageHeader
        title="Reproductor de vídeos"
        intro="Los vídeos de la escaleta en orden. Elige uno para verlo, pasa al siguiente y ordénalos: el orden es el de la escaleta."
        actions={
          choice.rundowns.length > 0 && (
            <RundownPicker
              rundowns={choice.rundowns}
              value={choice.rundown?.id ?? ''}
              onChange={choice.setId}
            />
          )
        }
      />
      {choice.loading ? (
        <Spinner label="Cargando…" />
      ) : !choice.rundown ? (
        <p className="rf-muted">No hay escaletas entre ayer y las próximas dos semanas.</p>
      ) : (
        <ClipPlayer key={choice.rundown.id} rundown={choice.rundown} />
      )}
    </>
  );
}

const clipOf = (l: LineSnapshot) => (typeof l.cells.clip === 'string' ? l.cells.clip.trim() : '');
const NO_GRAPHICS = new Map<string, ScriptGraphicBlock[]>();

function ClipPlayer({ rundown }: { rundown: RundownDto }) {
  const { me, org } = useSession();
  const user = useMemo(() => ({ id: me.user.id, name: me.user.name }), [me.user.id, me.user.name]);
  const canMove = useCan('rundown.edit_structure');
  const { session, loaded, live, cg, setCg } = useRundownSession(org.id, rundown.id, user);
  const doc = session?.doc;
  const lines = useLines(doc);
  const clips = useMemo(() => lines.filter((l) => clipOf(l)), [lines]);
  const cgCtx = useCgContextValue({
    rundownId: rundown.id,
    state: cg,
    graphics: NO_GRAPHICS,
    canFire: false,
    apply: setCg,
  });
  const media = useQuery({
    queryKey: ['media', 'player'],
    queryFn: async () => (await api.get<{ media: MediaDto[] }>('/api/media')).media,
  });
  const mediaByClip = useMemo(() => {
    const map = new Map<string, MediaDto>();
    for (const m of media.data ?? []) {
      if (!m.mime.startsWith('video/')) continue;
      map.set(normalizeClip(m.clipName), m);
      map.set(normalizeClip(m.clipName.split('/').pop() ?? ''), m);
      if (!map.has(normalizeClip(m.name))) map.set(normalizeClip(m.name), m);
    }
    return map;
  }, [media.data]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [autoplay, setAutoplay] = useState(false);
  const [chain, setChain] = useState(false);
  const [drag, setDrag] = useState<{ id: string; drop: number | null } | null>(null);
  const index = Math.max(
    0,
    clips.findIndex((c) => c.id === selectedId),
  );
  const selected = clips[index] ?? null;

  const go = (to: number, play = true) => {
    const next = clips[to];
    if (!next) return;
    setSelectedId(next.id);
    setAutoplay(play);
  };

  /** Pone el vídeo `id` antes del vídeo número `before` (0…n) moviendo su línea en la escaleta. */
  const moveClip = (id: string, before: number) => {
    if (!doc || !canMove) return;
    const from = lines.findIndex((l) => l.id === id);
    const target = clips[before];
    const last = clips[clips.length - 1];
    const at = target
      ? lines.findIndex((l) => l.id === target.id)
      : lines.findIndex((l) => l.id === last?.id) + 1;
    if (from < 0 || at < 0 || target?.id === id) return;
    moveLines(doc, [id], at - (from < at ? 1 : 0), LOCAL_ORIGIN);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTableSectionElement>) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const up = e.key === 'ArrowUp';
    if (e.altKey && selected) moveClip(selected.id, up ? index - 1 : index + 2);
    else go(up ? index - 1 : index + 1, false);
  };

  if (!loaded && !clips.length) return <Spinner label="Abriendo la escaleta…" />;

  const statusOf = (l: LineSnapshot) => {
    const c = cg?.clip?.lineId === l.id && cg.clip.state !== 'stopped' ? cg.clip : null;
    if (c?.state === 'playing') return <span className="rf-gsheet__state is-onair">► EN AIRE</span>;
    if (c?.state === 'paused') return <span className="rf-gsheet__state">❚❚ PAUSA</span>;
    if (c?.state === 'loaded') return <span className="rf-gsheet__state">⏏ CARGADO</span>;
    if (cg?.preroll?.lineId === l.id) return <span className="rf-gsheet__state">PRECARGADO</span>;
    if (cgCtx.value.clips && !cgCtx.value.clips.has(normalizeClip(clipOf(l))))
      return (
        <span className="rf-gsheet__state is-bad" title="No está en CasparCG">
          ⚠ falta
        </span>
      );
    if (live?.onAir?.lineId === l.id) return <span className="rf-gsheet__state">EN AIRE</span>;
    return <span className="rf-muted">—</span>;
  };
  const durationOf = (l: LineSnapshot) => {
    const m = mediaByClip.get(normalizeClip(clipOf(l)));
    const d =
      m?.durationS ??
      cgCtx.value.clips?.get(normalizeClip(clipOf(l))) ??
      (typeof l.cells.dur_vtr === 'number' ? l.cells.dur_vtr : null);
    return d !== null && d !== undefined ? formatDuration(d, { short: true }) : '';
  };

  const selectedMedia = selected ? mediaByClip.get(normalizeClip(clipOf(selected))) : undefined;

  return (
    <CgProvider value={cgCtx.value}>
      <div className="rf-player">
        <section className="rf-card rf-player__list" aria-label="Vídeos de la escaleta">
          {clips.length === 0 ? (
            <p className="rf-muted">
              Esta escaleta no tiene vídeos: escribe el nombre del clip en la columna CLIP.
            </p>
          ) : (
            <div className="rf-table-wrap">
              <table className="rf-table rf-sheet rf-player__table" aria-label="Vídeos">
                <thead>
                  <tr>
                    {canMove && <th aria-label="Mover" />}
                    <th className="is-num">#</th>
                    <th>Nº</th>
                    <th>Noticia</th>
                    <th>Clip</th>
                    <th className="is-num">Dur.</th>
                    <th>Estado</th>
                    {canMove && <th aria-label="Orden" />}
                  </tr>
                </thead>
                <tbody onKeyDown={onKeyDown}>
                  {clips.map((l, i) => (
                    <tr
                      key={l.id}
                      data-line-id={l.id}
                      tabIndex={0}
                      aria-selected={selected?.id === l.id}
                      className={[
                        selected?.id === l.id && 'is-selected',
                        drag?.drop === i && 'is-drop-before',
                        drag?.drop === clips.length && i === clips.length - 1 && 'is-drop-after',
                        drag?.id === l.id && 'is-dragging',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      onClick={() => go(i, false)}
                      onDragOver={(e) => {
                        if (!drag) return;
                        e.preventDefault();
                        const r = e.currentTarget.getBoundingClientRect();
                        const drop = e.clientY > r.top + r.height / 2 ? i + 1 : i;
                        if (drop !== drag.drop) setDrag({ ...drag, drop });
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (drag?.drop != null) moveClip(drag.id, drag.drop);
                        setDrag(null);
                      }}
                    >
                      {canMove && (
                        <td
                          className="rf-player__handle"
                          draggable
                          title="Arrastra para cambiar el orden"
                          onDragStart={(e) => {
                            e.dataTransfer.effectAllowed = 'move';
                            e.dataTransfer.setData('text/x-rf-line', l.id);
                            setDrag({ id: l.id, drop: null });
                          }}
                          onDragEnd={() => setDrag(null)}
                        >
                          ⋮⋮
                        </td>
                      )}
                      <td className="is-num rf-tabular">{i + 1}</td>
                      <td className="rf-tabular">
                        <strong>{String(l.cells.num ?? '')}</strong>
                      </td>
                      <td>{String(l.cells.nombre ?? '')}</td>
                      <td className="rf-player__clip">
                        {mediaByClip.has(normalizeClip(clipOf(l))) && (
                          <span title="Con vista previa" aria-hidden="true">
                            ▶{' '}
                          </span>
                        )}
                        {clipOf(l)}
                      </td>
                      <td className="is-num rf-tabular">{durationOf(l)}</td>
                      <td>{statusOf(l)}</td>
                      {canMove && (
                        <td className="rf-player__order">
                          <button
                            type="button"
                            aria-label={`Subir el vídeo ${i + 1}`}
                            disabled={i === 0}
                            onClick={(e) => {
                              e.stopPropagation();
                              moveClip(l.id, i - 1);
                            }}
                          >
                            ▲
                          </button>
                          <button
                            type="button"
                            aria-label={`Bajar el vídeo ${i + 1}`}
                            disabled={i === clips.length - 1}
                            onClick={(e) => {
                              e.stopPropagation();
                              moveClip(l.id, i + 2);
                            }}
                          >
                            ▼
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="rf-card rf-player__view" aria-label="Reproductor">
          {selected ? (
            <>
              <h2 className="rf-tile__title">
                {index + 1}/{clips.length} · {String(selected.cells.num ?? '')}{' '}
                {String(selected.cells.nombre ?? '')}
              </h2>
              <p className="rf-muted rf-small" data-testid="player-clip">
                {clipOf(selected)}
              </p>
              <div className="rf-player__screen">
                {selectedMedia ? (
                  <video
                    key={selectedMedia.id}
                    controls
                    autoPlay={autoplay}
                    src={`/api/media/${selectedMedia.id}/file${
                      selectedMedia.proxyStatus === 'ready' ? '?proxy=1' : ''
                    }`}
                    onEnded={() => chain && go(index + 1)}
                  />
                ) : (
                  <p className="rf-player__empty">
                    Sin vista previa: el vídeo no está en Media (puede estar solo en CasparCG).
                  </p>
                )}
              </div>
              <div className="rf-player__nav">
                <button
                  type="button"
                  className="rf-btn rf-btn--secondary rf-btn--sm"
                  onClick={() => go(index - 1)}
                  disabled={index === 0}
                >
                  ◀◀ Anterior
                </button>
                <button
                  type="button"
                  className="rf-btn rf-btn--secondary rf-btn--sm"
                  onClick={() => go(index + 1)}
                  disabled={index >= clips.length - 1}
                >
                  Siguiente ▶▶
                </button>
                <label className="rf-livebar__check">
                  <input
                    type="checkbox"
                    checked={chain}
                    onChange={(e) => setChain(e.target.checked)}
                  />
                  Encadenar
                </label>
              </div>
              <div className="rf-player__cg">
                <span className="rf-muted rf-small">CasparCG</span>
                <VtrTransport
                  lines={lines}
                  onAirLineId={live?.onAir?.lineId ?? null}
                  nextLineId={null}
                  lineId={selected.id}
                />
                {!Object.keys(cg?.devices ?? {}).length && (
                  <span className="rf-muted rf-small">Sin CasparCG configurado.</span>
                )}
              </div>
            </>
          ) : (
            <p className="rf-muted">Elige un vídeo de la lista.</p>
          )}
        </section>
      </div>
    </CgProvider>
  );
}
