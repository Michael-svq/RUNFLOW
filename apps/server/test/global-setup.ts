import pg from 'pg';
import { runMigrations } from '@runflow/db';

/*
 * Crea una base de datos de pruebas nueva y le aplica las migraciones.
 * Variables (con valores por defecto para desarrollo local y CI):
 *   TEST_DATABASE_ADMIN_URL  conexión del propietario a una BD existente (para crear la de pruebas)
 *   TEST_DATABASE_NAME       nombre de la BD de pruebas
 *   TEST_APP_ROLE / TEST_APP_PASSWORD  rol sin privilegios con el que se conecta la app
 */
const adminUrl =
  process.env.TEST_DATABASE_ADMIN_URL ?? 'postgres://runflow:runflow@localhost:5432/runflow';
const dbName = process.env.TEST_DATABASE_NAME ?? 'runflow_test';
const appRole = process.env.TEST_APP_ROLE ?? 'runflow_app';
const appPassword = process.env.TEST_APP_PASSWORD ?? 'runflow_app';

function withDb(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

export default async function setup() {
  if (!/^[a-z_][a-z0-9_]*$/.test(dbName)) throw new Error('TEST_DATABASE_NAME no válido');
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${dbName} with (force)`);
  await admin.query(`create database ${dbName}`);
  await admin.end();

  const ownerUrl = withDb(adminUrl, dbName);
  await runMigrations({ ownerUrl, appRole });

  const appUrl = new URL(ownerUrl);
  appUrl.username = appRole;
  appUrl.password = appPassword;
  process.env.TEST_OWNER_URL = ownerUrl;
  process.env.TEST_APP_URL = appUrl.toString();
}
