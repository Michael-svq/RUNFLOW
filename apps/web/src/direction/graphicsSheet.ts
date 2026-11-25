import type { LineSnapshot, ScriptGraphicBlock } from '@runflow/sync';

/*
 * Hoja de Rotulación: todos los rótulos de una escaleta, en el orden del
 * guion (línea a línea), para crearlos, cambiarlos, importarlos y exportarlos.
 */

export type GraphicFields = Omit<ScriptGraphicBlock, 'kind' | 'id'>;

export interface SheetRow {
  line: LineSnapshot;
  graphic: ScriptGraphicBlock;
}

export const lineNumber = (line: LineSnapshot): string => String(line.cells.num ?? '').trim();
export const lineName = (line: LineSnapshot): string => String(line.cells.nombre ?? '').trim();

/** Rótulos en el orden de la escaleta y, dentro de cada línea, del guion. */
export function sheetRows(
  lines: LineSnapshot[],
  graphicsByLine: Map<string, ScriptGraphicBlock[]>,
): SheetRow[] {
  return lines.flatMap((line) =>
    (graphicsByLine.get(line.id) ?? []).map((graphic) => ({ line, graphic })),
  );
}

export const CSV_HEADER = [
  'Nº',
  'Noticia',
  'Plantilla',
  'Campo 1',
  'Campo 2',
  'Campo 3',
  'Campo 4',
  'TC IN',
  'TC OUT',
  'ID',
];

export function toCsvRows(rows: SheetRow[]): string[][] {
  return [
    CSV_HEADER,
    ...rows.map(({ line, graphic: g }) => [
      lineNumber(line),
      lineName(line),
      g.type,
      g.f0,
      g.f1,
      g.f2,
      g.f3,
      g.tcIn,
      g.tcOut,
      g.id,
    ]),
  ];
}

type Column = 'num' | 'name' | 'type' | 'f0' | 'f1' | 'f2' | 'f3' | 'tcIn' | 'tcOut' | 'id';
const DEFAULT_ORDER: Column[] = [
  'num',
  'name',
  'type',
  'f0',
  'f1',
  'f2',
  'f3',
  'tcIn',
  'tcOut',
  'id',
];

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

function columnOf(header: string): Column | null {
  const h = norm(header).replace(/[º°.]/g, '').trim();
  if (['n', 'no', 'num', 'numero', 'nº'].includes(h)) return 'num';
  if (['noticia', 'linea', 'nombre de la linea', 'pieza'].includes(h)) return 'name';
  if (['plantilla', 'tipo', 'template'].includes(h)) return 'type';
  const field = /^(?:campo|f)\s*([0-4])$/.exec(h);
  if (field) {
    const n = Number(field[1]);
    // «Campo 1..4» o «f0..f3».
    const index = h.startsWith('f') ? n : n - 1;
    return index >= 0 && index <= 3 ? (`f${index}` as Column) : null;
  }
  if (['tc in', 'tcin', 'entrada'].includes(h)) return 'tcIn';
  if (['tc out', 'tcout', 'salida'].includes(h)) return 'tcOut';
  if (h === 'id') return 'id';
  return null;
}

export interface ImportPlan {
  /** Rótulos existentes (por ID) que cambian; `toLineId` si pasan a otra línea. */
  updates: { lineId: string; graphicId: string; fields: GraphicFields; toLineId?: string }[];
  /** Rótulos nuevos, al final del guion de su línea. */
  inserts: { lineId: string; fields: GraphicFields }[];
  /** Filas sin noticia reconocible (Nº o nombre). */
  skipped: number;
}

/**
 * Plan de importación de un CSV: cada fila se asocia a su línea por Nº (o por
 * nombre) y, si trae el ID de un rótulo de la escaleta, lo actualiza.
 */
export function planImport(table: string[][], lines: LineSnapshot[], rows: SheetRow[]): ImportPlan {
  const plan: ImportPlan = { updates: [], inserts: [], skipped: 0 };
  const nonEmpty = table.filter((r) => r.some((c) => c.trim()));
  if (!nonEmpty.length) return plan;
  const headerCols = nonEmpty[0]!.map(columnOf);
  const hasHeader = headerCols.includes('type') || headerCols.includes('f0');
  const order = hasHeader ? headerCols : DEFAULT_ORDER;
  const byNum = new Map(lines.map((l) => [norm(lineNumber(l)), l]));
  const byName = new Map(lines.map((l) => [norm(lineName(l)), l]));
  const existing = new Map(rows.map((r) => [r.graphic.id, r]));
  for (const raw of hasHeader ? nonEmpty.slice(1) : nonEmpty) {
    const v: Partial<Record<Column, string>> = {};
    order.forEach((col, i) => {
      if (col) v[col] = (raw[i] ?? '').trim();
    });
    const line =
      (v.num && byNum.get(norm(v.num))) || (v.name && byName.get(norm(v.name))) || undefined;
    const current = v.id ? existing.get(v.id) : undefined;
    const target = line ?? current?.line;
    if (!target) {
      plan.skipped++;
      continue;
    }
    const fields: GraphicFields = {
      type: (v.type || current?.graphic.type || 'TOT').toUpperCase(),
      f0: v.f0 ?? '',
      f1: v.f1 ?? '',
      f2: v.f2 ?? '',
      f3: v.f3 ?? '',
      tcIn: v.tcIn ?? '',
      tcOut: v.tcOut ?? '',
    };
    if (current) {
      plan.updates.push({
        lineId: current.line.id,
        graphicId: current.graphic.id,
        fields,
        ...(target.id !== current.line.id ? { toLineId: target.id } : {}),
      });
    } else {
      plan.inserts.push({ lineId: target.id, fields });
    }
  }
  return plan;
}
