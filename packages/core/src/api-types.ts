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
  /** Zona horaria de la empresa (para calcular la hora exacta de inicio y fin). */
  timezone: string;
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

export interface AsrunEntryDto {
  id: number;
  lineId: string;
  num: string;
  name: string;
  type: string;
  startedAt: string;
  endedAt: string | null;
  durationS: number | null;
  rehearsal: boolean;
  trigger: 'go' | 'auto' | 'event' | 'back';
}

export interface PersonDto {
  id: string;
  name: string;
  title: string;
  notes: string;
}

export interface ChatMessageDto {
  id: number;
  userId: string | null;
  userName: string;
  body: string;
  createdAt: string;
}

export interface TemplateDto {
  id: string;
  name: string;
  description: string;
  lineCount: number;
  createdAt: string;
}

export interface FridgeItemDto {
  id: string;
  name: string;
  cells: Record<string, string | number>;
  script: unknown[];
  createdAt: string;
}

export interface VersionDto {
  id: string;
  kind: 'auto' | 'manual' | 'restore';
  label: string;
  lineCount: number;
  createdAt: string;
  createdBy: string | null;
}

export interface TrashItemDto {
  id: string;
  title: string;
  programName: string;
  airDate: string;
  deletedAt: string;
}

export interface SearchResultDto {
  rundownId: string;
  rundownTitle: string;
  airDate: string;
  lineId: string;
  num: string;
  name: string;
}
