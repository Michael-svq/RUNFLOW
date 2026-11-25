import type { SignalStats } from '@runflow/core';

/*
 * Monitor de señal: a partir de los píxeles de la imagen (RGBA) calcula el
 * histograma, la forma de onda de luminancia, el desfile RGB, el
 * vectorscopio (Cb/Cr, Rec. 709) y las medidas para el control automático.
 */

export interface Scopes {
  width: number;
  height: number;
  /** 256 niveles de luminancia y de cada canal. */
  histY: Uint32Array;
  histR: Uint32Array;
  histG: Uint32Array;
  histB: Uint32Array;
  /** Forma de onda: columna × 256 niveles (Y y cada canal). */
  waveY: Uint32Array;
  waveR: Uint32Array;
  waveG: Uint32Array;
  waveB: Uint32Array;
  /** Vectorscopio: 256 × 256 (Cb en x, Cr en y). */
  vector: Uint32Array;
  stats: SignalStats;
  /** Momento (epoch ms) en que se pidió o capturó la imagen. */
  at?: number;
}

/** Píxel neutro: poca saturación y ni muy oscuro ni quemado. */
const NEUTRAL_CHROMA = 0.3;

export function analyze(data: Uint8ClampedArray, width: number, height: number): Scopes {
  const histY = new Uint32Array(256);
  const histR = new Uint32Array(256);
  const histG = new Uint32Array(256);
  const histB = new Uint32Array(256);
  const waveY = new Uint32Array(width * 256);
  const waveR = new Uint32Array(width * 256);
  const waveG = new Uint32Array(width * 256);
  const waveB = new Uint32Array(width * 256);
  const vector = new Uint32Array(256 * 256);
  let sumY = 0;
  let high = 0;
  let low = 0;
  let neutral = 0;
  let castR = 0;
  let castB = 0;
  const total = width * height;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const Y = Math.min(255, Math.round(lum));
      histY[Y]!++;
      histR[r]!++;
      histG[g]!++;
      histB[b]!++;
      waveY[x * 256 + Y]!++;
      waveR[x * 256 + r]!++;
      waveG[x * 256 + g]!++;
      waveB[x * 256 + b]!++;
      const cb = Math.max(0, Math.min(255, Math.round((b - lum) / 1.8556 + 128)));
      const cr = Math.max(0, Math.min(255, Math.round((r - lum) / 1.5748 + 128)));
      vector[cr * 256 + cb]!++;
      sumY += lum;
      if (lum >= 250) high++;
      if (lum <= 5) low++;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (lum >= 40 && lum <= 235 && max - min < NEUTRAL_CHROMA * max) {
        neutral++;
        castR += r - g;
        castB += b - g;
      }
    }
  }
  const pct = (n: number) => (total ? (n / total) * 100 : 0);
  return {
    width,
    height,
    histY,
    histR,
    histG,
    histB,
    waveY,
    waveR,
    waveG,
    waveB,
    vector,
    stats: {
      luma: total ? (sumY / total / 255) * 100 : 0,
      clipHigh: pct(high),
      clipLow: pct(low),
      castR: neutral ? (castR / neutral / 255) * 100 : 0,
      castB: neutral ? (castB / neutral / 255) * 100 : 0,
      neutralShare: pct(neutral),
    },
  };
}

/** Posición en el vectorscopio (0–255) de un color RGB (para la retícula de barras al 75 %). */
export function vectorPoint(r: number, g: number, b: number): { x: number; y: number } {
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return { x: (b - lum) / 1.8556 + 128, y: (r - lum) / 1.5748 + 128 };
}

/** Objetivos de las barras de color al 75 % (R, Mg, B, Cy, G, Yl). */
export const VECTOR_TARGETS: { label: string; rgb: [number, number, number] }[] = [
  { label: 'R', rgb: [191, 0, 0] },
  { label: 'Mg', rgb: [191, 0, 191] },
  { label: 'B', rgb: [0, 0, 191] },
  { label: 'Cy', rgb: [0, 191, 191] },
  { label: 'G', rgb: [0, 191, 0] },
  { label: 'Yl', rgb: [191, 191, 0] },
];
