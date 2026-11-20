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

async function createDatabase(name: string): Promise<{ ownerUrl: string; appUrl: string }> {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error('TEST_DATABASE_NAME no válido');
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.query(`create database ${name}`);
  await admin.end();

  const ownerUrl = withDb(adminUrl, name);
  await runMigrations({ ownerUrl, appRole });

  const appUrl = new URL(ownerUrl);
  appUrl.username = appRole;
  appUrl.password = appPassword;
  return { ownerUrl, appUrl: appUrl.toString() };
}

export default async function setup() {
  const main = await createDatabase(dbName);
  process.env.TEST_OWNER_URL = main.ownerUrl;
  process.env.TEST_APP_URL = main.appUrl;
  // Segunda base de datos: la de una RunFlow Station enlazada con la nube.
  if (!process.env.TEST_SKIP_STATION_DB) {
    const station = await createDatabase(`${dbName}_station`);
    process.env.TEST_STATION_OWNER_URL = station.ownerUrl;
    process.env.TEST_STATION_APP_URL = station.appUrl;
  }
}
