import { z } from 'zod';

/*
 * Control de cámara (Dirección TV): cámaras PTZ por VISCA sobre IP o
 * Panasonic AW, ajustes de imagen, memorias copiables entre cámaras y control
 * automático de la señal según unos objetivos (nivel, recortes y color).
 */

export const CAMERA_PROTOCOLS = [
  {
    value: 'visca',
    label: 'VISCA sobre IP (Sony, PTZOptics, Lumens, Avonic…)',
    port: 52381,
  },
  { value: 'panasonic', label: 'Panasonic AW (HTTP)', port: 80 },
  { value: 'simulated', label: 'Simulada (estudio virtual)', port: 0 },
] as const;
export type CameraProtocol = (typeof CAMERA_PROTOCOLS)[number]['value'];

export const cameraConfigSchema = z.object({
  protocol: z.enum(['visca', 'panasonic', 'simulated']).default('visca'),
  host: z.string().trim().max(255).default(''),
  /** 0 = el del protocolo (52381 VISCA, 80 Panasonic). */
  port: z.number().int().min(0).max(65535).default(0),
  /** Dirección VISCA de la cámara (1–7). */
  address: z.number().int().min(1).max(7).default(1),
  /** Imagen fija (JPEG) para el monitor de señal; vacío = la de la cámara si la tiene. */
  snapshotUrl: z.string().trim().max(500).default(''),
});
export type CameraConfig = z.infer<typeof cameraConfigSchema>;

/** Velocidades de obturación (índice en `shutter`). */
export const CAMERA_SHUTTERS = ['1/50', '1/60', '1/100', '1/120', '1/250', '1/500', '1/1000'];

/** Ajustes de imagen (unidades de RunFlow; cada protocolo los traduce). */
export const cameraImageSchema = z.object({
  /** Diafragma: 0 cerrado … 100 abierto. */
  iris: z.number().min(0).max(100),
  /** Ganancia en dB (0–36). */
  gainDb: z.number().min(0).max(36),
  /** Índice de CAMERA_SHUTTERS. */
  shutter: z
    .number()
    .int()
    .min(0)
    .max(CAMERA_SHUTTERS.length - 1),
  /** Balance de blancos: corrección de rojo y azul (−50…50). */
  rGain: z.number().min(-50).max(50),
  bGain: z.number().min(-50).max(50),
  /** Nivel de negro (pedestal), −50…50. */
  pedestal: z.number().min(-50).max(50),
  /** Detalle (nitidez) 0–100. */
  detail: z.number().min(0).max(100),
});
export type CameraImage = z.infer<typeof cameraImageSchema>;
export const cameraImagePatch = cameraImageSchema.partial();

export const DEFAULT_CAMERA_IMAGE: CameraImage = {
  iris: 50,
  gainDb: 0,
  shutter: 0,
  rGain: 0,
  bGain: 0,
  pedestal: 0,
  detail: 50,
};

/** Objetivos del control automático de la señal. */
export const cameraAutoSchema = z.object({
  /** Nivel medio de luminancia buscado (% de la escala). */
  lumaTarget: z.number().min(10).max(90).default(45),
  /** Margen alrededor del objetivo (puntos). */
  tolerance: z.number().min(1).max(20).default(4),
  /** Ganancia máxima que puede subir (dB). */
  maxGainDb: z.number().min(0).max(36).default(12),
  /** % de la imagen que puede estar quemado (blancos recortados). */
  clipLimit: z.number().min(0).max(30).default(2),
  /** Corrige también el balance de blancos con las zonas neutras. */
  whiteBalance: z.boolean().default(true),
});
export type CameraAuto = z.infer<typeof cameraAutoSchema>;
export const DEFAULT_CAMERA_AUTO: CameraAuto = cameraAutoSchema.parse({});

/** Memoria de ajustes: se graba de una cámara y se lee en cualquiera. */
export const cameraProfileSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1, 'Obligatorio').max(40),
  image: cameraImageSchema,
  auto: cameraAutoSchema.prefault({}),
});
export type CameraProfile = z.infer<typeof cameraProfileSchema>;

export const cameraMoveInput = z.object({
  /** Velocidades −1…1 (0 = parar). */
  pan: z.number().min(-1).max(1).default(0),
  tilt: z.number().min(-1).max(1).default(0),
  zoom: z.number().min(-1).max(1).default(0),
  focus: z.number().min(-1).max(1).default(0),
});
export type CameraMove = z.infer<typeof cameraMoveInput>;

export const cameraPresetInput = z.object({
  action: z.enum(['recall', 'save']),
  /** Memoria de posición 1–100. */
  slot: z.number().int().min(1).max(100),
});

export interface CameraState {
  image: CameraImage;
  focusAuto: boolean;
  /** Posiciones guardadas (memorias de posición). */
  presets: number[];
  /** Último balance hecho (epoch ms). */
  whiteBalancedAt: number | null;
  blackBalancedAt: number | null;
}

export interface CameraDto {
  id: string;
  name: string;
  protocol: CameraProtocol;
  connected: boolean;
  error: string | null;
  /** La cámara da imagen fija para el monitor de señal. */
  snapshot: boolean;
  state: CameraState;
}

/* ---------- Medidas de la señal y control automático ---------- */

/** Medidas que el monitor de señal saca de la imagen. */
export interface SignalStats {
  /** Luminancia media (0–100). */
  luma: number;
  /** % de píxeles quemados (≥ 98 %) y empastados (≤ 2 %). */
  clipHigh: number;
  clipLow: number;
  /** Dominante de color en zonas neutras: rojo − verde y azul − verde (−100…100). */
  castR: number;
  castB: number;
  /** Píxeles neutros usados para el color (0 = no hay referencia). */
  neutralShare: number;
}

export interface AutoStep {
  patch: Partial<CameraImage>;
  /** Qué se corrige (para la persona que mira). */
  reason: string;
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Un paso del control automático: corrige la exposición con el diafragma y,
 * si no basta, con la ganancia (sin pasar de `maxGainDb`); baja si hay
 * blancos quemados de más; y ajusta el balance de blancos con las zonas
 * neutras. Devuelve null si la señal ya está dentro de los objetivos.
 */
export function autoStep(
  stats: SignalStats,
  image: CameraImage,
  auto: CameraAuto,
): AutoStep | null {
  const patch: Partial<CameraImage> = {};
  const reasons: string[] = [];
  const error = auto.lumaTarget - stats.luma;
  const burnt = stats.clipHigh > auto.clipLimit;
  if (burnt || error < -auto.tolerance) {
    // Demasiada luz: primero baja la ganancia y luego cierra el diafragma.
    const step = burnt ? Math.max(3, Math.abs(error) * 0.6) : Math.abs(error) * 0.6;
    if (image.gainDb > 0) {
      patch.gainDb = clamp(Math.floor(image.gainDb - Math.max(3, step / 2)), 0, 36);
      reasons.push(burnt ? 'blancos quemados: baja la ganancia' : 'imagen clara: baja la ganancia');
    } else if (image.iris > 0) {
      patch.iris = round1(clamp(image.iris - Math.max(1, step), 0, 100));
      reasons.push(
        burnt ? 'blancos quemados: cierra el diafragma' : 'imagen clara: cierra el diafragma',
      );
    }
  } else if (error > auto.tolerance) {
    // Falta luz: primero abre el diafragma y luego sube la ganancia.
    const step = error * 0.6;
    if (image.iris < 100) {
      patch.iris = round1(clamp(image.iris + Math.max(1, step), 0, 100));
      reasons.push('imagen oscura: abre el diafragma');
    } else if (image.gainDb < auto.maxGainDb) {
      patch.gainDb = clamp(Math.ceil(image.gainDb + Math.max(3, step / 2)), 0, auto.maxGainDb);
      reasons.push('imagen oscura: sube la ganancia');
    } else {
      reasons.push(`falta luz (diafragma abierto y ganancia en ${auto.maxGainDb} dB)`);
    }
  }
  if (auto.whiteBalance && stats.neutralShare >= 2) {
    const WB_TOLERANCE = 2;
    if (Math.abs(stats.castR) > WB_TOLERANCE) {
      patch.rGain = round1(clamp(image.rGain - stats.castR * 0.5, -50, 50));
    }
    if (Math.abs(stats.castB) > WB_TOLERANCE) {
      patch.bGain = round1(clamp(image.bGain - stats.castB * 0.5, -50, 50));
    }
    if (patch.rGain !== undefined || patch.bGain !== undefined) reasons.push('corrige el color');
  }
  const changed = Object.entries(patch).filter(([k, v]) => v !== image[k as keyof CameraImage]);
  if (!changed.length) return reasons.length ? { patch: {}, reason: reasons.join(' · ') } : null;
  return {
    patch: Object.fromEntries(changed) as Partial<CameraImage>,
    reason: reasons.join(' · '),
  };
}
