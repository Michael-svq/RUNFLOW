import { describe, expect, it } from 'vitest';
import { autoStep, DEFAULT_CAMERA_AUTO, DEFAULT_CAMERA_IMAGE } from '@runflow/core';
import { analyze, vectorPoint } from './scopes';

/** Imagen de `w`×`h` píxeles con el color que devuelve `fill(x, y)`. */
function image(w: number, h: number, fill: (x: number, y: number) => [number, number, number]) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = fill(x, y);
      data.set([r, g, b, 255], (y * w + x) * 4);
    }
  }
  return data;
}

describe('monitor de señal', () => {
  it('gris medio: luminancia, histograma, forma de onda y vectorscopio en el centro', () => {
    const s = analyze(
      image(4, 2, () => [128, 128, 128]),
      4,
      2,
    );
    expect(s.stats.luma).toBeCloseTo(50.2, 1);
    expect(s.histY[128]).toBe(8);
    expect(s.waveY[0 * 256 + 128]).toBe(2);
    expect(s.vector[128 * 256 + 128]).toBe(8);
    expect(s.stats).toMatchObject({ clipHigh: 0, clipLow: 0, castR: 0, castB: 0 });
    expect(s.stats.neutralShare).toBe(100);
  });

  it('mide blancos quemados, negros empastados y dominante de color', () => {
    const s = analyze(
      image(10, 1, (x) => (x < 2 ? [255, 255, 255] : x < 3 ? [0, 0, 0] : [140, 120, 100])),
      10,
      1,
    );
    expect(s.stats.clipHigh).toBe(20);
    expect(s.stats.clipLow).toBe(10);
    expect(s.stats.castR).toBeCloseTo((20 / 255) * 100, 1);
    expect(s.stats.castB).toBeCloseTo((-20 / 255) * 100, 1);
    // El control automático corrige rojo hacia abajo y azul hacia arriba.
    const step = autoStep(s.stats, DEFAULT_CAMERA_IMAGE, {
      ...DEFAULT_CAMERA_AUTO,
      clipLimit: 30,
      tolerance: 20,
    })!;
    expect(step.patch.rGain).toBeLessThan(0);
    expect(step.patch.bGain).toBeGreaterThan(0);
  });

  it('el rojo puro cae hacia Cr alto en el vectorscopio', () => {
    const p = vectorPoint(191, 0, 0);
    expect(p.y).toBeGreaterThan(200);
    expect(p.x).toBeLessThan(128);
  });
});
