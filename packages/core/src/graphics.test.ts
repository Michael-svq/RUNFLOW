import { describe, expect, it } from 'vitest';
import {
  graphicSummary,
  overlappingGraphics,
  parseTimecode,
  validateGraphic,
  type GraphicData,
} from './graphics';

const g = (p: Partial<GraphicData>): GraphicData => ({
  id: 'x',
  type: 'TOT',
  f0: '',
  f1: '',
  f2: '',
  f3: '',
  tcIn: '',
  tcOut: '',
  ...p,
});

describe('rótulos', () => {
  it('TC mm:ss', () => {
    expect(parseTimecode('00:12')).toBe(12);
    expect(parseTimecode('1:05')).toBe(65);
    expect(parseTimecode('45')).toBe(45);
    expect(parseTimecode('1:75')).toBeNull();
  });

  it('valida obligatorios, longitudes y TC', () => {
    expect(validateGraphic(g({ f0: 'ANA', f1: 'MINISTRA' }))).toEqual([]);
    expect(validateGraphic(g({ f0: '' })).map((i) => i.field)).toEqual(['f0']);
    expect(validateGraphic(g({ f0: 'X'.repeat(41) })).map((i) => i.field)).toEqual(['f0']);
    expect(
      validateGraphic(g({ f0: 'A', tcIn: '00:20', tcOut: '00:10' })).map((i) => i.field),
    ).toEqual(['tcOut']);
    expect(validateGraphic(g({ f0: 'A', tcOut: '00:10' })).map((i) => i.field)).toEqual(['tcIn']);
    expect(
      validateGraphic(g({ f0: 'A', tcIn: '01:20' }), { pieceSeconds: 70 }).map((i) => i.field),
    ).toEqual(['tcIn']);
    expect(validateGraphic(g({ type: 'ZZZ' }))[0]!.field).toBe('type');
  });

  it('resumen para la columna GRAFISMO', () => {
    expect(graphicSummary(g({ f0: 'ANDRES', f1: 'CICLISTA BMX' }))).toBe(
      'TOT ANDRES // CICLISTA BMX',
    );
    expect(graphicSummary(g({ type: 'LOC', f0: 'SEVILLA', tcIn: '00:05' }))).toBe(
      'LOC 00:05 SEVILLA',
    );
  });

  it('detecta solapes (sin TC de salida, 6 s)', () => {
    const list = [
      g({ id: 'a', tcIn: '00:10' }),
      g({ id: 'b', tcIn: '00:14', tcOut: '00:20' }),
      g({ id: 'c', tcIn: '00:20' }),
    ];
    expect(overlappingGraphics(list)).toEqual([['a', 'b']]);
  });
});
