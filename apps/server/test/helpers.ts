import pg from 'pg';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { createDb, type DbHandle } from '@runflow/db';
import { buildApp, type AppDeps } from '../src/app';
import type { CollabServer } from '../src/collab/collab-server';
import { loadConfig } from '../src/config';

export interface TestContext {
  app: FastifyInstance;
  handle: DbHandle;
  collab: CollabServer;
  deps: AppDeps;
  close(): Promise<void>;
}

export async function createTestContext(env: Record<string, string> = {}): Promise<TestContext> {
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: process.env.TEST_APP_URL!,
    AUTH_RATE_LIMIT: '10000',
    ...env,
  });
  const handle = createDb(config.databaseUrl, { max: 4 });
  const deps: AppDeps = { db: handle.db, config, version: 'test' };
  const app = await buildApp(deps);
  await app.ready();
  return {
    app,
    handle,
    collab: deps.collab!,
    deps,
    async close() {
      await app.close();
      await handle.close();
    },
  };
}

/** Vacía todas las tablas (con el propietario, que no está sujeto a RLS). */
export async function resetDb(ownerUrl = process.env.TEST_OWNER_URL): Promise<void> {
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  await client.query(
    'truncate table stations, chat_messages, rundown_versions, rundown_templates, fridge_items, outputs, people, asrun_log, views, rundown_lines, rundowns, programs, audit_log, sessions, memberships, roles, users, organizations restart identity cascade',
  );
  await client.end();
}

/** Cliente HTTP de pruebas con su propia cookie de sesión. */
export class Client {
  cookie: string | undefined;
  constructor(private readonly app: FastifyInstance) {}

  async request(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, body?: unknown) {
    const res: LightMyRequestResponse = await this.app.inject({
      method,
      url,
      headers: {
        ...(method !== 'GET' ? { 'x-runflow-request': '1' } : {}),
        ...(this.cookie ? { cookie: this.cookie } : {}),
      },
      ...(body !== undefined ? { payload: body as object } : {}),
    });
    const setCookie = res.cookies.find((c) => c.name === 'rf_session');
    if (setCookie) this.cookie = setCookie.value ? `rf_session=${setCookie.value}` : undefined;
    return { status: res.statusCode, body: res.body ? (res.json() as any) : undefined };
  }

  get(url: string) {
    return this.request('GET', url);
  }
  post(url: string, body?: unknown) {
    return this.request('POST', url, body ?? {});
  }
  patch(url: string, body: unknown) {
    return this.request('PATCH', url, body);
  }
  delete(url: string) {
    return this.request('DELETE', url);
  }

  async login(email: string, password: string) {
    const res = await this.post('/api/auth/login', { email, password });
    if (res.status !== 200)
      throw new Error(`login ${email}: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
  }
}

export const PASSWORD = 'contraseña-segura-1';

/** Crea la instalación con una empresa "Chanel TV" y su administradora. */
export async function setupFirstOrg(app: FastifyInstance) {
  const admin = new Client(app);
  const res = await admin.post('/api/setup', {
    orgName: 'Chanel TV',
    name: 'Ana Admin',
    email: 'ana@chaneltv.test',
    password: PASSWORD,
  });
  if (res.status !== 200) throw new Error(`setup: ${res.status} ${JSON.stringify(res.body)}`);
  return { admin, me: res.body };
}

export async function roleId(client: Client, key: string): Promise<string> {
  const res = await client.get('/api/roles');
  const role = res.body.roles.find((r: { key: string }) => r.key === key);
  if (!role) throw new Error(`rol ${key} no encontrado`);
  return role.id;
}
