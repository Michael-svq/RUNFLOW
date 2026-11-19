import { es, type MessageKey } from './es';

const messages: Record<MessageKey, string> = es;

/** Traduce una clave, sustituyendo {variables}. */
export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  const template = messages[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`));
}

export const locale = 'es-ES';

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return t('common.never');
  return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(iso),
  );
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso));
}

export type { MessageKey };
