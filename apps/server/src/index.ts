import { createDb } from '@runflow/db';
import { buildApp, type AppDeps } from './app';
import { loadConfig, loadDotEnv } from './config';
import { DEMO_ACCOUNT, ensureDemoUsers, seedDemo } from './demo/seed';

loadDotEnv();
const config = loadConfig();
const handle = createDb(config.databaseUrl);
const deps: AppDeps = {
  db: handle.db,
  config,
  version: process.env.npm_package_version ?? '0.1.0',
};
const app = await buildApp(deps);

const shutdown = async (signal: string) => {
  app.log.info(`${signal}: cerrando RunFlow`);
  await app.close();
  await handle.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ port: config.port, host: config.host });
// Retoma los directos en curso y los eventos programados.
await deps
  .live!.resume()
  .catch((err: unknown) => app.log.error({ err }, 'No se pudieron retomar los directos'));
// Station enlazada con la nube: empieza a sincronizar.
deps.stationSync?.start();
// Fuentes RSS de las empresas.
deps.sources?.start();
// Búsquedas de redes sociales.
deps.social?.start();
// Estudio virtual: datos de ejemplo la primera vez.
if (config.demo.seed) {
  try {
    const created = await seedDemo(app, deps, {
      studioHost: config.demo.studioHost,
      runflowUrl: config.publicUrl ?? `http://localhost:${config.port}`,
    });
    const users = await ensureDemoUsers(deps);
    if (created || users)
      app.log.info(
        `Estudio virtual listo: entra con ${DEMO_ACCOUNT.email} (o redac@, dirtv@, produ@runflow.test) / ${DEMO_ACCOUNT.password}`,
      );
  } catch (err) {
    app.log.error({ err }, 'No se pudieron crear los datos de ejemplo');
  }
}
app.log.info(`RunFlow (${config.mode}) escuchando en ${config.host}:${config.port}`);
