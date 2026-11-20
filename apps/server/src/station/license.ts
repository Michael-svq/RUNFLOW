import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

/*
 * Licencias de RunFlow Station (PLAN §28): un texto firmado con Ed25519 que se
 * comprueba sin conexión. Formato: `RFL1.<datos base64url>.<firma base64url>`.
 *
 * - Sin licencia: 30 días de prueba desde la instalación.
 * - Caducada: 30 días de gracia con aviso; después, solo lectura.
 * - Station enlazada con la nube: la cubre la suscripción de la nube.
 */

export const GRACE_DAYS = 30;
export const TRIAL_DAYS = 30;
const DAY = 86_400_000;
const PREFIX = 'RFL1';

export const licensePayload = z.object({
  /** Identificador de la licencia. */
  id: z.string().min(1).max(64),
  /** A quién se emite (centro, televisión…). */
  licensee: z.string().min(1).max(160),
  plan: z.string().min(1).max(40),
  /** Personas usuarias como máximo (0 = sin límite). */
  maxUsers: z.number().int().min(0).default(0),
  issuedAt: z.string(),
  expiresAt: z.string(),
});
export type LicensePayload = z.infer<typeof licensePayload>;

export type LicenseState = 'cloud' | 'valid' | 'grace' | 'trial' | 'expired' | 'unchecked';

export interface LicenseStatus {
  state: LicenseState;
  /** Se puede trabajar con normalidad (en «expired» solo se puede consultar). */
  writable: boolean;
  license: LicensePayload | null;
  /** Fin de la licencia, de la gracia o de la prueba. */
  until: string | null;
  message: string;
}

const b64u = (b: Buffer | Uint8Array) => Buffer.from(b).toString('base64url');

/** Crea un par de claves (para quien emite licencias). */
export function generateLicenseKeys(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

export function issueLicense(privateKeyPem: string, payload: LicensePayload): string {
  const data = Buffer.from(JSON.stringify(licensePayload.parse(payload)));
  const signature = sign(null, data, createPrivateKey(privateKeyPem));
  return `${PREFIX}.${b64u(data)}.${b64u(signature)}`;
}

/** Comprueba la firma y devuelve los datos de la licencia (o null si no es válida). */
export function readLicense(text: string, publicKeyPem: string): LicensePayload | null {
  const [prefix, data, signature, ...rest] = text.trim().split('.');
  if (prefix !== PREFIX || !data || !signature || rest.length) return null;
  try {
    const bytes = Buffer.from(data, 'base64url');
    if (!verify(null, bytes, createPublicKey(publicKeyPem), Buffer.from(signature, 'base64url')))
      return null;
    const parsed = licensePayload.safeParse(JSON.parse(bytes.toString('utf8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function evaluateLicense(opts: {
  linked: boolean;
  publicKey: string | undefined;
  license: LicensePayload | null;
  installedAt: Date;
  now?: Date;
}): LicenseStatus {
  const now = (opts.now ?? new Date()).getTime();
  const fmt = (t: number) => new Date(t).toISOString();
  if (opts.linked) {
    return {
      state: 'cloud',
      writable: true,
      license: null,
      until: null,
      message: 'Enlazada con la nube',
    };
  }
  if (!opts.publicKey) {
    return {
      state: 'unchecked',
      writable: true,
      license: null,
      until: null,
      message: 'Compilación sin comprobación de licencias',
    };
  }
  if (opts.license) {
    const end = Date.parse(opts.license.expiresAt);
    if (now <= end)
      return {
        state: 'valid',
        writable: true,
        license: opts.license,
        until: fmt(end),
        message: `Licencia de ${opts.license.licensee}`,
      };
    const graceEnd = end + GRACE_DAYS * DAY;
    if (now <= graceEnd)
      return {
        state: 'grace',
        writable: true,
        license: opts.license,
        until: fmt(graceEnd),
        message: 'Licencia caducada: renuévala antes de que acabe el periodo de gracia',
      };
    return {
      state: 'expired',
      writable: false,
      license: opts.license,
      until: fmt(graceEnd),
      message: 'Licencia caducada: la Station funciona solo en modo consulta',
    };
  }
  const trialEnd = opts.installedAt.getTime() + TRIAL_DAYS * DAY;
  if (now <= trialEnd)
    return {
      state: 'trial',
      writable: true,
      license: null,
      until: fmt(trialEnd),
      message: 'Periodo de prueba',
    };
  return {
    state: 'expired',
    writable: false,
    license: null,
    until: fmt(trialEnd),
    message: 'Fin del periodo de prueba: añade una licencia para seguir trabajando',
  };
}

/** Licencia de esta instalación, guardada en su carpeta de datos. */
export class LicenseManager {
  private license: LicensePayload | null = null;
  private installedAt = new Date();

  constructor(
    private readonly dataDir: string,
    private readonly publicKey: string | undefined,
    private readonly linked: boolean,
  ) {}

  private file(name: string) {
    return path.join(this.dataDir, name);
  }

  async load(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    const installed = await readFile(this.file('installed-at'), 'utf8').catch(() => null);
    if (installed && !Number.isNaN(Date.parse(installed))) {
      this.installedAt = new Date(installed.trim());
    } else {
      await writeFile(this.file('installed-at'), this.installedAt.toISOString());
    }
    const text = await readFile(this.file('license.txt'), 'utf8').catch(() => null);
    this.license = text && this.publicKey ? readLicense(text, this.publicKey) : null;
  }

  status(now?: Date): LicenseStatus {
    return evaluateLicense({
      linked: this.linked,
      publicKey: this.publicKey,
      license: this.license,
      installedAt: this.installedAt,
      ...(now ? { now } : {}),
    });
  }

  /** Guarda una licencia nueva si su firma es válida. */
  async install(text: string): Promise<LicensePayload | null> {
    if (!this.publicKey) return null;
    const license = readLicense(text, this.publicKey);
    if (!license) return null;
    await writeFile(this.file('license.txt'), text.trim());
    this.license = license;
    return license;
  }
}
