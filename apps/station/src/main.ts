import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Bonjour } from 'bonjour-service';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { generate } from 'selfsigned';

/*
 * RunFlow Station (PLAN §4 y §9): un ordenador del estudio hace de servidor.
 * Arranca PostgreSQL integrado, aplica las migraciones, lanza el servidor de
 * RunFlow en modo Station y lo anuncia en la red local (mDNS), para que el
 * resto de equipos entre con el navegador.
 *
 *   runflow-station                 arranca la Station
 *   runflow-station info            carpeta de datos y direcciones
 *   runflow-station link URL TOKEN  enlaza con la nube (modo híbrido)
 *   runflow-station unlink          vuelve a modo local
 *   runflow-station https on|off    HTTPS con certificado propio de la Station
 */

interface StationConfig {
  name: string;
  port: number;
  pgPort: number;
  ownerPassword: string;
  appPassword: string;
  https: boolean;
  cloudUrl?: string;
  stationToken?: string;
}

const here = path.dirname(fileURLToPath(import.meta.url));

function defaultDataDir(): string {
  if (process.env.RUNFLOW_STATION_DATA) return path.resolve(process.env.RUNFLOW_STATION_DATA);
  if (process.platform === 'win32')
    return path.join(process.env.ProgramData ?? 'C:\\ProgramData', 'RunFlow Station');
  if (process.platform === 'darwin')
    return path.join(os.homedir(), 'Library', 'Application Support', 'RunFlow Station');
  return path.join(os.homedir(), '.runflow-station');
}

/** Servidor y web: junto al lanzador (paquete) o en el monorepo (desarrollo). */
function locate(): { serverDir: string; webDir: string | undefined } {
  const serverCandidates = [
    process.env.RUNFLOW_SERVER_DIR,
    path.join(here, 'server'),
    path.resolve(here, '../../server/dist'),
  ].filter((p): p is string => !!p);
  const serverDir = serverCandidates.find((p) => existsSync(path.join(p, 'index.js')));
  if (!serverDir) {
    throw new Error('No se encuentra el servidor de RunFlow (compila con «pnpm build»)');
  }
  const webDir = [
    process.env.RUNFLOW_WEB_DIR,
    path.join(here, 'web'),
    path.resolve(here, '../../web/dist'),
  ].find((p) => p && existsSync(path.join(p, 'index.html')));
  return { serverDir, webDir };
}

const secret = () => randomBytes(24).toString('base64url');

async function loadConfig(dataDir: string): Promise<StationConfig> {
  await mkdir(dataDir, { recursive: true });
  const file = path.join(dataDir, 'station.json');
  const saved = existsSync(file)
    ? (JSON.parse(await readFile(file, 'utf8')) as Partial<StationConfig>)
    : {};
  const config: StationConfig = {
    name: saved.name ?? `RunFlow Station (${os.hostname()})`,
    port: saved.port ?? Number(process.env.PORT ?? 8080),
    pgPort: saved.pgPort ?? 54329,
    ownerPassword: saved.ownerPassword ?? secret(),
    appPassword: saved.appPassword ?? secret(),
    https: saved.https ?? false,
    ...(saved.cloudUrl ? { cloudUrl: saved.cloudUrl } : {}),
    ...(saved.stationToken ? { stationToken: saved.stationToken } : {}),
  };
  await saveConfig(dataDir, config);
  return config;
}

async function saveConfig(dataDir: string, config: StationConfig): Promise<void> {
  const file = path.join(dataDir, 'station.json');
  await writeFile(file, JSON.stringify(config, null, 2));
  // Contiene contraseñas y el token de la Station.
  await chmod(file, 0o600).catch(() => undefined);
}

function lanAddresses(): string[] {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i): i is os.NetworkInterfaceInfo => !!i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

const hostLabel = () =>
  os
    .hostname()
    .toLowerCase()
    .replace(/\.local$/, '')
    .replace(/[^a-z0-9-]+/g, '-') || 'runflow';

function urls(config: StationConfig): string[] {
  const scheme = config.https ? 'https' : 'http';
  return [
    `${scheme}://${hostLabel()}.local:${config.port}`,
    ...lanAddresses().map((ip) => `${scheme}://${ip}:${config.port}`),
    `${scheme}://localhost:${config.port}`,
  ];
}

/** Certificado propio de la Station (los navegadores pedirán confiar en él una vez). */
async function ensureCertificate(dataDir: string): Promise<{ cert: string; key: string }> {
  const dir = path.join(dataDir, 'tls');
  const cert = path.join(dir, 'cert.pem');
  const key = path.join(dir, 'key.pem');
  if (existsSync(cert) && existsSync(key)) return { cert, key };
  await mkdir(dir, { recursive: true });
  const notAfter = new Date();
  notAfter.setFullYear(notAfter.getFullYear() + 5);
  const pems = await generate([{ name: 'commonName', value: `${hostLabel()}.local` }], {
    keyType: 'ec',
    curve: 'P-256',
    notAfterDate: notAfter,
    extensions: [
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: `${hostLabel()}.local` },
          { type: 2, value: 'localhost' },
          { type: 7, ip: '127.0.0.1' },
          ...lanAddresses().map((ip) => ({ type: 7 as const, ip })),
        ],
      },
    ],
  });
  await writeFile(cert, pems.cert);
  await writeFile(key, pems.private, { mode: 0o600 });
  return { cert, key };
}

/** PostgreSQL integrado: solo escucha en este equipo. */
async function startDatabase(dataDir: string, config: StationConfig) {
  const databaseDir = path.join(dataDir, 'postgres');
  const pgServer = new EmbeddedPostgres({
    databaseDir,
    port: config.pgPort,
    user: 'runflow',
    password: config.ownerPassword,
    persistent: true,
    createPostgresUser: process.getuid?.() === 0,
    postgresFlags: ['-c', 'listen_addresses=127.0.0.1'],
    onLog: () => undefined,
    onError: (err) => console.error('[postgres]', err),
  });
  if (!existsSync(path.join(databaseDir, 'PG_VERSION'))) {
    console.log('Preparando la base de datos (primera vez)…');
    await pgServer.initialise();
  }
  await pgServer.start();

  const admin = pgServer.getPgClient('postgres', '127.0.0.1');
  await admin.connect();
  try {
    const db = await admin.query("select 1 from pg_database where datname = 'runflow'");
    if (!db.rowCount) await admin.query('create database runflow');
    const role = await admin.query("select 1 from pg_roles where rolname = 'runflow_app'");
    const password = pg.escapeLiteral(config.appPassword);
    await admin.query(
      role.rowCount
        ? `alter role runflow_app with login password ${password}`
        : `create role runflow_app with login password ${password}`,
    );
  } finally {
    await admin.end();
  }
  const base = `postgres://%USER%:%PASS%@127.0.0.1:${config.pgPort}/runflow`;
  return {
    stop: () => pgServer.stop(),
    ownerUrl: base
      .replace('%USER%', 'runflow')
      .replace('%PASS%', encodeURIComponent(config.ownerPassword)),
    appUrl: base
      .replace('%USER%', 'runflow_app')
      .replace('%PASS%', encodeURIComponent(config.appPassword)),
  };
}

function runNode(script: string, env: NodeJS.ProcessEnv): ChildProcess {
  return spawn(process.execPath, [script], { env: { ...process.env, ...env }, stdio: 'inherit' });
}

async function migrate(serverDir: string, ownerUrl: string): Promise<void> {
  const code = await new Promise<number | null>((resolve) =>
    runNode(path.join(serverDir, 'migrate.js'), {
      DATABASE_OWNER_URL: ownerUrl,
      DATABASE_APP_ROLE: 'runflow_app',
    }).on('exit', resolve),
  );
  if (code !== 0) throw new Error('No se pudieron aplicar las migraciones');
}

async function waitForHealth(url: string, timeoutMs = 30_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) return true;
    } catch {
      // aún arrancando
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function start(dataDir: string): Promise<void> {
  const config = await loadConfig(dataDir);
  const { serverDir, webDir } = locate();
  const database = await startDatabase(dataDir, config);
  await migrate(serverDir, database.ownerUrl);
  const tls = config.https ? await ensureCertificate(dataDir) : undefined;

  const env: NodeJS.ProcessEnv = {
    NODE_ENV: 'production',
    RUNFLOW_MODE: 'station',
    DATABASE_URL: database.appUrl,
    PORT: String(config.port),
    HOST: '0.0.0.0',
    DATA_DIR: dataDir,
    COOKIE_SECURE: config.https ? 'true' : 'false',
    ...(webDir ? { WEB_DIST: webDir } : {}),
    ...(tls ? { TLS_CERT_FILE: tls.cert, TLS_KEY_FILE: tls.key } : {}),
    ...(config.cloudUrl && config.stationToken
      ? { CLOUD_URL: config.cloudUrl, STATION_TOKEN: config.stationToken }
      : {}),
  };

  let server: ChildProcess | undefined;
  let stopping = false;
  let restarts = 0;
  const launch = () => {
    server = runNode(path.join(serverDir, 'index.js'), env);
    server.on('exit', (code) => {
      if (stopping) return;
      // Si el servidor se cae, vuelve a arrancar (con espera creciente).
      const delay = Math.min(10_000, 500 * 2 ** restarts++);
      console.error(`El servidor se detuvo (código ${code}); reintento en ${delay} ms`);
      setTimeout(launch, delay);
    });
  };
  launch();

  const local = `${config.https ? 'https' : 'http'}://127.0.0.1:${config.port}`;
  if (config.https) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // comprobación local
  const up = await waitForHealth(local);
  restarts = 0;

  const bonjour = new Bonjour();
  bonjour.publish({
    name: config.name,
    type: config.https ? 'https' : 'http',
    port: config.port,
    host: `${hostLabel()}.local`,
    txt: { app: 'runflow', path: '/' },
  });

  console.log(`
  ┌──────────────────────────────────────────────┐
     RunFlow Station ${up ? 'en marcha' : '(arrancando…)'}
     Modo: ${config.cloudUrl ? `híbrido, enlazada con ${config.cloudUrl}` : 'local'}
     Datos: ${dataDir}
  └──────────────────────────────────────────────┘
  Abre en cualquier equipo de la red:
${urls(config)
  .map((u) => `    ${u}`)
  .join('\n')}
`);

  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    console.log('Deteniendo RunFlow Station…');
    bonjour.unpublishAll(() => bonjour.destroy());
    if (server && server.exitCode === null) {
      server.kill('SIGTERM');
      await new Promise((r) => server!.once('exit', r));
    }
    await database.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

async function main(): Promise<void> {
  const [command = 'start', ...args] = process.argv.slice(2);
  const dataDir = defaultDataDir();
  switch (command) {
    case 'start':
      return start(dataDir);
    case 'info': {
      const config = await loadConfig(dataDir);
      console.log(`Datos: ${dataDir}`);
      console.log(`Modo: ${config.cloudUrl ? `híbrido (${config.cloudUrl})` : 'local'}`);
      console.log(`Direcciones:\n${urls(config).join('\n')}`);
      return;
    }
    case 'link': {
      const [cloudUrl, token] = args;
      if (!cloudUrl || !token || !/^https?:\/\//.test(cloudUrl)) {
        console.error('Uso: runflow-station link https://tu-nube.example TOKEN');
        process.exitCode = 1;
        return;
      }
      const config = await loadConfig(dataDir);
      await saveConfig(dataDir, {
        ...config,
        cloudUrl: cloudUrl.replace(/\/+$/, ''),
        stationToken: token,
      });
      console.log('Enlazada. Reinicia la Station para empezar a sincronizar.');
      return;
    }
    case 'unlink': {
      const { cloudUrl: _c, stationToken: _t, ...rest } = await loadConfig(dataDir);
      await saveConfig(dataDir, rest);
      console.log('Desenlazada: la Station funcionará en modo local tras reiniciarla.');
      return;
    }
    case 'https': {
      const config = await loadConfig(dataDir);
      await saveConfig(dataDir, { ...config, https: args[0] !== 'off' });
      console.log(`HTTPS ${args[0] !== 'off' ? 'activado' : 'desactivado'}. Reinicia la Station.`);
      return;
    }
    default:
      console.error(`Orden desconocida: ${command}`);
      process.exitCode = 1;
  }
}

await main();
