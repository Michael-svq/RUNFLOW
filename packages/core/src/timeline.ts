/*
 * F4.1 Timeline: pistas y cues dentro de cada línea, con precisión de
 * fotograma. La vista horizontal coloca cada línea según el motor de tiempos
 * y sus cues a su tiempo relativo dentro de la línea.
 */

export const CUE_TRACKS = [
  { key: 'camara', label: 'Cámaras', color: '#CC4125', hint: 'CAM 1, CAM 2… (plano)' },
  { key: 'vtr', label: 'VTR', color: '#76923C', hint: 'Clip o fuente' },
  { key: 'rotulos', label: 'Rótulos', color: '#46BDC6', hint: 'Texto del rótulo' },
  { key: 'letras', label: 'Letras', color: '#FFD24A', hint: 'Verso de la canción' },
  { key: 'fx', label: 'FX', color: '#B4A7D6', hint: 'Efecto' },
  { key: 'luces', label: 'Luces', color: '#FF7A1A', hint: 'Cue de iluminación (p. ej. 12.5)' },
  { key: 'audio', label: 'Audio', color: '#6FA8DC', hint: 'Pista, micro o efecto' },
  { key: 'notas', label: 'Notas', color: '#999999', hint: 'Aviso para el equipo' },
] as const;
export type CueTrack = (typeof CUE_TRACKS)[number]['key'];
export const CUE_TRACK_KEYS = CUE_TRACKS.map((t) => t.key) as CueTrack[];
export const isCueTrack = (v: unknown): v is CueTrack =>
  typeof v === 'string' && (CUE_TRACK_KEYS as string[]).includes(v);

export interface Cue {
  id: string;
  track: CueTrack;
  /** Segundos desde el inicio de la línea (puede tener fracción de fotograma). */
  at: number;
  /** Duración en segundos (0 = instantáneo). */
  duration: number;
  /** Texto visible: plano, verso, cue… */
  label: string;
  /** Dato para automatizar: fuente del mezclador, cue de luces, clip… */
  target: string;
}

export const DEFAULT_FPS = 25;

/** «m:ss:ff» (o «h:mm:ss:ff») con fotogramas. */
export function formatCueTime(seconds: number, fps = DEFAULT_FPS): string {
  const totalFrames = Math.max(0, Math.round(seconds * fps));
  const ff = totalFrames % fps;
  const s = Math.floor(totalFrames / fps);
  const p = (n: number) => String(n).padStart(2, '0');
  const h = Math.floor(s / 3600);
  const m = Math.floor(s / 60) % 60;
  const sec = s % 60;
  return h ? `${h}:${p(m)}:${p(sec)}:${p(ff)}` : `${m}:${p(sec)}:${p(ff)}`;
}

/**
 * Lee «m:ss:ff», «m:ss.d», «m:ss» o segundos («12», «12.5»). Devuelve segundos
 * o null si no es válido.
 */
export function parseCueTime(input: string, fps = DEFAULT_FPS): number | null {
  const t = input.trim().replace(',', '.');
  if (!t) return null;
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  const parts = t.split(':');
  if (parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return null;
  const n = parts.map(Number);
  if (parts.length === 2) {
    const [m, s] = n as [number, number];
    return s >= 60 ? null : m * 60 + s;
  }
  if (parts.length === 3) {
    const [m, s, f] = n as [number, number, number];
    if (s >= 60 || f >= fps || !Number.isInteger(f)) return null;
    return m * 60 + s + f / fps;
  }
  if (parts.length === 4) {
    const [h, m, s, f] = n as [number, number, number, number];
    if (m >= 60 || s >= 60 || f >= fps || !Number.isInteger(f)) return null;
    return h * 3600 + m * 60 + s + f / fps;
  }
  return null;
}

/** Cue con su posición absoluta (ms) en la escaleta, para la cue list. */
export interface PlacedCue extends Cue {
  lineId: string;
  /** Hora absoluta prevista (epoch ms). */
  absAt: number;
}

/** Coloca los cues de cada línea según su hora de inicio y los ordena. */
export function placeCues(
  lines: { id: string }[],
  starts: Map<string, number>,
  cues: Map<string, Cue[]>,
): PlacedCue[] {
  const out: PlacedCue[] = [];
  for (const l of lines) {
    const start = starts.get(l.id);
    if (start === undefined) continue;
    for (const c of cues.get(l.id) ?? [])
      out.push({ ...c, lineId: l.id, absAt: start + c.at * 1000 });
  }
  return out.sort(
    (a, b) =>
      a.absAt - b.absAt || CUE_TRACK_KEYS.indexOf(a.track) - CUE_TRACK_KEYS.indexOf(b.track),
  );
}

/** Próximo cue a partir de un instante (para el aviso «siguiente cue» en directo). */
export function nextCue(placed: PlacedCue[], nowMs: number, track?: CueTrack): PlacedCue | null {
  return placed.find((c) => c.absAt >= nowMs && (!track || c.track === track)) ?? null;
}

/* ---------- F4.2 Automatización ---------- */

/** Cue ejecutado en directo (lo emite el servidor por el WebSocket, mensaje 107). */
export interface FiredCue {
  cueId: string;
  lineId: string;
  track: CueTrack;
  label: string;
  target: string;
  /** Epoch ms en que se ejecutó. */
  at: number;
  /** Se mandó a un equipo (false = solo aviso: ensayo, sin armar o pista sin equipo). */
  executed: boolean;
  error: string | null;
}

export interface AutomationState {
  fired: FiredCue[];
}
