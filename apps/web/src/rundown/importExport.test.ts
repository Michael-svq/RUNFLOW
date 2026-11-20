import { describe, expect, it } from 'vitest';
import { detectHeader, parseCsv, rowsToLines, toCsv } from './importExport';

// Extracto de la escaleta de referencia (docs/referencias/escaleta-general).
const reference = [
  ['', '', '', '', '', '', 'MEDIA DURACION 0:50 +5'],
  [
    'ESTADO',
    'Nº',
    'PRESENTA',
    'TIEMPO ESTIMADO',
    'TIPO',
    'NOMBRE / DESCRIPCIÓN',
    'INSITU REPORTERO',
    'FUENTE',
    'DUR. VTR',
    'COLEAs',
  ],
  ['C', '2', 'EDU', '0:00:30', 'ACTING', 'PRESENTACION', '', '', '', ''],
  ['E', '4', 'EDU', '0:00:45', 'ACTING', 'PASO A VTR', '', '', '', ''],
  ['', '12', '', '', 'VTR', 'VTR ANDALUCIA', '', 'VTR 1', '1:10', '5'],
  ['', '16', '', '', 'TOTAL + COLAS', 'RAFA NADAL', '', 'VTR 3', '3:30', '50'],
  ['', '', '', '', '', '', '', '', '', ''],
  ['CAE', 'C', '', '', '', '', '', '', '', ''],
];

describe('importación', () => {
  it('reconoce la cabecera de la escaleta de referencia', () => {
    const h = detectHeader(reference)!;
    expect(h.headerRow).toBe(1);
    expect(h.mapping).toEqual([
      'estado',
      'num',
      'presenta',
      't_est',
      'tipo',
      'nombre',
      'reportero',
      'fuente',
      'dur_vtr',
      'coleo',
    ]);
  });

  it('convierte filas en líneas con tipos, estados y duraciones', () => {
    const h = detectHeader(reference)!;
    const { lines } = rowsToLines(reference, h.headerRow, h.mapping);
    expect(lines).toHaveLength(4);
    expect(lines[0]).toEqual({
      estado: 'C',
      num: '2',
      presenta: 'EDU',
      t_est: 30,
      tipo: 'ACTING',
      nombre: 'PRESENTACION',
    });
    expect(lines[2]).toMatchObject({ tipo: 'VTR', fuente: 'VTR 1', dur_vtr: 70, coleo: 5 });
    expect(lines[3]).toMatchObject({ tipo: 'TOTAL_COLAS', dur_vtr: 210, coleo: 50 });
  });

  it('horas de Excel como fracción de día', () => {
    const rows = [
      ['TIPO', 'NOMBRE', 'TIEMPO ESTIMADO'],
      ['ACTING', 'X', 30 / 86400],
    ];
    const h = detectHeader(rows)!;
    expect(rowsToLines(rows, h.headerRow, h.mapping).lines[0]!.t_est).toBe(30);
  });

  it('CSV con ; y comillas, ida y vuelta', () => {
    const rows = [
      ['NOMBRE', 'OBSERVACIONES'],
      ['A; B', 'dice "hola"\notra línea'],
    ];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});
