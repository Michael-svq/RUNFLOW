/*
 * Prepara una base de datos limpia para las pruebas de navegador (apps/web/e2e).
 * La invoca el webServer de Playwright antes de arrancar el servidor.
 */
import setup from './global-setup';

process.env.TEST_DATABASE_NAME ??= 'runflow_e2e';
process.env.TEST_SKIP_STATION_DB = '1';
await setup();
console.log(`Base de datos ${process.env.TEST_DATABASE_NAME} lista`);
