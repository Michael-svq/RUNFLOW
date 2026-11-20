import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

/** Clave pública de licencias incorporada al compilar (tsup `define`). */
declare const __RUNFLOW_LICENSE_PUBLIC_KEY__: string | undefined;
const BUILT_LICENSE_KEY =
  typeof __RUNFLOW_LICENSE_PUBLIC_KEY__ === 'string' ? __RUNFLOW_LICENSE_PUBLIC_KEY__ : '';

const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v);
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
  /** Tiempo mínimo entre dos GO manuales (protección contra doble pulsación). */
  MIN_GO_INTERVAL_MS: z.coerce.number().int().min(0).max(10_000).default(700),
  /** Station en modo híbrido: dirección de la nube y token de la Station. */
  CLOUD_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
  STATION_TOKEN: z.preprocess(emptyToUndefined, z.string().optional()),
  STATION_SYNC_INTERVAL_MS: z.coerce.number().int().min(100).default(15_000),
  WEB_DIST: z.string().optional(),
  /** Carpeta de datos de la instalación (licencia de la Station…). */
  DATA_DIR: z.string().default('./data'),
  /** HTTPS directo (Station en red local): certificado y clave en PEM. */
  TLS_CERT_FILE: z.string().optional(),
  TLS_KEY_FILE: z.string().optional(),
  /** Tamaño máximo de un fichero de media (MB). */
  MEDIA_MAX_MB: z.coerce.number().int().min(1).max(20_000).default(4096),
  /** Crear proxies de previsualización con ffmpeg (si está instalado). */
  MEDIA_PROXIES: bool.default(true),
  /** Cada cuánto se leen las fuentes RSS (ms; 0 = no se leen solas). */
  SOURCES_POLL_MS: z.coerce.number().int().min(0).default(300_000),
  /** Permite leer fuentes de la red interna (en una Station siempre). */
  SOURCES_ALLOW_PRIVATE: bool.default(false),
  /** Nube SaaS: aplica los límites de cada plan (usuarios, programas, equipos, IA). */
  PLAN_LIMITS: bool.default(false),
  /** Nube SaaS: cualquiera puede crear una empresa desde /registro. */
  SIGNUP_ENABLED: bool.default(false),
  /** Cobro con Stripe (lanzamiento). */
  STRIPE_SECRET_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  STRIPE_WEBHOOK_SECRET: z.preprocess(emptyToUndefined, z.string().optional()),
  STRIPE_PRICE_BASIC: z.preprocess(emptyToUndefined, z.string().optional()),
  STRIPE_PRICE_PRO: z.preprocess(emptyToUndefined, z.string().optional()),
  STRIPE_API_BASE: z.string().url().default('https://api.stripe.com'),
  /** Clave maestra para cifrar secretos (claves de IA). Sin ella se crea en DATA_DIR. */
  SECRET_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  /** Dirección con la que otros equipos (CasparCG) ven este servidor, p. ej. http://192.168.1.20:8080. */
  PUBLIC_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
  /** Clave pública de licencias (solo fuera de producción; en producción va compilada). */
  LICENSE_PUBLIC_KEY: z.string().optional(),
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
  minGoIntervalMs: number;
  cloudUrl: string | undefined;
  stationToken: string | undefined;
  stationSyncIntervalMs: number;
  /** Carpeta con la web compilada; si existe, el servidor la sirve. */
  webDist: string | undefined;
  dataDir: string;
  publicUrl: string | undefined;
  secretKey: string | undefined;
  planLimits: boolean;
  sourcesPollMs: number;
  mediaMaxMb: number;
  mediaProxies: boolean;
  sourcesAllowPrivate: boolean;
  signupEnabled: boolean;
  stripe:
    | {
        secretKey: string;
        webhookSecret: string | undefined;
        prices: { basic?: string; pro?: string };
        apiBase: string;
      }
    | undefined;
  tls: { certFile: string; keyFile: string } | undefined;
  licensePublicKey: string | undefined;
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
    minGoIntervalMs: e.MIN_GO_INTERVAL_MS,
    cloudUrl: e.CLOUD_URL,
    stationToken: e.STATION_TOKEN,
    stationSyncIntervalMs: e.STATION_SYNC_INTERVAL_MS,
    webDist: e.WEB_DIST,
    dataDir: path.resolve(e.DATA_DIR),
    publicUrl: e.PUBLIC_URL,
    secretKey: e.SECRET_KEY,
    planLimits: e.PLAN_LIMITS,
    sourcesPollMs: e.SOURCES_POLL_MS,
    mediaMaxMb: e.MEDIA_MAX_MB,
    mediaProxies: e.MEDIA_PROXIES,
    sourcesAllowPrivate: e.SOURCES_ALLOW_PRIVATE || e.RUNFLOW_MODE === 'station',
    signupEnabled: e.SIGNUP_ENABLED,
    stripe: e.STRIPE_SECRET_KEY
      ? {
          secretKey: e.STRIPE_SECRET_KEY,
          webhookSecret: e.STRIPE_WEBHOOK_SECRET,
          prices: {
            ...(e.STRIPE_PRICE_BASIC ? { basic: e.STRIPE_PRICE_BASIC } : {}),
            ...(e.STRIPE_PRICE_PRO ? { pro: e.STRIPE_PRICE_PRO } : {}),
          },
          apiBase: e.STRIPE_API_BASE.replace(/\/+$/, ''),
        }
      : undefined,
    tls:
      e.TLS_CERT_FILE && e.TLS_KEY_FILE
        ? { certFile: e.TLS_CERT_FILE, keyFile: e.TLS_KEY_FILE }
        : undefined,
    licensePublicKey:
      (BUILT_LICENSE_KEY || undefined) ??
      (e.NODE_ENV !== 'production' ? e.LICENSE_PUBLIC_KEY?.replace(/\\n/g, '\n') : undefined),
    logLevel: e.LOG_LEVEL ?? (e.NODE_ENV === 'production' ? 'info' : 'debug'),
  };
}
