import { locale } from '../i18n';

/* Fechas de Producción en la hora local del navegador. */

export const fmtDay = new Intl.DateTimeFormat(locale, {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});
export const fmtDate = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });
export const fmtTime = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });
export const fmtDateTime = new Intl.DateTimeFormat(locale, {
  dateStyle: 'short',
  timeStyle: 'short',
});
const monthFmt = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' });
/** «Noviembre de 2026». */
export const fmtMonth = {
  format: (d: Date) => {
    const s = monthFmt.format(d);
    return s.charAt(0).toUpperCase() + s.slice(1);
  },
};

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO → valor de <input type="datetime-local">. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`;
}

/** Valor de <input type="datetime-local"> → ISO (o null si está vacío). */
export const fromLocalInput = (v: string): string | null => (v ? new Date(v).toISOString() : null);

/** YYYY-MM-DD local. */
export const dayKey = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Rejilla de 6 semanas (lunes a domingo) que contiene el mes. */
export function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - offset);
  return Array.from(
    { length: 42 },
    (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i),
  );
}

export const WEEKDAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
