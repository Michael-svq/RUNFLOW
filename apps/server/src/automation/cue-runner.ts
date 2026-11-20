import type { FastifyBaseLogger } from 'fastify';
import type { AutomationState, Cue, CueTrack, LiveState } from '@runflow/core';
import { lineScript, readCues } from '@runflow/sync';
import type { CollabServer } from '../collab/collab-server';

/*
 * F4.2 Automatización avanzada: ejecuta los cues del timeline de la línea en
 * aire a su tiempo (desde el GO). Con los equipos armados y fuera de ensayo,
 * los cues de cámara/VTR cortan el mezclador, los de rótulos lanzan el rótulo
 * del guion y los de luces disparan la mesa (F4.3). Si se editan los cues en
 * pleno directo, se reprograman al momento.
 */

export const MSG_AUTOMATION = 107;

export interface CueContext {
  rundownId: string;
  orgId: string;
  lineId: string;
  cue: Cue;
  /** Rótulos del guion de la línea, en orden. */
  graphics: { id: string }[];
}

/** Lo que sabe hacer cada pista; devuelve false si no había equipo que mandar. */
export type CueExecutor = (ctx: CueContext) => Promise<boolean>;

interface RundownRun {
  orgId: string;
  live: LiveState | null;
  /** Documento abierto mientras hay una línea en aire (para ver los cambios al momento). */
  hold: Promise<{ release: () => Promise<void>; off: () => void } | null> | null;
  timers: Map<string, NodeJS.Timeout>;
  fired: Set<string>;
  state: AutomationState;
}

/** Tolerancia para lanzar cues que «acaban de pasar» (p. ej. el cue en 0:00:00 al dar GO). */
const LATE_MS = 750;
const KEEP = 30;

export class CueRunner {
  readonly executors: Partial<Record<CueTrack, CueExecutor>> = {};
  private readonly runs = new Map<string, RundownRun>();

  constructor(
    private readonly collab: CollabServer,
    private readonly log: FastifyBaseLogger,
  ) {
    collab.snapshots.push(async (rundownId) => {
      const r = this.runs.get(rundownId);
      return r ? { type: MSG_AUTOMATION, payload: r.state } : null;
    });
  }

  private run(rundownId: string, orgId: string): RundownRun {
    let r = this.runs.get(rundownId);
    if (!r || r.orgId !== orgId) {
      r = {
        orgId,
        live: null,
        hold: null,
        timers: new Map(),
        fired: new Set(),
        state: { fired: [] },
      };
      this.runs.set(rundownId, r);
    }
    return r;
  }

  /** Lo llama el motor de directo tras cada cambio. */
  onLive(rundownId: string, orgId: string, prev: LiveState, next: LiveState): void {
    const r = this.run(rundownId, orgId);
    r.live = next;
    const changed =
      prev.onAir?.lineId !== next.onAir?.lineId || prev.onAir?.startedAt !== next.onAir?.startedAt;
    if (!changed) return;
    r.fired.clear();
    if (next.onAir) this.holdDoc(rundownId, r);
    else this.releaseDoc(r);
    void this.reschedule(rundownId);
  }

  /** Mantiene el documento abierto y reprograma en cuanto cambian los cues. */
  private holdDoc(rundownId: string, r: RundownRun): void {
    if (r.hold) return;
    r.hold = this.collab
      .acquire(rundownId, r.orgId)
      .then(({ doc, release }) => {
        let timer: NodeJS.Timeout | undefined;
        const onUpdate = (_u: Uint8Array, origin: unknown) => {
          if (origin === 'load' || origin === 'live') return;
          clearTimeout(timer);
          timer = setTimeout(() => void this.reschedule(rundownId), 50);
        };
        doc.on('update', onUpdate);
        return {
          release,
          off: () => {
            clearTimeout(timer);
            doc.off('update', onUpdate);
          },
        };
      })
      .catch((err: unknown) => {
        this.log.warn({ err, rundownId }, 'Automatización: no se pudo abrir la escaleta');
        return null;
      });
  }

  private releaseDoc(r: RundownRun): void {
    const hold = r.hold;
    r.hold = null;
    void hold?.then(async (h) => {
      h?.off();
      await h?.release();
    });
  }

  private clear(r: RundownRun): void {
    for (const t of r.timers.values()) clearTimeout(t);
    r.timers.clear();
  }

  async reschedule(rundownId: string): Promise<void> {
    const r = this.runs.get(rundownId);
    if (!r) return;
    this.clear(r);
    const onAir = r.live?.onAir;
    if (!onAir) return;
    let cues: Cue[];
    try {
      cues = await this.collab.withDoc(rundownId, r.orgId, (doc) => readCues(doc, onAir.lineId));
    } catch (err) {
      this.log.warn({ err, rundownId }, 'Automatización: no se pudieron leer los cues');
      return;
    }
    // El directo pudo cambiar mientras se leía.
    if (r.live?.onAir?.lineId !== onAir.lineId || r.live.onAir.startedAt !== onAir.startedAt)
      return;
    this.clear(r);
    const now = Date.now();
    for (const cue of cues) {
      if (r.fired.has(cue.id)) continue;
      const due = onAir.startedAt + cue.at * 1000;
      if (due < now - LATE_MS) continue;
      r.timers.set(
        cue.id,
        setTimeout(() => void this.fire(rundownId, onAir, cue.id), Math.max(0, due - now)),
      );
    }
  }

  private async fire(
    rundownId: string,
    onAir: { lineId: string; startedAt: number },
    cueId: string,
  ): Promise<void> {
    const r = this.runs.get(rundownId);
    if (!r || r.live?.onAir?.lineId !== onAir.lineId || r.fired.has(cueId)) return;
    r.timers.delete(cueId);
    r.fired.add(cueId);
    // Se relee el cue y el guion en el momento (pudo editarse hasta el último instante).
    const found = await this.collab
      .withDoc(rundownId, r.orgId, (doc) => ({
        cue: readCues(doc, onAir.lineId).find((c) => c.id === cueId),
        graphics: lineScript(doc, onAir.lineId).graphics.map((g) => ({ id: g.id })),
      }))
      .catch(() => null);
    if (!found?.cue) return;
    const cue = found.cue;
    const active = !!r.live?.armed && !r.live.rehearsal;
    const executor = this.executors[cue.track];
    let executed = false;
    let error: string | null = null;
    if (active && executor) {
      try {
        executed = await executor({
          rundownId,
          orgId: r.orgId,
          lineId: onAir.lineId,
          cue,
          graphics: found.graphics,
        });
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
        this.log.warn({ rundownId, cue: cue.id, err: error }, 'Automatización: cue fallido');
      }
    }
    r.state.fired = [
      {
        cueId: cue.id,
        lineId: onAir.lineId,
        track: cue.track,
        label: cue.label,
        target: cue.target,
        at: Date.now(),
        executed,
        error,
      },
      ...r.state.fired,
    ].slice(0, KEEP);
    this.collab.broadcastCustom(rundownId, MSG_AUTOMATION, r.state);
  }

  state(rundownId: string): AutomationState {
    return this.runs.get(rundownId)?.state ?? { fired: [] };
  }

  close(): void {
    for (const r of this.runs.values()) {
      this.clear(r);
      void r.hold?.then((h) => h?.off());
    }
    this.runs.clear();
  }
}
