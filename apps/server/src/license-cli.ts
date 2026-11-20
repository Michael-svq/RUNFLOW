import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { generateLicenseKeys, issueLicense } from './station/license';

/*
 * Herramienta de quien emite las licencias de RunFlow Station.
 *
 *   pnpm --filter @runflow/server license keys <carpeta>
 *       crea license-private.pem (guárdala a salvo, fuera del repositorio) y
 *       license-public.pem (se incorpora al compilar con RUNFLOW_LICENSE_PUBLIC_KEY).
 *
 *   pnpm --filter @runflow/server license issue <privada.pem> "<Centro>" <AAAA-MM-DD> [plan] [maxUsuarios]
 *       imprime el texto de la licencia para pegarlo en la consola de la Station.
 */
const [command, ...args] = process.argv.slice(2);

if (command === 'keys') {
  const dir = args[0] ?? '.';
  const keys = generateLicenseKeys();
  await writeFile(`${dir}/license-private.pem`, keys.privateKey, { mode: 0o600 });
  await writeFile(`${dir}/license-public.pem`, keys.publicKey);
  console.log(`Claves creadas en ${dir}. La privada no debe salir de tu equipo.`);
} else if (command === 'issue' && args.length >= 3) {
  const [keyFile, licensee, expires, plan = 'local', maxUsers = '0'] = args as [
    string,
    string,
    string,
    string?,
    string?,
  ];
  const privateKey = await readFile(keyFile, 'utf8');
  console.log(
    issueLicense(privateKey, {
      id: randomUUID(),
      licensee,
      plan,
      maxUsers: Number(maxUsers),
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(`${expires}T23:59:59Z`).toISOString(),
    }),
  );
} else {
  console.log(
    'Uso: license keys <carpeta> | license issue <privada.pem> "<Centro>" <AAAA-MM-DD> [plan] [maxUsuarios]',
  );
  process.exitCode = 1;
}
