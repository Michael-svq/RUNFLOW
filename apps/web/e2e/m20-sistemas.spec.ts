import { expect, test } from '@playwright/test';

/* F4.4 Otros sistemas: conector HTTP asignado a una pista y prueba a mano. */

const H = { 'x-runflow-request': '1' };
const ADMIN = { email: 'ana@chaneltv.test', password: 'contraseña-segura-1' };

test('F4.4: otro sistema por HTTP con prueba de cue', async ({ page, request }) => {
  const status = await (await request.get('/api/setup/status')).json();
  if (status.needsSetup) {
    await request.post('/api/setup', {
      headers: H,
      data: { orgName: 'Chanel TV', name: 'Ana Admin', ...ADMIN },
    });
  }
  const name = `TriCaster ${Date.now()}`;
  await page.goto('/entrar');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Contraseña').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: /Hola/ })).toBeVisible();
  const origin = new URL(page.url()).origin;

  await page.goto('/station');
  await page.getByRole('tab', { name: 'Equipos' }).click();
  await page.getByLabel('Tipo de equipo').selectOption({ label: 'Otro sistema' });
  await page.getByRole('button', { name: 'Añadir equipo' }).click();
  const form = page.getByRole('form', { name: 'Equipo Otro sistema' });
  await form.getByLabel('Nombre').fill(name);
  // La propia API de RunFlow hace de «TriCaster» en la prueba.
  await form.getByLabel('Dirección (URL)').fill(`${origin}/api/setup/status?cue={cue}`);
  await form.getByLabel('Audio').check();
  await form.getByRole('button', { name: 'Guardar equipo' }).click();

  const row = page.locator('li', { hasText: name });
  await expect(row.getByText('Otro sistema')).toBeVisible();
  await expect(row).toContainText('pistas: FX, Audio');
  page.once('dialog', (d) => void d.accept('ddr1_play'));
  await row.getByRole('button', { name: 'Probar cue' }).click();
  await expect(page.getByText(`Enviado a ${name}: ddr1_play`)).toBeVisible();
  await expect(row.getByText('Conectado')).toBeVisible();
});
