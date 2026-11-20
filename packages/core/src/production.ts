import { z } from 'zod';

/* F3.1 Producción: calendario, personal, hojas de llamada, invitados y logística. */

export const EVENT_KINDS = [
  { value: 'directo', label: 'Directo' },
  { value: 'grabacion', label: 'Grabación' },
  { value: 'ensayo', label: 'Ensayo' },
  { value: 'reunion', label: 'Reunión' },
  { value: 'viaje', label: 'Viaje / exteriores' },
  { value: 'otro', label: 'Otro' },
] as const;
export type EventKind = (typeof EVENT_KINDS)[number]['value'];
const eventKinds = EVENT_KINDS.map((k) => k.value) as [EventKind, ...EventKind[]];

export const EVENT_STATUSES = [
  { value: 'previsto', label: 'Previsto' },
  { value: 'confirmado', label: 'Confirmado' },
  { value: 'cancelado', label: 'Cancelado' },
] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number]['value'];
const eventStatuses = EVENT_STATUSES.map((k) => k.value) as [EventStatus, ...EventStatus[]];

export const CALL_STATUSES = [
  { value: 'pendiente', label: 'Pendiente' },
  { value: 'confirmado', label: 'Confirmado' },
  { value: 'rechazado', label: 'No puede' },
] as const;
export type CallStatus = (typeof CALL_STATUSES)[number]['value'];
const callStatuses = CALL_STATUSES.map((k) => k.value) as [CallStatus, ...CallStatus[]];

export const GUEST_STATUSES = [
  { value: 'pendiente', label: 'Pendiente' },
  { value: 'confirmado', label: 'Confirmado' },
  { value: 'llegado', label: 'Ha llegado' },
  { value: 'cancelado', label: 'Cancelado' },
] as const;
export type GuestStatus = (typeof GUEST_STATUSES)[number]['value'];
const guestStatuses = GUEST_STATUSES.map((k) => k.value) as [GuestStatus, ...GuestStatus[]];

export const LOGISTICS_CATEGORIES = [
  { value: 'transporte', label: 'Transporte' },
  { value: 'catering', label: 'Catering' },
  { value: 'escenografia', label: 'Escenografía' },
  { value: 'maquillaje', label: 'Maquillaje y peluquería' },
  { value: 'tecnico', label: 'Material técnico' },
  { value: 'otro', label: 'Otro' },
] as const;
export type LogisticsCategory = (typeof LOGISTICS_CATEGORIES)[number]['value'];
const logisticsCategories = LOGISTICS_CATEGORIES.map((k) => k.value) as [
  LogisticsCategory,
  ...LogisticsCategory[],
];

const text = (max: number) => z.string().trim().max(max);
const optDate = z.iso.datetime({ offset: true }).nullable();

export const productionEventInput = z
  .object({
    title: text(120).min(1, 'Obligatorio'),
    kind: z.enum(eventKinds).default('grabacion'),
    status: z.enum(eventStatuses).default('previsto'),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: optDate.default(null),
    location: text(200).default(''),
    notes: text(4000).default(''),
    programId: z.uuid().nullable().default(null),
    rundownId: z.uuid().nullable().default(null),
  })
  .refine((e) => !e.endsAt || Date.parse(e.endsAt) >= Date.parse(e.startsAt), {
    message: 'El fin no puede ser anterior al inicio',
    path: ['endsAt'],
  });
export type ProductionEventInput = z.infer<typeof productionEventInput>;
export const productionEventPatch = z
  .object({
    title: text(120).min(1),
    kind: z.enum(eventKinds),
    status: z.enum(eventStatuses),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: optDate,
    location: text(200),
    notes: text(4000),
    programId: z.uuid().nullable(),
    rundownId: z.uuid().nullable(),
  })
  .partial();

export const productionEventsQuery = z.object({
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});

export interface ProductionEventDto {
  id: string;
  title: string;
  kind: EventKind;
  status: EventStatus;
  startsAt: string;
  endsAt: string | null;
  location: string;
  notes: string;
  programId: string | null;
  programName: string | null;
  rundownId: string | null;
  rundownTitle: string | null;
  /** Resumen para el calendario. */
  crewTotal: number;
  crewConfirmed: number;
  crewDeclined: number;
  guestTotal: number;
  logisticsPending: number;
}

/** Persona del equipo (directorio de personal de la empresa). */
export const crewInput = z.object({
  name: text(100).min(1, 'Obligatorio'),
  role: text(80).default(''),
  phone: text(40).default(''),
  email: z.union([z.literal(''), z.email('Email no válido').max(200)]).default(''),
  notes: text(1000).default(''),
  active: z.boolean().default(true),
});
export type CrewInput = z.infer<typeof crewInput>;
export const crewPatch = z
  .object({
    name: text(100).min(1),
    role: text(80),
    phone: text(40),
    email: z.union([z.literal(''), z.email('Email no válido').max(200)]),
    notes: text(1000),
    active: z.boolean(),
  })
  .partial();

export interface CrewDto {
  id: string;
  name: string;
  role: string;
  phone: string;
  email: string;
  notes: string;
  active: boolean;
}

/** Convocatoria de una persona a un evento (línea de la hoja de llamada). */
export const callInput = z.object({
  crewId: z.uuid(),
  role: text(80).optional(),
  callAt: optDate.default(null),
});
export const callPatch = z
  .object({
    role: text(80),
    callAt: optDate,
    status: z.enum(callStatuses),
  })
  .partial();

export interface CallDto {
  id: string;
  crewId: string;
  name: string;
  phone: string;
  email: string;
  role: string;
  callAt: string | null;
  status: CallStatus;
  reply: string;
  respondedAt: string | null;
  /** Enlace de confirmación sin cuenta (/convocatoria/:token). */
  token: string;
}

export const guestInput = z.object({
  name: text(100).min(1, 'Obligatorio'),
  description: text(200).default(''),
  phone: text(40).default(''),
  email: z.union([z.literal(''), z.email('Email no válido').max(200)]).default(''),
  arrivalAt: optDate.default(null),
  makeupAt: optDate.default(null),
  setAt: optDate.default(null),
  status: z.enum(guestStatuses).default('pendiente'),
  notes: text(1000).default(''),
});
export const guestPatch = z
  .object({
    name: text(100).min(1),
    description: text(200),
    phone: text(40),
    email: z.union([z.literal(''), z.email('Email no válido').max(200)]),
    arrivalAt: optDate,
    makeupAt: optDate,
    setAt: optDate,
    status: z.enum(guestStatuses),
    notes: text(1000),
  })
  .partial();

export interface GuestDto {
  id: string;
  name: string;
  description: string;
  phone: string;
  email: string;
  arrivalAt: string | null;
  makeupAt: string | null;
  setAt: string | null;
  status: GuestStatus;
  notes: string;
}

export const logisticsInput = z.object({
  category: z.enum(logisticsCategories).default('otro'),
  description: text(200).min(1, 'Obligatorio'),
  provider: text(120).default(''),
  at: optDate.default(null),
  assignee: text(100).default(''),
  done: z.boolean().default(false),
  notes: text(1000).default(''),
});
export const logisticsPatch = z
  .object({
    category: z.enum(logisticsCategories),
    description: text(200).min(1),
    provider: text(120),
    at: optDate,
    assignee: text(100),
    done: z.boolean(),
    notes: text(1000),
  })
  .partial();

export interface LogisticsDto {
  id: string;
  category: LogisticsCategory;
  description: string;
  provider: string;
  at: string | null;
  assignee: string;
  done: boolean;
  notes: string;
}

export interface ProductionEventDetail {
  event: ProductionEventDto;
  calls: CallDto[];
  guests: GuestDto[];
  logistics: LogisticsDto[];
}

/** Lo que ve la persona convocada en su enlace (sin cuenta). */
export interface PublicCallDto {
  orgName: string;
  timezone: string;
  event: Pick<ProductionEventDto, 'title' | 'kind' | 'startsAt' | 'endsAt' | 'location' | 'notes'>;
  name: string;
  role: string;
  callAt: string | null;
  status: CallStatus;
  reply: string;
}

export const callReply = z.object({
  status: z.enum(['confirmado', 'rechazado']),
  reply: text(500).default(''),
});

export const labelOf = <T extends string>(
  list: readonly { value: T; label: string }[],
  v: T,
): string => list.find((x) => x.value === v)?.label ?? v;
