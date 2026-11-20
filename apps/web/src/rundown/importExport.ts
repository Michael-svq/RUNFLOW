import { COLUMNS, LINE_TYPES, parseDuration, type ColumnDef } from '@runflow/core';
import type { CellValue } from '@runflow/sync';
import { parseInput } from './cells';

/*
 * Importación de escaletas desde hojas de cálculo (CSV, TSV, XLSX), pensada
 * para migrar la escaleta de referencia y las hojas que ya usan los equipos.
 */

export type RawCell = string | number | boolean | Date | null | undefined;

function norm(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '');
}

/** Nombres alternativos de cabecera (los de la hoja de referencia y variantes). */
const ALIASES: Record<string, string[]> = {
  estado: ['ESTADO', 'EST'],
  num: ['N', 'NO', 'NUM', 'NUMERO'],
  presenta: ['PRESENTA', 'PRESENTADOR'],
  t_est: ['TIEMPOESTIMADO', 'TESTIMADO', 'ESTIMADO', 'DURACION', 'TIEMPO'],
  tipo: ['TIPO'],
  nombre: ['NOMBREDESCRIPCION', 'NOMBRE', 'DESCRIPCION', 'TITULO'],
  reportero: ['INSITUREPORTERO', 'REPORTERO', 'INSITU', 'PERIODISTA'],
  recursos: ['RECURSOS'],
  pantallas: ['PANTALLAS'],
  observaciones: ['OBSERVACIONES', 'OBS'],
  fibra: ['FIBRAMOCHI', 'FIBRAMOCHILA', 'FIBRA'],
  status: ['STATUS'],
  fuente: ['FUENTE'],
  vtr_post: ['VTRPOST'],
  vtr_ok: ['VTROK'],
  dur_vtr: ['DURVTR', 'DURACIONVTR'],
  pie: ['PIE'],
  coleo: ['COLEO', 'COLEAS', 'COLEOS'],
  son: ['SON', 'SONIDO'],
  ob_real: ['OBREAL', 'OBSERVACIONESREALIZACION'],
  invitados: ['INVITADOSPLATODIRECTO', 'INVITADOS'],
  set: ['SET'],
  ventana: ['VENT', 'VENTANA'],
  telefonos: ['TELEFONOS', 'TELEFONO'],
  camara: ['CAMARA'],
};

const BY_ALIAS = new Map<string, string>();
for (const [key, list] of Object.entries(ALIASES)) for (const a of list) BY_ALIAS.set(a, key);
for (const c of COLUMNS) if (c.kind !== 'computed') BY_ALIAS.set(norm(c.label), c.key);

export function guessColumn(header: string): string | null {
  const n = norm(header);
  return n ? (BY_ALIAS.get(n) ?? null) : null;
}

function cellText(v: RawCell): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${v.getUTCHours()}:${pad(v.getUTCMinutes())}:${pad(v.getUTCSeconds())}`;
  }
  return String(v).trim();
}

/** Busca la fila de cabecera (la primera con al menos 3 columnas reconocidas). */
export function detectHeader(
  rows: RawCell[][],
): { headerRow: number; mapping: (string | null)[] } | null {
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const mapping = (rows[r] ?? []).map((c) => guessColumn(cellText(c)));
    const used = new Set<string>();
    const unique = mapping.map((m) => (m && !used.has(m) ? (used.add(m), m) : null));
    if (unique.filter(Boolean).length >= 3) return { headerRow: r, mapping: unique };
  }
  return null;
}

/** Valor de una celda importada (las horas de Excel llegan como fracción de día o fecha). */
export function importValue(
  col: ColumnDef,
  raw: RawCell,
): { ok: boolean; value: CellValue | null } {
  if (raw === null || raw === undefined || raw === '') return { ok: true, value: null };
  if ((col.kind === 'duration' || col.kind === 'seconds') && typeof raw === 'number') {
    const seconds = raw > 0 && raw < 1 ? Math.round(raw * 86400) : Math.round(raw);
    return { ok: true, value: seconds };
  }
  if (col.kind === 'duration' && raw instanceof Date) {
    return {
      ok: true,
      value: raw.getUTCHours() * 3600 + raw.getUTCMinutes() * 60 + raw.getUTCSeconds(),
    };
  }
  const text = cellText(raw);
  if (col.kind === 'duration') {
    const s = parseDuration(text);
    return s === null ? { ok: false, value: null } : { ok: true, value: s };
  }
  if (col.kind === 'type') {
    // "TOTAL + COLAS", "CAB + RAF"… y tipos desconocidos se guardan como texto en observaciones.
    const known = LINE_TYPES.find((t) => norm(t.label) === norm(text) || t.key === norm(text));
    if (known) return { ok: true, value: known.key };
  }
  const parsed = parseInput(col, text);
  return parsed.ok ? { ok: true, value: parsed.value } : { ok: false, value: null };
}

export interface ImportResult {
  lines: Record<string, CellValue>[];
  skippedCells: number;
}

/** Convierte las filas (tras la cabecera) en líneas, según el mapeo de columnas. */
export function rowsToLines(
  rows: RawCell[][],
  headerRow: number,
  mapping: (string | null)[],
): ImportResult {
  const byKey = new Map(COLUMNS.map((c) => [c.key, c]));
  const lines: Record<string, CellValue>[] = [];
  let skippedCells = 0;
  for (const row of rows.slice(headerRow + 1)) {
    const cells: Record<string, CellValue> = {};
    row.forEach((raw, i) => {
      const key = mapping[i];
      const col = key ? byKey.get(key) : undefined;
      if (!col) return;
      const { ok, value } = importValue(col, raw);
      if (!ok) {
        skippedCells++;
        return;
      }
      if (value !== null && value !== '') cells[col.key] = value;
    });
    // Filas vacías o de leyenda (CAE C, EMITIDO E…) se ignoran.
    const meaningful = Object.keys(cells).filter((k) => k !== 'num' && k !== 'estado');
    if (meaningful.length === 0) continue;
    lines.push(cells);
  }
  return { lines, skippedCells };
}

export function toCsv(rows: string[][]): string {
  const esc = (v: string) => (/[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return '﻿' + rows.map((r) => r.map(esc).join(';')).join('\r\n');
}

/** CSV con detección del separador (; , o tabulador). */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, '');
  const first = clean.split(/\r?\n/, 1)[0] ?? '';
  const sep = first.includes('\t')
    ? '\t'
    : (first.match(/;/g)?.length ?? 0) >= (first.match(/,/g)?.length ?? 0)
      ? ';'
      : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]!;
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export function download(name: string, content: BlobPart, type: string): void {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
