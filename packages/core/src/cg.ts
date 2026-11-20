import { z } from 'zod';
import {
  DEFAULT_GRAPHIC_SECONDS,
  GRAPHIC_TYPE_BY_KEY,
  parseTimecode,
  TIMECODE_LINE_TYPES,
  type GraphicData,
} from './graphics';

/*
 * RunFlow CG (PLAN §13 y §15): rótulos y playout de VTR con CasparCG.
 */

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color no válido (#RRGGBB)');

/** Diseño de los rótulos de la empresa (lo usan las plantillas HTML). */
export const cgDesignSchema = z.object({
  primary: hex.default('#FF7A1A'),
  secondary: hex.default('#1F2A2E'),
  text: hex.default('#FFFFFF'),
  accentText: hex.default('#1F2A2E'),
  font: z.enum(['Montserrat', 'Helvetica', 'Arial', 'Roboto', 'Georgia']).default('Montserrat'),
  /** Alineación de los rótulos inferiores. */
  align: z.enum(['left', 'center', 'right']).default('left'),
  /** Distancia al borde inferior (% de la altura). */
  bottom: z.number().int().min(0).max(40).default(9),
  /** Margen de seguridad lateral (% del ancho). */
  margin: z.number().int().min(0).max(20).default(6),
  animation: z.enum(['slide', 'fade', 'wipe']).default('slide'),
  animationMs: z.number().int().min(0).max(2000).default(450),
  uppercase: z.boolean().default(true),
  /** Texto de la mosca (p. ej. el nombre del canal), arriba a la derecha con DAT. */
  bug: z.string().max(24).default(''),
});
export type CgDesign = z.infer<typeof cgDesignSchema>;

/** Configuración de la empresa (página Configuración, nivel Master). */
export const orgSettingsSchema = z.object({
  /** Duración de un rótulo sin TC de salida (D: 6 s). */
  graphicSeconds: z.number().int().min(1).max(120).default(DEFAULT_GRAPHIC_SECONDS),
  /** Rótulos de cámara/directo: salen solos tras `graphicSeconds` (si no, ■ manual). */
  cameraAutoOut: z.boolean().default(false),
  /** Precargar en CasparCG el VTR de la línea SIGUIENTE (arranque instantáneo con GO). */
  prerollNext: z.boolean().default(true),
  /** IA: tokens al mes para toda la empresa (0 = sin límite). */
  aiMonthlyTokens: z.number().int().min(0).max(1_000_000_000).default(0),
  cgDesign: cgDesignSchema.prefault({}),
});
export type OrgSettings = z.infer<typeof orgSettingsSchema>;
export const orgSettingsPatch = z.object({
  graphicSeconds: z.number().int().min(1).max(120).optional(),
  cameraAutoOut: z.boolean().optional(),
  prerollNext: z.boolean().optional(),
  aiMonthlyTokens: z.number().int().min(0).max(1_000_000_000).optional(),
  cgDesign: cgDesignSchema.partial().optional(),
});

export function readOrgSettings(value: unknown): OrgSettings {
  const parsed = orgSettingsSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : orgSettingsSchema.parse({});
}

/* ---------- Equipos ---------- */

export const casparConfigSchema = z.object({
  host: z.string().trim().min(1, 'Obligatorio').max(255),
  port: z.number().int().min(1).max(65535).default(5250),
  /** Puerto UDP donde RunFlow recibe el OSC de CasparCG (0 = sin OSC). */
  oscPort: z.number().int().min(0).max(65535).default(6250),
  channel: z.number().int().min(1).max(32).default(1),
  layers: z
    .object({
      vtr: z.number().int().min(1).max(9999).default(10),
      lower: z.number().int().min(1).max(9999).default(20),
      banner: z.number().int().min(1).max(9999).default(30),
      logo: z.number().int().min(1).max(9999).default(40),
    })
    .prefault({}),
  /**
   * Dirección con la que CasparCG ve este servidor para cargar las plantillas
   * (p. ej. http://192.168.1.20:8080). Vacía: la del propio servidor.
   */
  templateBaseUrl: z.union([z.literal(''), z.string().url()]).default(''),
  /**
   * Carpeta de medios de CasparCG vista desde este servidor (mismo equipo o
   * carpeta compartida montada) para copiar ahí los vídeos de 05 Media.
   */
  mediaPath: z.string().trim().max(500).default(''),
});
export type CasparConfig = z.infer<typeof casparConfigSchema>;

/* ---------- Mezcladores (M8) ---------- */

/**
 * Mapa de fuentes: la FUENTE de la línea (CAM 1, VTR, EXT 1…) → entrada del
 * mezclador (escena de OBS, número o nombre de entrada de vMix, nº de entrada de ATEM).
 */
const sourceMap = z
  .record(z.string().trim().min(1).max(40), z.string().trim().min(1).max(80))
  .default({});

export const obsConfigSchema = z.object({
  host: z.string().trim().min(1, 'Obligatorio').max(255),
  port: z.number().int().min(1).max(65535).default(4455),
  password: z.string().max(200).default(''),
  /** En modo estudio: la escena va a previo y se lanza la transición. */
  studioMode: z.boolean().default(false),
  sources: sourceMap,
});
export type ObsConfig = z.infer<typeof obsConfigSchema>;

export const VMIX_TRANSITIONS = ['CutDirect', 'Cut', 'Fade', 'Merge', 'Wipe', 'Zoom'] as const;
export const vmixConfigSchema = z.object({
  host: z.string().trim().min(1, 'Obligatorio').max(255),
  /** API TCP de vMix (8099). */
  port: z.number().int().min(1).max(65535).default(8099),
  transition: z.enum(VMIX_TRANSITIONS).default('CutDirect'),
  durationMs: z.number().int().min(0).max(10_000).default(500),
  sources: sourceMap,
});
export type VmixConfig = z.infer<typeof vmixConfigSchema>;

export const atemConfigSchema = z.object({
  host: z.string().trim().min(1, 'Obligatorio').max(255),
  /** Mezclador M/E (0 = M/E 1). */
  me: z.number().int().min(0).max(3).default(0),
  /** cut: corte directo a programa · auto: previo + transición automática. */
  transition: z.enum(['cut', 'auto']).default('cut'),
  sources: sourceMap,
});
export type AtemConfig = z.infer<typeof atemConfigSchema>;

/* ---------- F4.3 Iluminación ---------- */

export const LIGHTING_PROTOCOLS = [
  { value: 'osc', label: 'OSC (Eos, grandMA3, QLC+, Chamsys…)', port: 8000 },
  { value: 'msc', label: 'MIDI Show Control por red (ipMIDI)', port: 21928 },
  { value: 'artnet', label: 'Art-Net (DMX)', port: 6454 },
  { value: 'sacn', label: 'sACN / E1.31 (DMX)', port: 5568 },
] as const;
export type LightingProtocol = (typeof LIGHTING_PROTOCOLS)[number]['value'];

export const lightingConfigSchema = z.object({
  protocol: z.enum(['osc', 'msc', 'artnet', 'sacn']).default('osc'),
  /** IP de la mesa o del nodo; en sACN, vacío = multidifusión del universo. */
  host: z.string().trim().max(255).default(''),
  /** 0 = el del protocolo (OSC 8000, ipMIDI 21928, Art-Net 6454, sACN 5568). */
  port: z.number().int().min(0).max(65535).default(0),
  /** OSC: dirección con {cue} (p. ej. /eos/cue/{cue}/fire o /gma3/cmd). */
  oscAddress: z.string().trim().max(200).default('/eos/cue/{cue}/fire'),
  /** OSC: argumento de texto opcional con {cue} (p. ej. «Go+ Sequence 1 Cue {cue}»). */
  oscArg: z.string().trim().max(200).default(''),
  /** MSC: id de dispositivo (127 = todos). */
  mscDevice: z.number().int().min(0).max(127).default(127),
  /** MSC: lista de cues (opcional). */
  mscList: z.string().trim().max(20).default(''),
  /** DMX: universo (Art-Net desde 0; sACN desde 1). */
  universe: z.number().int().min(0).max(32767).default(1),
  /** DMX: escenas con nombre → canales («1=255,2=128,10-12=200»). */
  presets: z.record(z.string(), z.string().max(2000)).default({}),
});
export type LightingConfig = z.infer<typeof lightingConfigSchema>;

/**
 * Canales DMX de un cue: el nombre de una escena o «1=255,2=128,10-12=200»
 * (valores 0–255 o «50%»). Devuelve canal (1–512) → valor, o null si no vale.
 */
export function parseDmxSpec(
  spec: string,
  presets: Record<string, string> = {},
): Map<number, number> | null {
  const preset = Object.entries(presets).find(
    ([k]) => k.trim().toUpperCase() === spec.trim().toUpperCase(),
  );
  const text = (preset ? preset[1] : spec).trim();
  if (!text) return null;
  const out = new Map<number, number>();
  for (const part of text.split(/[,;\s]+/).filter(Boolean)) {
    const m = /^(\d{1,3})(?:-(\d{1,3}))?[=@:](\d{1,3})(%?)$/.exec(part);
    if (!m) return null;
    const from = Number(m[1]);
    const to = m[2] ? Number(m[2]) : from;
    const raw = Number(m[3]);
    const value = m[4] ? Math.round((Math.min(100, raw) / 100) * 255) : raw;
    if (from < 1 || to > 512 || from > to || value > 255) return null;
    for (let c = from; c <= to; c++) out.set(c, value);
  }
  return out.size ? out : null;
}

/* ---------- F4.4 Otros sistemas ---------- */

export const GENERIC_PROTOCOLS = [
  { value: 'http', label: 'HTTP (TriCaster, APIs web…)' },
  { value: 'tcp', label: 'TCP texto (RossTalk para Ross/XPression…)' },
  { value: 'udp', label: 'UDP texto' },
  { value: 'osc', label: 'OSC' },
] as const;
export type GenericProtocol = (typeof GENERIC_PROTOCOLS)[number]['value'];

/** Pistas del timeline (mismas claves que CUE_TRACKS de timeline.ts). */
const genericTracks = z.enum([
  'camara',
  'vtr',
  'rotulos',
  'letras',
  'fx',
  'luces',
  'audio',
  'notas',
]);

export const genericConfigSchema = z.object({
  protocol: z.enum(['http', 'tcp', 'udp', 'osc']).default('http'),
  host: z.string().trim().max(255).default(''),
  port: z.number().int().min(0).max(65535).default(0),
  /** HTTP: dirección con variables ({cue}, {label}, {target}, {track}). */
  url: z.string().trim().max(500).default(''),
  method: z.enum(['GET', 'POST']).default('GET'),
  /** HTTP POST: cuerpo (JSON o texto) con variables. */
  body: z.string().max(2000).default(''),
  /** TCP/UDP: comando de texto con variables (p. ej. «GPI {cue}»). */
  command: z.string().max(500).default('{cue}'),
  lineEnding: z.enum(['crlf', 'lf', 'none']).default('crlf'),
  /** OSC: dirección y argumento con variables. */
  oscAddress: z.string().trim().max(200).default('/runflow/{track}'),
  oscArg: z.string().trim().max(200).default('{cue}'),
  /** Pistas del timeline cuyos cues se mandan a este sistema. */
  tracks: z.array(genericTracks).min(1).default(['fx']),
});
export type GenericConfig = z.infer<typeof genericConfigSchema>;

/** Sustituye {cue}, {label}, {target} y {track} en una plantilla. */
export function fillTemplate(
  template: string,
  vars: { cue: string; label: string; target: string; track: string },
  encode: (v: string) => string = (v) => v,
): string {
  return template.replace(/\{(cue|label|target|track)\}/g, (_, k: keyof typeof vars) =>
    encode(vars[k]),
  );
}

export const DEVICE_KINDS = ['casparcg', 'obs', 'vmix', 'atem', 'lighting', 'generic'] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];
export const MIXER_KINDS: DeviceKind[] = ['obs', 'vmix', 'atem'];
export const DEVICE_KIND_LABEL: Record<DeviceKind, string> = {
  casparcg: 'CasparCG',
  obs: 'OBS Studio',
  vmix: 'vMix',
  atem: 'ATEM',
  lighting: 'Iluminación',
  generic: 'Otro sistema',
};

const name = z.string().trim().min(1, 'Obligatorio').max(60);
export const deviceInput = z.discriminatedUnion('kind', [
  z.object({
    name,
    kind: z.literal('casparcg'),
    enabled: z.boolean().default(true),
    config: casparConfigSchema,
  }),
  z.object({
    name,
    kind: z.literal('obs'),
    enabled: z.boolean().default(true),
    config: obsConfigSchema,
  }),
  z.object({
    name,
    kind: z.literal('vmix'),
    enabled: z.boolean().default(true),
    config: vmixConfigSchema,
  }),
  z.object({
    name,
    kind: z.literal('atem'),
    enabled: z.boolean().default(true),
    config: atemConfigSchema,
  }),
  z.object({
    name,
    kind: z.literal('lighting'),
    enabled: z.boolean().default(true),
    config: lightingConfigSchema,
  }),
  z.object({
    name,
    kind: z.literal('generic'),
    enabled: z.boolean().default(true),
    config: genericConfigSchema,
  }),
]);
export type DeviceInput = z.infer<typeof deviceInput>;
export type DeviceConfig =
  | CasparConfig
  | ObsConfig
  | VmixConfig
  | AtemConfig
  | LightingConfig
  | GenericConfig;

export function parseDeviceConfig(kind: string, config: unknown): DeviceConfig | null {
  const schema =
    kind === 'casparcg'
      ? casparConfigSchema
      : kind === 'obs'
        ? obsConfigSchema
        : kind === 'vmix'
          ? vmixConfigSchema
          : kind === 'atem'
            ? atemConfigSchema
            : kind === 'lighting'
              ? lightingConfigSchema
              : kind === 'generic'
                ? genericConfigSchema
                : null;
  const parsed = schema?.safeParse(config);
  return parsed?.success ? parsed.data : null;
}

export type DeviceDto = {
  id: string;
  name: string;
  enabled: boolean;
  status: DeviceStatus;
} & (
  | { kind: 'casparcg'; config: CasparConfig }
  | { kind: 'obs'; config: ObsConfig }
  | { kind: 'vmix'; config: VmixConfig }
  | { kind: 'atem'; config: AtemConfig }
  | { kind: 'lighting'; config: LightingConfig }
  | { kind: 'generic'; config: GenericConfig }
);

/** Fuente de una línea: su columna FUENTE o, en un VTR sin fuente, «VTR». */
export function lineSource(cells: Record<string, unknown>): string | null {
  const f = typeof cells.fuente === 'string' ? cells.fuente.trim().toUpperCase() : '';
  if (f) return f.replace(/\s+/g, ' ');
  return TIMECODE_LINE_TYPES.has(String(cells.tipo ?? '')) ? 'VTR' : null;
}

/** Entrada del mezclador para una fuente (sin distinguir mayúsculas). */
export function mapSource(sources: Record<string, string>, source: string | null): string | null {
  if (!source) return null;
  const key = source.trim().toUpperCase().replace(/\s+/g, ' ');
  for (const [k, v] of Object.entries(sources)) {
    if (k.trim().toUpperCase().replace(/\s+/g, ' ') === key) return v;
  }
  return null;
}

/** Estado de los mezcladores en directo (mensaje 106). */
export interface MixerState {
  devices: Record<string, DeviceStatus & { name: string; kind: DeviceKind }>;
  /** Fuente en programa (la de la línea EN AIRE) y su entrada en cada mezclador. */
  program: { lineId: string; source: string; inputs: Record<string, string> } | null;
  /** Latencia (ms) del último corte, del GO a la respuesta del mezclador. */
  lastCutMs: number | null;
  warning: string | null;
  /** Emisión en streaming y grabación de cada mezclador (F2.3). */
  outputs: Record<string, { streaming: boolean; recording: boolean }>;
}

export const STREAM_ACTIONS = ['startStream', 'stopStream', 'startRecord', 'stopRecord'] as const;
export type StreamAction = (typeof STREAM_ACTIONS)[number];
export const streamInput = z.object({
  action: z.enum(STREAM_ACTIONS),
  /** Sin equipo: el primero que lo permita. */
  deviceId: z.uuid().optional(),
});

export const initialMixerState = (): MixerState => ({
  devices: {},
  program: null,
  lastCutMs: null,
  warning: null,
  outputs: {},
});

export interface DeviceStatus {
  connected: boolean;
  error: string | null;
  version: string | null;
}

/** Capa de CasparCG de cada tipo de rótulo. */
export const GRAPHIC_LAYER: Record<string, keyof CasparConfig['layers']> = {
  TOT: 'lower',
  LOC: 'lower',
  INF: 'lower',
  DAT: 'logo',
  BAN: 'banner',
  HIG: 'banner',
  RRS: 'banner',
};

/* ---------- Horario de rótulos ---------- */

export interface GraphicCue {
  id: string;
  /** Segundos desde el inicio de la pieza. */
  inAt: number;
  outAt: number;
}

/** Rótulos automáticos de un VTR: entran en su TC y salen en su TC de salida o tras la duración por defecto. */
export function graphicCues(
  graphics: Pick<GraphicData, 'id' | 'tcIn' | 'tcOut'>[],
  defaultSeconds = DEFAULT_GRAPHIC_SECONDS,
): GraphicCue[] {
  const cues: GraphicCue[] = [];
  for (const g of graphics) {
    const tin = g.tcIn ? parseTimecode(g.tcIn) : null;
    if (tin === null) continue;
    const tout = g.tcOut ? parseTimecode(g.tcOut) : null;
    cues.push({
      id: g.id,
      inAt: tin,
      outAt: tout !== null && tout > tin ? tout : tin + defaultSeconds,
    });
  }
  return cues.sort((a, b) => a.inAt - b.inAt);
}

/** Datos que recibe la plantilla HTML de un rótulo (CasparCG `CG ADD` / vista previa). */
export interface CgTemplateData {
  type: string;
  fields: Record<string, string>;
  design: CgDesign;
}

export function templateData(g: GraphicData, design: CgDesign): CgTemplateData {
  const type = GRAPHIC_TYPE_BY_KEY[g.type];
  const fields: Record<string, string> = {};
  for (const f of type?.fields ?? []) {
    const v = (g[f.key] ?? '').trim();
    fields[f.key] = design.uppercase ? v.toUpperCase() : v;
  }
  return { type: g.type, fields, design };
}

/* ---------- Estado de RunFlow CG en directo ---------- */

export interface CgGraphicOnAir {
  lineId: string;
  type: string;
  /** Epoch ms en que entró. */
  since: number;
  /** Epoch ms en que saldrá solo (null = hasta ■). */
  outAt: number | null;
  auto: boolean;
}

export interface CgClipState {
  lineId: string;
  name: string;
  state: 'loaded' | 'playing' | 'paused' | 'stopped';
  loop: boolean;
  /** Epoch ms de inicio de la reproducción (reloj del servidor). */
  startedAt: number | null;
  /** Segundos de la pieza (CasparCG o DUR. VTR). */
  duration: number | null;
  /** Posición (s) informada por OSC y momento de la medida. */
  position: number | null;
  positionAt: number | null;
}

export interface CgState {
  graphics: Record<string, CgGraphicOnAir>;
  /** Rótulos ya emitidos (id → epoch ms de salida). */
  done: Record<string, number>;
  clip: CgClipState | null;
  /** Clip precargado para la siguiente línea. */
  preroll: { lineId: string; name: string } | null;
  devices: Record<string, DeviceStatus & { name: string }>;
  /** Clips de la escaleta que no están en CasparCG (en minúsculas). */
  missingClips: string[];
  /** Último error de un equipo (se muestra ⚠ en la cabecera). */
  warning: string | null;
}

export const initialCgState = (): CgState => ({
  graphics: {},
  done: {},
  clip: null,
  preroll: null,
  devices: {},
  missingClips: [],
  warning: null,
});

/** Nombre de clip normalizado como lo lista CasparCG (sin extensión, mayúsculas indiferentes). */
export function normalizeClip(name: string): string {
  return name
    .trim()
    .replace(/\\/g, '/')
    .replace(/\.[a-z0-9]{2,4}$/i, '')
    .toLowerCase();
}
