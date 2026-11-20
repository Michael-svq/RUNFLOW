/*
 * Rótulos (PLAN §13). Tipos por defecto con sus campos y longitudes máximas.
 * Más adelante serán configurables por empresa (M5) y tendrán plantilla CG (M7).
 */

export type GraphicFieldKey = 'f0' | 'f1' | 'f2' | 'f3';

export interface GraphicField {
  key: GraphicFieldKey;
  label: string;
  maxLength: number;
  required: boolean;
}

export interface GraphicType {
  key: string;
  name: string;
  description: string;
  fields: GraphicField[];
}

export const GRAPHIC_TYPES: GraphicType[] = [
  {
    key: 'TOT',
    name: 'Total',
    description: 'Persona que habla: nombre y cargo',
    fields: [
      { key: 'f0', label: 'NOMBRE', maxLength: 40, required: true },
      { key: 'f1', label: 'CARGO', maxLength: 60, required: false },
    ],
  },
  {
    key: 'LOC',
    name: 'Localizador',
    description: 'Lugar',
    fields: [{ key: 'f0', label: 'LOCALIZACIÓN, PROVINCIA', maxLength: 50, required: true }],
  },
  {
    key: 'INF',
    name: 'Informa',
    description: 'Periodista y, si se quiere, cámara y/o editor',
    fields: [
      { key: 'f0', label: 'PERIODISTA', maxLength: 40, required: true },
      { key: 'f1', label: 'CÁMARA Y/O EDITOR', maxLength: 60, required: false },
    ],
  },
  {
    key: 'DAT',
    name: 'Fecha',
    description: 'Fecha',
    fields: [{ key: 'f0', label: 'FECHA', maxLength: 30, required: true }],
  },
  {
    key: 'BAN',
    name: 'Banner',
    description: 'Banner de dos líneas',
    fields: [
      { key: 'f0', label: 'LÍNEA 1', maxLength: 60, required: true },
      { key: 'f1', label: 'LÍNEA 2', maxLength: 60, required: false },
    ],
  },
  {
    key: 'HIG',
    name: 'Highlights',
    description: 'Destacado de dos líneas',
    fields: [
      { key: 'f0', label: 'LÍNEA 1', maxLength: 60, required: true },
      { key: 'f1', label: 'LÍNEA 2', maxLength: 60, required: false },
    ],
  },
];

export const GRAPHIC_TYPE_BY_KEY: Record<string, GraphicType> = Object.fromEntries(
  GRAPHIC_TYPES.map((t) => [t.key, t]),
);

/** Duración por defecto de un rótulo sin TC de salida (D9: 6 s, configurable). */
export const DEFAULT_GRAPHIC_SECONDS = 6;

/** Velocidad de lectura por defecto (D17): 3 palabras por segundo. */
export const DEFAULT_READING_WPS = 3;

/** Tipos de línea en los que el rótulo va por TC sobre la pieza (VTR). */
export const TIMECODE_LINE_TYPES = new Set(['VTR', 'TOTAL_COLAS', 'COLAS', 'CAB_RAF']);

export interface GraphicData {
  id: string;
  type: string;
  f0: string;
  f1: string;
  f2: string;
  f3: string;
  /** mm:ss sobre la pieza (solo en VTR). */
  tcIn: string;
  tcOut: string;
}

/** "mm:ss" → segundos (acepta también "m:ss" y "ss"). */
export function parseTimecode(tc: string): number | null {
  const m = /^(?:(\d{1,3}):)?([0-5]?\d)$/.exec(tc.trim());
  if (!m) return null;
  return Number(m[1] ?? 0) * 60 + Number(m[2]);
}

export function formatTimecode(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export interface GraphicIssue {
  field: GraphicFieldKey | 'tcIn' | 'tcOut' | 'type';
  message: string;
}

/** Valida un rótulo: campos obligatorios, longitudes y TC (dentro de la pieza). */
export function validateGraphic(
  g: GraphicData,
  opts: { pieceSeconds?: number | null } = {},
): GraphicIssue[] {
  const issues: GraphicIssue[] = [];
  const type = GRAPHIC_TYPE_BY_KEY[g.type];
  if (!type) return [{ field: 'type', message: 'Tipo de rótulo desconocido' }];
  for (const f of type.fields) {
    const v = (g[f.key] ?? '').trim();
    if (f.required && !v) issues.push({ field: f.key, message: `${f.label}: obligatorio` });
    if (v.length > f.maxLength)
      issues.push({ field: f.key, message: `${f.label}: máximo ${f.maxLength} caracteres` });
  }
  const tin = g.tcIn ? parseTimecode(g.tcIn) : null;
  const tout = g.tcOut ? parseTimecode(g.tcOut) : null;
  if (g.tcIn && tin === null)
    issues.push({ field: 'tcIn', message: 'TC de entrada no válido (mm:ss)' });
  if (g.tcOut && tout === null)
    issues.push({ field: 'tcOut', message: 'TC de salida no válido (mm:ss)' });
  if (g.tcOut && !g.tcIn) issues.push({ field: 'tcIn', message: 'Falta el TC de entrada' });
  if (tin !== null && tout !== null && tout <= tin) {
    issues.push({ field: 'tcOut', message: 'El TC de salida debe ser posterior al de entrada' });
  }
  const piece = opts.pieceSeconds;
  if (piece && tin !== null && tin >= piece)
    issues.push({ field: 'tcIn', message: 'El TC de entrada supera la duración de la pieza' });
  if (piece && tout !== null && tout > piece)
    issues.push({ field: 'tcOut', message: 'El TC de salida supera la duración de la pieza' });
  return issues;
}

/** Texto corto de un rótulo para la columna GRAFISMO: "TOT ANDRES // CICLISTA BMX". */
export function graphicSummary(
  g: Pick<GraphicData, 'type' | 'f0' | 'f1' | 'f2' | 'f3' | 'tcIn'>,
): string {
  const parts = [g.f0, g.f1, g.f2, g.f3].map((v) => (v ?? '').trim()).filter(Boolean);
  return `${g.type}${g.tcIn ? ` ${g.tcIn}` : ''} ${parts.join(' // ')}`.trim();
}

/** Solapes entre rótulos por TC (misma capa) en una pieza. */
export function overlappingGraphics(
  graphics: GraphicData[],
  defaultSeconds = DEFAULT_GRAPHIC_SECONDS,
): [string, string][] {
  const spans = graphics
    .map((g) => {
      const tin = g.tcIn ? parseTimecode(g.tcIn) : null;
      if (tin === null) return null;
      const tout = g.tcOut ? parseTimecode(g.tcOut) : null;
      return { id: g.id, from: tin, to: tout ?? tin + defaultSeconds };
    })
    .filter((x): x is { id: string; from: number; to: number } => x !== null)
    .sort((a, b) => a.from - b.from);
  const out: [string, string][] = [];
  for (let i = 0; i < spans.length; i++) {
    for (let j = i + 1; j < spans.length && spans[j]!.from < spans[i]!.to; j++) {
      out.push([spans[i]!.id, spans[j]!.id]);
    }
  }
  return out;
}
