import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL es obligatoria'),
  DATABASE_OWNER_URL: z.string().optional(),
  DATABASE_APP_ROLE: z.string().default('runflow_app'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  RUNFLOW_MODE: z.enum(['cloud', 'station']).default('cloud'),
  COOKIE_SECURE: bool.default(false),
  TRUST_PROXY: bool.default(false),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(14),
  /** Intentos por minuto y por IP en login, cambio de contraseña y primera configuración. */
  AUTH_RATE_LIMIT: z.coerce.number().int().min(1).default(10),
  WEB_DIST: z.string().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
});

export interface AppConfig {
  env: 'development' | 'production' | 'test';
  databaseUrl: string;
  databaseOwnerUrl: string | undefined;
  databaseAppRole: string;
  port: number;
  host: string;
  mode: 'cloud' | 'station';
  cookieSecure: boolean;
  trustProxy: boolean;
  sessionTtlDays: number;
  authRateLimit: number;
  /** Carpeta con la web compilada; si existe, el servidor la sirve. */
  webDist: string | undefined;
  logLevel: string;
}

/** Carga `.env` de la raíz del monorepo si existe (solo desarrollo). */
export function loadDotEnv(): void {
  for (const candidate of [path.resolve('.env'), path.resolve('../../.env')]) {
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      return;
    }
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuración no válida:\n${details}`);
  }
  const e = parsed.data;
  return {
    env: e.NODE_ENV,
    databaseUrl: e.DATABASE_URL,
    databaseOwnerUrl: e.DATABASE_OWNER_URL,
    databaseAppRole: e.DATABASE_APP_ROLE,
    port: e.PORT,
    host: e.HOST,
    mode: e.RUNFLOW_MODE,
    cookieSecure: e.COOKIE_SECURE,
    trustProxy: e.TRUST_PROXY,
    sessionTtlDays: e.SESSION_TTL_DAYS,
    authRateLimit: e.AUTH_RATE_LIMIT,
    webDist: e.WEB_DIST,
    logLevel: e.LOG_LEVEL ?? (e.NODE_ENV === 'production' ? 'info' : 'debug'),
  };
}
