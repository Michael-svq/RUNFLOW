import { createDb } from '@runflow/db';
import { buildApp } from './app';
import { loadConfig, loadDotEnv } from './config';

loadDotEnv();
const config = loadConfig();
const handle = createDb(config.databaseUrl);
const app = await buildApp({
  db: handle.db,
  config,
  version: process.env.npm_package_version ?? '0.1.0',
});

const shutdown = async (signal: string) => {
  app.log.info(`${signal}: cerrando RunFlow`);
  await app.close();
  await handle.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ port: config.port, host: config.host });
app.log.info(`RunFlow (${config.mode}) escuchando en ${config.host}:${config.port}`);
