/*
 * Motor de tiempos de la escaleta (PLAN §10). Funciones puras: las usan el
 * servidor (avance automático) y la web (relojes y columnas de hora).
 *
 * Todas las horas son milisegundos epoch (UTC); las duraciones, segundos.
 */

import { LINE_TYPE_BY_KEY } from './rundown';

export type LiveMode = 'manual' | 'automatico' | 'hibrido' | 'evento';

export const LIVE_MODES: { value: LiveMode; label: string; description: string }[] = [
  { value: 'manual', label: 'Manual', description: 'Solo avanza con GO' },
  {
    value: 'hibrido',
    label: 'Híbrido',
    description: 'Avanza solo en las líneas con autonext (VTR por defecto); el resto con GO',
  },
  {
    value: 'automatico',
    label: 'Automático',
    description: 'Cada línea pasa a la siguiente al cumplir su duración',
  },
  {
    value: 'evento',
    label: 'Evento',
    description: 'Arranca solo a la hora programada, respeta las horas fijas y avanza solo',
  },
];

/** Tipos de línea con autonext por defecto (piezas que terminan solas). */
export const AUTONEXT_TYPES = new Set(['VTR', 'TOTAL_COLAS', 'CAB_RAF']);

/** Claves internas de línea (no son columnas visibles). */
export const LINE_FLAGS = {
  /** '1' = línea flotante (no cuenta en los tiempos). */
  floating: '_float',
  /** 'HH:MM:SS' = hora fija de inicio. */
  hardTime: '_hard',
  /** '1' sí, '0' no; sin valor = según el tipo. */
  autonext: '_auto',
  /** '1' = la línea abre un bloque (ej. HEADLINES 1) con reloj propio. */
  block: '_block',
} as const;

export interface TimingLine {
  id: string;
  cells: Record<string, string | number>;
}

export interface PlayedLine {
  startedAt: number;
  /** Duración real en segundos. */
  duration: number;
}

export interface LiveState {
  mode: LiveMode;
  /** Automatismos de equipos armados (CasparCG, mezclador: M7–M8). */
  armed: boolean;
  /** Ensayo: no cambia estados ni cuenta como emisión oficial. */
  rehearsal: boolean;
  /** El autonext corta al final de la duración o al final del coleo. */
  autonextAt: 'duration' | 'coleo';
  onAir: { lineId: string; startedAt: number } | null;
  /** Siguiente elegida a mano (null = la siguiente en orden). */
  next: string | null;
  played: Record<string, PlayedLine>;
  showStartedAt: number | null;
  showEndedAt: number | null;
  /** Se incrementa con cada cambio (para detectar órdenes obsoletas). */
  seq: number;
  lastGoAt: number;
}

export function initialLiveState(): LiveState {
  return {
    mode: 'hibrido',
    armed: false,
    rehearsal: false,
    autonextAt: 'duration',
    onAir: null,
    next: null,
    played: {},
    showStartedAt: null,
    showEndedAt: null,
    seq: 0,
    lastGoAt: 0,
  };
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function isFloating(line: TimingLine): boolean {
  return line.cells[LINE_FLAGS.floating] === '1';
}

/** Duración prevista: TIEMPO ESTIMADO o, si no hay, DUR. VTR. */
export function lineDuration(line: TimingLine): number {
  return num(line.cells.t_est) ?? num(line.cells.dur_vtr) ?? 0;
}

export function lineColeo(line: TimingLine): number {
  return num(line.cells.coleo) ?? 0;
}

/** ¿Pasa sola a la siguiente al terminar? (según línea, tipo y modo). */
export function hasAutonext(line: TimingLine, mode: LiveMode): boolean {
  if (mode === 'manual') return false;
  if (mode === 'automatico' || mode === 'evento') return lineDuration(line) > 0;
  const flag = line.cells[LINE_FLAGS.autonext];
  if (flag === '1') return lineDuration(line) > 0;
  if (flag === '0') return false;
  return AUTONEXT_TYPES.has(String(line.cells.tipo ?? '')) && lineDuration(line) > 0;
}

/** Hora fija de la línea como epoch, en el día de la escaleta. */
export function hardTimeAt(line: TimingLine, dayStartMs: number): number | null {
  const v = line.cells[LINE_FLAGS.hardTime];
  if (typeof v !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(v);
  if (!m) return null;
  return dayStartMs + (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0)) * 1000;
}

export interface LineTiming {
  /** Hora prevista (o real si ya salió) de inicio. */
  start: number;
  /** Hora a la que debería empezar para acabar en hora (back-time). */
  backTime: number;
  /** Duración usada en el cálculo (s). */
  duration: number;
  /** Suma acumulada de DUR. VTR hasta esta línea (s). */
  vtrSum: number;
  state: 'played' | 'onAir' | 'next' | 'pending' | 'floating';
  /** Duración real (s) de las emitidas; transcurrido en la que está en aire. */
  actual: number | null;
}

export interface RundownTiming {
  lines: Map<string, LineTiming>;
  plannedStart: number;
  plannedEnd: number;
  /** Fin previsto con lo emitido y lo que queda. */
  projectedEnd: number;
  /** projectedEnd − plannedEnd en segundos: + vamos largos, − vamos cortos. */
  overUnder: number;
  /** Suma de duraciones previstas (sin flotantes), s. */
  totalEstimated: number;
  nextLineId: string | null;
  onAirLineId: string | null;
}

/** Siguiente línea que saldría tras la que está en aire (o la primera, si no ha empezado). */
export function resolveNext(lines: TimingLine[], live: LiveState): string | null {
  const played = live.played;
  if (live.next && lines.some((l) => l.id === live.next && !isFloating(l))) return live.next;
  const startIdx = live.onAir ? lines.findIndex((l) => l.id === live.onAir!.lineId) + 1 : 0;
  for (let i = Math.max(0, startIdx); i < lines.length; i++) {
    const l = lines[i]!;
    if (isFloating(l)) continue;
    if (!live.onAir && played[l.id]) continue;
    return l.id;
  }
  return null;
}

export interface RundownWindow {
  plannedStart: number;
  plannedEnd: number;
  /** Medianoche del día de la escaleta en su zona horaria (base de las horas fijas). */
  dayStart: number;
}

export function computeTiming(
  lines: TimingLine[],
  window: RundownWindow,
  live: LiveState,
  now: number,
): RundownTiming {
  const { plannedStart, dayStart } = window;
  const plannedEnd =
    window.plannedEnd > plannedStart ? window.plannedEnd : window.plannedEnd + 86_400_000;
  const result = new Map<string, LineTiming>();
  const onAirId = live.onAir?.lineId ?? null;
  const nextId = resolveNext(lines, live);
  const counted = lines.filter((l) => !isFloating(l));
  const totalEstimated = counted.reduce((s, l) => s + lineDuration(l), 0);

  // Front-time: lo emitido con sus horas reales; lo pendiente, encadenado desde ahora.
  // Sin empezar: desde la hora programada (o desde ahora, si ya vamos tarde).
  let cursor = live.showStartedAt ?? Math.max(plannedStart, live.showEndedAt ? plannedStart : now);
  let vtrSum = 0;

  lines.forEach((line) => {
    const duration = lineDuration(line);
    vtrSum += num(line.cells.dur_vtr) ?? 0;
    const played = live.played[line.id];
    if (isFloating(line)) {
      result.set(line.id, {
        start: cursor,
        backTime: 0,
        duration,
        vtrSum,
        state: 'floating',
        actual: null,
      });
      return;
    }
    if (line.id === onAirId) {
      const startedAt = live.onAir!.startedAt;
      const elapsed = Math.max(0, (now - startedAt) / 1000);
      result.set(line.id, {
        start: startedAt,
        backTime: 0,
        duration,
        vtrSum,
        state: 'onAir',
        actual: elapsed,
      });
      // Si se pasa de su duración, empuja a las siguientes.
      cursor = startedAt + Math.max(duration, elapsed) * 1000;
      return;
    }
    if (played) {
      result.set(line.id, {
        start: played.startedAt,
        backTime: 0,
        duration,
        vtrSum,
        state: 'played',
        actual: played.duration,
      });
      cursor = Math.max(cursor, played.startedAt + played.duration * 1000);
      return;
    }
    const hard = live.mode === 'evento' ? hardTimeAt(line, dayStart) : null;
    const start = hard !== null && hard > cursor ? hard : cursor;
    result.set(line.id, {
      start,
      backTime: 0,
      duration,
      vtrSum,
      state: line.id === nextId ? 'next' : 'pending',
      actual: null,
    });
    cursor = start + duration * 1000;
  });

  // Back-time: desde el fin programado hacia atrás.
  let back = plannedEnd;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    const t = result.get(line.id)!;
    if (t.state === 'floating') continue;
    back -= t.duration * 1000;
    t.backTime = back;
  }

  const projectedEnd = live.showEndedAt ?? cursor;
  return {
    lines: result,
    plannedStart,
    plannedEnd,
    projectedEnd,
    overUnder: Math.round((projectedEnd - plannedEnd) / 1000),
    totalEstimated,
    nextLineId: nextId,
    onAirLineId: onAirId,
  };
}

/**
 * Momento en que la línea en aire debe pasar sola a la siguiente, o null.
 */
export function autoAdvanceAt(lines: TimingLine[], live: LiveState): number | null {
  if (!live.onAir) return null;
  const line = lines.find((l) => l.id === live.onAir!.lineId);
  if (!line || !hasAutonext(line, live.mode)) return null;
  const extra = live.autonextAt === 'coleo' ? lineColeo(line) : 0;
  return live.onAir.startedAt + (lineDuration(line) + extra) * 1000;
}

/**
 * Próximo evento programado en modo evento: arranque a la hora o línea con
 * hora fija. Devuelve la línea que debe entrar y cuándo.
 */
export function scheduledEvent(
  lines: TimingLine[],
  live: LiveState,
  window: RundownWindow,
): { at: number; lineId: string | null } | null {
  if (live.mode !== 'evento' || live.showEndedAt) return null;
  if (!live.onAir && !live.showStartedAt) return { at: window.plannedStart, lineId: null };
  const dayStart = window.dayStart;
  const onAirIndex = live.onAir ? lines.findIndex((l) => l.id === live.onAir!.lineId) : -1;
  let best: { at: number; lineId: string } | null = null;
  lines.forEach((l, i) => {
    if (i <= onAirIndex || isFloating(l) || live.played[l.id]) return;
    const at = hardTimeAt(l, dayStart);
    if (at !== null && (!best || at < best.at)) best = { at, lineId: l.id };
  });
  return best;
}

/* ---------- Zonas horarias ---------- */

function tzOffsetMs(epoch: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(epoch));
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return asUtc - Math.floor(epoch / 1000) * 1000;
}

/** Fecha y hora locales de una zona (p. ej. Europe/Madrid) → epoch ms. */
export function zonedToEpoch(date: string, time: string, timeZone: string): number {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  const [h, mi, s] = time.split(':').map(Number) as [number, number, number?];
  const guess = Date.UTC(y, mo - 1, d, h, mi, s ?? 0);
  let epoch = guess - tzOffsetMs(guess, timeZone);
  // Segunda pasada para cambios de hora (horario de verano).
  epoch = guess - tzOffsetMs(epoch, timeZone);
  return epoch;
}

/** Ventana programada de una escaleta en epoch ms (si el fin es anterior al inicio, cruza medianoche). */
export function rundownWindow(
  airDate: string,
  startTime: string,
  endTime: string,
  timeZone: string,
): RundownWindow {
  const plannedStart = zonedToEpoch(airDate, startTime, timeZone);
  let plannedEnd = zonedToEpoch(airDate, endTime, timeZone);
  if (plannedEnd <= plannedStart) plannedEnd += 86_400_000;
  return { plannedStart, plannedEnd, dayStart: zonedToEpoch(airDate, '00:00:00', timeZone) };
}

export function lineTypeLabel(key: unknown): string {
  return LINE_TYPE_BY_KEY[String(key ?? '')]?.label ?? String(key ?? '');
}

/* ---------- Bloques (PLAN §10: reloj de bloque) ---------- */

export interface RundownBlock {
  /** Línea que abre el bloque. */
  id: string;
  name: string;
  lineIds: string[];
  /** Suma de los tiempos estimados de sus líneas (sin flotantes). */
  plannedSeconds: number;
}

export function isBlockStart(line: TimingLine): boolean {
  return line.cells[LINE_FLAGS.block] === '1';
}

/** Bloques de la escaleta: cada inicio de bloque agrupa las líneas hasta el siguiente. */
export function rundownBlocks(lines: TimingLine[]): RundownBlock[] {
  const blocks: RundownBlock[] = [];
  let current: RundownBlock | null = null;
  for (const line of lines) {
    if (isBlockStart(line)) {
      const name =
        String(line.cells.nombre ?? '').trim() || lineTypeLabel(line.cells.tipo) || 'Bloque';
      current = { id: line.id, name, lineIds: [], plannedSeconds: 0 };
      blocks.push(current);
    }
    if (!current) continue;
    current.lineIds.push(line.id);
    if (!isFloating(line)) current.plannedSeconds += lineDuration(line);
  }
  return blocks;
}

export interface BlockClock {
  block: RundownBlock;
  /** Segundos desde que empezó el bloque. */
  elapsed: number;
  /** Segundos que quedan según lo previsto (negativo: el bloque va largo). */
  remaining: number;
}

/** Reloj del bloque en aire: desde la primera de sus líneas que salió en este directo. */
export function currentBlockClock(
  lines: TimingLine[],
  live: LiveState,
  now: number,
): BlockClock | null {
  const onAirId = live.onAir?.lineId;
  if (!onAirId) return null;
  const block = rundownBlocks(lines).find((b) => b.lineIds.includes(onAirId));
  if (!block) return null;
  let start = live.onAir!.startedAt;
  for (const id of block.lineIds) {
    const played = live.played[id];
    if (played && played.startedAt < start) start = played.startedAt;
  }
  const elapsed = Math.max(0, (now - start) / 1000);
  return { block, elapsed, remaining: block.plannedSeconds - elapsed };
}
