import { z } from 'zod';

const trimmed = (max: number) => z.string().trim().min(1, 'Obligatorio').max(max);

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email('Email no válido'));

export const passwordSchema = z
  .string()
  .min(10, 'Mínimo 10 caracteres')
  .max(200, 'Máximo 200 caracteres');

export const personNameSchema = trimmed(120);
export const orgNameSchema = trimmed(120);

export const loginInput = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Obligatorio').max(200),
});
export type LoginInput = z.infer<typeof loginInput>;

/** Primera configuración: crea la primera empresa y su administrador (también administrador de plataforma). */
export const setupInput = z.object({
  orgName: orgNameSchema,
  name: personNameSchema,
  email: emailSchema,
  password: passwordSchema,
});
export type SetupInput = z.infer<typeof setupInput>;

export const createOrgInput = z.object({
  orgName: orgNameSchema,
  adminName: personNameSchema,
  adminEmail: emailSchema,
  /** Solo se usa si el email no existe todavía. */
  adminPassword: passwordSchema.optional(),
});
export type CreateOrgInput = z.infer<typeof createOrgInput>;

export const createUserInput = z.object({
  name: personNameSchema,
  email: emailSchema,
  roleId: z.uuid(),
  /** Contraseña inicial; obligatoria si el email no existe todavía. Se pedirá cambiarla al entrar. */
  password: passwordSchema.optional(),
});
export type CreateUserInput = z.infer<typeof createUserInput>;

export const updateUserInput = z
  .object({
    name: personNameSchema.optional(),
    roleId: z.uuid().optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nada que actualizar');
export type UpdateUserInput = z.infer<typeof updateUserInput>;

export const resetPasswordInput = z.object({ password: passwordSchema });
export type ResetPasswordInput = z.infer<typeof resetPasswordInput>;

export const updateMeInput = z.object({ name: personNameSchema });
export type UpdateMeInput = z.infer<typeof updateMeInput>;

export const changePasswordInput = z
  .object({
    currentPassword: z.string().min(1, 'Obligatorio').max(200),
    newPassword: passwordSchema,
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: 'La nueva contraseña debe ser distinta',
    path: ['newPassword'],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordInput>;

export const setActiveOrgInput = z.object({ orgId: z.uuid() });
export type SetActiveOrgInput = z.infer<typeof setActiveOrgInput>;

/* ---------- Programas, escaletas y vistas (M1) ---------- */

const clockSchema = z
  .string()
  .trim()
  .regex(/^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Hora no válida (HH:MM)')
  .transform((v) => {
    const [h, m, s] = v.split(':');
    return `${h!.padStart(2, '0')}:${m}:${s ?? '00'}`;
  });

const dateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha no válida')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'Fecha no válida');

export const programTypeSchema = z.enum([
  'informativo',
  'magacin',
  'deportes',
  'entretenimiento',
  'evento',
  'educativo',
  'otro',
]);

export const createProgramInput = z.object({
  name: trimmed(120),
  type: programTypeSchema,
  defaultStartTime: clockSchema.nullable().optional(),
  defaultDurationMin: z.number().int().min(1, 'Mínimo 1 minuto').max(1440).nullable().optional(),
});
export type CreateProgramInput = z.infer<typeof createProgramInput>;

export const updateProgramInput = createProgramInput
  .partial()
  .extend({ archived: z.boolean().optional() })
  .refine((v) => Object.keys(v).length > 0, 'Nada que actualizar');
export type UpdateProgramInput = z.infer<typeof updateProgramInput>;

export const createRundownInput = z.object({
  programId: z.uuid('Elige un programa'),
  title: z.string().trim().max(160).optional(),
  airDate: dateSchema,
  startTime: clockSchema,
  endTime: clockSchema,
});
export type CreateRundownInput = z.infer<typeof createRundownInput>;

export const rundownStatusSchema = z.enum(['borrador', 'lista', 'en_aire', 'cerrada']);

export const updateRundownInput = z
  .object({
    title: trimmed(160),
    airDate: dateSchema,
    startTime: clockSchema,
    endTime: clockSchema,
    status: rundownStatusSchema,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nada que actualizar');
export type UpdateRundownInput = z.infer<typeof updateRundownInput>;

export const listRundownsQuery = z.object({
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  programId: z.uuid().optional(),
});

export const viewColumnSchema = z.object({
  key: z.string().min(1).max(40),
  width: z.number().int().min(32).max(800),
});

export const saveViewInput = z.object({
  name: trimmed(60),
  shared: z.boolean().default(false),
  columns: z
    .array(viewColumnSchema)
    .min(1, 'Elige al menos una columna')
    .max(100)
    .refine((cols) => new Set(cols.map((c) => c.key)).size === cols.length, 'Columnas repetidas'),
});
export type SaveViewInput = z.infer<typeof saveViewInput>;

/* ---------- Personas y cargos (M3) ---------- */

export const personInput = z.object({
  name: trimmed(80),
  title: z.string().trim().max(120).default(''),
  notes: z.string().trim().max(500).default(''),
});
export type PersonInput = z.infer<typeof personInput>;

export const listPeopleQuery = z.object({
  q: z.string().trim().max(80).optional(),
});
