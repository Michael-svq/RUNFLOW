import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/** Binario (estado del documento Yjs). */
const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => 'bytea',
  toDriver: (value) => Buffer.from(value),
  fromDriver: (value) => new Uint8Array(value),
});

/*
 * Esquema de M0. Toda tabla de negocio lleva org_id y está protegida por
 * Row Level Security (ver migrations/0001_rls.sql y docs/adr/0002).
 */

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  /** free | basic | pro | edu | local */
  plan: text('plan').notNull().default('free'),
  /** cloud | hybrid | local */
  mode: text('mode').notNull().default('cloud'),
  timezone: text('timezone').notNull().default('Europe/Madrid'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Cuentas globales: un usuario puede pertenecer a varias empresas. */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    passwordHash: text('password_hash').notNull(),
    isPlatformAdmin: boolean('is_platform_admin').notNull().default(false),
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('users_email_lower_idx').on(sql`lower(${t.email})`)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** SHA-256 del token; el token en claro solo existe en la cookie. */
    tokenHash: text('token_hash').notNull().unique(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    activeOrgId: uuid('active_org_id').references(() => organizations.id, {
      onDelete: 'set null',
    }),
    userAgent: text('user_agent'),
    ip: text('ip'),
    createdAt: createdAt(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const roles = pgTable(
  'roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    permissions: text('permissions')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Rol creado por defecto (el de administrador no se puede borrar). */
    isSystem: boolean('is_system').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('roles_org_key_idx').on(t.orgId, t.key)],
);

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('memberships_org_user_idx').on(t.orgId, t.userId),
    index('memberships_user_idx').on(t.userId),
  ],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    data: jsonb('data')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [index('audit_log_org_created_idx').on(t.orgId, t.createdAt)],
);

/* ---------- M1: programas, escaletas y vistas ---------- */

export const programs = pgTable(
  'programs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** informativo | magacin | deportes | entretenimiento | evento | educativo | otro */
    type: text('type').notNull().default('informativo'),
    defaultStartTime: time('default_start_time'),
    defaultDurationMin: integer('default_duration_min'),
    archived: boolean('archived').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('programs_org_name_idx').on(t.orgId, sql`lower(${t.name})`)],
);

export const rundowns = pgTable(
  'rundowns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    programId: uuid('program_id')
      .notNull()
      .references(() => programs.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    airDate: date('air_date', { mode: 'string' }).notNull(),
    startTime: time('start_time').notNull(),
    endTime: time('end_time').notNull(),
    /** borrador | lista | en_aire | cerrada */
    status: text('status').notNull().default('borrador'),
    /** Estado completo del documento colaborativo (Yjs). */
    ydoc: bytea('ydoc'),
    /** Estado del directo (LiveState de @runflow/core), autoridad del servidor. */
    live: jsonb('live'),
    lineCount: integer('line_count').notNull().default(0),
    estimatedSeconds: integer('estimated_seconds').notNull().default(0),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    /** Borrado lógico (papelera, M5). */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [index('rundowns_org_date_idx').on(t.orgId, t.airDate)],
);

/** Proyección relacional de las líneas (búsquedas, listados, informes, PDF). */
export const rundownLines = pgTable(
  'rundown_lines',
  {
    rundownId: uuid('rundown_id')
      .notNull()
      .references(() => rundowns.id, { onDelete: 'cascade' }),
    id: text('id').notNull(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    num: text('num').notNull().default(''),
    type: text('type').notNull().default(''),
    cells: jsonb('cells')
      .notNull()
      .default(sql`'{}'::jsonb`),
  },
  (t) => [primaryKey({ columns: [t.rundownId, t.id] })],
);

/** Vistas guardadas de la escaleta: personales (owner) o compartidas (owner null). */
export const views = pgTable(
  'views',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    columns: jsonb('columns').$type<{ key: string; width: number }[]>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('views_org_idx').on(t.orgId)],
);

/** Registro de emisión: qué salió al aire y cuándo (PLAN §8). */
export const asrunLog = pgTable(
  'asrun_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    rundownId: uuid('rundown_id')
      .notNull()
      .references(() => rundowns.id, { onDelete: 'cascade' }),
    lineId: text('line_id').notNull(),
    num: text('num').notNull().default(''),
    name: text('name').notNull().default(''),
    type: text('type').notNull().default(''),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true, mode: 'date' }),
    durationS: integer('duration_s'),
    rehearsal: boolean('rehearsal').notNull().default(false),
    /** go | auto | event | back */
    trigger: text('trigger').notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [index('asrun_rundown_idx').on(t.rundownId, t.startedAt)],
);

/** Base de datos de personas y cargos para rótulos (TOT, INF). */
export const people = pgTable(
  'people',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    title: text('title').notNull().default(''),
    notes: text('notes').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('people_org_name_title_idx').on(
      t.orgId,
      sql`lower(${t.name})`,
      sql`lower(${t.title})`,
    ),
  ],
);

/**
 * Salidas por enlace (PLAN §14): prompter, presentador, relojes, agenda,
 * mensajes y multivista. Se abren sin usuario con un token revocable.
 */
export const outputs = pgTable(
  'outputs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    rundownId: uuid('rundown_id')
      .notNull()
      .references(() => rundowns.id, { onDelete: 'cascade' }),
    /** prompter | presenter | clocks | agenda | messages | multiview */
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    /** SHA-256 del token; el token en claro solo se muestra al crearla. */
    tokenHash: text('token_hash').notNull().unique(),
    settings: jsonb('settings')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [index('outputs_rundown_idx').on(t.rundownId)],
);
