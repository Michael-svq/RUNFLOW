import os from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/*
 * Pruebas de navegador contra el servidor de producción (web compilada + API)
 * con una base de datos de pruebas nueva. Requiere `pnpm build` antes.
 */
const PORT = Number(process.env.E2E_PORT ?? 3199);
const adminUrl =
  process.env.TEST_DATABASE_ADMIN_URL ?? 'postgres://runflow:runflow@localhost:5432/runflow';
const appUrl = new URL(adminUrl);
appUrl.pathname = '/runflow_e2e';
appUrl.username = process.env.TEST_APP_ROLE ?? 'runflow_app';
appUrl.password = process.env.TEST_APP_PASSWORD ?? 'runflow_app';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'es-ES',
    trace: 'off',
    // Sin animaciones: capturas estables (la interfaz respeta prefers-reduced-motion).
    contextOptions: { reducedMotion: 'reduce' },
  },
  projects: [{ name: 'escritorio', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm --dir ../server exec tsx test/e2e-prepare.ts && node ../server/dist/index.js`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      NODE_ENV: 'production',
      PORT: String(PORT),
      HOST: '127.0.0.1',
      DATABASE_URL: appUrl.toString(),
      TEST_DATABASE_ADMIN_URL: adminUrl,
      TEST_DATABASE_NAME: 'runflow_e2e',
      WEB_DIST: path.resolve(import.meta.dirname, 'dist'),
      LOG_LEVEL: 'warn',
      AUTH_RATE_LIMIT: '1000',
      SIGNUP_ENABLED: 'true',
      SOURCES_ALLOW_PRIVATE: 'true',
      SOURCES_POLL_MS: '0',
      DATA_DIR: path.join(os.tmpdir(), 'runflow-e2e-data'),
    },
  },
});
