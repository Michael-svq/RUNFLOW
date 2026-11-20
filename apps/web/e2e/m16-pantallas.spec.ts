import { expect, test } from '@playwright/test';

/* F3.3 Pantallas: contenido por defecto, escena lanzada y vuelta, en vivo. */

const H = { 'x-runflow-request': '1' };
const ADMIN = { email: 'ana@chaneltv.test', password: 'contraseña-segura-1' };

test('F3.3: la pantalla cambia al lanzar una escena', async ({ page, request, browser }) => {
  const status = await (await request.get('/api/setup/status')).json();
  if (status.needsSetup) {
    await request.post('/api/setup', {
      headers: H,
      data: { orgName: 'Chanel TV', name: 'Ana Admin', ...ADMIN },
    });
  }
  const n = Date.now();
  const screenName = `Videowall ${n}`;
  const sceneName = `Apertura ${n}`;

  await page.goto('/entrar');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Contraseña').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: /Hola/ })).toBeVisible();

  await page.goto('/produccion');
  await page.getByRole('tab', { name: 'Pantallas' }).click();
  await page.getByLabel('Nombre de la pantalla').fill(screenName);
  await page.getByRole('button', { name: 'Añadir pantalla' }).click();

  const row = page.locator('.rf-screens__item', { hasText: screenName });
  await row.getByLabel(`Contenido de ${screenName}`, { exact: true }).selectOption('text');
  await row.getByLabel(`Texto de ${screenName}`, { exact: true }).fill('RunFlow TV');
  await row.getByRole('button', { name: 'Guardar' }).click();
  await expect(row.getByText('Por defecto: Texto: «RunFlow TV»')).toBeVisible();
  const link = (await row.locator('.rf-screens__link').textContent())!;

  // La pantalla, en otro navegador sin sesión.
  const wallCtx = await browser.newContext();
  const wall = await wallCtx.newPage();
  await wall.goto(link);
  await expect(wall.locator('.rf-screen__text')).toHaveText('RunFlow TV');

  // Escena con un texto distinto para esta pantalla.
  await page.getByLabel('Nombre de la escena').fill(sceneName);
  await page.getByRole('button', { name: 'Añadir escena' }).click();
  const scene = page.locator('.rf-screens__item', { hasText: sceneName });
  await scene
    .locator('.rf-screens__row', { hasText: screenName })
    .getByLabel('Por defecto')
    .uncheck();
  const label = `${screenName} en ${sceneName}`;
  await scene.getByLabel(`Contenido de ${label}`).selectOption('text');
  await scene.getByLabel(`Texto de ${label}`, { exact: true }).fill('BIENVENIDOS');
  await scene.getByRole('button', { name: 'Guardar escena' }).click();
  await expect(scene.getByRole('button', { name: 'Guardar escena' })).toBeDisabled();
  await scene.getByRole('button', { name: 'Lanzar' }).click();

  await expect(wall.locator('.rf-screen__text')).toHaveText('BIENVENIDOS');
  await expect(page.getByText(`En pantallas: ${sceneName}`)).toBeVisible();

  await page.getByRole('button', { name: 'Volver al contenido por defecto' }).click();
  await expect(wall.locator('.rf-screen__text')).toHaveText('RunFlow TV');
  await wallCtx.close();
});
