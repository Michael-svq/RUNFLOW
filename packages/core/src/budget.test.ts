import { describe, expect, it } from 'vitest';
import { budgetCsv, moneyInput, parseMoney, summarizeBudget, type BudgetLineDto } from './budget';

describe('presupuesto', () => {
  it('lee importes escritos a mano', () => {
    expect(parseMoney('1.234,56')).toBe(123456);
    expect(parseMoney('1234,5')).toBe(123450);
    expect(parseMoney('1234.56')).toBe(123456);
    expect(parseMoney('1,234.56')).toBe(123456);
    expect(parseMoney('1.234')).toBe(123400);
    expect(parseMoney('1 500 €')).toBe(150000);
    expect(parseMoney('0')).toBe(0);
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('-5')).toBeNull();
    expect(parseMoney('abc')).toBeNull();
    expect(moneyInput(123450)).toBe('1234,50');
    expect(moneyInput(null)).toBe('');
  });

  it('resume previsto, real y desviación por categoría', () => {
    const s = summarizeBudget([
      { category: 'catering', plannedCents: 30000, actualCents: 34000, paid: false },
      { category: 'catering', plannedCents: 10000, actualCents: null, paid: false },
      { category: 'personal', plannedCents: 100000, actualCents: 90000, paid: true },
    ]);
    expect(s.total).toEqual({
      plannedCents: 140000,
      actualCents: 124000,
      plannedWithActualCents: 130000,
      deviationCents: -6000,
      pendingPaymentCents: 34000,
      lines: 3,
    });
    expect(s.byCategory.map((c) => c.category)).toEqual(['personal', 'catering']);
    expect(s.byCategory[1]).toMatchObject({ plannedCents: 40000, deviationCents: 4000 });
  });

  it('exporta CSV para hojas de cálculo en español', () => {
    const line: BudgetLineDto = {
      id: '1',
      category: 'catering',
      concept: 'Bocadillos; agua',
      provider: 'Bar Pepe',
      plannedCents: 30000,
      actualCents: 34050,
      date: '2026-12-18',
      invoice: 'F-12',
      paid: false,
      notes: '',
      programId: null,
      programName: 'Gala',
      eventId: null,
      eventTitle: null,
    };
    const csv = budgetCsv([line]);
    expect(csv.startsWith('﻿Fecha;Programa')).toBe(true);
    expect(csv.split('\r\n')[1]).toBe(
      '2026-12-18;Gala;;Catering;"Bocadillos; agua";Bar Pepe;300,00;340,50;+40,50;F-12;No;',
    );
  });
});
