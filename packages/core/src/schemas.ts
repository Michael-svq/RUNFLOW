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
