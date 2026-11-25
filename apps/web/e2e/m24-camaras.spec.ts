import { expect, test, type Page } from '@playwright/test';

/* Dirección TV → Control de cámara con una cámara simulada. */

const H = { 'x-runflow-request': '1' };
const ADMIN = { email: 'ana@chaneltv.test', password: 'contraseña-segura-1' };
const shots = process.env.SCREENSHOT_DIR;
async function shot(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: false });
}
const output = (page: Page, label: string) =>
  page
    .locator('.rf-cam__slider', { has: page.getByLabel(label, { exact: true }) })
    .locator('output');

test('Control de cámara: señal, balances, control automático, posiciones y memorias', async ({
  page,
  request,
}) => {
  const status = await (await request.get('/api/setup/status')).json();
  if (status.needsSetup) {
    await request.post('/api/setup', {
      headers: H,
      data: { orgName: 'Chanel TV', name: 'Ana Admin', ...ADMIN },
    });
  } else {
    await request.post('/api/auth/login', { headers: H, data: ADMIN });
  }
  const name = `CAM SIM ${Date.now() % 100000}`;
  const created = await request.post('/api/devices', {
    headers: H,
    data: { name, kind: 'camera', config: { protocol: 'simulated' } },
  });
  expect(created.status()).toBe(201);

  await page.goto('/entrar');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Contraseña').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: /Hola/ })).toBeVisible();

  await page.goto('/camaras');
  await expect(page.getByRole('heading', { name: 'Control de cámara' })).toBeVisible();
  await page.getByRole('tab', { name }).click();
  await page.getByLabel('Fuente de imagen').selectOption('camera');
  const stats = page.getByTestId('signal-stats');
  await expect(stats).toContainText('Luma');

  // Balance de blancos automático: corrige la luz cálida del plató.
  await page.getByRole('button', { name: 'Balance de blancos (AWB)' }).click();
  await expect(output(page, 'Rojo')).toHaveText('-12');
  await expect(output(page, 'Azul')).toHaveText('+14');

  // Control automático: el plató está oscuro y abre el diafragma.
  await expect(output(page, 'Diafragma')).toHaveText('50 %');
  await page.getByRole('region', { name: 'Control automático' }).getByLabel('Activar').check();
  await expect(page.getByRole('status').filter({ hasText: /diafragma|objetivos/ })).toBeVisible();
  await expect
    .poll(async () => parseInt((await output(page, 'Diafragma').textContent()) ?? '0', 10), {
      timeout: 15_000,
    })
    .toBeGreaterThan(50);
  // Llega a los objetivos y no estropea el balance de blancos.
  await expect(page.getByText('Señal dentro de los objetivos')).toBeVisible({ timeout: 20_000 });
  await expect(output(page, 'Rojo')).toHaveText('-12');
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, 'm24-camaras');
  await page.getByRole('region', { name: 'Control automático' }).getByLabel('Activar').uncheck();

  // Posiciones: grabar y volver a la 3.
  await page.getByLabel('Grabar posición', { exact: true }).check();
  await page.getByRole('button', { name: 'Grabar posición 3' }).click();
  await expect(page.getByRole('button', { name: 'Ir a posición 3' })).toHaveClass(/is-stored/);
  await page.getByRole('button', { name: 'Ir a posición 3' }).click();

  // Memorias de ajustes.
  const memo = `Plató prueba ${Date.now() % 1000}`;
  await page.getByLabel('Nombre de la memoria').fill(memo);
  await page.getByRole('button', { name: 'Grabar ajustes actuales' }).click();
  await expect(page.getByText(`Grabada «${memo}»`)).toBeVisible();
  const item = page.locator('.rf-cam__profiles li', { hasText: memo });
  await item.getByRole('button', { name: 'Leer' }).click();
  await expect(page.getByText(`«${memo}» leída en ${name}.`)).toBeVisible();
  await item.getByRole('button', { name: `Borrar la memoria ${memo}` }).click();
  await expect(page.locator('.rf-cam__profiles li', { hasText: memo })).toHaveCount(0);
});
