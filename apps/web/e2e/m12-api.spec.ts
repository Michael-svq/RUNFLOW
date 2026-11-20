import { expect, test } from '@playwright/test';

/* F2.4: crear un token de API en Configuración y usarlo. */

const H = { 'x-runflow-request': '1' };
const ADMIN = { email: 'ana@chaneltv.test', password: 'contraseña-segura-1' };

test('F2.4: token de la API creado en Configuración', async ({ page, request, playwright }) => {
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
  await expect(page.getByRole('heading', { name: /Hola/ })).toBeVisible();
  await page.goto('/configuracion');
  const form = page.getByRole('form', { name: 'Nuevo token' });
  await form.getByLabel('Nombre del token').fill('Web de la tele');
  await form.getByRole('button', { name: 'Crear token' }).click();
  const code = page.locator('.rf-config code.rf-code').filter({ hasText: /^rf_/ });
  await expect(code).toBeVisible();
  const token = (await code.textContent())!.trim();

  const anon = await playwright.request.newContext({
    baseURL: page.url().replace(/\/configuracion.*/, ''),
  });
  const res = await anon.get('/api/v1/rundowns', { headers: { authorization: `Bearer ${token}` } });
  expect(res.status()).toBe(200);
  expect(Array.isArray((await res.json()).rundowns)).toBe(true);
  await anon.dispose();
});
