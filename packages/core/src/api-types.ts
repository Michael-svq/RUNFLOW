import type { Permission } from './permissions';

/** Tipos de las respuestas de la API compartidos entre servidor y web. */

export interface RoleSummary {
  id: string;
  key: string;
  name: string;
}

export interface RoleDetail extends RoleSummary {
  description: string;
  permissions: Permission[];
  isSystem: boolean;
}

export interface MeOrganization {
  id: string;
  name: string;
  role: RoleSummary;
}

export interface MeResponse {
  user: {
    id: string;
    name: string;
    email: string;
    isPlatformAdmin: boolean;
    mustChangePassword: boolean;
  };
  organizations: MeOrganization[];
  activeOrg: (MeOrganization & { permissions: Permission[] }) | null;
  mode: 'cloud' | 'station';
}

export interface MemberDto {
  userId: string;
  name: string;
  email: string;
  role: RoleSummary;
  active: boolean;
  /** Pertenece a otras empresas (no se puede cambiar su nombre ni su contraseña desde aquí). */
  sharedAccount: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface CreateMemberResponse {
  member: MemberDto;
  /** true si el email ya existía y solo se ha añadido a la empresa. */
  existingAccount: boolean;
}

export interface PlatformOrgDto {
  id: string;
  name: string;
  slug: string;
  plan: string;
  mode: string;
  members: number;
  createdAt: string;
}

export interface SetupStatusResponse {
  needsSetup: boolean;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
  };
}

export interface ProgramDto {
  id: string;
  name: string;
  type: string;
  defaultStartTime: string | null;
  defaultDurationMin: number | null;
  archived: boolean;
}

export interface RundownDto {
  id: string;
  programId: string;
  programName: string;
  title: string;
  /** YYYY-MM-DD */
  airDate: string;
  /** HH:MM:SS */
  startTime: string;
  endTime: string;
  status: 'borrador' | 'lista' | 'en_aire' | 'cerrada';
  lineCount: number;
  /** Suma de TIEMPO ESTIMADO de las líneas, en segundos. */
  estimatedSeconds: number;
  createdAt: string;
  updatedAt: string;
}

export interface SavedViewDto {
  id: string;
  name: string;
  shared: boolean;
  ownerUserId: string | null;
  columns: { key: string; width: number }[];
  /** Quien la pide puede modificarla o borrarla. */
  canEdit: boolean;
}
