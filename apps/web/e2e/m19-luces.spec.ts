import { expect, test } from '@playwright/test';

/* F4.3 Iluminación: mesa por Art-Net con una escena y prueba de cue. */

const H = { 'x-runflow-request': '1' };
const ADMIN = { email: 'ana@chaneltv.test', password: 'contraseña-segura-1' };

test('F4.3: mesa de luces Art-Net con escena y prueba de cue', async ({ page, request }) => {
  const status = await (await request.get('/api/setup/status')).json();
  if (status.needsSetup) {
    await request.post('/api/setup', {
      headers: H,
      data: { orgName: 'Chanel TV', name: 'Ana Admin', ...ADMIN },
    });
  }
  const name = `Mesa ${Date.now()}`;
  await page.goto('/entrar');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Contraseña').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: /Hola/ })).toBeVisible();

  await page.goto('/configuracion');
  await page.getByLabel('Tipo de equipo').selectOption({ label: 'Iluminación' });
  await page.getByRole('button', { name: 'Añadir equipo' }).click();
  const form = page.getByRole('form', { name: 'Equipo Iluminación' });
  await form.getByLabel('Nombre').fill(name);
  await form.getByLabel(/Dirección de la mesa/).fill('127.0.0.1');
  await form.getByLabel('Protocolo', { exact: true }).selectOption('artnet');
  await form.getByLabel('Universo DMX').fill('0');
  await form.getByRole('button', { name: '+ Escena' }).click();
  await form.getByLabel('Escena 1', { exact: true }).fill('CALLE');
  await form.getByLabel('Canales para CALLE').fill('1=255,2-4=50%');
  await form.getByRole('button', { name: 'Guardar equipo' }).click();

  const row = page.locator('li', { hasText: name });
  await expect(row.getByText('Iluminación')).toBeVisible();
  await expect(row).toContainText('Art-Net');
  page.once('dialog', (d) => void d.accept('CALLE'));
  await row.getByRole('button', { name: 'Probar cue' }).click();
  await expect(page.getByText(`Enviado a ${name}: CALLE`)).toBeVisible();

  // Una escena que no existe da error.
  page.once('dialog', (d) => void d.accept('NOCHE'));
  await row.getByRole('button', { name: 'Probar cue' }).click();
  await expect(page.getByText(/no es una escena/).first()).toBeVisible();
});
