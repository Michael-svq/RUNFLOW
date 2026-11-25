import { generateKeyBetween } from 'fractional-indexing';
import * as Y from 'yjs';
import { clearCues, copyCues } from './cues';
import { clearScript, copyScript } from './script';

/*
 * Documento colaborativo de una escaleta (Yjs, CRDT).
 *
 *   doc.getMap('lines') : Y.Map<idLínea, Y.Map>
 *     línea.pos   : string  — posición con índice fraccional (orden)
 *     línea.cells : Y.Map<columna, string | number>
 *
 * Se usa un mapa (no un array) con posición fraccional para que dos personas
 * puedan mover líneas a la vez sin duplicarlas: mover = cambiar `pos`.
 * Empates de posición (inserciones simultáneas en el mismo hueco) se ordenan
 * por id, de forma idéntica en todos los clientes.
 */

export const LINES_KEY = 'lines';
export type CellValue = string | number;

export interface LineSnapshot {
  id: string;
  pos: string;
  cells: Record<string, CellValue>;
}

export function getLinesMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>(LINES_KEY);
}

function cellsOf(line: Y.Map<unknown>): Y.Map<CellValue> {
  return line.get('cells') as Y.Map<CellValue>;
}

function compare(a: { pos: string; id: string }, b: { pos: string; id: string }): number {
  if (a.pos < b.pos) return -1;
  if (a.pos > b.pos) return 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Líneas en orden, como objetos planos. */
export function readLines(doc: Y.Doc): LineSnapshot[] {
  const out: LineSnapshot[] = [];
  getLinesMap(doc).forEach((line, id) => {
    const cells = cellsOf(line);
    out.push({
      id,
      pos: (line.get('pos') as string) ?? 'a0',
      cells: cells ? (cells.toJSON() as Record<string, CellValue>) : {},
    });
  });
  return out.sort(compare);
}

function newId(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * Posición para insertar en `index` (0 = principio) dentro de `ordered`.
 * Si los vecinos empatan, separa antes los que empatan para hacer hueco.
 */
function positionAt(doc: Y.Doc, ordered: LineSnapshot[], index: number): string {
  const lines = getLinesMap(doc);
  const prev = ordered[index - 1];
  let next = ordered[index];
  if (prev && next && prev.pos >= next.pos) {
    // Empate: recoloca las siguientes líneas empatadas tras `prev`.
    let i = index;
    let lower = prev.pos;
    while (ordered[i] && ordered[i]!.pos <= prev.pos) {
      const upper = ordered.slice(i + 1).find((l) => l.pos > prev.pos)?.pos ?? null;
      const p = generateKeyBetween(lower, upper);
      lines.get(ordered[i]!.id)!.set('pos', p);
      ordered[i] = { ...ordered[i]!, pos: p };
      lower = p;
      i++;
    }
    next = ordered[index];
  }
  return generateKeyBetween(prev?.pos ?? null, next?.pos ?? null);
}

/* ---------- Numeración (Nº) ---------- */

function leadingNumber(num: CellValue | undefined): number | null {
  const m = /^(\d+)/.exec(String(num ?? ''));
  return m ? Number(m[1]) : null;
}

/**
 * Número para una línea nueva entre dos existentes, sin renumerar el resto
 * (los números impresos siguen valiendo): 2,4 → 3; 2,3 → 2A; al final → último + paso.
 */
export function numberBetween(
  prev: CellValue | undefined,
  next: CellValue | undefined,
  step = 2,
): string {
  const p = leadingNumber(prev);
  const n = leadingNumber(next);
  if (p === null && n === null) return String(step);
  if (p === null) return n! > 1 ? String(Math.max(1, n! - step)) : '0';
  if (n === null || n - p > 1) return String(n === null ? p + step : p + Math.floor((n - p) / 2));
  // Sin hueco: sufijo de letra sobre el número anterior (4 → 4A, 4A → 4B).
  const prevText = String(prev);
  const letter = /^(\d+)([A-Z]?)$/.exec(prevText);
  if (letter && letter[2] && letter[2] < 'Z') {
    return `${letter[1]}${String.fromCharCode(letter[2].charCodeAt(0) + 1)}`;
  }
  return `${p}A`;
}

/* ---------- Operaciones ---------- */

export interface InsertOptions {
  /** Posición en la lista ordenada (por defecto, al final). */
  index?: number;
  cells?: Record<string, CellValue>;
  /** Paso de numeración (por defecto 2). */
  step?: number;
}

export function insertLine(doc: Y.Doc, options: InsertOptions = {}, origin?: unknown): string {
  const id = newId();
  doc.transact(() => {
    const ordered = readLines(doc);
    const index = Math.max(0, Math.min(options.index ?? ordered.length, ordered.length));
    const pos = positionAt(doc, ordered, index);
    const line = new Y.Map<unknown>();
    const cells = new Y.Map<CellValue>();
    const values: Record<string, CellValue> = {
      num: numberBetween(ordered[index - 1]?.cells.num, ordered[index]?.cells.num, options.step),
      ...options.cells,
    };
    for (const [k, v] of Object.entries(values)) {
      if (v !== '' && v !== null && v !== undefined) cells.set(k, v);
    }
    line.set('pos', pos);
    line.set('cells', cells);
    getLinesMap(doc).set(id, line);
  }, origin);
  return id;
}

export function duplicateLine(doc: Y.Doc, id: string, origin?: unknown): string | null {
  const ordered = readLines(doc);
  const index = ordered.findIndex((l) => l.id === id);
  if (index < 0) return null;
  const { num: _num, estado: _estado, ...cells } = ordered[index]!.cells;
  let newId = '';
  doc.transact(() => {
    newId = insertLine(doc, { index: index + 1, cells }, origin);
    copyScript(doc, id, newId, origin);
    copyCues(doc, id, newId, origin);
  }, origin);
  return newId;
}

/** Mueve una línea para que quede en `toIndex` de la lista resultante. */
export function moveLine(doc: Y.Doc, id: string, toIndex: number, origin?: unknown): void {
  doc.transact(() => {
    const line = getLinesMap(doc).get(id);
    if (!line) return;
    const others = readLines(doc).filter((l) => l.id !== id);
    const index = Math.max(0, Math.min(toIndex, others.length));
    line.set('pos', positionAt(doc, others, index));
  }, origin);
}

/**
 * Mueve varias líneas a la vez (en su orden actual, una tras otra) para que la
 * primera quede en `toIndex` de la lista sin esas líneas.
 */
export function moveLines(doc: Y.Doc, ids: string[], toIndex: number, origin?: unknown): void {
  doc.transact(() => {
    const set = new Set(ids);
    const all = readLines(doc);
    const block = all.filter((l) => set.has(l.id)).map((l) => l.id);
    const others = all.filter((l) => !set.has(l.id));
    const before = others[Math.max(0, Math.min(toIndex, others.length))]?.id ?? null;
    let prev: string | null = null;
    for (const id of block) {
      const rest = readLines(doc).filter((l) => l.id !== id);
      const index = prev
        ? rest.findIndex((l) => l.id === prev) + 1
        : before
          ? rest.findIndex((l) => l.id === before)
          : rest.length;
      moveLine(doc, id, index, origin);
      prev = id;
    }
  }, origin);
}

export function deleteLines(doc: Y.Doc, ids: string[], origin?: unknown): void {
  doc.transact(() => {
    const lines = getLinesMap(doc);
    for (const id of ids) {
      lines.delete(id);
      clearScript(doc, id, origin);
      clearCues(doc, id, origin);
    }
  }, origin);
}

export interface CellChange {
  id: string;
  key: string;
  /** null o '' borra el valor. */
  value: CellValue | null;
}

export function setCells(doc: Y.Doc, changes: CellChange[], origin?: unknown): void {
  doc.transact(() => {
    const lines = getLinesMap(doc);
    for (const { id, key, value } of changes) {
      const line = lines.get(id);
      if (!line) continue;
      const cells = cellsOf(line);
      if (value === null || value === '') cells.delete(key);
      else if (cells.get(key) !== value) cells.set(key, value);
    }
  }, origin);
}

export function setCell(
  doc: Y.Doc,
  id: string,
  key: string,
  value: CellValue | null,
  origin?: unknown,
): void {
  setCells(doc, [{ id, key, value }], origin);
}

/** Renumera todas las líneas en orden: paso, 2·paso, 3·paso… */
export function renumber(doc: Y.Doc, step = 2, origin?: unknown): void {
  doc.transact(() => {
    readLines(doc).forEach((l, i) => setCell(doc, l.id, 'num', String((i + 1) * step)));
  }, origin);
}

/* ---------- Resúmenes ---------- */

export interface RundownSummary {
  lineCount: number;
  estimatedSeconds: number;
}

export function summarize(lines: LineSnapshot[]): RundownSummary {
  let estimatedSeconds = 0;
  for (const l of lines) {
    const v = l.cells.t_est;
    if (typeof v === 'number' && Number.isFinite(v)) estimatedSeconds += v;
  }
  return { lineCount: lines.length, estimatedSeconds };
}
