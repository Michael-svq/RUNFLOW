import { z } from 'zod';

/* F3.2 Presupuesto: partidas por programa o convocatoria, previsto frente a real. */

export const BUDGET_CATEGORIES = [
  { value: 'personal', label: 'Personal' },
  { value: 'tecnico', label: 'Material técnico' },
  { value: 'transporte', label: 'Transporte y dietas' },
  { value: 'catering', label: 'Catering' },
  { value: 'escenografia', label: 'Escenografía' },
  { value: 'maquillaje', label: 'Maquillaje y vestuario' },
  { value: 'derechos', label: 'Derechos y música' },
  { value: 'invitados', label: 'Invitados y colaboradores' },
  { value: 'otros', label: 'Otros' },
] as const;
export type BudgetCategory = (typeof BUDGET_CATEGORIES)[number]['value'];
const categories = BUDGET_CATEGORIES.map((c) => c.value) as [BudgetCategory, ...BudgetCategory[]];

/** Céntimos (enteros) para no arrastrar errores de coma flotante. */
const cents = z.number().int().min(0).max(100_000_000_000);
const day = z.iso.date();
const text = (max: number) => z.string().trim().max(max);

export const budgetLineInput = z.object({
  category: z.enum(categories).default('otros'),
  concept: text(200).min(1, 'Obligatorio'),
  provider: text(120).default(''),
  plannedCents: cents.default(0),
  actualCents: cents.nullable().default(null),
  date: day.nullable().default(null),
  invoice: text(60).default(''),
  paid: z.boolean().default(false),
  notes: text(1000).default(''),
  programId: z.uuid().nullable().default(null),
  eventId: z.uuid().nullable().default(null),
});
export type BudgetLineInput = z.infer<typeof budgetLineInput>;

export const budgetLinePatch = z
  .object({
    category: z.enum(categories),
    concept: text(200).min(1),
    provider: text(120),
    plannedCents: cents,
    actualCents: cents.nullable(),
    date: day.nullable(),
    invoice: text(60),
    paid: z.boolean(),
    notes: text(1000),
    programId: z.uuid().nullable(),
    eventId: z.uuid().nullable(),
  })
  .partial();

export const budgetQuery = z.object({
  programId: z.uuid().optional(),
  eventId: z.uuid().optional(),
  from: day.optional(),
  to: day.optional(),
});
export type BudgetQuery = z.infer<typeof budgetQuery>;

export interface BudgetLineDto {
  id: string;
  category: BudgetCategory;
  concept: string;
  provider: string;
  plannedCents: number;
  actualCents: number | null;
  date: string | null;
  invoice: string;
  paid: boolean;
  notes: string;
  programId: string | null;
  programName: string | null;
  eventId: string | null;
  eventTitle: string | null;
}

export interface BudgetTotals {
  plannedCents: number;
  /** Gasto real conocido (partidas con importe real). */
  actualCents: number;
  /** Previsto de las partidas que ya tienen real, para comparar lo comparable. */
  plannedWithActualCents: number;
  /** Real − previsto en las partidas con real (positivo = por encima). */
  deviationCents: number;
  pendingPaymentCents: number;
  lines: number;
}

export interface BudgetSummary {
  total: BudgetTotals;
  byCategory: ({ category: BudgetCategory } & BudgetTotals)[];
}

const emptyTotals = (): BudgetTotals => ({
  plannedCents: 0,
  actualCents: 0,
  plannedWithActualCents: 0,
  deviationCents: 0,
  pendingPaymentCents: 0,
  lines: 0,
});

function add(t: BudgetTotals, l: Pick<BudgetLineDto, 'plannedCents' | 'actualCents' | 'paid'>) {
  t.lines++;
  t.plannedCents += l.plannedCents;
  if (l.actualCents !== null) {
    t.actualCents += l.actualCents;
    t.plannedWithActualCents += l.plannedCents;
    t.deviationCents += l.actualCents - l.plannedCents;
    if (!l.paid) t.pendingPaymentCents += l.actualCents;
  }
}

/** Totales y desglose por categoría (en el orden de BUDGET_CATEGORIES). */
export function summarizeBudget(
  lines: Pick<BudgetLineDto, 'category' | 'plannedCents' | 'actualCents' | 'paid'>[],
): BudgetSummary {
  const total = emptyTotals();
  const by = new Map<BudgetCategory, BudgetTotals>();
  for (const l of lines) {
    add(total, l);
    let t = by.get(l.category);
    if (!t) by.set(l.category, (t = emptyTotals()));
    add(t, l);
  }
  return {
    total,
    byCategory: BUDGET_CATEGORIES.filter((c) => by.has(c.value)).map((c) => ({
      category: c.value,
      ...by.get(c.value)!,
    })),
  };
}

/**
 * Importe escrito a mano → céntimos. Acepta «1.234,56», «1234,5», «1234.56», «1 234 €».
 * Devuelve null si no es un importe válido.
 */
export function parseMoney(input: string): number | null {
  let s = input.replace(/[€\s ]/g, '');
  if (!s) return null;
  if (!/^\d[\d.,]*$/.test(s)) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    // El último separador es el decimal; el otro, de miles.
    const dec = lastComma > lastDot ? ',' : '.';
    s = s.replace(dec === ',' ? /\./g : /,/g, '').replace(dec, '.');
  } else if (lastComma >= 0) {
    // Solo comas: decimal si hay 1–2 cifras detrás; si no, miles.
    s =
      /,\d{1,2}$/.test(s) && s.split(',').length === 2 ? s.replace(',', '.') : s.replace(/,/g, '');
  } else if (lastDot >= 0) {
    s = /\.\d{1,2}$/.test(s) && s.split('.').length === 2 ? s : s.replace(/\./g, '');
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/** Céntimos → «1234,56» para editar. */
export const moneyInput = (c: number | null): string =>
  c === null ? '' : (c / 100).toFixed(2).replace('.', ',');

/** CSV para hojas de cálculo en español: «;», coma decimal y BOM. */
export function budgetCsv(lines: BudgetLineDto[]): string {
  const esc = (v: string) => (/[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const num = (c: number | null) => (c === null ? '' : (c / 100).toFixed(2).replace('.', ','));
  const label = (c: BudgetCategory) => BUDGET_CATEGORIES.find((x) => x.value === c)?.label ?? c;
  const head = [
    'Fecha',
    'Programa',
    'Convocatoria',
    'Categoría',
    'Concepto',
    'Proveedor',
    'Previsto',
    'Real',
    'Desviación',
    'Factura',
    'Pagado',
    'Notas',
  ];
  const rows = lines.map((l) => [
    l.date ?? '',
    l.programName ?? '',
    l.eventTitle ?? '',
    label(l.category),
    l.concept,
    l.provider,
    num(l.plannedCents),
    num(l.actualCents),
    l.actualCents === null ? '' : num(l.actualCents - l.plannedCents).replace(/^(\d)/, '+$1'),
    l.invoice,
    l.paid ? 'Sí' : 'No',
    l.notes,
  ]);
  return '﻿' + [head, ...rows].map((r) => r.map((v) => esc(String(v))).join(';')).join('\r\n');
}
