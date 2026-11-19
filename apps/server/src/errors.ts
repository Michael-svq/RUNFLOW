import type { ZodType } from 'zod';

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export const unauthorized = () =>
  new HttpError(401, 'unauthorized', 'Inicia sesión para continuar');
export const forbidden = (message = 'No tienes permiso para esta acción') =>
  new HttpError(403, 'forbidden', message);
export const notFound = (message = 'No encontrado') => new HttpError(404, 'not_found', message);
export const conflict = (code: string, message: string) => new HttpError(409, code, message);
export const badRequest = (code: string, message: string, fields?: Record<string, string>) =>
  new HttpError(400, code, message, fields);

/** Valida con zod y lanza 400 con los errores por campo. */
export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data ?? {});
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '_';
    fields[key] ??= issue.message;
  }
  throw badRequest('validation', 'Revisa los datos del formulario', fields);
}

/** Código de error de Postgres (p. ej. 23505 = clave duplicada). */
export function pgErrorCode(err: unknown): string | undefined {
  let current: unknown = err;
  for (let i = 0; i < 5 && current && typeof current === 'object'; i++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}
