import { z } from 'zod';

/* Salidas por enlace (PLAN §14). */

export const OUTPUT_KINDS = [
  {
    value: 'prompter',
    label: 'Teleprompter',
    description: 'Solo el paso (texto verde), en grande',
  },
  {
    value: 'presenter',
    label: 'Presentador',
    description: 'Prompter + relojes + siguiente línea + mensajes',
  },
  {
    value: 'clocks',
    label: 'Relojes',
    description: 'Hora, línea en aire, inicio, fin y descuadre',
  },
  { value: 'agenda', label: 'Agenda', description: 'Escaleta simplificada con horas' },
  { value: 'messages', label: 'Mensajes', description: 'Mensajes del control al plató' },
  {
    value: 'multiview',
    label: 'Multivista',
    description: 'Relojes, agenda, prompter y mensajes en cuadrícula',
  },
  {
    value: 'control',
    label: 'Mando',
    description: 'GO, volver y rótulos desde una tablet, Stream Deck o Companion',
  },
] as const;

/** Órdenes del mando por enlace (Companion / Stream Deck / tablet). */
export const CONTROL_ACTIONS = ['go', 'back', 'stop', 'next-graphic', 'clear-graphics'] as const;
export type ControlAction = (typeof CONTROL_ACTIONS)[number];

export type OutputKind = (typeof OUTPUT_KINDS)[number]['value'];

export const outputSettingsSchema = z.object({
  /** Tamaño del texto del prompter en px (a 1080 de alto). */
  fontSize: z.number().int().min(16).max(200).default(64),
  /** Espejo horizontal (cristal de teleprompter). */
  mirror: z.boolean().default(false),
  /** Texto en mayúsculas. */
  uppercase: z.boolean().default(false),
  /** Altura del marcador de lectura (fracción de la pantalla). */
  marker: z.number().min(0.1).max(0.9).default(0.33),
  /** Mostrar líneas sin paso (solo su cabecera). */
  showEmpty: z.boolean().default(false),
});
export type OutputSettings = z.infer<typeof outputSettingsSchema>;

/** Cambios parciales de ajustes (sin valores por defecto: solo lo que se envía). */
export const outputSettingsPatch = z.object({
  fontSize: z.number().int().min(16).max(200).optional(),
  mirror: z.boolean().optional(),
  uppercase: z.boolean().optional(),
  marker: z.number().min(0.1).max(0.9).optional(),
  showEmpty: z.boolean().optional(),
});

export const createOutputInput = z.object({
  kind: z.enum(['prompter', 'presenter', 'clocks', 'agenda', 'messages', 'multiview', 'control']),
  name: z.string().trim().min(1, 'Obligatorio').max(60),
  settings: outputSettingsPatch.default({}),
});
export type CreateOutputInput = z.infer<typeof createOutputInput>;

export const updateOutputInput = z
  .object({
    name: z.string().trim().min(1).max(60),
    settings: outputSettingsPatch,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nada que actualizar');

export interface OutputDto {
  id: string;
  rundownId: string;
  kind: OutputKind;
  name: string;
  settings: OutputSettings;
  createdAt: string;
}

/** Lo que recibe una salida pública al abrir su enlace. */
export interface PublicOutputDto {
  kind: OutputKind;
  name: string;
  settings: OutputSettings;
  orgName: string;
  rundown: {
    id: string;
    title: string;
    airDate: string;
    startTime: string;
    endTime: string;
    timezone: string;
  };
}

/** Posición del prompter que marca el operador (todas las salidas la siguen). */
export interface PrompterState {
  /** Línea que está en el marcador de lectura. */
  lineId: string | null;
  /** Fracción (0–1) dentro del bloque de esa línea. */
  fraction: number;
  running: boolean;
  /** Velocidad en líneas de pantalla por segundo (−10 a 10). */
  speed: number;
  /** Saltar a la línea en aire con cada GO. */
  followLive: boolean;
  seq: number;
}

/** Mensaje del control al plató. */
export interface StageMessage {
  text: string;
  color: 'white' | 'yellow' | 'red' | 'green';
  flash: boolean;
  sentAt: number;
  from: string;
}

export function outputSettings(raw: unknown): OutputSettings {
  const parsed = outputSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : outputSettingsSchema.parse({});
}
