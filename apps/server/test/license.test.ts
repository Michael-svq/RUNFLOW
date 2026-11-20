import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  evaluateLicense,
  generateLicenseKeys,
  issueLicense,
  readLicense,
  type LicensePayload,
} from '../src/station/license';
import { createTestContext, PASSWORD, resetDb, setupFirstOrg, type TestContext } from './helpers';

const keys = generateLicenseKeys();
const DAY = 86_400_000;
const payload = (expiresAt: Date): LicensePayload => ({
  id: 'lic-1',
  licensee: 'IES Chanel',
  plan: 'local',
  maxUsers: 0,
  issuedAt: new Date().toISOString(),
  expiresAt: expiresAt.toISOString(),
});

describe('licencias firmadas', () => {
  it('solo acepta licencias firmadas con la clave correcta y sin retocar', () => {
    const text = issueLicense(keys.privateKey, payload(new Date(Date.now() + 365 * DAY)));
    expect(readLicense(text, keys.publicKey)?.licensee).toBe('IES Chanel');
    const other = generateLicenseKeys();
    expect(readLicense(text, other.publicKey)).toBeNull();
    const [p, data, sig] = text.split('.');
    const forged = Buffer.from(
      Buffer.from(data!, 'base64url').toString().replace('IES Chanel', 'Otro centro'),
    ).toString('base64url');
    expect(readLicense(`${p}.${forged}.${sig}`, keys.publicKey)).toBeNull();
    expect(readLicense('basura', keys.publicKey)).toBeNull();
  });

  it('prueba, vigente, gracia y caducada', () => {
    const now = new Date('2026-06-01T12:00:00Z');
    const base = { linked: false, publicKey: keys.publicKey, now };
    const installedRecently = new Date(now.getTime() - 10 * DAY);
    const installedLongAgo = new Date(now.getTime() - 40 * DAY);
    expect(evaluateLicense({ ...base, license: null, installedAt: installedRecently }).state).toBe(
      'trial',
    );
    const expiredTrial = evaluateLicense({ ...base, license: null, installedAt: installedLongAgo });
    expect(expiredTrial).toMatchObject({ state: 'expired', writable: false });
    const lic = (days: number) => payload(new Date(now.getTime() + days * DAY));
    expect(
      evaluateLicense({ ...base, license: lic(10), installedAt: installedLongAgo }).state,
    ).toBe('valid');
    expect(
      evaluateLicense({ ...base, license: lic(-10), installedAt: installedLongAgo }),
    ).toMatchObject({ state: 'grace', writable: true });
    expect(
      evaluateLicense({ ...base, license: lic(-31), installedAt: installedLongAgo }),
    ).toMatchObject({ state: 'expired', writable: false });
    expect(
      evaluateLicense({ ...base, linked: true, license: null, installedAt: installedLongAgo })
        .state,
    ).toBe('cloud');
  });
});

describe('Station local sin licencia en vigor', () => {
  let ctx: TestContext;
  let dataDir: string;

  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'runflow-license-'));
    // Instalada hace 40 días y sin licencia: la prueba ya terminó.
    await writeFile(
      path.join(dataDir, 'installed-at'),
      new Date(Date.now() - 40 * DAY).toISOString(),
    );
    await resetDb(process.env.TEST_STATION_OWNER_URL);
    ctx = await createTestContext({
      DATABASE_URL: process.env.TEST_STATION_APP_URL!,
      RUNFLOW_MODE: 'station',
      DATA_DIR: dataDir,
      LICENSE_PUBLIC_KEY: keys.publicKey,
    });
  });
  afterAll(async () => {
    await ctx.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  it('queda en modo consulta hasta que se añade una licencia válida', async () => {
    const { admin } = await setupFirstOrg(ctx.app);
    let status = await admin.get('/api/station/status');
    expect(status.body.license).toMatchObject({ state: 'expired', writable: false });
    const blocked = await admin.post('/api/programs', { name: 'Noticias', type: 'informativo' });
    expect(blocked.status).toBe(402);
    expect(blocked.body.error.code).toBe('license_expired');
    // Se puede seguir entrando.
    expect((await admin.post('/api/auth/logout')).status).toBe(200);
    await admin.login('ana@chaneltv.test', PASSWORD);

    const bad = await admin.post('/api/station/license', { license: 'RFL1.no.vale' });
    expect(bad.status).toBe(400);
    const good = issueLicense(keys.privateKey, payload(new Date(Date.now() + 365 * DAY)));
    const ok = await admin.post('/api/station/license', { license: good });
    expect(ok.status).toBe(200);
    expect(ok.body.license).toMatchObject({ state: 'valid', writable: true });

    status = await admin.get('/api/station/status');
    expect(status.body.license.license.licensee).toBe('IES Chanel');
    const created = await admin.post('/api/programs', { name: 'Noticias', type: 'informativo' });
    expect(created.status).toBe(201);
  });
});
