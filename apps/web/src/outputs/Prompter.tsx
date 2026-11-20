import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type * as Y from 'yjs';
import type { LiveState, OutputSettings, PrompterState } from '@runflow/core';
import { isFloating, lineTypeLabel } from '@runflow/core';
import { lineScript, type LineSnapshot } from '@runflow/sync';

/*
 * Teleprompter (PLAN §14): solo el paso (texto verde) de cada línea, en orden.
 * La posición se expresa como "línea + fracción" en el marcador de lectura, así
 * que salidas de distinto tamaño o tipo de letra quedan siempre sincronizadas.
 */

export interface PrompterBlock {
  lineId: string;
  num: string;
  name: string;
  paso: string[];
}

/** Bloques del prompter; se recalculan al cambiar el documento (agrupado por fotograma). */
export function usePrompterBlocks(
  doc: Y.Doc | undefined,
  lines: LineSnapshot[],
  showEmpty: boolean,
): PrompterBlock[] {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!doc) return;
    let frame = 0;
    const onUpdate = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setVersion((v) => v + 1);
      });
    };
    doc.on('update', onUpdate);
    return () => {
      cancelAnimationFrame(frame);
      doc.off('update', onUpdate);
    };
  }, [doc]);
  return useMemo(() => {
    if (!doc) return [];
    const out: PrompterBlock[] = [];
    for (const l of lines) {
      if (isFloating(l)) continue;
      const s = lineScript(doc, l.id);
      if (!s.paso.length && !showEmpty) continue;
      out.push({
        lineId: l.id,
        num: String(l.cells.num ?? ''),
        name: String(l.cells.nombre ?? '') || lineTypeLabel(l.cells.tipo),
        paso: s.paso,
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, lines, showEmpty, version]);
}

export interface Anchor {
  lineId: string | null;
  fraction: number;
}

/** Alto del contenedor (para escalar la letra: el ajuste es "px a 1080 de alto"). */
function useHeight(ref: RefObject<HTMLElement | null>): number {
  const [height, setHeight] = useState(1080);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight || 1080));
    ro.observe(el);
    setHeight(el.clientHeight || 1080);
    return () => ro.disconnect();
  }, [ref]);
  return height;
}

export function anchorAt(container: HTMLElement, marker: number): Anchor {
  // Margen de 2 px por el redondeo de los altos.
  const y = container.scrollTop + marker * container.clientHeight + 2;
  const blocks = container.querySelectorAll<HTMLElement>('[data-prompter-line]');
  let found: Anchor = { lineId: null, fraction: 0 };
  for (const b of blocks) {
    if (b.offsetTop <= y) {
      found = {
        lineId: b.dataset.prompterLine ?? null,
        fraction: Math.min(1, Math.max(0, (y - b.offsetTop) / Math.max(1, b.offsetHeight))),
      };
    } else break;
  }
  return found;
}

export function scrollTargetFor(
  container: HTMLElement,
  anchor: Anchor,
  marker: number,
): number | null {
  if (!anchor.lineId) return null;
  const el = container.querySelector<HTMLElement>(
    `[data-prompter-line="${CSS.escape(anchor.lineId)}"]`,
  );
  if (!el) return null;
  return el.offsetTop + anchor.fraction * el.offsetHeight - marker * container.clientHeight;
}

interface ViewProps {
  blocks: PrompterBlock[];
  settings: OutputSettings;
  live: LiveState | null;
  scrollRef: RefObject<HTMLDivElement | null>;
  compact?: boolean;
  onWheel?: () => void;
}

/** Presentación del prompter (sin lógica de movimiento). */
export function PrompterView({ blocks, settings, live, scrollRef, compact, onWheel }: ViewProps) {
  const height = useHeight(scrollRef);
  const fontPx = Math.max(
    10,
    ((compact ? settings.fontSize * 0.6 : settings.fontSize) * height) / 1080,
  );
  const onAir = live?.onAir?.lineId;
  return (
    <div className={`rf-prompter${compact ? ' rf-prompter--compact' : ''}`}>
      <div
        ref={scrollRef}
        className="rf-prompter__scroll"
        onWheel={onWheel}
        style={{ fontSize: fontPx }}
        data-testid="prompter-scroll"
      >
        <div
          className={`rf-prompter__content${settings.mirror ? ' is-mirror' : ''}${settings.uppercase ? ' is-upper' : ''}`}
        >
          <div style={{ height: settings.marker * height }} aria-hidden="true" />
          {blocks.length === 0 && (
            <p className="rf-prompter__empty">Sin texto de paso en la escaleta.</p>
          )}
          {blocks.map((b) => (
            <section
              key={b.lineId}
              data-prompter-line={b.lineId}
              className={`rf-prompter__block${b.lineId === onAir ? ' is-onair' : ''}`}
            >
              <h2 className="rf-prompter__head">
                <span>{b.num}</span> {b.name}
                {b.lineId === onAir && <span className="rf-prompter__onair">EN AIRE</span>}
              </h2>
              {b.paso.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </section>
          ))}
          <div style={{ height }} aria-hidden="true" />
        </div>
      </div>
      <div
        className={`rf-prompter__marker${settings.mirror ? ' is-mirror' : ''}`}
        style={{ top: `${settings.marker * 100}%` }}
        aria-hidden="true"
      >
        ▶
      </div>
    </div>
  );
}

/**
 * Salida: sigue la posición que marca el operador (suavizada y extrapolada
 * con la velocidad para que el movimiento sea continuo). Si el operador pidió
 * seguir el GO, salta a la línea en aire.
 */
export function useFollowPrompter(
  scrollRef: RefObject<HTMLDivElement | null>,
  state: PrompterState | null,
  live: LiveState | null,
  settings: OutputSettings,
  blocks: PrompterBlock[],
) {
  const target = useRef<number | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Nueva posición del operador → objetivo.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !state) return;
    const t = scrollTargetFor(el, state, settings.marker);
    if (t !== null) target.current = t;
  }, [state, settings.marker, scrollRef, blocks]);

  // Seguir el GO.
  const onAir = live?.onAir?.lineId ?? null;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !onAir || !stateRef.current?.followLive) return;
    const t = scrollTargetFor(el, { lineId: onAir, fraction: 0 }, settings.marker);
    if (t !== null) target.current = t;
  }, [onAir, settings.marker, scrollRef]);

  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const el = scrollRef.current;
      const s = stateRef.current;
      if (el && target.current !== null) {
        if (s?.running && s.speed) {
          const fontPx = parseFloat(getComputedStyle(el).fontSize) || 40;
          target.current += s.speed * fontPx * 0.5 * dt;
        }
        const diff = target.current - el.scrollTop;
        if (Math.abs(diff) > 0.5)
          el.scrollTop += Math.abs(diff) > el.clientHeight * 2 ? diff : diff * Math.min(1, dt * 8);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [scrollRef]);
}
