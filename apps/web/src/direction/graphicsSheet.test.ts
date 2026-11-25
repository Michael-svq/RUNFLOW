import { describe, expect, it } from 'vitest';
import type { LineSnapshot, ScriptGraphicBlock } from '@runflow/sync';
import { planImport, sheetRows, toCsvRows } from './graphicsSheet';

const line = (id: string, num: string, nombre: string): LineSnapshot =>
  ({ id, pos: id, cells: { num, nombre } }) as LineSnapshot;
const g = (id: string, type: string, f0: string, f1 = ''): ScriptGraphicBlock => ({
  kind: 'rotulo',
  id,
  type,
  f0,
  f1,
  f2: '',
  f3: '',
  tcIn: '',
  tcOut: '',
});

const lines = [line('a', '2', 'PRESENTACIÓN'), line('b', '4', 'PRESUPUESTOS')];
const graphics = new Map([
  ['a', [g('g1', 'TOT', 'Ana Pérez', 'Presentadora')]],
  ['b', [g('g2', 'TOT', 'María López'), g('g3', 'LOC', 'Sevilla')]],
]);

describe('hoja de rotulación', () => {
  it('ordena los rótulos por línea y exporta con cabecera', () => {
    const rows = sheetRows(lines, graphics);
    expect(rows.map((r) => r.graphic.id)).toEqual(['g1', 'g2', 'g3']);
    const csv = toCsvRows(rows);
    expect(csv[0]).toContain('Plantilla');
    expect(csv[1]).toEqual([
      '2',
      'PRESENTACIÓN',
      'TOT',
      'Ana Pérez',
      'Presentadora',
      '',
      '',
      '',
      '',
      'g1',
    ]);
  });

  it('importa: actualiza por ID, mueve de noticia, crea y salta lo desconocido', () => {
    const rows = sheetRows(lines, graphics);
    const plan = planImport(
      [
        ['Nº', 'Noticia', 'Plantilla', 'Campo 1', 'Campo 2', 'TC IN', 'ID'],
        ['2', '', 'TOT', 'Ana Pérez', 'Directora', '', 'g1'],
        ['', 'presupuestos', 'tot', 'Luis García', 'Ministro', '00:05', ''],
        ['2', '', 'LOC', 'Madrid', '', '', 'g3'],
        ['99', 'NO EXISTE', 'TOT', 'Nadie', '', '', ''],
        ['', '', '', '', '', '', ''],
      ],
      lines,
      rows,
    );
    expect(plan.updates).toEqual([
      {
        lineId: 'a',
        graphicId: 'g1',
        fields: {
          type: 'TOT',
          f0: 'Ana Pérez',
          f1: 'Directora',
          f2: '',
          f3: '',
          tcIn: '',
          tcOut: '',
        },
      },
      expect.objectContaining({ lineId: 'b', graphicId: 'g3', toLineId: 'a' }),
    ]);
    expect(plan.inserts).toEqual([
      {
        lineId: 'b',
        fields: {
          type: 'TOT',
          f0: 'Luis García',
          f1: 'Ministro',
          f2: '',
          f3: '',
          tcIn: '00:05',
          tcOut: '',
        },
      },
    ]);
    expect(plan.skipped).toBe(1);
  });

  it('sin cabecera usa el orden de la exportación', () => {
    const plan = planImport([['4', 'PRESUPUESTOS', 'BAN', 'Última hora', 'Línea 2']], lines, []);
    expect(plan.inserts[0]).toMatchObject({
      lineId: 'b',
      fields: { type: 'BAN', f0: 'Última hora', f1: 'Línea 2' },
    });
  });
});
