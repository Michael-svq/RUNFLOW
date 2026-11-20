import { describe, expect, it } from 'vitest';
import { COLUMN_BY_KEY } from '@runflow/core';
import { displayValue, parseInput, parseTsv, toTsv } from './cells';

const col = (k: string) => COLUMN_BY_KEY[k]!;

describe('celdas', () => {
  it('interpreta tipos, estados y duraciones', () => {
    expect(parseInput(col('tipo'), 'vtr')).toEqual({ ok: true, value: 'VTR' });
    expect(parseInput(col('tipo'), 'total + colas')).toEqual({ ok: true, value: 'TOTAL_COLAS' });
    expect(parseInput(col('tipo'), 'moch')).toEqual({ ok: true, value: 'MOCHILA' });
    expect(parseInput(col('tipo'), 'inventado').ok).toBe(false);
    expect(parseInput(col('estado'), 'a')).toEqual({ ok: true, value: 'A' });
    expect(parseInput(col('estado'), 'final')).toEqual({ ok: true, value: 'A' });
    expect(parseInput(col('t_est'), '1:30')).toEqual({ ok: true, value: 90 });
    expect(parseInput(col('t_est'), 'mucho').ok).toBe(false);
    expect(parseInput(col('nombre'), '  ')).toEqual({ ok: true, value: null });
    expect(displayValue(col('t_est'), 90)).toBe('0:01:30');
    expect(displayValue(col('tipo'), 'CAB_RAF')).toBe('CAB + RAF');
  });

  it('copia y pega TSV con saltos de línea y comillas', () => {
    const rows = [
      ['ANDRES // CICLISTA\nPABLO // PETANCA', 'a"b', 'normal'],
      ['', 'x', ''],
    ];
    expect(parseTsv(toTsv(rows))).toEqual(rows);
    expect(parseTsv('a\tb\r\nc\td\r\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });
});
