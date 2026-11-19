import { useState } from 'react';
import type { ZodType } from 'zod';
import { ApiError, errorMessage } from '../api/client';

export type FieldErrors = Record<string, string>;

/** Valida en el navegador con el mismo esquema que el servidor. */
export function validate<T>(
  schema: ZodType<T>,
  values: unknown,
): { data?: T; errors: FieldErrors } {
  const result = schema.safeParse(values);
  if (result.success) return { data: result.data, errors: {} };
  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '_';
    errors[key] ??= issue.message;
  }
  return { errors };
}

/** Estado de envío de un formulario: errores por campo y error general. */
export function useFormState() {
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit<T>(action: () => Promise<T>): Promise<T | undefined> {
    setSubmitting(true);
    setFormError(null);
    setFieldErrors({});
    try {
      return await action();
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length > 0) {
        setFieldErrors(err.fields);
        setFormError(err.message);
      } else {
        setFormError(errorMessage(err));
      }
      return undefined;
    } finally {
      setSubmitting(false);
    }
  }

  return { fieldErrors, setFieldErrors, formError, setFormError, submitting, submit };
}
