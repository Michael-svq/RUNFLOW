import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultMigrationsFolder, runMigrations } from '@runflow/db';
import { loadDotEnv } from './config';

loadDotEnv();
const ownerUrl = process.env.DATABASE_OWNER_URL;
if (!ownerUrl) {
  console.error('Falta DATABASE_OWNER_URL (usuario propietario de la base de datos)');
  process.exit(1);
}
// En el bundle de producción las migraciones se copian junto al ejecutable.
const bundled = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
const migrationsFolder =
  process.env.MIGRATIONS_DIR ?? (existsSync(bundled) ? bundled : defaultMigrationsFolder);

await runMigrations({
  ownerUrl,
  appRole: process.env.DATABASE_APP_ROLE ?? 'runflow_app',
  migrationsFolder,
});
console.log('Migraciones aplicadas');
