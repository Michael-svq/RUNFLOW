import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/*
 * scrypt (incluido en Node, sin dependencias nativas: importante para Station).
 * Formato: scrypt$N$r$p$salt$hash (base64url).
 */
const N = 1 << 15;
const R = 8;
const P = 1;
const KEYLEN = 64;
const MAXMEM = 128 * N * R * 2;

function scrypt(
  password: string,
  salt: Buffer,
  keylen: number,
  opts: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password.normalize('NFKC'), salt, keylen, opts, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return ['scrypt', N, R, P, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts as [string, string, string, string, string, string];
  const expected = Buffer.from(hashB64, 'base64url');
  const cost = Number(n);
  const block = Number(r);
  const parallel = Number(p);
  if (!expected.length || !Number.isInteger(cost) || !Number.isInteger(block)) return false;
  const key = await scrypt(password, Buffer.from(saltB64, 'base64url'), expected.length, {
    N: cost,
    r: block,
    p: parallel,
    maxmem: 128 * cost * block * 2,
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Hash de referencia para igualar tiempos cuando el email no existe. */
let dummyHash: Promise<string> | undefined;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  return dummyHash;
}
