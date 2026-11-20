import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/*
 * Cifrado de secretos guardados en la base de datos (claves de IA): AES-256-GCM.
 * La clave maestra viene de SECRET_KEY (32 bytes en base64 o hex) o, si no se
 * define, se crea una vez en la carpeta de datos (DATA_DIR/secret.key).
 */

const PREFIX = 'v1';

export class SecretBox {
  private constructor(private readonly key: Buffer) {}

  static async load(opts: { secretKey?: string; dataDir: string }): Promise<SecretBox> {
    if (opts.secretKey) return new SecretBox(SecretBox.parse(opts.secretKey));
    const file = path.join(opts.dataDir, 'secret.key');
    if (existsSync(file)) return new SecretBox(SecretBox.parse(await readFile(file, 'utf8')));
    await mkdir(opts.dataDir, { recursive: true });
    const key = randomBytes(32);
    await writeFile(file, key.toString('base64'), { mode: 0o600 });
    await chmod(file, 0o600).catch(() => undefined);
    return new SecretBox(key);
  }

  static parse(text: string): Buffer {
    const t = text.trim();
    const key = /^[0-9a-f]{64}$/i.test(t) ? Buffer.from(t, 'hex') : Buffer.from(t, 'base64');
    if (key.length !== 32) throw new Error('SECRET_KEY debe tener 32 bytes (base64 o hex)');
    return key;
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return [
      PREFIX,
      iv.toString('base64'),
      cipher.getAuthTag().toString('base64'),
      data.toString('base64'),
    ].join('.');
  }

  decrypt(sealed: string): string {
    const [prefix, iv, tag, data] = sealed.split('.');
    if (prefix !== PREFIX || !iv || !tag || !data)
      throw new Error('Secreto con formato desconocido');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString(
      'utf8',
    );
  }
}
