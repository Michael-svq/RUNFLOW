import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from './client';

const IDENT = /^[a-z_][a-z0-9_]*$/;

export const defaultMigrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../migrations',
);

/**
 * Aplica las migraciones con el usuario propietario y concede al rol de la
 * aplicación permisos de lectura/escritura (sin ser propietario, le aplica RLS).
 */
export async function runMigrations(options: {
  ownerUrl: string;
  appRole: string;
  migrationsFolder?: string;
}): Promise<void> {
  if (!IDENT.test(options.appRole)) {
    throw new Error(`Nombre de rol no válido: ${options.appRole}`);
  }
  const handle = createDb(options.ownerUrl, { max: 1 });
  try {
    await migrate(handle.db, {
      migrationsFolder: options.migrationsFolder ?? defaultMigrationsFolder,
    });
    const role = sql.identifier(options.appRole);
    await handle.db.execute(sql`grant usage on schema public to ${role}`);
    await handle.db.execute(
      sql`grant select, insert, update, delete on all tables in schema public to ${role}`,
    );
    await handle.db.execute(sql`grant usage, select on all sequences in schema public to ${role}`);
    await handle.db.execute(sql`grant execute on all functions in schema public to ${role}`);
  } finally {
    await handle.close();
  }
}
