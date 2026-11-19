import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

export type Schema = typeof schema;
export type Db = NodePgDatabase<Schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface DbHandle {
  db: Db;
  pool: pg.Pool;
  close(): Promise<void>;
}

export function createDb(connectionString: string, options: { max?: number } = {}): DbHandle {
  const pool = new pg.Pool({ connectionString, max: options.max ?? 10 });
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
}

export interface TenantContext {
  orgId: string;
  userId: string;
}

/**
 * Ejecuta `fn` en una transacción limitada a una empresa.
 * Las políticas RLS de Postgres filtran TODAS las consultas a esa empresa,
 * aunque una consulta olvide el `where org_id = ...`.
 */
export function withTenant<T>(db: Db, ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.org_id', ${ctx.orgId}, true), set_config('app.user_id', ${ctx.userId}, true)`,
    );
    return fn(tx);
  });
}

/** Transacción de un usuario sin empresa activa: solo ve sus propias membresías y empresas. */
export function withUser<T>(db: Db, userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return fn(tx);
  });
}

/**
 * Transacción de sistema: salta el aislamiento por empresa.
 * Solo para operaciones que por naturaleza no tienen empresa
 * (login, primera configuración, administración de plataforma).
 */
export function withSystem<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.bypass_rls', 'on', true)`);
    return fn(tx);
  });
}
