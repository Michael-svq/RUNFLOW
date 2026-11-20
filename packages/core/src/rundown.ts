/*
 * Catálogo de la escaleta (PLAN §23): columnas, tipos de línea, estados y
 * vistas por defecto, tomados de la escaleta de referencia
 * (docs/referencias/escaleta-general). Más adelante serán configurables
 * por empresa y programa (M5).
 */

/** `computed`: la calcula el motor de tiempos (no se edita). */
export type ColumnKind =
  | 'status'
  | 'number'
  | 'type'
  | 'text'
  | 'duration'
  | 'seconds'
  | 'select'
  | 'computed';

export interface SelectOption {
  value: string;
  label: string;
  /** Color de fondo de la celda cuando tiene este valor. */
  bg?: string;
  fg?: string;
}

export interface ColumnDef {
  key: string;
  /** Cabecera, en mayúsculas como en la referencia. */
  label: string;
  /** Descripción para la ayuda y el selector de columnas. */
  description: string;
  kind: ColumnKind;
  /** Ancho por defecto en px. */
  width: number;
  /** Columna fija a la izquierda al hacer scroll horizontal. */
  pinned?: boolean;
  options?: SelectOption[];
  /** Alineación del contenido. */
  align?: 'left' | 'center' | 'right';
}

/** Estados de línea (columna ESTADO): letra + color, nunca solo color. */
export const LINE_STATUSES: SelectOption[] = [
  { value: 'C', label: 'CAE', bg: '#CC4125', fg: '#000000' },
  { value: 'E', label: 'EMITIDO', bg: '#6FA8DC', fg: '#000000' },
  { value: 'X', label: 'NO LISTO', bg: '#85200C', fg: '#FFFFFF' },
  { value: 'A', label: 'FINAL', bg: '#93C47D', fg: '#000000' },
];

export interface LineType {
  key: string;
  label: string;
  bg: string;
  fg: string;
}

/** Tipos de línea con los colores de la escaleta de referencia. */
export const LINE_TYPES: LineType[] = [
  { key: 'ACTING', label: 'ACTING', bg: '#FFD966', fg: '#000000' },
  { key: 'TEMA', label: 'TEMA', bg: '#3C78D8', fg: '#FFFFFF' },
  { key: 'VARIOS', label: 'VARIOS', bg: '#95B3D7', fg: '#000000' },
  { key: 'VTR', label: 'VTR', bg: '#76923C', fg: '#000000' },
  { key: 'TOTAL_COLAS', label: 'TOTAL + COLAS', bg: '#76923C', fg: '#000000' },
  { key: 'COLAS', label: 'COLAS', bg: '#C2D69B', fg: '#000000' },
  { key: 'MOCHILA', label: 'MOCHILA', bg: '#953734', fg: '#FFFFFF' },
  { key: 'FIBRA', label: 'FIBRA', bg: '#D99594', fg: '#000000' },
  { key: 'GRAFISMO', label: 'GRAFISMO', bg: '#46BDC6', fg: '#FFFFFF' },
  { key: 'CAB_RAF', label: 'CAB + RAF', bg: '#FF6D01', fg: '#000000' },
  { key: 'CONTI', label: 'CONTI', bg: '#000000', fg: '#FFFFFF' },
];

export const LINE_TYPE_BY_KEY: Record<string, LineType> = Object.fromEntries(
  LINE_TYPES.map((t) => [t.key, t]),
);

const OK_X: SelectOption[] = [
  { value: 'OK', label: 'OK', bg: '#B6D7A8', fg: '#000000' },
  { value: 'X', label: 'X', bg: '#E06666', fg: '#000000' },
];

/** Columnas de la escaleta, en el orden de la referencia. */
export const COLUMNS: ColumnDef[] = [
  {
    key: 'estado',
    label: 'ESTADO',
    description: 'Estado de la línea: C cae, E emitido, X no listo, A final',
    kind: 'status',
    width: 64,
    pinned: true,
    align: 'center',
    options: LINE_STATUSES,
  },
  {
    key: 'num',
    label: 'Nº',
    description: 'Número de la línea (de 2 en 2 para poder intercalar)',
    kind: 'number',
    width: 56,
    pinned: true,
    align: 'center',
  },
  {
    key: 'presenta',
    label: 'PRESENTA',
    description: 'Quién presenta la línea',
    kind: 'text',
    width: 96,
  },
  {
    key: 't_est',
    label: 'TIEMPO ESTIMADO',
    description: 'Duración prevista de la línea',
    kind: 'duration',
    width: 88,
    align: 'right',
  },
  {
    key: 'tipo',
    label: 'TIPO',
    description: 'Tipo de línea (ACTING, VTR, COLAS…)',
    kind: 'type',
    width: 118,
  },
  {
    key: 'nombre',
    label: 'NOMBRE / DESCRIPCIÓN',
    description: 'Título de la línea',
    kind: 'text',
    width: 220,
  },
  {
    key: 'reportero',
    label: 'INSITU / REPORTERO',
    description: 'Periodista o reportero',
    kind: 'text',
    width: 120,
  },
  { key: 'recursos', label: 'RECURSOS', description: 'Recursos', kind: 'text', width: 140 },
  {
    key: 'pantallas',
    label: 'PANTALLAS',
    description: 'Contenido de pantallas',
    kind: 'text',
    width: 140,
  },
  {
    key: 'observaciones',
    label: 'OBSERVACIONES',
    description: 'Observaciones',
    kind: 'text',
    width: 160,
  },
  {
    key: 'grafismo',
    label: 'GRAFISMO',
    description: 'Rótulos de la línea (se escriben en el guion)',
    kind: 'computed',
    width: 220,
  },
  {
    key: 'fibra',
    label: 'FIBRA / MOCHI',
    description: 'Señal de fibra o mochila',
    kind: 'text',
    width: 80,
  },
  {
    key: 'status',
    label: 'STATUS',
    description: 'Estado de la señal',
    kind: 'select',
    width: 84,
    align: 'center',
    options: [
      { value: 'PLAY', label: 'PLAY', bg: '#00FF00', fg: '#000000' },
      { value: 'ONLINE', label: 'ONLINE', bg: '#00FFFF', fg: '#000000' },
      { value: 'OFFLINE', label: 'OFFLINE', bg: '#FF0000', fg: '#000000' },
    ],
  },
  {
    key: 'fuente',
    label: 'FUENTE',
    description: 'Fuente de la línea (CAM 1, VTR 1, EXT 1…)',
    kind: 'text',
    width: 80,
    align: 'center',
  },
  {
    key: 'vtr_post',
    label: 'VTR POST',
    description: 'Pieza en postproducción',
    kind: 'select',
    width: 64,
    align: 'center',
    options: OK_X,
  },
  {
    key: 'vtr_ok',
    label: 'VTR OK',
    description: 'Pieza revisada y lista',
    kind: 'select',
    width: 64,
    align: 'center',
    options: OK_X,
  },
  {
    key: 'dur_vtr',
    label: 'DUR. VTR',
    description: 'Duración de la pieza',
    kind: 'duration',
    width: 76,
    align: 'right',
  },
  {
    key: 'pie',
    label: 'PIE',
    description: 'Últimas palabras de la pieza',
    kind: 'text',
    width: 130,
  },
  {
    key: 'coleo',
    label: 'COLEO',
    description: 'Segundos de seguridad tras el final de la pieza',
    kind: 'seconds',
    width: 64,
    align: 'right',
  },
  { key: 'son', label: 'SON', description: 'Sonido', kind: 'text', width: 80 },
  {
    key: 'ob_real',
    label: 'OB. REAL.',
    description: 'Observaciones de realización',
    kind: 'text',
    width: 140,
  },
  {
    key: 'invitados',
    label: 'INVITADOS PLATO / DIRECTO',
    description: 'Invitados en plató o en directo',
    kind: 'text',
    width: 150,
  },
  { key: 'set', label: 'SET', description: 'Set o decorado', kind: 'text', width: 110 },
  { key: 'ventana', label: 'VENT.', description: 'Ventana', kind: 'text', width: 90 },
  {
    key: 'telefonos',
    label: 'TELÉFONOS',
    description: 'Teléfonos de contacto',
    kind: 'text',
    width: 140,
  },
  { key: 'camara', label: 'CÁMARA', description: 'Cámara', kind: 'text', width: 90 },
  {
    key: 'lectura',
    label: 'T. LECTURA',
    description: 'Tiempo de lectura del paso (3 palabras por segundo; calculado)',
    kind: 'computed',
    width: 80,
    align: 'right',
  },
  {
    key: 'sum_vtr',
    label: 'SUMATORIO TIEMPO VTR',
    description: 'Suma acumulada de DUR. VTR (calculada)',
    kind: 'computed',
    width: 92,
    align: 'right',
  },
  {
    key: 'hora',
    label: 'HORA',
    description: 'Hora prevista de inicio (real en lo emitido; calculada)',
    kind: 'computed',
    width: 84,
    align: 'right',
  },
  {
    key: 'back',
    label: 'BACK TIME',
    description: 'Hora a la que debe empezar para acabar en hora (calculada)',
    kind: 'computed',
    width: 84,
    align: 'right',
  },
  {
    key: 'real',
    label: 'TIEMPO REAL',
    description: 'Duración real de lo emitido; transcurrido en la línea en aire (calculada)',
    kind: 'computed',
    width: 84,
    align: 'right',
  },
];

export const COLUMN_BY_KEY: Record<string, ColumnDef> = Object.fromEntries(
  COLUMNS.map((c) => [c.key, c]),
);

export interface ViewColumn {
  key: string;
  width: number;
}

export interface BuiltinView {
  id: string;
  name: string;
  columns: ViewColumn[];
}

function view(id: string, name: string, keys: string[]): BuiltinView {
  return { id, name, columns: keys.map((key) => ({ key, width: COLUMN_BY_KEY[key]!.width })) };
}

/** Vistas por puesto incluidas de serie (PLAN §23). */
export const BUILTIN_VIEWS: BuiltinView[] = [
  view(
    'builtin:completa',
    'Completa',
    COLUMNS.map((c) => c.key),
  ),
  view('builtin:redaccion', 'Redacción', [
    'estado',
    'num',
    'presenta',
    't_est',
    'tipo',
    'nombre',
    'reportero',
    'recursos',
    'grafismo',
    'lectura',
    'observaciones',
    'dur_vtr',
    'pie',
    'hora',
  ]),
  view('builtin:realizacion', 'Realización', [
    'estado',
    'num',
    'presenta',
    't_est',
    'tipo',
    'nombre',
    'pantallas',
    'grafismo',
    'fibra',
    'status',
    'fuente',
    'dur_vtr',
    'pie',
    'coleo',
    'son',
    'ob_real',
    'camara',
    'hora',
    'real',
    'back',
  ]),
  view('builtin:produccion', 'Producción', [
    'estado',
    'num',
    't_est',
    'tipo',
    'nombre',
    'reportero',
    'invitados',
    'set',
    'ventana',
    'telefonos',
    'observaciones',
    'hora',
  ]),
  view('builtin:tecnica', 'Técnica', [
    'estado',
    'num',
    'tipo',
    'nombre',
    'fibra',
    'status',
    'fuente',
    'vtr_post',
    'vtr_ok',
    'dur_vtr',
    'coleo',
    'son',
    'sum_vtr',
    'hora',
  ]),
];

export const PROGRAM_TYPES = [
  { value: 'informativo', label: 'Informativo' },
  { value: 'magacin', label: 'Magacín' },
  { value: 'deportes', label: 'Deportes' },
  { value: 'entretenimiento', label: 'Entretenimiento' },
  { value: 'evento', label: 'Evento' },
  { value: 'educativo', label: 'Educativo' },
  { value: 'otro', label: 'Otro' },
] as const;
export type ProgramType = (typeof PROGRAM_TYPES)[number]['value'];

export const RUNDOWN_STATUSES = [
  { value: 'borrador', label: 'Borrador' },
  { value: 'lista', label: 'Lista' },
  { value: 'en_aire', label: 'En aire' },
  { value: 'cerrada', label: 'Cerrada' },
] as const;
export type RundownStatus = (typeof RUNDOWN_STATUSES)[number]['value'];

/* ---------- Duraciones ---------- */

/**
 * Interpreta una duración escrita a mano: "30" → 30 s, "1:30" → 90 s,
 * "0:01:30" → 90 s, "1.30" → 90 s. Devuelve null si no es válida.
 */
export function parseDuration(input: string): number | null {
  const text = input.trim().replace(/[.,']/g, ':');
  if (text === '') return null;
  if (!/^\d{1,4}(:\d{1,2}){0,2}$/.test(text)) return null;
  const parts = text.split(':').map(Number);
  let seconds = 0;
  for (const p of parts) seconds = seconds * 60 + p;
  if (parts.length > 1 && parts.slice(1).some((p) => p >= 60)) return null;
  return seconds;
}

/** Formatea segundos como H:MM:SS (como en la referencia: 0:00:30). */
export function formatDuration(
  seconds: number | null | undefined,
  opts: { short?: boolean } = {},
): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '';
  const sign = seconds < 0 ? '-' : '';
  const s = Math.abs(Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (opts.short && h === 0) return `${sign}${m}:${pad(sec)}`;
  return `${sign}${h}:${pad(m)}:${pad(sec)}`;
}

/** Hora "HH:MM" o "HH:MM:SS" → segundos desde medianoche. */
export function parseClock(input: string): number | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(input.trim());
  if (!m) return null;
  const [h, min, s] = [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
  if (h > 23 || min > 59 || s > 59) return null;
  return h * 3600 + min * 60 + s;
}

export function formatClock(secondsOfDay: number): string {
  const s = ((Math.round(secondsOfDay) % 86400) + 86400) % 86400;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}
