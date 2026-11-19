import { describe, expect, it } from 'vitest';
import {
  BUILTIN_VIEWS,
  COLUMN_BY_KEY,
  COLUMNS,
  createRundownInput,
  formatClock,
  formatDuration,
  parseClock,
  parseDuration,
  saveViewInput,
} from './index';

describe('duraciones', () => {
  it.each([
    ['30', 30],
    ['1:30', 90],
    ['0:01:30', 90],
    ['1.30', 90],
    ['1,05', 65],
    ['2:00:00', 7200],
    [' 45 ', 45],
  ])('"%s" → %i s', (input, seconds) => {
    expect(parseDuration(input)).toBe(seconds);
  });

  it.each(['', 'abc', '1:75', '1::2', '-5'])('"%s" no es válida', (input) => {
    expect(parseDuration(input)).toBeNull();
  });

  it('formatea como en la referencia', () => {
    expect(formatDuration(30)).toBe('0:00:30');
    expect(formatDuration(220)).toBe('0:03:40');
    expect(formatDuration(3725)).toBe('1:02:05');
    expect(formatDuration(70, { short: true })).toBe('1:10');
    expect(formatDuration(-95)).toBe('-0:01:35');
    expect(formatDuration(null)).toBe('');
  });
});

describe('horas', () => {
  it('interpreta y formatea', () => {
    expect(parseClock('12:00')).toBe(43200);
    expect(parseClock('13:30:15')).toBe(48615);
    expect(parseClock('24:00')).toBeNull();
    expect(formatClock(43230)).toBe('12:00:30');
    expect(formatClock(86400 + 60)).toBe('00:01:00');
  });

  it('normaliza la hora de la escaleta', () => {
    const r = createRundownInput.parse({
      programId: '7b0c1f1e-6d4a-4f55-9a43-2c9d4f6a1b11',
      airDate: '2026-11-20',
      startTime: '9:05',
      endTime: '10:00:30',
    });
    expect(r.startTime).toBe('09:05:00');
    expect(r.endTime).toBe('10:00:30');
  });
});

describe('catálogo', () => {
  it('las columnas tienen claves únicas', () => {
    expect(new Set(COLUMNS.map((c) => c.key)).size).toBe(COLUMNS.length);
  });

  it('las vistas de serie solo usan columnas existentes y empiezan por ESTADO y Nº', () => {
    for (const v of BUILTIN_VIEWS) {
      for (const c of v.columns) expect(COLUMN_BY_KEY[c.key]).toBeDefined();
      expect(v.columns.slice(0, 2).map((c) => c.key)).toEqual(['estado', 'num']);
    }
  });

  it('no permite vistas con columnas repetidas', () => {
    const r = saveViewInput.safeParse({
      name: 'Mía',
      columns: [
        { key: 'nombre', width: 100 },
        { key: 'nombre', width: 120 },
      ],
    });
    expect(r.success).toBe(false);
  });
});
