import { expect, test, type Page } from '@playwright/test';

/*
 * M6 (parte web): alta y revocación de una RunFlow Station desde la nube.
 * La sincronización y el corte de internet en directo se prueban en el
 * servidor (apps/server/test/station.test.ts), con dos instalaciones reales.
 */

const shots = process.env.SCREENSHOT_DIR;
async function shot(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: false });
}
const H = { 'x-runflow-request': '1' };
const ADMIN = { email: 'ana@chaneltv.test', password: 'contraseña-segura-1' };

test('M6: enlazar y revocar una Station desde la nube', async ({ page, request }) => {
  const status = await (await request.get('/api/setup/status')).json();
  if (status.needsSetup) {
    await request.post('/api/setup', {
      headers: H,
      data: { orgName: 'Chanel TV', name: 'Ana Admin', ...ADMIN },
    });
  }
  await page.goto('/entrar');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Contraseña').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.goto('/station');
  await expect(page.getByRole('heading', { name: /RunFlow Station/ })).toBeVisible();

  const name = `Plató ${Date.now()}`;
  await page.getByLabel('Nombre').fill(name);
  await page.getByRole('button', { name: 'Crear enlace' }).click();
  const command = page.locator('.rf-station__token code');
  await expect(command).toContainText('runflow-station link http://');
  const token = (await command.textContent())!.trim().split(' ').pop()!;
  await shot(page, 'm6-station-creada');

  // Con ese token, la Station puede pedir la instantánea de la empresa.
  const snap = await request.get('/api/station-sync/snapshot', {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(snap.status()).toBe(200);
  expect((await snap.json()).organization.name).toBe('Chanel TV');

  await page.getByRole('button', { name: 'Hecho' }).click();
  await page.reload();
  const row = page.locator('tr', { hasText: name });
  await expect(row).toContainText('Conectada');
  await row.getByRole('button', { name: 'Revocar' }).click();
  await row.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.locator('tr', { hasText: name })).toHaveCount(0);
  const after = await request.get('/api/station-sync/snapshot', {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(after.status()).toBe(401);
});
