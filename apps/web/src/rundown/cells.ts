import {
  formatDuration,
  LINE_TYPE_BY_KEY,
  LINE_TYPES,
  parseDuration,
  type ColumnDef,
} from '@runflow/core';
import type { CellValue } from '@runflow/sync';

/** Texto que se muestra en una celda. */
export function displayValue(col: ColumnDef, value: CellValue | undefined): string {
  if (value === undefined || value === null || value === '') return '';
  switch (col.kind) {
    case 'duration':
      return typeof value === 'number' ? formatDuration(value) : String(value);
    case 'type':
      return LINE_TYPE_BY_KEY[String(value)]?.label ?? String(value);
    default:
      return String(value);
  }
}

/** Texto inicial al editar (las duraciones se editan en formato corto). */
export function editValue(col: ColumnDef, value: CellValue | undefined): string {
  if (value === undefined || value === null) return '';
  if (col.kind === 'duration' && typeof value === 'number')
    return formatDuration(value, { short: true });
  return displayValue(col, value);
}

export type ParseResult = { ok: true; value: CellValue | null } | { ok: false };

function matchOption(col: ColumnDef, text: string): string | undefined {
  const upper = text.trim().toUpperCase();
  const opt = col.options?.find(
    (o) => o.value.toUpperCase() === upper || o.label.toUpperCase() === upper,
  );
  return opt?.value;
}

/** Convierte lo escrito (o pegado) en el valor que se guarda. */
export function parseInput(col: ColumnDef, raw: string): ParseResult {
  const text = col.kind === 'text' ? raw.replace(/\s+$/, '') : raw.trim();
  if (text === '') return { ok: true, value: null };
  switch (col.kind) {
    case 'duration': {
      const s = parseDuration(text);
      return s === null ? { ok: false } : { ok: true, value: s };
    }
    case 'seconds': {
      if (!/^\d{1,5}$/.test(text)) return { ok: false };
      return { ok: true, value: Number(text) };
    }
    case 'type': {
      const upper = text.toUpperCase().replace(/\s+/g, ' ');
      const exact = LINE_TYPES.find((t) => t.key === upper || t.label === upper);
      const prefix = exact ?? LINE_TYPES.find((t) => t.label.startsWith(upper));
      return prefix ? { ok: true, value: prefix.key } : { ok: false };
    }
    case 'status':
    case 'select': {
      const v = matchOption(col, text);
      return v ? { ok: true, value: v } : { ok: false };
    }
    case 'number':
      return { ok: true, value: text.toUpperCase().slice(0, 12) };
    default:
      return { ok: true, value: text.slice(0, 2000) };
  }
}

/** Colores de la celda según su valor (tipos, estados, STATUS…). */
export function cellColors(
  col: ColumnDef,
  value: CellValue | undefined,
): { bg: string; fg: string } | undefined {
  if (value === undefined || value === '') return undefined;
  if (col.kind === 'type') {
    const t = LINE_TYPE_BY_KEY[String(value)];
    return t ? { bg: t.bg, fg: t.fg } : undefined;
  }
  if (col.kind === 'status' || col.kind === 'select') {
    const o = col.options?.find((x) => x.value === value);
    return o?.bg ? { bg: o.bg, fg: o.fg ?? '#000000' } : undefined;
  }
  return undefined;
}

/* ---------- Copiar / pegar (TSV, compatible con Excel y Google Sheets) ---------- */

function quote(cell: string): string {
  return /[\t\n"]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

export function toTsv(rows: string[][]): string {
  return rows.map((r) => r.map(quote).join('\t')).join('\n');
}

export function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let i = 0;
  let inQuotes = false;
  const src = text.replace(/\r\n?/g, '\n');
  while (i < src.length) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i += 2;
        continue;
      }
      if (ch === '"') {
        inQuotes = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"' && cell === '') {
      inQuotes = true;
    } else if (ch === '\t') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
    i++;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
