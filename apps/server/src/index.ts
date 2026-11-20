import { createDb } from '@runflow/db';
import { buildApp, type AppDeps } from './app';
import { loadConfig, loadDotEnv } from './config';

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
app.log.info(`RunFlow (${config.mode}) escuchando en ${config.host}:${config.port}`);
